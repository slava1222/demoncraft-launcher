"use strict";
// La secuencia completa de "Jugar": manifest -> archivos del pack -> Java -> Forge -> version propia -> perfil ->
// servidor en la lista -> abrir el launcher oficial. Cada paso informa por `report` para la barra de progreso.
//
// 1.1.0 (25/10): dos modos. "oficial" (el de siempre): el pack en la carpeta propia (.demoncraft), el perfil DemonCraft en el
// launcher oficial de Minecraft y ese launcher abierto. "otro": para quien juega con otro launcher (sin cuenta premium, por
// ejemplo): el pack, Forge, la version DemonCraft y el servidor van a la carpeta del juego de SU launcher, y juega desde el.
// Este launcher nunca arranca el juego: en ese modo solo actualiza la carpeta.
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

const MODES = ["oficial", "otro"];
// donde se apartan, en la carpeta de otro launcher, los mods que no son del pack (no se borran: pueden ser del jugador)
const STRAYS_DIR = "mods-guardados-demoncraft";

function stepsFor(mode) {
    return [
        { id: "manifest", label: "Comprobando la versión del pack" },
        { id: "files", label: "Actualizando mods y texturas" },
        { id: "java", label: "Comprobando Java" },
        { id: "forge", label: "Comprobando Forge" },
        { id: "profile", label: mode === "otro" ? "Preparando la versión DemonCraft y el servidor" : "Preparando el perfil y el servidor" },
    ];
}
const STEPS = stepsFor("oficial");

function modeOf(settings) {
    return settings && settings.mode === "otro" ? "otro" : "oficial";
}

/** La carpeta del juego de cada modo: la propia con el launcher oficial; con otro launcher, la suya (por defecto .minecraft). */
function targetOf(settings) {
    if (modeOf(settings) !== "otro") return { mode: "oficial", gameDir: config.gameDir, minecraftDir: config.minecraftDir };
    const dir = settings.otherDir ? path.resolve(settings.otherDir) : config.minecraftDir;
    return { mode: "otro", gameDir: dir, minecraftDir: dir };
}

/** Lo que se ve de una carpeta sin tocarla: si parece la de un juego de Minecraft (alguna de sus piezas de siempre). */
function looksLikeMinecraft(dir) {
    return ["versions", "options.txt", "launcher_profiles.json", "saves"].some((name) => fs.existsSync(path.join(dir, name)));
}

/**
 * @param mode, otherDir  para probar (cli.js): si no, los de los ajustes guardados
 */
async function prepare({ mode, otherDir, assetsDir, report = () => {}, signal } = {}) {
    const home = stateStore.load(config.gameDir);
    const settings = Object.assign({}, home.settings, mode ? { mode } : {}, otherDir ? { otherDir } : {});
    const target = targetOf(settings);
    const own = target.mode === "oficial";
    const { gameDir, minecraftDir } = target;
    // los ajustes y el Java descargado son del launcher (carpeta propia); lo que se sabe de los archivos, de cada carpeta
    const state = own ? home : stateStore.load(gameDir);
    const steps = stepsFor(target.mode);
    const step = (index, extra) => report(Object.assign({ step: index, steps: steps.length, label: steps[index].label }, extra || {}));

    step(0, { message: "Pidiendo la lista del pack..." });
    const { manifest, offline, error } = await fetchManifest({ gameDir: config.gameDir, signal });
    if (offline) step(0, { message: "Sin conexión con GitHub: se usa la última lista conocida (" + (error || "") + ")", warning: true });

    step(1, { message: own ? "Comprobando archivos..." : "Comprobando archivos en " + gameDir + "..." });
    const firstTime = !state.packVersion;
    const sync = await syncPack(manifest, state, { gameDir, signal, report: (p) => step(1, p), keepStrays: own ? null : STRAYS_DIR, mergeDefaults: firstTime });
    stateStore.save(state, gameDir);

    step(2, { message: "Buscando Java..." });
    const javaExe = await ensureJava({ gameDir: config.gameDir, minecraftDir, state: home, signal, report: (p) => step(2, p) });
    stateStore.save(home, config.gameDir);

    step(3, { message: "Comprobando Forge " + manifest.pack.forge + "..." });
    const forge = await ensureForge(manifest, { gameDir: config.gameDir, minecraftDir, javaExe, state, signal, report: (p) => step(3, p) });
    stateStore.save(state, gameDir);

    step(4, { message: own ? "Escribiendo el perfil DemonCraft..." : "Escribiendo la versión DemonCraft..." });
    const versionId = writeCustomVersion(manifest, { minecraftDir });
    // el perfil es del launcher oficial: otro launcher enseña las versiones de la carpeta (la DemonCraft entre ellas)
    if (own) upsertProfile(manifest, { minecraftDir, gameDir, versionId, settings: home.settings, assetsDir });
    const serverAdded = ensureServer(manifest, { gameDir });
    state.lastPrepared = new Date().toISOString();
    stateStore.save(state, gameDir);

    const found = own ? launcher.findLauncher() : null;
    report({ step: steps.length - 1, steps: steps.length, label: "Listo", message: "Todo listo", finished: true });
    return { manifest, offline, sync, forge, versionId, serverAdded, launcher: found, javaExe, mode: target.mode, gameDir, strayDir: own ? null : path.join(gameDir, STRAYS_DIR) };
}

async function play(options = {}) {
    const result = await prepare(options);
    // con otro launcher se juega desde el: aqui solo se actualiza su carpeta
    if (result.mode === "otro") return result;
    if (!result.launcher) {
        const err = new Error("No encuentro el launcher oficial de Minecraft. Instálalo desde " + launcher.DOWNLOAD_URL + " y vuelve a pulsar Jugar.");
        err.code = "NO_LAUNCHER";
        throw err;
    }
    launcher.openLauncher(result.launcher);
    return result;
}

function status() {
    const home = stateStore.load(config.gameDir);
    const target = targetOf(home.settings);
    const state = target.mode === "oficial" ? home : stateStore.load(target.gameDir);
    const cached = stateStore.readJsonSafe(require("./manifest").cachePath(config.gameDir));
    return {
        mode: target.mode,
        modeChosen: MODES.includes(home.settings.mode),
        gameDir: target.gameDir,
        minecraftDir: target.minecraftDir,
        defaultOtherDir: config.minecraftDir,
        looksLikeMinecraft: looksLikeMinecraft(target.gameDir),
        otherLooksLikeMinecraft: looksLikeMinecraft(home.settings.otherDir || config.minecraftDir),
        packVersion: state.packVersion,
        lastPrepared: state.lastPrepared,
        settings: home.settings,
        installed: fs.existsSync(path.join(target.gameDir, "mods")),
        launcher: target.mode === "oficial" ? launcher.findLauncher() : null,
        manifest: cached,
    };
}

/** Solo las claves que vengan, y solo con valores que valgan: lo demas se queda como estaba. */
function saveSettings(settings) {
    const state = stateStore.load(config.gameDir);
    const next = Object.assign({}, state.settings);
    if (settings && "maxRamGb" in settings) next.maxRamGb = settings.maxRamGb ? Number(settings.maxRamGb) : null;
    if (settings && "mode" in settings && (settings.mode === null || MODES.includes(settings.mode))) next.mode = settings.mode;
    if (settings && "otherDir" in settings) {
        const dir = settings.otherDir ? String(settings.otherDir) : null;
        if (dir === null || path.isAbsolute(dir)) next.otherDir = dir ? path.resolve(dir) : null;
    }
    state.settings = next;
    stateStore.save(state, config.gameDir);
    return state.settings;
}

module.exports = { prepare, play, status, saveSettings, looksLikeMinecraft, targetOf, STEPS, STRAYS_DIR };
