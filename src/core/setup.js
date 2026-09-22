"use strict";
// La secuencia completa de "Jugar": manifest -> archivos del pack -> Java -> Forge -> version propia -> perfil ->
// servidor en la lista -> abrir el launcher oficial. Cada paso informa por `report` para la barra de progreso.
const fs = require("fs");
const path = require("path");
const config = require("./config");
const stateStore = require("./state");
const { fetchManifest } = require("./manifest");
const { syncPack } = require("./sync");
const { ensureJava } = require("./java");
const { ensureForge, writeCustomVersion } = require("./forge");
const { upsertProfile } = require("./profiles");
const { ensureServer } = require("./servers");
const launcher = require("./launcher");

const STEPS = [
    { id: "manifest", label: "Comprobando la version del pack" },
    { id: "files", label: "Actualizando mods y texturas" },
    { id: "java", label: "Comprobando Java" },
    { id: "forge", label: "Comprobando Forge" },
    { id: "profile", label: "Preparando el perfil y el servidor" },
];

async function prepare({ gameDir = config.gameDir, minecraftDir = config.minecraftDir, assetsDir, report = () => {}, signal } = {}) {
    const state = stateStore.load(gameDir);
    const step = (index, extra) => report(Object.assign({ step: index, steps: STEPS.length, label: STEPS[index].label }, extra || {}));

    step(0, { message: "Pidiendo la lista del pack..." });
    const { manifest, offline, error } = await fetchManifest({ gameDir, signal });
    if (offline) step(0, { message: "Sin conexion con GitHub: se usa la ultima lista conocida (" + (error || "") + ")", warning: true });

    step(1, { message: "Comprobando archivos..." });
    const sync = await syncPack(manifest, state, { gameDir, signal, report: (p) => step(1, p) });
    stateStore.save(state, gameDir);

    step(2, { message: "Buscando Java..." });
    const javaExe = await ensureJava({ gameDir, minecraftDir, state, signal, report: (p) => step(2, p) });
    stateStore.save(state, gameDir);

    step(3, { message: "Comprobando Forge " + manifest.pack.forge + "..." });
    const forge = await ensureForge(manifest, { gameDir, minecraftDir, javaExe, state, signal, report: (p) => step(3, p) });
    stateStore.save(state, gameDir);

    step(4, { message: "Escribiendo el perfil DemonCraft..." });
    const versionId = writeCustomVersion(manifest, { minecraftDir });
    upsertProfile(manifest, { minecraftDir, gameDir, versionId, settings: state.settings, assetsDir });
    const serverAdded = ensureServer(manifest, { gameDir });
    state.lastPrepared = new Date().toISOString();
    stateStore.save(state, gameDir);

    const found = launcher.findLauncher();
    report({ step: STEPS.length - 1, steps: STEPS.length, label: "Listo", message: "Todo listo", finished: true });
    return { manifest, offline, sync, forge, versionId, serverAdded, launcher: found, javaExe };
}

async function play(options = {}) {
    const result = await prepare(options);
    if (!result.launcher) {
        const err = new Error("No encuentro el launcher oficial de Minecraft. Instalalo desde " + launcher.DOWNLOAD_URL + " y vuelve a pulsar Jugar.");
        err.code = "NO_LAUNCHER";
        throw err;
    }
    launcher.openLauncher(result.launcher);
    return result;
}

function status({ gameDir = config.gameDir, minecraftDir = config.minecraftDir } = {}) {
    const state = stateStore.load(gameDir);
    const cached = stateStore.readJsonSafe(require("./manifest").cachePath(gameDir));
    return {
        gameDir,
        minecraftDir,
        packVersion: state.packVersion,
        lastPrepared: state.lastPrepared,
        settings: state.settings,
        installed: fs.existsSync(path.join(gameDir, "mods")),
        launcher: launcher.findLauncher(),
        manifest: cached,
    };
}

function saveSettings(settings, { gameDir = config.gameDir } = {}) {
    const state = stateStore.load(gameDir);
    state.settings = Object.assign({}, state.settings, settings);
    stateStore.save(state, gameDir);
    return state.settings;
}

module.exports = { prepare, play, status, saveSettings, STEPS };
