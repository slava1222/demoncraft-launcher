"use strict";
// Encontrar y abrir el launcher oficial de Minecraft, en cualquiera de sus tres formas: instalador clasico, app de
// Xbox (C:\XboxGames) o Microsoft Store (paquete Microsoft.4297127D64EC6).
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const STORE_AUMID = "Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft";
const DOWNLOAD_URL = "https://www.minecraft.net/es-es/download";

function exeCandidates() {
    return [
        "C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe",
        path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Minecraft Launcher", "MinecraftLauncher.exe"),
        path.join(process.env.ProgramFiles || "C:\\Program Files", "Minecraft Launcher", "MinecraftLauncher.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Programs", "Minecraft Launcher", "MinecraftLauncher.exe"),
    ];
}

function storeInstalled() {
    try {
        const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage -Name Microsoft.4297127D64EC6 | Measure-Object).Count"], { encoding: "utf8", timeout: 20000, windowsHide: true });
        return r.status === 0 && Number((r.stdout || "").trim()) > 0;
    } catch (err) {
        return false;
    }
}

function findLauncher() {
    for (const exe of exeCandidates()) {
        if (exe && fs.existsSync(exe)) return { kind: "exe", path: exe };
    }
    if (process.platform === "win32" && storeInstalled()) return { kind: "store", aumid: STORE_AUMID };
    return null;
}

function openLauncher(found) {
    if (!found) throw new Error("No encuentro el launcher oficial de Minecraft en este equipo");
    let child;
    if (found.kind === "exe") child = spawn(found.path, [], { detached: true, stdio: "ignore", windowsHide: false });
    else child = spawn("explorer.exe", ["shell:AppsFolder\\" + found.aumid], { detached: true, stdio: "ignore" });
    child.unref();
}

module.exports = { findLauncher, openLauncher, DOWNLOAD_URL };
