"use strict";
// Proceso principal de Electron: la ventana, el puente con la interfaz (IPC), la cuenta de Microsoft y la
// actualizacion del propio launcher. La logica del pack y del juego vive en src/core y no sabe nada de Electron.
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const log = require("electron-log");
const setup = require("../core/setup");
const config = require("../core/config");
const accounts = require("./accounts");

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
let game = null; // proceso del juego en marcha

function createWindow() {
    win = new BrowserWindow({
        width: 1100,
        height: 700,
        minWidth: 940,
        minHeight: 640,
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
    // los errores de la interfaz van al mismo log que el resto: si algo no pinta, se ve en el archivo de log
    win.webContents.on("console-message", (event, level, message, line, sourceId) => {
        if (level >= 2) log.warn(`interfaz ${path.basename(sourceId || "")}:${line} ${message}`);
    });
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

function summarize(result, extra) {
    return Object.assign({
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
    }, extra || {});
}

function useOfficialLauncher() {
    const s = setup.status();
    return Boolean(s.settings && s.settings.useOfficialLauncher);
}

async function run(kind) {
    if (busy) throw new Error("Ya hay una preparacion en marcha");
    if (kind === "play" && game) throw new Error("Minecraft ya esta en marcha");
    busy = true;
    abortController = new AbortController();
    const options = { assetsDir, signal: abortController.signal, report: (p) => send("progress", p) };
    try {
        if (kind === "prepare") return summarize(await setup.prepare(options));
        // Jugar: con cuenta de Microsoft y sin forzar el launcher oficial, arranque directo; si no, el launcher oficial
        let session = null;
        if (accounts.enabled() && !useOfficialLauncher()) {
            try {
                session = await accounts.currentSession();
            } catch (err) {
                log.warn("no se pudo renovar la sesion: " + err.message);
                if (err.code === "NOT_APPROVED") throw err;
                session = null;
            }
        }
        if (session) {
            const result = await setup.launchDirect(Object.assign({ session, launcherVersion: app.getVersion() }, options));
            game = result.child;
            game.on("exit", (code) => {
                log.info("Minecraft termino con codigo " + code);
                game = null;
                send("game-exit", { code, logFile: result.logFile });
            });
            log.info("juego arrancado: pid " + game.pid + ", " + result.spec.libraries + " librerias");
            return summarize(result, { mode: "direct", pid: game.pid, quickPlay: result.quickPlay });
        }
        const result = await setup.play(options);
        log.info("launcher oficial abierto: pack " + result.manifest.pack.version);
        return summarize(result, { mode: "official" });
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
        account: { enabled: accounts.enabled(), profile: accounts.publicProfile() },
        gameRunning: Boolean(game),
    };
});
ipcMain.handle("prepare", () => run("prepare"));
ipcMain.handle("play", () => run("play"));
ipcMain.handle("cancel", () => { if (abortController) abortController.abort(); return true; });
ipcMain.handle("settings:set", (event, settings) => setup.saveSettings({
    maxRamGb: settings && settings.maxRamGb ? Number(settings.maxRamGb) : null,
    useOfficialLauncher: Boolean(settings && settings.useOfficialLauncher),
}));
ipcMain.handle("account:login", async () => {
    if (busy) throw new Error("Espera a que termine la preparacion");
    const profile = await accounts.login(win);
    return profile;
});
ipcMain.handle("account:logout", async () => { await accounts.logout(); return true; });
ipcMain.handle("open:folder", () => shell.openPath(config.gameDir));
ipcMain.handle("open:log", () => shell.openPath(path.join(config.gameDir, ".launcher", "logs", "juego.log")));
ipcMain.handle("open:link", (event, url) => { if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url)); return false; });
ipcMain.handle("window:minimize", () => { if (win) win.minimize(); });
ipcMain.handle("window:close", () => { if (win) win.close(); });

function checkLauncherUpdates() {
    if (!autoUpdater || !app.isPackaged) return;
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
