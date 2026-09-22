"use strict";
// Descargas con verificacion sha1, reintentos y progreso, sobre http/https de Node con stream.pipeline (el fetch de
// Node 24 se cae con un assert interno de undici cuando el servidor cierra la conexion con el flujo en pausa).
// Se escribe en un .part y solo al final se renombra: nunca queda un archivo a medias con el nombre bueno.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const config = require("./config");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_REDIRECTS = 6;
const IDLE_TIMEOUT_MS = 45000;

function sha1File(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha1");
        fs.createReadStream(file)
            .on("data", (chunk) => hash.update(chunk))
            .on("error", reject)
            .on("end", () => resolve(hash.digest("hex")));
    });
}

/** GET con redirecciones (GitHub manda los assets a otro dominio) y tiempo de espera por inactividad. */
function request(url, { signal, headers } = {}, redirects = 0) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(url);
        } catch (err) {
            return reject(new Error("URL no valida: " + url));
        }
        const lib = target.protocol === "https:" ? https : http;
        const options = { headers: Object.assign({ "User-Agent": config.userAgent, "Accept": "*/*" }, headers || {}), signal };
        const req = lib.get(target, options, (res) => {
            const status = res.statusCode || 0;
            if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
                res.resume();
                if (redirects >= MAX_REDIRECTS) return reject(new Error("Demasiadas redirecciones: " + url));
                return resolve(request(new URL(res.headers.location, target).toString(), { signal, headers }, redirects + 1));
            }
            if (status !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${status} al pedir ${url}`));
            }
            resolve(res);
        });
        req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error("Tiempo de espera agotado: " + url)));
        req.on("error", reject);
    });
}

async function getBuffer(url, options) {
    const res = await request(url, options);
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function fetchJson(url, options) {
    return JSON.parse((await getBuffer(url, options)).toString("utf8"));
}

async function fetchText(url, options) {
    return (await getBuffer(url, options)).toString("utf8");
}

async function downloadOnce(url, dest, { sha1, onProgress, signal }) {
    const res = await request(url, { signal });
    const total = Number(res.headers["content-length"]) || 0;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + ".part";
    const hash = crypto.createHash("sha1");
    let received = 0;
    const counter = new Transform({
        transform(chunk, encoding, callback) {
            hash.update(chunk);
            received += chunk.length;
            if (onProgress) onProgress(received, total);
            callback(null, chunk);
        },
    });
    try {
        await pipeline(res, counter, fs.createWriteStream(tmp), { signal });
    } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
    }
    if (total && received !== total) {
        fs.rmSync(tmp, { force: true });
        throw new Error(`Descarga incompleta de ${path.basename(dest)} (${received} de ${total} bytes)`);
    }
    const digest = hash.digest("hex");
    if (sha1 && digest !== String(sha1).toLowerCase()) {
        fs.rmSync(tmp, { force: true });
        throw new Error(`El archivo ${path.basename(dest)} llego corrupto (sha1 ${digest.slice(0, 8)}... en vez de ${String(sha1).slice(0, 8)}...)`);
    }
    fs.rmSync(dest, { force: true });
    fs.renameSync(tmp, dest);
    return { sha1: digest, size: received };
}

async function download(url, dest, { sha1, onProgress, signal, retries = 3 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await downloadOnce(url, dest, { sha1, onProgress, signal });
        } catch (err) {
            lastError = err;
            if (err && err.name === "AbortError") throw err;
            if (attempt < retries) await sleep(700 * attempt);
        }
    }
    throw lastError;
}

/** Ejecuta tareas asincronas con como mucho `limit` a la vez, conservando el orden de los resultados. */
async function pool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function run() {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
}

module.exports = { download, sha1File, fetchJson, fetchText, pool, sleep, request };
