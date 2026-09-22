"use strict";
// Las secuencias completas. `prepare`: manifest -> archivos del pack -> Java -> Forge -> version propia -> perfil ->
// servidor en la lista. `play`: prepare y abrir el launcher oficial. `launchDirect`: prepare, resolver la version,
// bajar librerias y recursos y arrancar el juego con la cuenta de Microsoft. Cada paso informa por `report`.
const fs = require("fs");
const path = require("path");
const config = require("./config");
const stateStore = require("./state");
const { fetchManifest, cachePath } = require("./manifest");
const { syncPack } = require("./sync");
const { ensureJava } = require("./java");
const { ensureForge, writeCustomVersion } = require("./forge");
const { upsertProfile, defaultRamGb } = require("./profiles");
const { ensureServer } = require("./servers");
const launcher = require("./launcher");
const launch = require("./launch");

const STEPS = [
    { id: "manifest", label: "Comprobando la version del pack" },
    { id: "files", label: "Actualizando mods y texturas" },
    { id: "java", label: "Comprobando Java" },
    { id: "forge", label: "Comprobando Forge" },
    { id: "profile", label: "Preparando el perfil y el servidor" },
    { id: "game", label: "Preparando Minecraft" },
];

async function prepare({ gameDir = config.gameDir, minecraftDir = config.minecraftDir, assetsDir, report = () => {}, signal, totalSteps = 5 } = {}) {
    const state = stateStore.load(gameDir);
    const step = (index, extra) => report(Object.assign({ step: index, steps: totalSteps, label: STEPS[index].label }, extra || {}));

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
    if (totalSteps === 5) report({ step: 4, steps: totalSteps, label: "Listo", message: "Todo listo", finished: true });
    return { manifest, offline, sync, forge, versionId, serverAdded, launcher: found, javaExe, state };
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

/**
 * Arranque directo con la cuenta de Microsoft. `session` = { name, uuid, accessToken, xuid } ya validada.
 * Devuelve el proceso del juego y el archivo de log.
 */
async function launchDirect({ session, launcherVersion = "1.0.0", gameDir = config.gameDir, minecraftDir = config.minecraftDir, assetsDir, report = () => {}, signal } = {}) {
    const result = await prepare({ gameDir, minecraftDir, assetsDir, report, signal, totalSteps: 6 });
    const manifest = result.manifest;
    const step = (extra) => report(Object.assign({ step: 5, steps: 6, label: STEPS[5].label }, extra || {}));
    step({ message: "Buscando Java 17..." });
    const javaExe = await ensureJava({ gameDir, minecraftDir, state: result.state, only17: true, signal, report: (p) => step(p) });
    stateStore.save(result.state, gameDir);
    const ramGb = result.state.settings.maxRamGb || defaultRamGb(manifest);
    const quickPlay = manifest.server && manifest.server.address ? String(manifest.server.address).trim() : "";
    const spec = await launch.buildLaunch({ manifest, minecraftDir, gameDir, javaExe, session, ramGb, quickPlay, launcherVersion, signal, report: (p) => step(p) });
    const logFile = path.join(gameDir, ".launcher", "logs", "juego.log");
    step({ message: "Arrancando Minecraft..." });
    const child = launch.startGame(spec, { logFile });
    report({ step: 5, steps: 6, label: "Jugando", message: "Minecraft en marcha" + (quickPlay ? ", entrando en " + quickPlay : ""), finished: true });
    return Object.assign(result, { child, logFile, quickPlay, spec: { javaExe, args: spec.args.length, libraries: spec.libraries } });
}

function status({ gameDir = config.gameDir, minecraftDir = config.minecraftDir } = {}) {
    const state = stateStore.load(gameDir);
    const cached = stateStore.readJsonSafe(cachePath(gameDir));
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

module.exports = { prepare, play, launchDirect, status, saveSettings, STEPS };
