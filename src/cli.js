"use strict";
// Uso por consola, sin Electron, para probar el nucleo:
//   node src/cli.js status
//   node src/cli.js prepare      (todo menos abrir el launcher)
//   node src/cli.js play
// Variables: DEMONCRAFT_MANIFEST_URL, DEMONCRAFT_GAME_DIR, DEMONCRAFT_MINECRAFT_DIR
const setup = require("./core/setup");

function report(p) {
    const pct = p.total ? ` ${Math.round((100 * p.done) / p.total)} %` : "";
    const stepInfo = p.step != null ? `[${p.step + 1}/${p.steps}] ` : "";
    process.stdout.write(`${stepInfo}${p.label || ""} - ${p.message || ""}${pct}\n`);
}

async function main() {
    const cmd = process.argv[2] || "status";
    if (cmd === "status") {
        console.log(JSON.stringify(setup.status(), null, 2));
        return;
    }
    if (cmd === "prepare" || cmd === "play") {
        const started = Date.now();
        const result = await (cmd === "play" ? setup.play({ report }) : setup.prepare({ report }));
        console.log(JSON.stringify({
            pack: result.manifest.pack,
            offline: result.offline,
            downloaded: result.sync.downloaded.length,
            deleted: result.sync.deleted,
            created: result.sync.created,
            forgeInstalledNow: result.forge.installed,
            versionId: result.versionId,
            serverAdded: result.serverAdded,
            launcher: result.launcher,
            javaExe: result.javaExe,
            seconds: Math.round((Date.now() - started) / 1000),
        }, null, 2));
        return;
    }
    console.error("comando desconocido: " + cmd);
    process.exit(2);
}

main().catch((err) => {
    console.error("ERROR: " + (err && err.stack || err));
    process.exit(1);
});
