"use strict";
// Proceso principal de Electron: la ventana, el puente con la interfaz (IPC) y la actualizacion del propio launcher.
// Toda la logica del pack vive en src/core y no sabe nada de Electron (se prueba con src/cli.js).
const { app, BrowserWindow, ipcMain, shell, screen, dialog } = require("electron");
const path = require("path");
const log = require("electron-log");
const setup = require("../core/setup");
const config = require("../core/config");

let autoUpdater = null;
try {
    ({ autoUpdater } = require("electron-updater"));
} catch (err) {
    autoUpdater = null;
}

log.transports.file.level = "info";
log.info("DemonCraft Launcher " + app.getVersion() + " arrancando");

const assetsDir = path.join(__dirname, "..", "..", "assets");
let win = null;
let busy = false;
let abortController = null;

function createWindow() {
    // 29/09: tamaño fijo (la ventana ya no se estira); en una pantalla mas pequeña, lo que quepa
    const area = screen.getPrimaryDisplay().workAreaSize;
    win = new BrowserWindow({
        width: Math.min(1100, area.width),
        height: Math.min(680, area.height),
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        frame: false,
        backgroundColor: "#0b0709",
        show: false,
        title: "DemonCraft Launcher",
        icon: path.join(assetsDir, "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "..", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
    win.once("ready-to-show", () => win.show());
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    win.on("closed", () => { win = null; });
}

function send(channel, payload) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function summarize(result) {
    return {
        pack: result.manifest.pack,
        server: result.manifest.server,
        links: result.manifest.links,
        news: result.manifest.news,
        offline: result.offline,
        downloaded: result.sync.downloaded.length,
        deleted: result.sync.deleted.length,
        forgeInstalledNow: result.forge.installed,
        launcher: result.launcher ? result.launcher.kind : null,
        launcherDownloadUrl: require("../core/launcher").DOWNLOAD_URL,
        // 1.1.0: el modo y, con otro launcher, su carpeta, la version a elegir y lo apartado
        mode: result.mode,
        gameDir: result.gameDir,
        versionId: result.versionId,
        forgeVersionId: result.forge.versionId,
        movedAside: result.sync.movedAside.length,
        strayDir: result.strayDir,
    };
}

async function run(kind) {
    if (busy) throw new Error("Ya hay una preparación en marcha");
    busy = true;
    abortController = new AbortController();
    const options = { assetsDir, signal: abortController.signal, report: (p) => send("progress", p) };
    try {
        const result = kind === "play" ? await setup.play(options) : await setup.prepare(options);
        log.info(kind + " ok: pack " + result.manifest.pack.version + " en " + result.gameDir + " (modo " + result.mode + ")"
            + (result.forge.installed ? " (Forge instalado ahora)" : "") + (result.sync.movedAside.length ? " · apartados " + result.sync.movedAside.length : ""));
        return summarize(result);
    } catch (err) {
        log.error(kind + " fallo: " + (err && err.stack || err));
        throw err;
    } finally {
        busy = false;
        abortController = null;
    }
}

ipcMain.handle("status", () => {
    const s = setup.status();
    return {
        mode: s.mode,
        modeChosen: s.modeChosen,
        gameDir: s.gameDir,
        defaultOtherDir: s.defaultOtherDir,
        looksLikeMinecraft: s.looksLikeMinecraft,
        otherLooksLikeMinecraft: s.otherLooksLikeMinecraft,
        packVersion: s.packVersion,
        lastPrepared: s.lastPrepared,
        settings: s.settings,
        installed: s.installed,
        launcher: s.launcher ? s.launcher.kind : null,
        launcherDownloadUrl: require("../core/launcher").DOWNLOAD_URL,
        manifest: s.manifest ? { pack: s.manifest.pack, forge: s.manifest.forge ? { versionId: s.manifest.forge.versionId } : null, server: s.manifest.server, links: s.manifest.links, news: s.manifest.news } : null,
        version: app.getVersion(),
    };
});
ipcMain.handle("prepare", () => run("prepare"));
ipcMain.handle("play", () => run("play"));
ipcMain.handle("cancel", () => { if (abortController) abortController.abort(); return true; });
// solo lo que venga: la memoria, el modo ("oficial" | "otro") y la carpeta del otro launcher (setup.saveSettings los valida)
ipcMain.handle("settings:set", (event, settings) => {
    if (busy) throw new Error("Espera a que termine la preparación en marcha");
    const out = {};
    for (const key of ["maxRamGb", "mode", "otherDir"]) if (settings && key in settings) out[key] = settings[key];
    return setup.saveSettings(out);
});
// 1.1.0: elegir la carpeta del juego del otro launcher
ipcMain.handle("dialog:folder", async (event, current) => {
    const picked = await dialog.showOpenDialog(win, {
        title: "Carpeta del juego de tu launcher",
        defaultPath: current || config.minecraftDir,
        properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || !picked.filePaths.length) return null;
    return { dir: picked.filePaths[0], looksLikeMinecraft: setup.looksLikeMinecraft(picked.filePaths[0]) };
});
ipcMain.handle("open:folder", () => shell.openPath(setup.status().gameDir));
ipcMain.handle("open:link", (event, url) => { if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url)); return false; });
ipcMain.handle("window:minimize", () => { if (win) win.minimize(); });
ipcMain.handle("window:close", () => { if (win) win.close(); });

function checkLauncherUpdates() {
    if (!autoUpdater || !app.isPackaged || config.OWNER === "OWNER") return;
    try {
        autoUpdater.logger = log;
        autoUpdater.autoDownload = true;
        autoUpdater.on("update-downloaded", (info) => send("launcher-update", { version: info.version }));
        autoUpdater.checkForUpdatesAndNotify().catch((err) => log.warn("actualizacion del launcher: " + err.message));
    } catch (err) {
        log.warn("actualizacion del launcher: " + err.message);
    }
}
ipcMain.handle("launcher-update:install", () => { if (autoUpdater) autoUpdater.quitAndInstall(); });

const single = app.requestSingleInstanceLock();
if (!single) {
    app.quit();
} else {
    app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
    app.whenReady().then(() => {
        createWindow();
        checkLauncherUpdates();
    });
    app.on("window-all-closed", () => app.quit());
}
