"use strict";
// Inicio de sesion oficial: Microsoft (OAuth 2 con PKCE, cliente publico, sin secreto) -> Xbox Live -> XSTS ->
// servicios de Minecraft -> perfil. Solo cuentas que tienen el juego: si Mojang no ha aprobado todavia el id de
// cliente de nuestra app de Azure, el ultimo paso responde 403 y se explica.
const crypto = require("crypto");
const { postJson, postForm, getJson } = require("./api");

const AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const SCOPE = "XboxLive.signin offline_access";
const XBL_AUTH = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE = "https://api.minecraftservices.com/minecraft/profile";

const XERR = {
    2148916227: "Esta cuenta de Microsoft esta bloqueada en Xbox Live.",
    2148916233: "Esta cuenta de Microsoft no tiene perfil de Xbox: crea uno en xbox.com y vuelve a intentarlo.",
    2148916235: "Xbox Live no esta disponible en el pais de esta cuenta.",
    2148916236: "Esta cuenta necesita verificar la edad en xbox.com.",
    2148916237: "Esta cuenta necesita verificar la edad en xbox.com.",
    2148916238: "Es una cuenta de menor: un adulto tiene que añadirla a su familia en xbox.com.",
};

function base64url(buf) {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pkce() {
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    return { verifier, challenge, state: base64url(crypto.randomBytes(16)) };
}

function authorizeUrl(clientId, { challenge, state }) {
    const q = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        response_mode: "query",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        prompt: "select_account",
    });
    return `${AUTHORITY}/authorize?${q}`;
}

function fail(step, res) {
    const detail = (res.data && (res.data.error_description || res.data.errorMessage || res.data.error)) || res.text || "";
    return new Error(`${step} respondio ${res.status}: ${String(detail).slice(0, 200)}`);
}

async function exchangeCode(clientId, code, verifier, { signal } = {}) {
    const res = await postForm(`${AUTHORITY}/token`, { client_id: clientId, grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: verifier, scope: SCOPE }, { signal });
    if (res.status !== 200 || !res.data || !res.data.access_token) throw fail("Microsoft (codigo)", res);
    return res.data; // { access_token, refresh_token, expires_in }
}

async function refreshMicrosoft(clientId, refreshToken, { signal } = {}) {
    const res = await postForm(`${AUTHORITY}/token`, { client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPE }, { signal });
    if (res.status !== 200 || !res.data || !res.data.access_token) {
        const err = fail("Microsoft (renovacion)", res);
        err.code = "REFRESH_FAILED";
        throw err;
    }
    return res.data;
}

async function xboxLogin(msAccessToken, { signal } = {}) {
    const res = await postJson(XBL_AUTH, { Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "d=" + msAccessToken }, RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT" }, { signal });
    if (res.status !== 200 || !res.data || !res.data.Token) throw fail("Xbox Live", res);
    return { token: res.data.Token, uhs: res.data.DisplayClaims.xui[0].uhs };
}

async function xstsLogin(xblToken, { signal } = {}) {
    const res = await postJson(XSTS_AUTH, { Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] }, RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT" }, { signal });
    if (res.status === 401 && res.data && res.data.XErr) {
        const err = new Error(XERR[res.data.XErr] || ("Xbox Live rechazo la cuenta (XErr " + res.data.XErr + ")"));
        err.code = "XSTS_" + res.data.XErr;
        throw err;
    }
    if (res.status !== 200 || !res.data || !res.data.Token) throw fail("XSTS", res);
    return { token: res.data.Token, uhs: res.data.DisplayClaims.xui[0].uhs, xuid: (res.data.DisplayClaims.xui[0] || {}).xid || "" };
}

async function minecraftLogin(uhs, xstsToken, { signal } = {}) {
    const res = await postJson(MC_LOGIN, { identityToken: `XBL3.0 x=${uhs};${xstsToken}` }, { signal });
    if (res.status === 403) {
        const err = new Error("Mojang aun no ha aprobado este launcher (id de cliente de Azure pendiente de revision). Mientras tanto, usa el launcher oficial desde Ajustes.");
        err.code = "NOT_APPROVED";
        throw err;
    }
    if (res.status !== 200 || !res.data || !res.data.access_token) throw fail("Servicios de Minecraft", res);
    return { accessToken: res.data.access_token, expiresIn: Number(res.data.expires_in) || 86400 };
}

async function ownsMinecraft(mcToken, { signal } = {}) {
    const res = await getJson(MC_ENTITLEMENTS, { headers: { Authorization: "Bearer " + mcToken }, signal });
    if (res.status !== 200 || !res.data) throw fail("Servicios de Minecraft (licencia)", res);
    return Array.isArray(res.data.items) && res.data.items.length > 0;
}

async function fetchProfile(mcToken, { signal } = {}) {
    const res = await getJson(MC_PROFILE, { headers: { Authorization: "Bearer " + mcToken }, signal });
    if (res.status === 404) {
        const err = new Error("Esta cuenta de Microsoft no tiene Minecraft Java Edition (o aun no ha creado su nombre de jugador en minecraft.net).");
        err.code = "NO_PROFILE";
        throw err;
    }
    if (res.status !== 200 || !res.data || !res.data.id) throw fail("Servicios de Minecraft (perfil)", res);
    return { uuid: res.data.id, name: res.data.name };
}

/** De un token de Microsoft valido a una sesion de Minecraft completa. */
async function sessionFromMicrosoft(msAccessToken, { signal } = {}) {
    const xbl = await xboxLogin(msAccessToken, { signal });
    const xsts = await xstsLogin(xbl.token, { signal });
    const mc = await minecraftLogin(xsts.uhs, xsts.token, { signal });
    const profile = await fetchProfile(mc.accessToken, { signal });
    return { name: profile.name, uuid: profile.uuid, accessToken: mc.accessToken, expiresAt: Date.now() + mc.expiresIn * 1000, xuid: xsts.xuid };
}

module.exports = { pkce, authorizeUrl, exchangeCode, refreshMicrosoft, sessionFromMicrosoft, ownsMinecraft, fetchProfile, REDIRECT_URI };
