"use strict";
// El manifest.json del pack: que version es, que Forge lleva, la direccion del servidor, los enlaces, las novedades y
// la lista de archivos con su sha1. Lo genera tools/build_launcher_pack.py en el repositorio privado del servidor y se
// publica como asset del release "pack-X.Y.Z" del repositorio del pack.
//
// {
//   "format": 1,
//   "pack": { "name": "DemonCraft", "version": "1.5.0", "minecraft": "1.20.1", "forge": "47.4.10" },
//   "forge": { "versionId": "1.20.1-forge-47.4.10", "installer": "https://...-installer.jar", "sha1": "..." },
//   "server": { "name": "DemonCraft", "address": "play.demoncraft.es" },
//   "links": { "discord": "...", "store": "...", "web": "..." },
//   "java": { "args": "-XX:+UseG1GC ...", "minRamGb": 3, "defaultRamGb": 4 },
//   "managed": ["mods"],                       carpetas que son solo nuestras: lo que sobre se borra
//   "files": [ { "path": "mods/x.jar", "url": "https://...", "sha1": "...", "size": 123 } ],
//   "bundles": [ { "name": "config", "url": "https://...zip", "sha1": "...", "size": 1 } ],   zips que se extraen en la carpeta del juego
//   "defaults": { "options.txt": "lang:es_es\n" },     archivos que se crean SOLO si no existen (ajustes del jugador)
//   "news": [ { "date": "2026-09-22", "title": "...", "body": "..." } ]
// }
const path = require("path");
const config = require("./config");
const { fetchJson } = require("./download");
const state = require("./state");

function cachePath(gameDir = config.gameDir) {
    return path.join(state.launcherDir(gameDir), "manifest.json");
}

function validate(manifest) {
    if (!manifest || typeof manifest !== "object") throw new Error("El manifest del pack no es un JSON valido");
    if (!manifest.pack || !manifest.pack.version) throw new Error("El manifest no dice la version del pack");
    if (!manifest.forge || !manifest.forge.versionId || !manifest.forge.installer) throw new Error("El manifest no dice que Forge instalar");
    if (!Array.isArray(manifest.files)) manifest.files = [];
    if (!Array.isArray(manifest.bundles)) manifest.bundles = [];
    if (!Array.isArray(manifest.managed)) manifest.managed = ["mods"];
    if (!manifest.server) manifest.server = {};
    if (!manifest.links) manifest.links = {};
    if (!manifest.java) manifest.java = {};
    if (!manifest.defaults) manifest.defaults = {};
    if (!Array.isArray(manifest.news)) manifest.news = [];
    for (const f of manifest.files) {
        if (!f.path || !f.url || !f.sha1) throw new Error("Una entrada de files del manifest esta incompleta: " + JSON.stringify(f).slice(0, 80));
        const rel = f.path.replace(/\\/g, "/");
        if (rel.startsWith("/") || rel.includes("../") || /^[a-zA-Z]:/.test(rel)) throw new Error("Ruta no permitida en el manifest: " + f.path);
        f.path = rel;
    }
    return manifest;
}

/**
 * Pide el manifest al servidor. Si no hay conexion (o GitHub falla) y ya habia uno guardado, devuelve ese y lo marca
 * como `offline: true` para que la interfaz lo diga.
 */
async function fetchManifest({ gameDir = config.gameDir, url = config.manifestUrl, signal } = {}) {
    const cached = state.readJsonSafe(cachePath(gameDir));
    if (/OWNER/.test(url)) {
        if (cached) return { manifest: validate(cached), offline: true, error: "El launcher aun no tiene configurado el repositorio del pack" };
        throw new Error("El launcher aun no tiene configurado el repositorio del pack (config.js: OWNER)");
    }
    try {
        const manifest = validate(await fetchJson(url, { signal }));
        state.writeJson(cachePath(gameDir), manifest);
        return { manifest, offline: false };
    } catch (err) {
        if (err && err.name === "AbortError") throw err;
        if (cached) return { manifest: validate(cached), offline: true, error: err.message };
        throw new Error("No se pudo descargar la lista del pack y no hay una copia anterior: " + err.message);
    }
}

module.exports = { fetchManifest, validate, cachePath };
