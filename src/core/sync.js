"use strict";
// Deja la carpeta del juego igual que dice el manifest: descarga lo que falta o cambio (comprobado por sha1), extrae
// los paquetes zip, crea los archivos por defecto que no existan y borra de las carpetas gestionadas lo que ya no
// esta en la lista. Lo del jugador (partidas, capturas, opciones, packs que añada el) no se toca.
// 1.1.0 (25/10): en la carpeta de OTRO launcher lo que sobra en las carpetas gestionadas no se borra: se aparta (keepStrays),
// porque puede ser del jugador; y la primera vez, los paquetes de texturas del pack se añaden a su options.txt.
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const config = require("./config");
const { download, sha1File, pool } = require("./download");
const { launcherDir } = require("./state");

/** Un archivo que Windows no deja cambiar casi siempre es un jar que el juego tiene abierto: se dice asi. */
function inUse(err, rel) {
    if (!err || err.code === "IN_USE" || !(err.inUse || /^(EBUSY|EPERM)$/.test(err.code || ""))) return err;
    const out = new Error("No se puede cambiar " + rel + " porque está en uso. Si Minecraft está abierto, ciérralo y vuelve a intentarlo.");
    out.code = "IN_USE";
    return out;
}

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

/** Las subcarpetas que se quedan vacias al borrar o apartar lo que sobra (la propia carpeta gestionada se queda). */
function pruneEmptyDirs(dir, keep = dir) {
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        return;
    }
    for (const e of entries) if (e.isDirectory()) pruneEmptyDirs(path.join(dir, e.name), keep);
    if (dir !== keep && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
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
 * Las listas de un options.txt («resourcePacks:[...]»): las del pack que falten se añaden al final de las del jugador, sin
 * tocar nada mas. Una linea que no se entienda se deja como esta. Devuelve si cambio algo.
 */
function mergeOptionLists(file, defaults) {
    const wanted = {};
    for (const line of String(defaults).split(/\r?\n/)) {
        const m = /^(\w+):(\[.*\])\s*$/.exec(line);
        if (!m) continue;
        try {
            wanted[m[1]] = JSON.parse(m[2]);
        } catch (err) {
            // el valor por defecto mal escrito no se añade
        }
    }
    if (!Object.keys(wanted).length) return false;
    const text = fs.readFileSync(file, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    let changed = false;
    for (const [key, list] of Object.entries(wanted)) {
        const index = lines.findIndex((l) => l.startsWith(key + ":"));
        if (index < 0) {
            const at = lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
            lines.splice(at, 0, key + ":" + JSON.stringify(list));
            changed = true;
            continue;
        }
        let current;
        try {
            current = JSON.parse(lines[index].slice(key.length + 1));
        } catch (err) {
            continue;
        }
        if (!Array.isArray(current)) continue;
        const missing = list.filter((v) => !current.includes(v));
        if (!missing.length) continue;
        lines[index] = key + ":" + JSON.stringify(current.concat(missing));
        changed = true;
    }
    if (changed) fs.writeFileSync(file, lines.join(eol), "utf8");
    return changed;
}

/**
 * @param manifest       el manifest validado
 * @param state          el estado (se modifica y lo guarda quien llama)
 * @param report         ({ phase, message, done, total, file }) => void
 * @param keepStrays     carpeta (dentro de la del juego) a la que se APARTAN, en vez de borrarse, los archivos de las carpetas
 *                       gestionadas que no son del pack; null = se borran (la carpeta propia)
 * @param mergeDefaults  la primera vez en una carpeta: los options.txt que ya existan reciben las listas del pack
 */
async function syncPack(manifest, state, { gameDir = config.gameDir, report = () => {}, signal, keepStrays = null, mergeDefaults = false } = {}) {
    fs.mkdirSync(gameDir, { recursive: true });
    const result = { downloaded: [], extracted: [], deleted: [], created: [], merged: [], movedAside: [], bytes: 0 };

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
            let sha1;
            try {
                ({ sha1 } = await download(entry.url, abs, {
                    sha1: entry.sha1,
                    signal,
                    onProgress: (received) => {
                        partial.set(entry.path, received);
                        let sum = doneBytes;
                        for (const v of partial.values()) sum += v;
                        report({ phase: "download", message: `Descargando ${path.basename(entry.path)}`, done: sum, total: totalBytes, file: entry.path });
                    },
                }));
            } catch (err) {
                throw inUse(err, entry.path);
            }
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
        const zipPath = path.join(launcherDir(gameDir), "bundles", bundle.name + ".zip");
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

    // 4) archivos por defecto: solo si no existen (son ajustes del jugador y no se pisan). La primera vez en una carpeta que
    // ya tenia los suyos (la de otro launcher), solo se les añaden las listas del pack: los paquetes de texturas
    for (const [rel, content] of Object.entries(manifest.defaults || {})) {
        const abs = safeJoin(gameDir, rel);
        if (!fs.existsSync(abs)) {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content, "utf8");
            result.created.push(rel);
        } else if (mergeDefaults && path.basename(rel) === "options.txt" && mergeOptionLists(abs, content)) {
            result.merged.push(rel);
        }
    }

    // 5) limpieza: lo que instalamos antes y ya no esta en la lista, y en las carpetas gestionadas todo lo que sobre (en la
    // carpeta de otro launcher, apartado a keepStrays: de ahi se puede recuperar)
    const wanted = new Set(manifest.files.map((f) => f.path));
    for (const rel of Object.keys(state.files)) {
        if (!wanted.has(rel)) {
            try {
                fs.rmSync(safeJoin(gameDir, rel), { force: true });
            } catch (err) {
                throw inUse(err, rel);
            }
            delete state.files[rel];
            result.deleted.push(rel);
        }
    }
    for (const folder of manifest.managed) {
        const dir = safeJoin(gameDir, folder);
        for (const rel of walk(dir)) {
            const full = toPosix(path.join(folder, rel));
            if (wanted.has(full)) continue;
            try {
                if (keepStrays) {
                    const to = safeJoin(gameDir, path.join(keepStrays, rel));
                    fs.mkdirSync(path.dirname(to), { recursive: true });
                    fs.rmSync(to, { force: true });
                    fs.renameSync(safeJoin(gameDir, full), to);
                    result.movedAside.push(full);
                } else {
                    fs.rmSync(safeJoin(gameDir, full), { force: true });
                    result.deleted.push(full);
                }
            } catch (err) {
                throw inUse(err, full);
            }
        }
        pruneEmptyDirs(dir);
    }
    state.packVersion = manifest.pack.version;
    report({ phase: "done", message: "Pack al día" });
    return result;
}

module.exports = { syncPack, mergeOptionLists };
