"use strict";
// Lo que el launcher recuerda entre arranques: que archivos del pack ya tiene (con su sha1, tamaño y fecha, para no
// volver a calcular 200 MB de hashes cada vez), que Java y Forge instalo, los ajustes del jugador y el ultimo manifest
// bueno (para poder jugar sin conexion con lo que ya hay).
const fs = require("fs");
const path = require("path");
const config = require("./config");

function launcherDir(gameDir = config.gameDir) {
    return path.join(gameDir, ".launcher");
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
        settings: { maxRamGb: null },
        packVersion: null,
        lastPrepared: null,
    };
}

function load(gameDir = config.gameDir) {
    const file = statePath(gameDir);
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return Object.assign(defaults(), data, { settings: Object.assign({ maxRamGb: null }, data.settings || {}) });
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

module.exports = { launcherDir, load, save, readJsonSafe, writeJson };
