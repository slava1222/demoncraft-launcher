"use strict";
// Lo que el launcher recuerda entre arranques: que archivos del pack ya tiene (con su sha1, tamaño y fecha, para no
// volver a calcular 200 MB de hashes cada vez), que Java y Forge instalo, los ajustes del jugador y el ultimo manifest
// bueno (para poder jugar sin conexion con lo que ya hay).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");

function samePath(a, b) {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function launcherDir(gameDir = config.gameDir) {
    const own = path.join(config.gameDir, ".launcher");
    if (samePath(gameDir, config.gameDir)) return own;
    // 1.1.0 (25/10): la carpeta del juego de OTRO launcher no se ensucia con lo nuestro: lo que se recuerda de ella (que
    // archivos dejamos, con su sha1) va a la carpeta propia, una subcarpeta por ruta
    const key = crypto.createHash("sha1").update(path.resolve(gameDir).toLowerCase()).digest("hex").slice(0, 12);
    return path.join(own, "otros", key);
}

function statePath(gameDir) {
    return path.join(launcherDir(gameDir), "state.json");
}

function defaults() {
    return {
        files: {},          // ruta relativa -> { sha1, size, mtimeMs }
        extracted: {},      // nombre de paquete -> [rutas relativas que dejo]
        forge: null,        // { versionId } instalado por nosotros
        javaPath: null,     // java.exe que descargamos nosotros (si el launcher oficial no tenia ninguno)
        // mode: "oficial" (el launcher de Minecraft, la carpeta propia) u "otro" (la carpeta del juego de otro launcher,
        // otherDir); null = aun sin elegir, que es "oficial"
        settings: { maxRamGb: null, mode: null, otherDir: null },
        packVersion: null,
        lastPrepared: null,
    };
}

function load(gameDir = config.gameDir) {
    const file = statePath(gameDir);
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return Object.assign(defaults(), data, { settings: Object.assign(defaults().settings, data.settings || {}) });
    } catch (err) {
        return defaults();
    }
}

function save(state, gameDir = config.gameDir) {
    const file = statePath(gameDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
}

function readJsonSafe(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        return null;
    }
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

module.exports = { launcherDir, samePath, load, save, readJsonSafe, writeJson };
