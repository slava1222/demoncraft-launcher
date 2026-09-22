"use strict";
// Forge se instala en el .minecraft real con el instalador oficial en modo silencioso (--installClient), igual que lo
// hace CurseForge: asi sirve tanto para el launcher clasico como para el de la Store/Xbox. Encima se crea una version
// propia "DemonCraft" que hereda de la de Forge y añade --quickPlayMultiplayer: al pulsar JUGAR en el launcher
// oficial, el juego arranca y entra solo en el servidor.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config");
const { download } = require("./download");
const stateStore = require("./state");

function versionJsonPath(minecraftDir, id) {
    return path.join(minecraftDir, "versions", id, id + ".json");
}

function forgeInstalled(minecraftDir, versionId) {
    const json = versionJsonPath(minecraftDir, versionId);
    if (!fs.existsSync(json)) return false;
    // el instalador deja el jar de cliente de Forge en libraries: sin el, la version esta a medias
    const m = /^(\d+\.\d+(?:\.\d+)?)-forge-(.+)$/.exec(versionId);
    if (m) {
        const full = m[1] + "-" + m[2];
        const clientJar = path.join(minecraftDir, "libraries", "net", "minecraftforge", "forge", full, "forge-" + full + "-client.jar");
        if (!fs.existsSync(clientJar)) return false;
    }
    return true;
}

function ensureLauncherProfilesFile(minecraftDir) {
    const file = path.join(minecraftDir, "launcher_profiles.json");
    if (!fs.existsSync(file)) {
        fs.mkdirSync(minecraftDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ profiles: {}, settings: { enableSnapshots: false, keepLauncherOpen: false, showGameLog: false }, version: 3 }, null, 2));
    }
}

function runInstaller(javaExe, installerJar, minecraftDir, report) {
    return new Promise((resolve, reject) => {
        const logLines = [];
        const child = spawn(javaExe, ["-jar", installerJar, "--installClient", minecraftDir], { cwd: path.dirname(installerJar), windowsHide: true });
        const onData = (buf) => {
            for (const line of buf.toString("utf8").split(/\r?\n/)) {
                if (!line.trim()) continue;
                logLines.push(line);
                if (logLines.length > 400) logLines.shift();
                const m = /(Downloading|Extracting|Processing|Task|Considering|Building|Splitting|Created|Finished|Successfully)/i.exec(line);
                if (m) report({ phase: "forge", message: "Instalando Forge: " + line.trim().slice(0, 90) });
            }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolve(logLines);
            else reject(new Error("El instalador de Forge fallo (codigo " + code + "):\n" + logLines.slice(-12).join("\n")));
        });
    });
}

async function ensureForge(manifest, { gameDir = config.gameDir, minecraftDir = config.minecraftDir, javaExe, state, report = () => {}, signal } = {}) {
    const versionId = manifest.forge.versionId;
    ensureLauncherProfilesFile(minecraftDir);
    if (forgeInstalled(minecraftDir, versionId)) return { installed: false, versionId };

    const before = stateStore.readJsonSafe(path.join(minecraftDir, "launcher_profiles.json"));
    const profilesBefore = new Set(Object.keys((before && before.profiles) || {}));

    const installerJar = path.join(stateStore.launcherDir(gameDir), "forge", path.basename(new URL(manifest.forge.installer).pathname));
    report({ phase: "forge", message: "Descargando el instalador de Forge...", done: 0, total: 0 });
    await download(manifest.forge.installer, installerJar, { sha1: manifest.forge.sha1 || undefined, signal, onProgress: (received, total) => report({ phase: "forge", message: "Descargando el instalador de Forge...", done: received, total }) });
    report({ phase: "forge", message: "Instalando Forge " + manifest.pack.forge + " (descarga Minecraft " + manifest.pack.minecraft + " y sus librerias; puede tardar unos minutos)..." });
    const log = await runInstaller(javaExe, installerJar, minecraftDir, report);
    if (!forgeInstalled(minecraftDir, versionId)) {
        throw new Error("El instalador termino pero Forge no aparece instalado:\n" + log.slice(-10).join("\n"));
    }
    // el instalador añade su propio perfil "forge" al launcher: sobra, el nuestro es el de DemonCraft
    const after = stateStore.readJsonSafe(path.join(minecraftDir, "launcher_profiles.json"));
    if (after && after.profiles) {
        let changed = false;
        for (const key of Object.keys(after.profiles)) {
            const p = after.profiles[key];
            if (!profilesBefore.has(key) && p && p.lastVersionId === versionId && key !== config.profileId) {
                delete after.profiles[key];
                changed = true;
            }
        }
        if (changed) stateStore.writeJson(path.join(minecraftDir, "launcher_profiles.json"), after);
    }
    if (state) state.forge = { versionId };
    return { installed: true, versionId };
}

/** La version "DemonCraft": hereda TODO de Forge y añade la entrada directa al servidor (si hay direccion). */
function writeCustomVersion(manifest, { minecraftDir = config.minecraftDir } = {}) {
    const parentId = manifest.forge.versionId;
    const parent = stateStore.readJsonSafe(versionJsonPath(minecraftDir, parentId));
    if (!parent) throw new Error("No encuentro la version de Forge " + parentId + " en " + minecraftDir);
    const id = config.customVersionId;
    const address = (manifest.server && manifest.server.address) ? String(manifest.server.address).trim() : "";
    const now = new Date().toISOString();
    const json = {
        id,
        inheritsFrom: parentId,
        type: "release",
        time: now,
        releaseTime: parent.releaseTime || now,
        mainClass: parent.mainClass,
        arguments: { game: address ? ["--quickPlayMultiplayer", address] : [], jvm: [] },
    };
    stateStore.writeJson(versionJsonPath(minecraftDir, id), json);
    return id;
}

module.exports = { ensureForge, forgeInstalled, writeCustomVersion, ensureLauncherProfilesFile };
