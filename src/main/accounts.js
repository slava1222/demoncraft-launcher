"use strict";
// La cuenta de Microsoft del jugador: ventana de inicio de sesion (la propia pagina de Microsoft dentro del
// launcher), cadena Xbox/XSTS/Minecraft, y guardado del token de renovacion cifrado con el almacen del sistema
// (DPAPI en Windows). Nunca se guarda la contraseña: no pasa por nosotros.
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, safeStorage, session: electronSession } = require("electron");
const log = require("electron-log");
const msauth = require("../core/msauth");
const config = require("../core/config");

const FILE = () => path.join(app.getPath("userData"), "account.json");
let cached = null; // { refreshToken, session: { name, uuid, accessToken, expiresAt, xuid } }

function enabled() {
    return Boolean(config.AZURE_CLIENT_ID);
}

function encrypt(text) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("El sistema no permite guardar la sesion cifrada");
    return safeStorage.encryptString(text).toString("base64");
}

function decrypt(b64) {
    return safeStorage.decryptString(Buffer.from(b64, "base64"));
}

function load() {
    if (cached) return cached;
    try {
        const raw = JSON.parse(fs.readFileSync(FILE(), "utf8"));
        cached = { refreshToken: decrypt(raw.refreshToken), session: raw.session || null };
    } catch (err) {
        cached = null;
    }
    return cached;
}

function save(data) {
    cached = data;
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify({ refreshToken: encrypt(data.refreshToken), session: data.session }, null, 2));
}

function logout() {
    cached = null;
    fs.rmSync(FILE(), { force: true });
    return electronSession.fromPartition("persist:msauth").clearStorageData().catch(() => {});
}

function publicProfile() {
    const data = load();
    return data && data.session ? { name: data.session.name, uuid: data.session.uuid } : null;
}

/** Abre la pagina de Microsoft en una ventana hija y espera el codigo de autorizacion en la redireccion final. */
function askForCode(parent) {
    const { verifier, challenge, state } = msauth.pkce();
    const url = msauth.authorizeUrl(config.AZURE_CLIENT_ID, { challenge, state });
    return new Promise((resolve, reject) => {
        const win = new BrowserWindow({
            width: 520,
            height: 680,
            parent,
            modal: true,
            title: "Iniciar sesion con Microsoft",
            autoHideMenuBar: true,
            webPreferences: { partition: "persist:msauth", nodeIntegration: false, contextIsolation: true, sandbox: true },
        });
        let settled = false;
        const finish = (err, code) => {
            if (settled) return;
            settled = true;
            if (!win.isDestroyed()) win.close();
            if (err) reject(err); else resolve({ code, verifier });
        };
        const check = (event, target) => {
            if (!target || !target.startsWith(msauth.REDIRECT_URI)) return;
            if (event && event.preventDefault) event.preventDefault();
            const q = new URL(target).searchParams;
            if (q.get("state") !== state) return finish(new Error("La respuesta de Microsoft no coincide con la peticion (state)"));
            if (q.get("error")) return finish(new Error(q.get("error_description") || q.get("error")));
            if (!q.get("code")) return finish(new Error("Microsoft no devolvio un codigo de autorizacion"));
            finish(null, q.get("code"));
        };
        win.webContents.on("will-redirect", check);
        win.webContents.on("will-navigate", check);
        win.webContents.on("did-navigate", (event, target) => check(null, target));
        win.on("closed", () => finish(Object.assign(new Error("Inicio de sesion cancelado"), { code: "CANCELLED" })));
        win.loadURL(url).catch((err) => finish(err));
    });
}

async function login(parent) {
    if (!enabled()) throw new Error("El inicio de sesion de Microsoft no esta configurado en este launcher");
    const { code, verifier } = await askForCode(parent);
    const tokens = await msauth.exchangeCode(config.AZURE_CLIENT_ID, code, verifier);
    const mcSession = await msauth.sessionFromMicrosoft(tokens.access_token);
    mcSession.clientId = clientIdFor();
    save({ refreshToken: tokens.refresh_token, session: mcSession });
    log.info("sesion iniciada como " + mcSession.name);
    return { name: mcSession.name, uuid: mcSession.uuid };
}

/** El identificador de cliente que el juego recibe en --clientId: uno estable por instalacion, como hace el launcher oficial. */
function clientIdFor() {
    const data = load();
    if (data && data.session && data.session.clientId) return data.session.clientId;
    return Buffer.from(require("crypto").randomUUID().replace(/-/g, ""), "hex").toString("base64");
}

/** Sesion de Minecraft vigente, renovandola con el token de Microsoft si hace falta. null si no hay cuenta. */
async function currentSession() {
    const data = load();
    if (!data || !data.refreshToken) return null;
    if (data.session && data.session.accessToken && data.session.expiresAt - Date.now() > 10 * 60 * 1000) return data.session;
    const tokens = await msauth.refreshMicrosoft(config.AZURE_CLIENT_ID, data.refreshToken);
    const mcSession = await msauth.sessionFromMicrosoft(tokens.access_token);
    mcSession.clientId = clientIdFor();
    save({ refreshToken: tokens.refresh_token || data.refreshToken, session: mcSession });
    return mcSession;
}

module.exports = { enabled, login, logout, currentSession, publicProfile };
