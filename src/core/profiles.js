"use strict";
// El perfil "DemonCraft" del launcher oficial: version propia, carpeta del juego propia, memoria y el icono del
// servidor. Se guarda una copia del launcher_profiles.json antes de tocarlo por si hubiera que volver atras.
const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("./config");
const stateStore = require("./state");

let iconDataUrl = null;
function profileIcon(assetsDir) {
    if (iconDataUrl !== null) return iconDataUrl;
    try {
        const png = fs.readFileSync(path.join(assetsDir, "profile-icon.png"));
        iconDataUrl = "data:image/png;base64," + png.toString("base64");
    } catch (err) {
        iconDataUrl = "Furnace";
    }
    return iconDataUrl;
}

function defaultRamGb(manifest) {
    const totalGb = os.totalmem() / (1024 ** 3);
    const wanted = Number((manifest.java && manifest.java.defaultRamGb) || 4);
    const min = Number((manifest.java && manifest.java.minRamGb) || 2);
    // nunca mas de la mitad de la RAM del equipo (redondeando hacia abajo), nunca menos del minimo del pack
    return Math.max(min, Math.min(wanted, Math.floor(totalGb / 2)));
}

function javaArgs(manifest, settings) {
    const ram = settings && settings.maxRamGb ? Number(settings.maxRamGb) : defaultRamGb(manifest);
    const base = (manifest.java && manifest.java.args) || config.defaultJavaArgs;
    return `-Xmx${ram}G ${base}`.trim();
}

function upsertProfile(manifest, { minecraftDir = config.minecraftDir, gameDir = config.gameDir, versionId, settings, assetsDir } = {}) {
    const file = path.join(minecraftDir, "launcher_profiles.json");
    const data = stateStore.readJsonSafe(file) || { profiles: {}, settings: {}, version: 3 };
    if (!data.profiles) data.profiles = {};
    if (fs.existsSync(file)) {
        const backup = path.join(stateStore.launcherDir(gameDir), "launcher_profiles.backup.json");
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(file, backup);
    }
    const now = new Date().toISOString();
    const existing = data.profiles[config.profileId] || {};
    data.profiles[config.profileId] = Object.assign({}, existing, {
        name: config.profileName,
        type: "custom",
        created: existing.created || now,
        lastUsed: now,                       // el launcher oficial abre con el perfil usado mas recientemente
        lastVersionId: versionId,
        gameDir,
        javaArgs: javaArgs(manifest, settings),
        icon: profileIcon(assetsDir || path.join(__dirname, "..", "..", "assets")),
    });
    stateStore.writeJson(file, data);
    return data.profiles[config.profileId];
}

module.exports = { upsertProfile, javaArgs, defaultRamGb };
