"use strict";
// Deja la carpeta del juego igual que dice el manifest: descarga lo que falta o cambio (comprobado por sha1), extrae
// los paquetes zip, crea los archivos por defecto que no existan y borra de las carpetas gestionadas lo que ya no
// esta en la lista. Lo del jugador (partidas, capturas, opciones, packs que añada el) no se toca.
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const config = require("./config");
const { download, sha1File, pool } = require("./download");

function toPosix(p) {
    return p.split(path.sep).join("/");
}

function safeJoin(base, rel) {
    const abs = path.resolve(base, rel);
    if (!abs.startsWith(path.resolve(base) + path.sep)) throw new Error("Ruta fuera de la carpeta del juego: " + rel);
    return abs;
}

async function isCurrent(abs, entry, state) {
    let stat;
    try {
        stat = fs.statSync(abs);
    } catch (err) {
        return false;
    }
    if (!stat.isFile()) return false;
    if (entry.size != null && stat.size !== entry.size) return false;
    const known = state.files[entry.path];
    if (known && known.sha1 === entry.sha1 && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return true;
    const digest = await sha1File(abs);
    if (digest !== String(entry.sha1).toLowerCase()) return false;
    state.files[entry.path] = { sha1: digest, size: stat.size, mtimeMs: stat.mtimeMs };
    return true;
}

function remember(state, rel, abs, sha1) {
    const stat = fs.statSync(abs);
    state.files[rel] = { sha1, size: stat.size, mtimeMs: stat.mtimeMs };
}

function walk(dir, out = [], base = dir) {
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        return out;
    }
    for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs, out, base);
        else out.push(toPosix(path.relative(base, abs)));
    }
    return out;
}

/**
 * @param manifest  el manifest validado
 * @param state     el estado (se modifica y lo guarda quien llama)
 * @param report    ({ phase, message, done, total, file }) => void
 */
async function syncPack(manifest, state, { gameDir = config.gameDir, report = () => {}, signal } = {}) {
    fs.mkdirSync(gameDir, { recursive: true });
    const result = { downloaded: [], extracted: [], deleted: [], created: [], bytes: 0 };

    // 1) que archivos hay que bajar
    report({ phase: "check", message: "Comprobando los archivos del pack..." });
    const pending = [];
    for (const entry of manifest.files) {
        const abs = safeJoin(gameDir, entry.path);
        if (!(await isCurrent(abs, entry, state))) pending.push(entry);
    }
    const totalBytes = pending.reduce((sum, e) => sum + (e.size || 0), 0);
    let doneBytes = 0;
    const partial = new Map();

    // 2) descargas (varias a la vez, progreso agregado)
    if (pending.length) {
        report({ phase: "download", message: `Descargando ${pending.length} archivo(s)...`, done: 0, total: totalBytes });
        await pool(pending, config.parallelDownloads, async (entry) => {
            if (signal && signal.aborted) throw Object.assign(new Error("Cancelado"), { name: "AbortError" });
            const abs = safeJoin(gameDir, entry.path);
            const { sha1 } = await download(entry.url, abs, {
                sha1: entry.sha1,
                signal,
                onProgress: (received) => {
                    partial.set(entry.path, received);
                    let sum = doneBytes;
                    for (const v of partial.values()) sum += v;
                    report({ phase: "download", message: `Descargando ${path.basename(entry.path)}`, done: sum, total: totalBytes, file: entry.path });
                },
            });
            partial.delete(entry.path);
            doneBytes += entry.size || 0;
            remember(state, entry.path, abs, sha1);
            result.downloaded.push(entry.path);
            result.bytes += entry.size || 0;
        });
    }

    // 3) paquetes zip (config, etc.): se extraen cuando cambian y se recuerda que dejaron para poder limpiar despues
    for (const bundle of manifest.bundles) {
        const known = state.extracted[bundle.name];
        if (known && known.sha1 === bundle.sha1) continue;
        report({ phase: "download", message: `Descargando ${bundle.name}...`, done: 0, total: bundle.size || 0 });
        const zipPath = path.join(gameDir, ".launcher", "bundles", bundle.name + ".zip");
        await download(bundle.url, zipPath, { sha1: bundle.sha1, signal, onProgress: (received, total) => report({ phase: "download", message: `Descargando ${bundle.name}...`, done: received, total }) });
        report({ phase: "extract", message: `Instalando ${bundle.name}...` });
        const zip = new AdmZip(zipPath);
        const left = [];
        for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            const rel = entry.entryName.replace(/\\/g, "/");
            if (rel.startsWith("/") || rel.includes("../")) continue;
            const abs = safeJoin(gameDir, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, entry.getData());
            left.push(rel);
        }
        // lo que dejo la version anterior del paquete y ya no viene, fuera
        if (known && Array.isArray(known.files)) {
            for (const rel of known.files) {
                if (!left.includes(rel)) {
                    fs.rmSync(safeJoin(gameDir, rel), { force: true });
                    result.deleted.push(rel);
                }
            }
        }
        state.extracted[bundle.name] = { sha1: bundle.sha1, files: left };
        result.extracted.push(bundle.name);
    }

    // 4) archivos por defecto: solo si no existen (son ajustes del jugador y no se pisan)
    for (const [rel, content] of Object.entries(manifest.defaults || {})) {
        const abs = safeJoin(gameDir, rel);
        if (!fs.existsSync(abs)) {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content, "utf8");
            result.created.push(rel);
        }
    }

    // 5) limpieza: lo que instalamos antes y ya no esta en la lista, y en las carpetas gestionadas todo lo que sobre
    const wanted = new Set(manifest.files.map((f) => f.path));
    for (const rel of Object.keys(state.files)) {
        if (!wanted.has(rel)) {
            fs.rmSync(safeJoin(gameDir, rel), { force: true });
            delete state.files[rel];
            result.deleted.push(rel);
        }
    }
    for (const folder of manifest.managed) {
        const dir = safeJoin(gameDir, folder);
        for (const rel of walk(dir)) {
            const full = toPosix(path.join(folder, rel));
            if (!wanted.has(full)) {
                fs.rmSync(safeJoin(gameDir, full), { force: true });
                result.deleted.push(full);
            }
        }
    }
    state.packVersion = manifest.pack.version;
    report({ phase: "done", message: "Pack al dia" });
    return result;
}

module.exports = { syncPack };
