"use strict";
// Lo unico que la interfaz puede pedirle al proceso principal.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("demoncraft", {
    status: () => ipcRenderer.invoke("status"),
    prepare: () => ipcRenderer.invoke("prepare"),
    play: () => ipcRenderer.invoke("play"),
    cancel: () => ipcRenderer.invoke("cancel"),
    setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
    login: () => ipcRenderer.invoke("account:login"),
    logout: () => ipcRenderer.invoke("account:logout"),
    openFolder: () => ipcRenderer.invoke("open:folder"),
    openLog: () => ipcRenderer.invoke("open:log"),
    openLink: (url) => ipcRenderer.invoke("open:link", url),
    minimize: () => ipcRenderer.invoke("window:minimize"),
    close: () => ipcRenderer.invoke("window:close"),
    installLauncherUpdate: () => ipcRenderer.invoke("launcher-update:install"),
    onProgress: (callback) => { ipcRenderer.on("progress", (event, payload) => callback(payload)); },
    onGameExit: (callback) => { ipcRenderer.on("game-exit", (event, payload) => callback(payload)); },
    onLauncherUpdate: (callback) => { ipcRenderer.on("launcher-update", (event, payload) => callback(payload)); },
});
