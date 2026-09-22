"use strict";
// Java para el instalador de Forge y para arrancar el juego (Forge 1.20.1 quiere Java 17). Primero el que ya trae el
// launcher oficial (java-runtime-gamma = 17; delta = 21 vale para el instalador); si no hay ninguno, se descarga un
// JRE 17 de Adoptium en la carpeta del launcher.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const AdmZip = require("adm-zip");
const config = require("./config");
const { download } = require("./download");
const stateStore = require("./state");

const TEMURIN_URL = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk";

function runtimeBases(minecraftDir) {
    const bases = [
        path.join(minecraftDir, "runtime"),
        path.join(process.env.APPDATA || "", ".minecraft", "runtime"),
        path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Minecraft Launcher", "runtime"),
        path.join(process.env.ProgramFiles || "C:\\Program Files", "Minecraft Launcher", "runtime"),
        path.join(process.env.LOCALAPPDATA || "", "Packages", "Microsoft.4297127D64EC6_8wekyb3d8bbwe", "LocalCache", "Local", "runtime"),
        "C:\\XboxGames\\Minecraft Launcher\\Content\\runtime",
    ];
    return bases.filter((b) => b && fs.existsSync(b));
}

function works(javaExe) {
    try {
        const r = spawnSync(javaExe, ["-version"], { encoding: "utf8", timeout: 15000, windowsHide: true });
        return r.status === 0;
    } catch (err) {
        return false;
    }
}

/** El Java del launcher oficial. `only17` exige la version 17 (para arrancar el juego). */
function findLauncherJava(minecraftDir = config.minecraftDir, { only17 = false } = {}) {
    const names = only17 ? ["java-runtime-gamma"] : ["java-runtime-gamma", "java-runtime-delta"];
    for (const base of runtimeBases(minecraftDir)) {
        for (const name of names) {
            for (const arch of ["windows-x64", "windows-x86"]) {
                const exe = path.join(base, name, arch, name, "bin", "java.exe");
                if (fs.existsSync(exe) && works(exe)) return exe;
            }
        }
    }
    return null;
}

function findExtractedJava(dir) {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir)) {
        const exe = path.join(dir, entry, "bin", "java.exe");
        if (fs.existsSync(exe)) return exe;
    }
    return null;
}

async function ensureJava({ gameDir = config.gameDir, minecraftDir = config.minecraftDir, state, only17 = false, report = () => {}, signal } = {}) {
    const fromLauncher = findLauncherJava(minecraftDir, { only17 });
    if (fromLauncher) return fromLauncher;
    if (state && state.javaPath && fs.existsSync(state.javaPath) && works(state.javaPath)) return state.javaPath;
    const runtimeDir = path.join(stateStore.launcherDir(gameDir), "runtime");
    const already = findExtractedJava(runtimeDir);
    if (already && works(already)) return already;

    report({ phase: "java", message: "Descargando Java 17...", done: 0, total: 0 });
    const zipPath = path.join(stateStore.launcherDir(gameDir), "temurin-17-jre.zip");
    await download(TEMURIN_URL, zipPath, { signal, onProgress: (received, total) => report({ phase: "java", message: "Descargando Java 17...", done: received, total }) });
    report({ phase: "java", message: "Instalando Java 17..." });
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    new AdmZip(zipPath).extractAllTo(runtimeDir, true);
    fs.rmSync(zipPath, { force: true });
    const exe = findExtractedJava(runtimeDir);
    if (!exe || !works(exe)) throw new Error("Java se descargo pero no arranca (" + os.arch() + ")");
    if (state) state.javaPath = exe;
    return exe;
}

module.exports = { ensureJava, findLauncherJava };
