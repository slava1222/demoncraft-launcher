"use strict";
// La interfaz: pide el estado, lanza la preparacion al abrir, pinta el progreso y el boton Jugar.
const $ = (id) => document.getElementById(id);
const api = window.demoncraft;

let busy = false;
let launcherKind = null;
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

function setBusy(value, label) {
    busy = value;
    $("btn-play").disabled = value;
    $("btn-play").querySelector(".play-text").textContent = value ? (label || "PREPARANDO") : "JUGAR";
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
    launcherKind = kind;
    const names = { exe: "instalado", store: "Microsoft Store" };
    $("launcher-kind").textContent = kind ? names[kind] || kind : "no encontrado";
    if (kind) $("no-launcher").classList.add("hidden"); else $("no-launcher").classList.remove("hidden");
}

api.onProgress((p) => {
    const label = p.label ? p.label + (p.message ? ": " : "") : "";
    setStatus(label + (p.message || ""), p.warning ? "warn" : "");
    if (p.step != null && p.steps) {
        const detail = [];
        detail.push("Paso " + Math.min(p.step + 1, p.steps) + " de " + p.steps);
        if (p.total) detail.push(fmtBytes(p.done) + " / " + fmtBytes(p.total));
        $("progress-detail").textContent = detail.join(" · ");
    }
    if (p.total) setProgress(p.done, p.total);
    else setProgress(0, 0);
});

api.onLauncherUpdate(() => $("update-banner").classList.remove("hidden"));

async function runPrepare(kind) {
    if (busy) return;
    hideError();
    setBusy(true, kind === "play" ? "ABRIENDO" : "PREPARANDO");
    setStatus(kind === "play" ? "Preparando el juego..." : "Comprobando el pack...");
    try {
        const result = kind === "play" ? await api.play() : await api.prepare();
        renderManifest(result);
        renderLauncher(result.launcher);
        if (result.launcherDownloadUrl) launcherDownloadUrl = result.launcherDownloadUrl;
        const parts = [];
        if (result.downloaded) parts.push(result.downloaded + " archivo(s) actualizado(s)");
        if (result.forgeInstalledNow) parts.push("Forge instalado");
        const suffix = parts.length ? " (" + parts.join(", ") + ")" : "";
        if (kind === "play") setStatus("Launcher de Minecraft abierto: entra con tu cuenta y pulsa Jugar" + suffix, "ok");
        else setStatus((result.offline ? "Sin conexion: pack " : "Pack ") + result.pack.version + " listo" + suffix, result.offline ? "warn" : "ok");
        $("progress-detail").textContent = "";
    } catch (err) {
        const msg = String(err && err.message || err).replace(/^Error invoking remote method '\w+': Error: /, "");
        if (/NO_LAUNCHER|launcher oficial/i.test(msg)) renderLauncher(null);
        setStatus("No se pudo completar", "warn");
        showError(msg);
    } finally {
        setBusy(false);
    }
}

async function init() {
    const s = await api.status();
    $("launcher-version").textContent = "v" + s.version;
    $("game-dir").textContent = "Carpeta del pack: " + s.gameDir;
    if (s.launcherDownloadUrl) launcherDownloadUrl = s.launcherDownloadUrl;
    renderManifest(s.manifest);
    renderLauncher(s.launcher);
    const ram = s.settings && s.settings.maxRamGb ? s.settings.maxRamGb : 4;
    $("ram").value = ram;
    $("ram-value").textContent = ram + " GB";
    await runPrepare("prepare");
}

$("btn-play").addEventListener("click", () => runPrepare("play"));
$("btn-retry").addEventListener("click", () => runPrepare("prepare"));
$("btn-folder").addEventListener("click", () => api.openFolder());
$("btn-settings").addEventListener("click", () => $("settings").classList.toggle("hidden"));
$("btn-get-launcher").addEventListener("click", () => api.openLink(launcherDownloadUrl));
$("btn-update").addEventListener("click", () => api.installLauncherUpdate());
$("btn-min").addEventListener("click", () => api.minimize());
$("btn-close").addEventListener("click", () => api.close());
$("ram").addEventListener("input", () => { $("ram-value").textContent = $("ram").value + " GB"; });
$("ram").addEventListener("change", async () => { await api.setSettings({ maxRamGb: Number($("ram").value) }); });
for (const key of ["discord", "store", "web"]) {
    $("link-" + key).addEventListener("click", () => { if (links[key]) api.openLink(links[key]); });
}

init().catch((err) => showError(String(err && err.message || err)));
