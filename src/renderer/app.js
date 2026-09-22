"use strict";
// La interfaz: pide el estado, prepara el pack al abrir, pinta el progreso, la cuenta y el boton Jugar.
const $ = (id) => document.getElementById(id);
const api = window.demoncraft;

let busy = false;
let gameRunning = false;
let accountEnabled = false;
let profile = null;
let launcherDownloadUrl = "https://www.minecraft.net/es-es/download";
let links = {};

function fmtBytes(n) {
    if (!n && n !== 0) return "";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function setStatus(text, cls) {
    const el = $("status-line");
    el.textContent = text;
    el.className = cls || "";
}

function setProgress(done, total) {
    const fill = $("progress-fill");
    if (total > 0) {
        fill.classList.remove("indeterminate");
        fill.style.width = Math.min(100, Math.round((100 * done) / total)) + "%";
    } else if (busy) {
        fill.classList.add("indeterminate");
    } else {
        fill.classList.remove("indeterminate");
        fill.style.width = "0%";
    }
}

function showError(message) {
    $("error-text").textContent = message;
    $("error").classList.remove("hidden");
}

function hideError() {
    $("error").classList.add("hidden");
}

function refreshPlayButton() {
    const btn = $("btn-play");
    btn.disabled = busy || gameRunning;
    btn.querySelector(".play-text").textContent = gameRunning ? "JUGANDO" : busy ? "PREPARANDO" : "JUGAR";
}

function setBusy(value) {
    busy = value;
    refreshPlayButton();
    if (!value) setProgress(0, 0);
}

function renderManifest(m) {
    if (!m) return;
    if (m.pack) {
        $("pack-version").textContent = m.pack.version || "—";
        if (m.pack.minecraft) $("mc-version").textContent = m.pack.minecraft;
        if (m.pack.forge) $("forge-version").textContent = m.pack.forge;
    }
    $("server-address").textContent = (m.server && m.server.address) ? m.server.address : "se anunciara pronto";
    links = m.links || {};
    for (const key of ["discord", "store", "web"]) {
        const btn = $("link-" + key);
        if (links[key]) btn.classList.remove("hidden"); else btn.classList.add("hidden");
    }
    const news = $("news");
    news.innerHTML = "";
    if (m.news && m.news.length) {
        for (const item of m.news.slice(0, 12)) {
            const div = document.createElement("div");
            div.className = "news-item";
            const date = document.createElement("div"); date.className = "news-date"; date.textContent = item.date || "";
            const title = document.createElement("div"); title.className = "news-title"; title.textContent = item.title || "";
            const body = document.createElement("div"); body.className = "news-body"; body.textContent = item.body || "";
            div.append(date, title, body);
            news.appendChild(div);
        }
    } else {
        const p = document.createElement("p"); p.className = "muted"; p.textContent = "Sin novedades todavia."; news.appendChild(p);
    }
}

function renderLauncher(kind) {
    const names = { exe: "instalado", store: "Microsoft Store" };
    $("launcher-kind").textContent = kind ? names[kind] || kind : "no encontrado";
    const needOfficial = !accountEnabled || !profile || $("use-official").checked;
    if (kind || !needOfficial) $("no-launcher").classList.add("hidden"); else $("no-launcher").classList.remove("hidden");
}

function renderAccount() {
    const panel = $("account-panel");
    if (!accountEnabled) {
        panel.classList.add("hidden");
        $("footer-text").textContent = "Al pulsar Jugar se instala o actualiza el pack y se abre el launcher oficial de Minecraft con el perfil DemonCraft listo: entra con tu cuenta y pulsa Jugar.";
        return;
    }
    panel.classList.remove("hidden");
    if (profile) {
        $("account-line").textContent = "Conectado como " + profile.name;
        $("account-line").className = "ok";
        $("btn-login").classList.add("hidden");
        $("btn-logout").classList.remove("hidden");
        $("footer-text").textContent = "Al pulsar Jugar se instala o actualiza el pack y se arranca Minecraft con tu cuenta, directo al servidor.";
    } else {
        $("account-line").textContent = "Sin cuenta conectada: inicia sesion para jugar desde aqui, o usa el launcher oficial";
        $("account-line").className = "muted";
        $("btn-login").classList.remove("hidden");
        $("btn-logout").classList.add("hidden");
        $("footer-text").textContent = "Inicia sesion con tu cuenta de Microsoft para arrancar el juego desde aqui; sin cuenta, Jugar abre el launcher oficial.";
    }
}

api.onProgress((p) => {
    const label = p.label ? p.label + (p.message ? ": " : "") : "";
    setStatus(label + (p.message || ""), p.warning ? "warn" : p.finished ? "ok" : "");
    if (p.step != null && p.steps) {
        const detail = [];
        detail.push("Paso " + Math.min(p.step + 1, p.steps) + " de " + p.steps);
        if (p.total) detail.push(fmtBytes(p.done) + " / " + fmtBytes(p.total));
        $("progress-detail").textContent = detail.join(" · ");
    }
    if (p.total) setProgress(p.done, p.total);
    else setProgress(0, 0);
});

api.onGameExit((info) => {
    gameRunning = false;
    refreshPlayButton();
    if (info && info.code && info.code !== 0) {
        setStatus("Minecraft se cerro con un error (codigo " + info.code + ")", "warn");
        showError("El juego termino con el codigo " + info.code + ". Mira el log desde Ajustes → Ver el ultimo log del juego.");
    } else {
        setStatus("Minecraft cerrado. Hasta la proxima.", "");
    }
});

api.onLauncherUpdate(() => $("update-banner").classList.remove("hidden"));

function cleanMessage(err) {
    return String(err && err.message || err).replace(/^Error invoking remote method '[\w:-]+': (Error: )?/, "");
}

async function runPrepare(kind) {
    if (busy || (kind === "play" && gameRunning)) return;
    hideError();
    setBusy(true);
    setStatus(kind === "play" ? "Preparando el juego..." : "Comprobando el pack...");
    try {
        const result = kind === "play" ? await api.play() : await api.prepare();
        renderManifest(result);
        if (result.launcherDownloadUrl) launcherDownloadUrl = result.launcherDownloadUrl;
        renderLauncher(result.launcher);
        const parts = [];
        if (result.downloaded) parts.push(result.downloaded + " archivo(s) actualizado(s)");
        if (result.forgeInstalledNow) parts.push("Forge instalado");
        const suffix = parts.length ? " (" + parts.join(", ") + ")" : "";
        if (kind === "play" && result.mode === "direct") {
            gameRunning = true;
            setStatus("Minecraft en marcha" + (result.quickPlay ? ", entrando en el servidor" : "") + suffix, "ok");
        } else if (kind === "play") {
            setStatus("Launcher de Minecraft abierto: entra con tu cuenta y pulsa Jugar" + suffix, "ok");
        } else {
            setStatus((result.offline ? "Sin conexion: pack " : "Pack ") + result.pack.version + " listo" + suffix, result.offline ? "warn" : "ok");
        }
        $("progress-detail").textContent = "";
    } catch (err) {
        const msg = cleanMessage(err);
        if (/NO_LAUNCHER|launcher oficial de Minecraft\. Instalalo/i.test(msg)) renderLauncher(null);
        setStatus("No se pudo completar", "warn");
        showError(msg);
    } finally {
        setBusy(false);
    }
}

async function doLogin() {
    if (busy) return;
    hideError();
    try {
        profile = await api.login();
        renderAccount();
        setStatus("Cuenta conectada: " + profile.name, "ok");
    } catch (err) {
        const msg = cleanMessage(err);
        if (!/cancelado/i.test(msg)) showError(msg);
    }
}

async function doLogout() {
    await api.logout();
    profile = null;
    renderAccount();
    setStatus("Sesion cerrada", "");
}

async function init() {
    const s = await api.status();
    $("launcher-version").textContent = "v" + s.version;
    $("game-dir").textContent = "Carpeta del pack: " + s.gameDir;
    if (s.launcherDownloadUrl) launcherDownloadUrl = s.launcherDownloadUrl;
    accountEnabled = Boolean(s.account && s.account.enabled);
    profile = s.account ? s.account.profile : null;
    gameRunning = Boolean(s.gameRunning);
    const ram = s.settings && s.settings.maxRamGb ? s.settings.maxRamGb : 4;
    $("ram").value = ram;
    $("ram-value").textContent = ram + " GB";
    $("use-official").checked = Boolean(s.settings && s.settings.useOfficialLauncher);
    renderAccount();
    renderManifest(s.manifest);
    renderLauncher(s.launcher);
    refreshPlayButton();
    await runPrepare("prepare");
}

function saveSettings() {
    return api.setSettings({ maxRamGb: Number($("ram").value), useOfficialLauncher: $("use-official").checked });
}

$("btn-play").addEventListener("click", () => runPrepare("play"));
$("btn-retry").addEventListener("click", () => runPrepare("prepare"));
$("btn-folder").addEventListener("click", () => api.openFolder());
$("btn-log").addEventListener("click", () => api.openLog());
$("btn-settings").addEventListener("click", () => $("settings").classList.toggle("hidden"));
$("btn-get-launcher").addEventListener("click", () => api.openLink(launcherDownloadUrl));
$("btn-update").addEventListener("click", () => api.installLauncherUpdate());
$("btn-login").addEventListener("click", doLogin);
$("btn-logout").addEventListener("click", doLogout);
$("btn-min").addEventListener("click", () => api.minimize());
$("btn-close").addEventListener("click", () => api.close());
$("ram").addEventListener("input", () => { $("ram-value").textContent = $("ram").value + " GB"; });
$("ram").addEventListener("change", saveSettings);
$("use-official").addEventListener("change", async () => { await saveSettings(); renderLauncher($("launcher-kind").textContent === "no encontrado" ? null : "exe"); });
for (const key of ["discord", "store", "web"]) {
    $("link-" + key).addEventListener("click", () => { if (links[key]) api.openLink(links[key]); });
}

init().catch((err) => showError(cleanMessage(err)));
