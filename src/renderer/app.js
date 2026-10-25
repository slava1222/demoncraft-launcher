"use strict";
// La interfaz: pide el estado, lanza la preparacion al abrir, pinta el progreso y el boton Jugar.
// 1.1.0 (25/10): dos modos. Con el launcher oficial, JUGAR prepara el pack y lo abre (lo de siempre). Con otro launcher,
// ACTUALIZAR pone el pack al dia en la carpeta del juego de ese launcher y explica que version elegir alli.
const $ = (id) => document.getElementById(id);
const api = window.demoncraft;

let busy = false;
let launcherKind = null;
let launcherDownloadUrl = "https://www.minecraft.net/es-es/download";
let links = {};
let mode = "oficial";
let current = null; // lo ultimo de api.status()
let pickDir = null; // la carpeta propuesta en la pregunta del primer arranque

const FOOTER = {
    oficial: "Al pulsar Jugar se instala o actualiza el pack y se abre el launcher oficial de Minecraft con el perfil DemonCraft listo: entra con tu cuenta y pulsa Jugar.",
    otro: "Al pulsar Actualizar se pone al día el pack en la carpeta de tu launcher. Después ábrelo, elige la versión DemonCraft y juega.",
};

function playLabel() {
    return mode === "otro" ? "ACTUALIZAR" : "JUGAR";
}

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
    $("btn-play").querySelector(".play-text").textContent = value ? (label || "PREPARANDO") : playLabel();
    // mientras se prepara no se cambia de modo ni de carpeta (el proceso principal tampoco lo deja)
    for (const el of document.querySelectorAll('input[name="mode"], #btn-other-dir')) el.disabled = value;
    if (!value) setProgress(0, 0);
}

function renderManifest(m) {
    if (!m) return;
    if (m.pack) {
        $("pack-version").textContent = m.pack.version || "—";
        if (m.pack.minecraft) $("mc-version").textContent = m.pack.minecraft;
        if (m.pack.forge) $("forge-version").textContent = m.pack.forge;
    }
    $("server-address").textContent = (m.server && m.server.address) ? m.server.address : "se anunciará pronto";
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
        const p = document.createElement("p"); p.className = "muted"; p.textContent = "Sin novedades todavía."; news.appendChild(p);
    }
}

function renderLauncher(kind) {
    launcherKind = kind;
    if (mode === "otro") {
        $("launcher-kind").textContent = "otro launcher";
        $("no-launcher").classList.add("hidden");
        return;
    }
    const names = { exe: "instalado", store: "Microsoft Store" };
    $("launcher-kind").textContent = kind ? names[kind] || kind : "no encontrado";
    if (kind) $("no-launcher").classList.add("hidden"); else $("no-launcher").classList.remove("hidden");
}

/** Todo lo que cambia con el modo: el boton, los ajustes, las carpetas y el pie. */
function applyMode(s) {
    current = s;
    mode = s.mode === "otro" ? "otro" : "oficial";
    document.body.classList.toggle("mode-otro", mode === "otro");
    for (const radio of document.querySelectorAll('input[name="mode"]')) radio.checked = radio.value === mode;
    $("other-dir-row").classList.toggle("hidden", mode !== "otro");
    $("other-dir").textContent = mode === "otro" ? s.gameDir : "";
    $("other-dir").title = mode === "otro" ? s.gameDir : "";
    $("ram-setting").classList.toggle("hidden", mode === "otro");
    $("ram-other").classList.toggle("hidden", mode !== "otro");
    $("btn-folder").textContent = mode === "otro" ? "Carpeta del juego" : "Carpeta del pack";
    // con otro launcher la carpeta ya se ve arriba, con su boton
    $("game-dir").textContent = mode === "otro" ? "" : "Carpeta del pack: " + s.gameDir;
    $("footer-text").textContent = FOOTER[mode];
    $("other-help").classList.add("hidden");
    if (!busy) $("btn-play").querySelector(".play-text").textContent = playLabel();
    renderLauncher(s.launcher);
}

/** Con otro launcher, al acabar: que version elegir alli y, si se aparto algo, donde esta. */
function renderOtherDone(result) {
    const version = result.versionId || "DemonCraft";
    const forge = result.forgeVersionId ? " (o " + result.forgeVersionId + ")" : "";
    $("other-help-text").textContent = "Ahora abre tu launcher, elige la versión " + version + forge
        + " y juega: entra directo en el servidor. Antes de jugar, abre este launcher para tener el pack al día.";
    const moved = result.movedAside || 0;
    const strayFolder = result.strayDir ? result.strayDir.split(/[\\/]/).pop() : "mods-guardados-demoncraft";
    $("other-moved").textContent = moved
        ? (moved === 1 ? "Había 1 archivo" : "Había " + moved + " archivos") + " en mods que no son del pack: "
            + (moved === 1 ? "lo hemos movido" : "los hemos movido") + " a la carpeta " + strayFolder + ", al lado de mods (no se ha borrado nada)."
        : "";
    $("other-moved").title = result.strayDir || "";
    $("other-moved").classList.toggle("hidden", !moved);
    $("other-help").classList.remove("hidden");
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
    $("other-help").classList.add("hidden");
    // con otro launcher no se abre nada: JUGAR (ACTUALIZAR) solo prepara
    const opening = kind === "play" && mode !== "otro";
    setBusy(true, opening ? "ABRIENDO" : mode === "otro" ? "ACTUALIZANDO" : "PREPARANDO");
    setStatus(opening ? "Preparando el juego..." : "Comprobando el pack...");
    try {
        const result = opening ? await api.play() : await api.prepare();
        renderManifest(result);
        renderLauncher(result.launcher);
        if (result.launcherDownloadUrl) launcherDownloadUrl = result.launcherDownloadUrl;
        const parts = [];
        if (result.downloaded) parts.push(result.downloaded + " archivo(s) actualizado(s)");
        if (result.forgeInstalledNow) parts.push("Forge instalado");
        const suffix = parts.length ? " (" + parts.join(", ") + ")" : "";
        if (opening) setStatus("Launcher de Minecraft abierto: entra con tu cuenta y pulsa Jugar" + suffix, "ok");
        else if (result.mode === "otro") {
            setStatus((result.offline ? "Sin conexión: pack " : "Pack ") + result.pack.version + " listo en la carpeta de tu launcher" + suffix, result.offline ? "warn" : "ok");
            renderOtherDone(result);
        } else setStatus((result.offline ? "Sin conexión: pack " : "Pack ") + result.pack.version + " listo" + suffix, result.offline ? "warn" : "ok");
        $("progress-detail").textContent = "";
    } catch (err) {
        const msg = String(err && err.message || err).replace(/^Error invoking remote method '[\w:-]+': Error: /, "");
        if (/NO_LAUNCHER|launcher oficial/i.test(msg)) renderLauncher(null);
        setStatus("No se pudo completar", "warn");
        showError(msg);
    } finally {
        setBusy(false);
    }
}

// ------------------------------------------------------------------ la pregunta del primer arranque
function showModePick() {
    document.body.classList.add("picking");
    $("mode-pick").classList.remove("hidden");
    $("pick-modes").classList.remove("hidden");
    $("pick-dir").classList.add("hidden");
}

function hideModePick() {
    document.body.classList.remove("picking");
    $("mode-pick").classList.add("hidden");
}

function renderPickDir(dir, looksLikeMinecraft) {
    pickDir = dir;
    $("pick-dir-path").textContent = dir;
    $("pick-dir-path").title = dir;
    const note = $("pick-dir-note");
    if (looksLikeMinecraft === false) {
        note.textContent = "Esta carpeta no parece la de un juego de Minecraft (no tiene versions ni options.txt). Si tu launcher guarda el juego en otra, elígela con Cambiar.";
        note.className = "warn-note";
    } else {
        note.textContent = "Es la carpeta de siempre de Minecraft, la que usan casi todos los launchers si no la has cambiado. Si el tuyo guarda el juego en otra (una instancia, por ejemplo), elígela con Cambiar. Los mods que haya y no sean del pack se apartan a una carpeta: no se borra nada.";
        note.className = "muted";
    }
}

function showPickDir() {
    showModePick();
    $("pick-modes").classList.add("hidden");
    $("pick-dir").classList.remove("hidden");
    const dir = (current && current.settings && current.settings.otherDir) || (current && current.defaultOtherDir) || "";
    renderPickDir(dir, current ? current.otherLooksLikeMinecraft : undefined);
}

async function chooseMode(newMode, dir) {
    await api.setSettings(dir ? { mode: newMode, otherDir: dir } : { mode: newMode });
    applyMode(await api.status());
    hideModePick();
    await runPrepare("prepare");
}

for (const card of document.querySelectorAll(".mode-card")) {
    card.addEventListener("click", () => {
        if (card.dataset.mode === "otro") showPickDir();
        else chooseMode("oficial").catch((err) => showError(String(err && err.message || err)));
    });
}
$("btn-pick-change").addEventListener("click", async () => {
    const picked = await api.pickFolder(pickDir);
    if (picked) renderPickDir(picked.dir, picked.looksLikeMinecraft);
});
$("btn-pick-go").addEventListener("click", () => chooseMode("otro", pickDir).catch((err) => showError(String(err && err.message || err))));
$("btn-pick-back").addEventListener("click", showModePick);
$("btn-switch-other").addEventListener("click", showPickDir);

// ------------------------------------------------------------------ el modo y la carpeta en Ajustes
for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", async () => {
        if (!radio.checked || busy) return;
        await api.setSettings({ mode: radio.value });
        applyMode(await api.status());
        hideError();
        setStatus(mode === "otro" ? "Pulsa ACTUALIZAR para poner el pack en la carpeta de tu launcher" : "Pulsa JUGAR para preparar el pack y abrir el launcher oficial");
    });
}
$("btn-other-dir").addEventListener("click", async () => {
    if (busy) return;
    const picked = await api.pickFolder(current ? current.gameDir : null);
    if (!picked) return;
    await api.setSettings({ otherDir: picked.dir });
    applyMode(await api.status());
    hideError();
    if (picked.looksLikeMinecraft) setStatus("Pulsa ACTUALIZAR para poner el pack en esa carpeta");
    else setStatus("Esa carpeta no parece la de un juego de Minecraft: comprueba que es la de tu launcher antes de pulsar ACTUALIZAR", "warn");
});

async function init() {
    const s = await api.status();
    $("launcher-version").textContent = "v" + s.version;
    if (s.launcherDownloadUrl) launcherDownloadUrl = s.launcherDownloadUrl;
    renderManifest(s.manifest);
    applyMode(s);
    const ram = s.settings && s.settings.maxRamGb ? s.settings.maxRamGb : 4;
    $("ram").value = ram;
    $("ram-value").textContent = ram + " GB";
    // 1.1.0: sin modo elegido, en un equipo sin el pack o sin el launcher oficial, primero se pregunta como juega
    if (!s.modeChosen && (!s.installed || !s.launcher)) {
        setStatus("Elige cómo juegas para empezar");
        showModePick();
        return;
    }
    await runPrepare("prepare");
}

$("btn-play").addEventListener("click", () => runPrepare("play"));
$("btn-retry").addEventListener("click", () => runPrepare("prepare"));
$("btn-folder").addEventListener("click", () => api.openFolder());
// con los ajustes abiertos no se ve la ayuda del otro launcher: las dos juntas no caben en la ventana
$("btn-settings").addEventListener("click", () => document.body.classList.toggle("settings-open", !$("settings").classList.toggle("hidden")));
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
