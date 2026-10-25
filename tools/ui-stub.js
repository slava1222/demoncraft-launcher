"use strict";
// Vista previa de la interfaz en un navegador (tools/ui-preview.html), sin Electron: un window.demoncraft de mentira que
// responde como el proceso principal. El caso sale de ?caso=: primera (la pregunta del primer arranque), otro (otro launcher,
// con 3 mods apartados), oficial (lo de siempre), sinlauncher (sin el launcher oficial) y enuso (un jar abierto por el juego).
// Solo para mirar la interfaz: no toca ningun archivo.
(function () {
    const caso = new URLSearchParams(location.search).get("caso") || "primera";
    const MC = "C:\\Users\\Jugador\\AppData\\Roaming\\.minecraft";
    const OWN = "C:\\Users\\Jugador\\AppData\\Roaming\\.demoncraft";
    const manifest = {
        pack: { name: "DemonCraft", version: "1.5.49", minecraft: "1.20.1", forge: "47.4.23" },
        forge: { versionId: "1.20.1-forge-47.4.23" },
        server: { name: "DemonCraft", address: "demoncraft.world" },
        links: { discord: "https://discord.gg/x", store: "https://tienda", web: "" },
        news: [
            { date: "2026-10-25", title: "El launcher, para todos", body: "Ahora también sirve si juegas con otro launcher o sin cuenta premium: Ajustes → Cómo juegas." },
            { date: "2026-10-25", title: "Actualización 1.5", body: "El Pase Estelar, la Caja de Sangre y la sangre de Enmu." },
        ],
    };
    const settings = { maxRamGb: null, mode: null, otherDir: null };
    if (caso === "otro" || caso === "enuso") settings.mode = "otro";
    if (caso === "oficial" || caso === "sinlauncher") settings.mode = "oficial";
    let progress = () => {};

    function status() {
        const otro = settings.mode === "otro";
        return {
            mode: otro ? "otro" : "oficial",
            modeChosen: !!settings.mode,
            gameDir: otro ? (settings.otherDir || MC) : OWN,
            defaultOtherDir: MC,
            looksLikeMinecraft: true,
            otherLooksLikeMinecraft: true,
            packVersion: caso === "primera" ? null : "1.5.48",
            settings: Object.assign({}, settings),
            installed: caso !== "primera",
            launcher: caso === "sinlauncher" || caso === "primera" ? null : "exe",
            launcherDownloadUrl: "https://www.minecraft.net/es-es/download",
            manifest,
            version: "1.1.0",
        };
    }

    function run(kind) {
        const otro = settings.mode === "otro";
        const steps = 5;
        const labels = ["Comprobando la versión del pack", "Actualizando mods y texturas", "Comprobando Java", "Comprobando Forge",
            otro ? "Preparando la versión DemonCraft y el servidor" : "Preparando el perfil y el servidor"];
        return new Promise((resolve, reject) => {
            let t = 0;
            const total = 14 * 1024 * 1024;
            const timer = setInterval(() => {
                t++;
                const step = Math.min(4, Math.floor(t / 4));
                progress({ step, steps, label: labels[step], message: step === 1 ? "Descargando knyquests-1.0.0.jar" : "...", done: step === 1 ? Math.min(total, (t % 4 + 1) * total / 4) : 0, total: step === 1 ? total : 0 });
                if (caso === "enuso" && t === 5) {
                    clearInterval(timer);
                    reject(new Error("Error invoking remote method 'prepare': Error: No se puede cambiar mods/knyquests-1.0.0.jar porque está en uso. Si Minecraft está abierto, ciérralo y vuelve a intentarlo."));
                    return;
                }
                if (t >= 20) {
                    clearInterval(timer);
                    resolve({
                        pack: manifest.pack, server: manifest.server, links: manifest.links, news: manifest.news, offline: false,
                        downloaded: 1, deleted: 0, forgeInstalledNow: false, launcher: otro ? null : (caso === "sinlauncher" ? null : "exe"),
                        launcherDownloadUrl: "https://www.minecraft.net/es-es/download",
                        mode: otro ? "otro" : "oficial", gameDir: otro ? (settings.otherDir || MC) : OWN, versionId: "DemonCraft",
                        forgeVersionId: "1.20.1-forge-47.4.23", movedAside: otro ? 3 : 0, strayDir: otro ? (settings.otherDir || MC) + "\\mods-guardados-demoncraft" : null,
                    });
                }
            }, 70);
        });
    }

    window.demoncraft = {
        status: async () => status(),
        prepare: () => run("prepare"),
        play: () => (caso === "sinlauncher" ? Promise.reject(new Error("Error invoking remote method 'play': Error: No encuentro el launcher oficial de Minecraft. Instalalo desde https://www.minecraft.net/es-es/download y vuelve a pulsar Jugar.")) : run("play")),
        cancel: async () => true,
        setSettings: async (s) => { Object.assign(settings, s); return Object.assign({}, settings); },
        openFolder: async () => console.log("abrir carpeta", status().gameDir),
        pickFolder: async () => ({ dir: "D:\\Juegos\\SKLauncher\\instancias\\DemonCraft", looksLikeMinecraft: false }),
        openLink: async (url) => console.log("abrir", url),
        minimize: async () => {},
        close: async () => {},
        installLauncherUpdate: async () => {},
        onProgress: (cb) => { progress = cb; },
        onLauncherUpdate: () => {},
    };
})();
