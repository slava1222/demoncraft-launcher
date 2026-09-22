"use strict";
// Peticiones HTTP con cuerpo (JSON o formulario) y respuesta JSON, sobre http/https de Node. Para las llamadas a
// Microsoft, Xbox Live y los servicios de Minecraft.
const http = require("http");
const https = require("https");
const { URLSearchParams } = require("url");
const config = require("./config");

const TIMEOUT_MS = 30000;

function requestRaw(method, url, { headers = {}, body = null, signal } = {}) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(url);
        } catch (err) {
            return reject(new Error("URL no valida: " + url));
        }
        const lib = target.protocol === "https:" ? https : http;
        const req = lib.request(target, { method, headers: Object.assign({ "User-Agent": config.userAgent, "Accept": "application/json" }, headers), signal }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
            res.on("error", reject);
        });
        req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("Tiempo de espera agotado: " + target.host)));
        req.on("error", reject);
        if (body != null) req.write(body);
        req.end();
    });
}

function parse(res) {
    const text = res.body.toString("utf8");
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (err) {
        data = null;
    }
    return { status: res.status, headers: res.headers, text, data };
}

async function getJson(url, { headers, signal } = {}) {
    return parse(await requestRaw("GET", url, { headers, signal }));
}

async function postJson(url, payload, { headers, signal } = {}) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    return parse(await requestRaw("POST", url, { headers: Object.assign({ "Content-Type": "application/json", "Content-Length": String(body.length) }, headers || {}), body, signal }));
}

async function postForm(url, fields, { headers, signal } = {}) {
    const body = Buffer.from(new URLSearchParams(fields).toString(), "utf8");
    return parse(await requestRaw("POST", url, { headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(body.length) }, headers || {}), body, signal }));
}

module.exports = { getJson, postJson, postForm, requestRaw };
