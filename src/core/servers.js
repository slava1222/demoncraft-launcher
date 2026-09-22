"use strict";
// El servidor en la lista de multijugador (servers.dat, NBT sin comprimir): el nuestro siempre el primero, los que
// añada el jugador se respetan.
const fs = require("fs");
const path = require("path");
const nbt = require("prismarine-nbt");
const config = require("./config");

function readServers(file) {
    try {
        const buf = fs.readFileSync(file);
        const parsed = nbt.parseUncompressed(buf); // devuelve el tag raiz { type, name, value }
        const list = parsed && parsed.value && parsed.value.servers && parsed.value.servers.value && parsed.value.servers.value.value;
        if (!Array.isArray(list)) return [];
        return list.map((entry) => {
            const out = {};
            for (const [k, v] of Object.entries(entry)) out[k] = v && v.value;
            return out;
        });
    } catch (err) {
        return [];
    }
}

function writeServers(file, servers) {
    const entries = servers.map((s) => {
        const c = { name: nbt.string(String(s.name || "")), ip: nbt.string(String(s.ip || "")) };
        if (s.icon) c.icon = nbt.string(String(s.icon));
        if (s.acceptTextures != null) c.acceptTextures = nbt.byte(Number(s.acceptTextures) ? 1 : 0);
        if (s.hidden != null) c.hidden = nbt.byte(Number(s.hidden) ? 1 : 0);
        return c;
    });
    const root = nbt.comp({ servers: nbt.list(nbt.comp(entries)) });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, nbt.writeUncompressed(root));
}

function ensureServer(manifest, { gameDir = config.gameDir } = {}) {
    const address = manifest.server && manifest.server.address ? String(manifest.server.address).trim() : "";
    if (!address) return false;
    const name = (manifest.server && manifest.server.name) || config.profileName;
    const file = path.join(gameDir, "servers.dat");
    const servers = readServers(file);
    const others = servers.filter((s) => s.ip !== address && s.name !== name);
    const mine = servers.find((s) => s.ip === address) || servers.find((s) => s.name === name) || {};
    writeServers(file, [Object.assign({}, mine, { name, ip: address, acceptTextures: 1 }), ...others]);
    return true;
}

module.exports = { ensureServer, readServers };
