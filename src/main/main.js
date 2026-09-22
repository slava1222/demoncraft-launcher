"use strict";
// Proceso principal de Electron: la ventana, el puente con la interfaz (IPC) y la actualizacion del propio launcher.
// Toda la logica del pack vive en src/core y no sabe nada de Electron (se prueba con src/cli.js).
const { app, BrowserWindow, ipcMain, shell } = require("electron");
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
    win = new BrowserWindow({
        width: 1100,
        height: 680,
        minWidth: 940,
        minHeight: 620,
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
    };
}

async function run(kind) {
    if (busy) throw new Error("Ya hay una preparacion en marcha");
    busy = true;
    abortController = new AbortController();
    const options = { assetsDir, signal: abortController.signal, report: (p) => send("progress", p) };
    try {
        const result = kind === "play" ? await setup.play(options) : await setup.prepare(options);
        log.info(kind + " ok: pack " + result.manifest.pack.version + (result.forge.installed ? " (Forge instalado ahora)" : ""));
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
        gameDir: s.gameDir,
        packVersion: s.packVersion,
        lastPrepared: s.lastPrepared,
        settings: s.settings,
        installed: s.installed,
        launcher: s.launcher ? s.launcher.kind : null,
        launcherDownloadUrl: require("../core/launcher").DOWNLOAD_URL,
        manifest: s.manifest ? { pack: s.manifest.pack, server: s.manifest.server, links: s.manifest.links, news: s.manifest.news } : null,
        version: app.getVersion(),
    };
});
ipcMain.handle("prepare", () => run("prepare"));
ipcMain.handle("play", () => run("play"));
ipcMain.handle("cancel", () => { if (abortController) abortController.abort(); return true; });
ipcMain.handle("settings:set", (event, settings) => setup.saveSettings({ maxRamGb: settings && settings.maxRamGb ? Number(settings.maxRamGb) : null }));
ipcMain.handle("open:folder", () => shell.openPath(config.gameDir));
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
