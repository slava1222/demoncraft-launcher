"use strict";
// Lo poco que el launcher necesita saber de antemano. Todo lo demas (direccion del servidor, enlaces, novedades,
// version de Forge, lista de archivos) viene en el manifest.json del pack, asi que cambia sin recompilar el launcher.
const os = require("os");
const path = require("path");

const OWNER = "slava1222";           // usuario de GitHub del dueño
const PACK_REPO = "demoncraft-pack";
const LAUNCHER_REPO = "demoncraft-launcher";

// Id de la aplicacion registrada en Azure para el inicio de sesion de Microsoft (no es un secreto). Vacio = el
// launcher solo ofrece abrir el launcher oficial. Solo funciona de verdad cuando Mojang aprueba el id
// (https://aka.ms/mce-reviewappid).
const AZURE_CLIENT_ID = process.env.DEMONCRAFT_AZURE_CLIENT_ID || "";

const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");

module.exports = {
    OWNER,
    PACK_REPO,
    LAUNCHER_REPO,
    AZURE_CLIENT_ID,
    // URL fija: GitHub redirige "latest/download" al ultimo release del repositorio del pack
    manifestUrl: process.env.DEMONCRAFT_MANIFEST_URL
        || `https://github.com/${OWNER}/${PACK_REPO}/releases/latest/download/manifest.json`,
    // carpeta del juego (mods, texturas, partidas, opciones): separada del .minecraft para no tocar el vanilla del jugador
    gameDir: process.env.DEMONCRAFT_GAME_DIR || path.join(appData, ".demoncraft"),
    // donde el launcher oficial guarda versiones, librerias, runtimes y perfiles (se comparte con el)
    minecraftDir: process.env.DEMONCRAFT_MINECRAFT_DIR || path.join(appData, ".minecraft"),
    profileId: "demoncraft",
    profileName: "DemonCraft",
    // id de la version propia que hereda de Forge y añade la entrada directa al servidor (para el launcher oficial)
    customVersionId: "DemonCraft",
    launcherName: "demoncraft-launcher",
    userAgent: "DemonCraftLauncher/1.0 (+https://github.com/" + OWNER + "/" + LAUNCHER_REPO + ")",
    defaultJavaArgs: "-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M",
    parallelDownloads: 3,
};
