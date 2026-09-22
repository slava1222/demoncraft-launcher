"use strict";
// Lo que hace el launcher oficial por debajo: resolver la version a lanzar (nuestra cadena es
// 1.20.1-forge-47.4.10 -> 1.20.1), evaluar las reglas por sistema operativo y caracteristicas, y dejar en disco el jar
// del cliente, las librerias y los assets. Todo se comparte con el launcher oficial en su .minecraft (mismas rutas),
// asi que lo que ya tenga el jugador no se vuelve a bajar.
const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("./config");
const { download, fetchJson, pool } = require("./download");

const VERSION_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const RESOURCES = "https://resources.download.minecraft.net/";

const OS_NAME = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux";
const OS_ARCH = process.arch === "ia32" ? "x86" : process.arch === "x64" ? "x86_64" : process.arch;

/** Semantica de Mojang: sin reglas, permitido; con reglas, gana la ultima que encaje (allow/disallow). */
function ruleAllows(rules, features = {}) {
    if (!Array.isArray(rules) || !rules.length) return true;
    let allowed = false;
    for (const rule of rules) {
        let matches = true;
        if (rule.os) {
            if (rule.os.name && rule.os.name !== OS_NAME) matches = false;
            if (rule.os.arch && rule.os.arch !== OS_ARCH) matches = false;
            if (rule.os.version) {
                try {
                    if (!new RegExp(rule.os.version).test(os.release())) matches = false;
                } catch (err) {
                    matches = false;
                }
            }
        }
        if (rule.features) {
            for (const [key, value] of Object.entries(rule.features)) {
                if (Boolean(features[key]) !== Boolean(value)) matches = false;
            }
        }
        if (matches) allowed = rule.action === "allow";
    }
    return allowed;
}

function versionJsonPath(minecraftDir, id) {
    return path.join(minecraftDir, "versions", id, id + ".json");
}

function readVersionJson(minecraftDir, id) {
    return JSON.parse(fs.readFileSync(versionJsonPath(minecraftDir, id), "utf8"));
}

/** El json de una version vanilla, bajandolo del manifest de Mojang si no esta. */
async function ensureVersionJson(minecraftDir, id, { report = () => {}, signal } = {}) {
    const file = versionJsonPath(minecraftDir, id);
    if (fs.existsSync(file)) return readVersionJson(minecraftDir, id);
    report({ message: "Descargando la definicion de Minecraft " + id + "..." });
    const manifest = await fetchJson(VERSION_MANIFEST, { signal });
    const entry = (manifest.versions || []).find((v) => v.id === id);
    if (!entry) throw new Error("Mojang no conoce la version " + id);
    await download(entry.url, file, { sha1: entry.sha1, signal });
    return readVersionJson(minecraftDir, id);
}

/** La cadena de herencia: [hija, madre, ..., vanilla]. */
async function loadChain(minecraftDir, id, options) {
    const chain = [];
    let current = id;
    const seen = new Set();
    while (current) {
        if (seen.has(current)) throw new Error("Herencia circular en la version " + id);
        seen.add(current);
        let json;
        if (fs.existsSync(versionJsonPath(minecraftDir, current))) json = readVersionJson(minecraftDir, current);
        else json = await ensureVersionJson(minecraftDir, current, options);
        chain.push(json);
        current = json.inheritsFrom;
    }
    return chain;
}

function firstDefined(chain, key) {
    for (const json of chain) if (json[key] !== undefined) return json[key];
    return undefined;
}

/** Une la cadena como hace el launcher oficial: argumentos de la vanilla primero, librerias de la hija primero. */
function mergeChain(chain) {
    const root = chain[chain.length - 1];
    const jvm = [];
    const game = [];
    const libraries = [];
    for (const json of [...chain].reverse()) {
        const args = json.arguments || {};
        if (Array.isArray(args.jvm)) jvm.push(...args.jvm);
        if (Array.isArray(args.game)) game.push(...args.game);
        if (json.minecraftArguments) game.push(...json.minecraftArguments.split(" ")); // formato antiguo, por si acaso
    }
    for (const json of chain) if (Array.isArray(json.libraries)) libraries.push(...json.libraries);
    return {
        id: chain[0].id,
        jar: firstDefined(chain, "jar") || root.id,
        mainClass: firstDefined(chain, "mainClass"),
        type: firstDefined(chain, "type") || "release",
        assetIndex: firstDefined(chain, "assetIndex"),
        assets: firstDefined(chain, "assets"),
        downloads: firstDefined(chain, "downloads"),
        javaVersion: firstDefined(chain, "javaVersion"),
        logging: firstDefined(chain, "logging"),
        arguments: { jvm, game },
        libraries,
    };
}

function mavenPath(name) {
    const parts = name.split(":");
    const [group, artifact, version] = parts;
    let classifier = parts[3] || "";
    let ext = "jar";
    const at = version.indexOf("@");
    let ver = version;
    if (at >= 0) {
        ext = version.slice(at + 1);
        ver = version.slice(0, at);
    }
    if (classifier.includes("@")) {
        ext = classifier.split("@")[1];
        classifier = classifier.split("@")[0];
    }
    return `${group.replace(/\./g, "/")}/${artifact}/${ver}/${artifact}-${ver}${classifier ? "-" + classifier : ""}.${ext}`;
}

function libraryFile(minecraftDir, lib) {
    const rel = (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) || mavenPath(lib.name);
    return path.join(minecraftDir, "libraries", rel);
}

function sizeOk(file, size) {
    try {
        const stat = fs.statSync(file);
        return stat.isFile() && (size == null || stat.size === size);
    } catch (err) {
        return false;
    }
}

/** Deja en disco las librerias permitidas por las reglas y devuelve sus rutas en orden (para el classpath). */
async function ensureLibraries(merged, minecraftDir, { report = () => {}, signal } = {}) {
    const wanted = [];
    const seen = new Set();
    for (const lib of merged.libraries) {
        if (!ruleAllows(lib.rules)) continue;
        const file = libraryFile(minecraftDir, lib);
        if (seen.has(file)) continue;
        seen.add(file);
        wanted.push({ lib, file });
    }
    const missing = wanted.filter(({ lib, file }) => {
        const art = lib.downloads && lib.downloads.artifact;
        return !sizeOk(file, art && art.size);
    });
    if (missing.length) {
        report({ message: `Descargando ${missing.length} libreria(s)...`, done: 0, total: missing.length });
        let done = 0;
        await pool(missing, config.parallelDownloads, async ({ lib, file }) => {
            const art = lib.downloads && lib.downloads.artifact;
            let url = art && art.url;
            if (!url) url = (lib.url || "https://libraries.minecraft.net/") + mavenPath(lib.name);
            await download(url, file, { sha1: art && art.sha1, signal });
            done++;
            report({ message: `Descargando librerias (${done}/${missing.length})`, done, total: missing.length });
        });
    }
    return wanted.map((w) => w.file);
}

async function ensureClientJar(merged, minecraftDir, { report = () => {}, signal } = {}) {
    // El jar del cliente se llama como la VERSION LANZADA (versions/1.20.1-forge-47.4.10/1.20.1-forge-47.4.10.jar),
    // igual que hace el launcher oficial: la lista de exclusion del cargador de Forge (-DignoreList=...,${version_name}.jar)
    // se basa en ese nombre y, con el nombre vanilla, el juego muere al construir los modulos.
    const file = path.join(minecraftDir, "versions", merged.id, merged.id + ".jar");
    const client = merged.downloads && merged.downloads.client;
    if (!client) {
        if (fs.existsSync(file)) return file;
        throw new Error("La version " + merged.id + " no dice de donde bajar el cliente");
    }
    if (sizeOk(file, client.size)) return file;
    const inherited = path.join(minecraftDir, "versions", merged.jar, merged.jar + ".jar");
    if (merged.jar !== merged.id && sizeOk(inherited, client.size)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.copyFileSync(inherited, file);
        return file;
    }
    report({ message: "Descargando Minecraft " + merged.jar + "...", done: 0, total: client.size || 0 });
    await download(client.url, file, { sha1: client.sha1, signal, onProgress: (received, total) => report({ message: "Descargando Minecraft " + merged.jar + "...", done: received, total }) });
    return file;
}

/** Donde viven los assets: los del .minecraft real si ya tienen ese indice (asi no se bajan 650 MB dos veces). */
function assetsRootFor(minecraftDir, indexId) {
    const own = path.join(minecraftDir, "assets");
    if (fs.existsSync(path.join(own, "indexes", indexId + ".json"))) return own;
    const real = path.join(process.env.APPDATA || "", ".minecraft", "assets");
    if (fs.existsSync(path.join(real, "indexes", indexId + ".json"))) return real;
    return own;
}

async function ensureAssets(merged, minecraftDir, { report = () => {}, signal } = {}) {
    const index = merged.assetIndex;
    if (!index) throw new Error("La version no tiene indice de assets");
    const root = assetsRootFor(minecraftDir, index.id);
    const indexFile = path.join(root, "indexes", index.id + ".json");
    if (!sizeOk(indexFile, index.size)) await download(index.url, indexFile, { sha1: index.sha1, signal });
    const objects = JSON.parse(fs.readFileSync(indexFile, "utf8")).objects || {};
    const missing = [];
    for (const [name, obj] of Object.entries(objects)) {
        const file = path.join(root, "objects", obj.hash.slice(0, 2), obj.hash);
        if (!sizeOk(file, obj.size)) missing.push({ name, hash: obj.hash, size: obj.size, file });
    }
    if (missing.length) {
        const totalBytes = missing.reduce((s, m) => s + m.size, 0);
        let doneBytes = 0;
        let done = 0;
        report({ message: `Descargando recursos del juego (${missing.length} archivos)...`, done: 0, total: totalBytes });
        await pool(missing, 12, async (m) => {
            await download(RESOURCES + m.hash.slice(0, 2) + "/" + m.hash, m.file, { sha1: m.hash, signal });
            doneBytes += m.size;
            done++;
            if (done % 20 === 0 || done === missing.length) report({ message: `Descargando recursos del juego (${done}/${missing.length})`, done: doneBytes, total: totalBytes });
        });
    }
    return { root, indexId: index.id };
}

module.exports = { ruleAllows, loadChain, mergeChain, ensureLibraries, ensureClientJar, ensureAssets, ensureVersionJson, mavenPath, OS_NAME };
