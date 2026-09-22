"use strict";
// Arranque directo del juego: construye la linea de Java a partir de la version resuelta (marcadores ${...},
// reglas por caracteristicas como la entrada directa al servidor) y lanza el proceso con su log en un archivo.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config");
const versions = require("./versions");

function substitute(text, vars) {
    return String(text).replace(/\$\{([^}]+)\}/g, (whole, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole));
}

function resolveArgs(list, features, vars) {
    const out = [];
    for (const entry of list || []) {
        if (typeof entry === "string") {
            out.push(substitute(entry, vars));
            continue;
        }
        if (!entry || !versions.ruleAllows(entry.rules, features)) continue;
        const values = Array.isArray(entry.value) ? entry.value : [entry.value];
        for (const v of values) out.push(substitute(v, vars));
    }
    return out;
}

/**
 * @param session  { name, uuid (sin guiones), accessToken, xuid } de la cuenta de Microsoft ya validada
 * @param quickPlay direccion "host:puerto" para entrar directo, o vacio
 */
async function buildLaunch({ manifest, minecraftDir = config.minecraftDir, gameDir = config.gameDir, javaExe, session, ramGb, quickPlay = "", launcherVersion = "1.0.0", report = () => {}, signal }) {
    if (!session || !session.accessToken || !session.uuid || !session.name) throw new Error("Hace falta una cuenta de Microsoft valida para arrancar el juego");
    const versionId = manifest.forge.versionId;
    report({ message: "Resolviendo la version " + versionId + "..." });
    const chain = await versions.loadChain(minecraftDir, versionId, { report, signal });
    const merged = versions.mergeChain(chain);
    if (!merged.mainClass) throw new Error("La version " + versionId + " no tiene clase principal");

    const libraries = await versions.ensureLibraries(merged, minecraftDir, { report, signal });
    const clientJar = await versions.ensureClientJar(merged, minecraftDir, { report, signal });
    const assets = await versions.ensureAssets(merged, minecraftDir, { report, signal });

    const nativesDir = path.join(gameDir, ".launcher", "natives", versionId);
    fs.mkdirSync(nativesDir, { recursive: true });
    fs.mkdirSync(gameDir, { recursive: true });

    const classpath = [...libraries, clientJar].join(path.delimiter);
    const vars = {
        auth_player_name: session.name,
        auth_uuid: session.uuid,
        auth_access_token: session.accessToken,
        auth_xuid: session.xuid || "",
        auth_session: session.accessToken,
        clientid: session.clientId || "",
        user_type: "msa",
        user_properties: "{}",
        version_name: versionId,
        version_type: merged.type || "release",
        game_directory: gameDir,
        assets_root: assets.root,
        game_assets: assets.root,
        assets_index_name: assets.indexId,
        natives_directory: nativesDir,
        library_directory: path.join(minecraftDir, "libraries"),
        classpath_separator: path.delimiter,
        classpath,
        launcher_name: config.launcherName,
        launcher_version: launcherVersion,
        resolution_width: "",
        resolution_height: "",
        quickPlayPath: "",
        quickPlaySingleplayer: "",
        quickPlayMultiplayer: quickPlay,
        quickPlayRealms: "",
    };
    const features = {
        is_demo_user: false,
        has_custom_resolution: false,
        has_quick_plays_support: false,
        is_quick_play_singleplayer: false,
        is_quick_play_multiplayer: Boolean(quickPlay),
        is_quick_play_realms: false,
    };
    const jvm = [`-Xmx${ramGb}G`, ...String((manifest.java && manifest.java.args) || config.defaultJavaArgs).split(/\s+/).filter(Boolean), ...resolveArgs(merged.arguments.jvm, features, vars)];
    const game = resolveArgs(merged.arguments.game, features, vars);
    return { javaExe, args: [...jvm, merged.mainClass, ...game], cwd: gameDir, versionId, libraries: libraries.length };
}

/** Lanza el juego desvinculado del launcher, con la salida en un archivo de log. */
function startGame(spec, { logFile }) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const out = fs.openSync(logFile, "w");
    const child = spawn(spec.javaExe, spec.args, { cwd: spec.cwd, detached: true, stdio: ["ignore", out, out], windowsHide: false });
    child.on("exit", () => { try { fs.closeSync(out); } catch (err) { /* ya cerrado */ } });
    return child;
}

module.exports = { buildLaunch, startGame, resolveArgs, substitute };
