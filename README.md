# DemonCraft Launcher

Launcher del servidor DemonCraft (Kimetsu no Yaiba RP, Minecraft 1.20.1 + Forge). Funciona como CurseForge: al pulsar
**Jugar** instala o actualiza el pack de mods, deja Forge y un perfil «DemonCraft» en el **launcher oficial de
Minecraft** y lo abre; el jugador entra con su cuenta de Microsoft y pulsa Jugar. El perfil lleva la entrada directa
al servidor (`--quickPlayMultiplayer`), así que el juego arranca ya dentro.

- Carpeta del pack: `%APPDATA%\.demoncraft` (mods, texturas, partidas, opciones). No toca el `.minecraft` vanilla del
  jugador salvo para instalar la versión de Forge y el perfil.
- Java: solo hace falta para el instalador de Forge; usa el que ya trae el launcher oficial y, si no hay, descarga un
  JRE 17 de Adoptium.
- El launcher no guarda ni pide cuentas: de eso se ocupa el launcher oficial.

## Desarrollo

```
npm install
npm start                  # abre el launcher (Electron)
node src/cli.js status     # el nucleo sin ventana
node src/cli.js prepare    # todo menos abrir el launcher oficial
npm run dist               # instalador dist/DemonCraft-Launcher-Setup-X.Y.Z.exe
python tools/make_art.py   # regenera logo, fondo e iconos (PIL)
```

Variables para probar sin tocar lo real: `DEMONCRAFT_MANIFEST_URL`, `DEMONCRAFT_GAME_DIR`, `DEMONCRAFT_MINECRAFT_DIR`.

## Cómo se publica

Dos repositorios públicos en GitHub (sin el código de los mods del servidor):

1. **demoncraft-launcher** (este): cada versión del launcher es un release `vX.Y.Z` con el instalador, `latest.yml` y el
   `.blockmap` que genera `npm run dist`. El launcher instalado se actualiza solo desde ahí (electron-updater).
2. **demoncraft-pack**: cada versión del pack es un release `pack-X.Y.Z` con `manifest.json` y los archivos (mods y
   texturas). El launcher lee siempre `https://github.com/<owner>/demoncraft-pack/releases/latest/download/manifest.json`,
   así que publicar un release nuevo es publicar la actualización.

Antes del primer release hay que poner el usuario de GitHub en `src/core/config.js` (`OWNER`) y en
`electron-builder.yml` (`publish.owner`).

Publicar el launcher:

```
npm run dist
gh release create v1.0.0 dist/DemonCraft-Launcher-Setup-1.0.0.exe dist/latest.yml dist/*.blockmap --title "Launcher 1.0.0" --notes "Primera version"
```

Publicar el pack (desde el repositorio privado del servidor, que es quien tiene la instancia y los jars compilados):

```
python tools/build_launcher_pack.py --version 1.5.0 --publish
```

El instalador no va firmado: Windows SmartScreen avisará la primera vez («Más información → Ejecutar de todas formas»).

## Manifest del pack

Lo genera `tools/build_launcher_pack.py` del repositorio del servidor a partir de `tools/launcher_pack.json` (usuario de
GitHub, dirección del servidor, enlaces, novedades) y de la instancia del dueño. Campos: `pack`, `forge`, `server`,
`links`, `java`, `managed`, `files` (ruta, url, sha1, tamaño), `bundles`, `defaults`, `news`. Ver `src/core/manifest.js`.
