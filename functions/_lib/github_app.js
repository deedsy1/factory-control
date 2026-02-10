// functions/_lib/github_app.js
// GitHub App -> Installation token helper for Cloudflare Pages Functions
// Uses WebCrypto (no external deps)
//
// This file intentionally keeps the original structure and adds small helper
// exports used elsewhere in the dashboard (contents read/write, base64 helpers).

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function base64url(bytes) {
  let str = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importPrivateKey(pem) {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signJwtRS256(payload, pemPrivateKey) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  // GitHub requires exp <= 10 minutes from iat
  const fullPayload = {
    iat: now - 30,
    exp: now + 9 * 60,
    ...payload,
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(fullPayload)));
  const data = enc.encode(`${headerB64}.${payloadB64}`);

  const key = await importPrivateKey(pemPrivateKey);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data);
  const sigB64 = base64url(new Uint8Array(sig));

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

// Cache per edge instance
let cachedToken = null;
let cachedExp = 0;

export async function getInstallationToken(env) {
  if (!env.GITHUB_APP_ID) throw new Error("Missing env.GITHUB_APP_ID");
  if (!env.GITHUB_INSTALLATION_ID) throw new Error("Missing env.GITHUB_INSTALLATION_ID");
  if (!env.GITHUB_APP_PRIVATE_KEY) throw new Error("Missing env.GITHUB_APP_PRIVATE_KEY");

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedExp - 60 > now) return cachedToken;

  const jwt = await signJwtRS256(
    { iss: String(env.GITHUB_APP_ID) },
    String(env.GITHUB_APP_PRIVATE_KEY)
  );

  const url = `https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "factory-control-dashboard",
    },
  });

  const txt = await r.text();
  if (!r.ok) {
    throw new Error(`Failed to mint installation token: HTTP ${r.status}\n${txt}`);
  }

  const data = JSON.parse(txt);
  cachedToken = data.token;
  cachedExp = Math.floor(new Date(data.expires_at).getTime() / 1000);
  return cachedToken;
}

export async function ghFetch(env, url, options = {}) {
  const token = await getInstallationToken(env);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "factory-control-dashboard",
    Authorization: `token ${token}`,
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers });
}

/** Base64 helpers (GitHub contents API expects base64). */
export function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64DecodeUtf8(b64) {
  const bin = atob(String(b64 || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Convenience wrapper: read repo file contents via GitHub "contents" API.
 * Returns: { text, sha, raw, status }
 */
export async function getGithubContents(env, repo, path, ref = "main") {
  if (!repo) throw new Error("getGithubContents: missing repo (owner/name)");
  if (!path) throw new Error("getGithubContents: missing path");

  const url = new URL(`https://api.github.com/repos/${repo}/contents/${path.replace(/^\//, "")}`);
  if (ref) url.searchParams.set("ref", ref);

  const r = await ghFetch(env, url.toString(), { method: "GET" });
  const raw = await r.text();

  if (!r.ok) {
    return { text: "", sha: "", raw, status: r.status };
  }

  const data = JSON.parse(raw);
  const content = data && data.content ? String(data.content).replace(/\n/g, "") : "";
  const text = content ? b64DecodeUtf8(content) : "";
  return { text, sha: data.sha || "", raw, status: r.status };
}

/**
 * Convenience wrapper: create/update repo file via GitHub contents API.
 * If sha is provided, GitHub treats as update; otherwise create.
 * Returns: { ok, raw, status }
 */
export async function putGithubContents(env, repo, path, message, contentText, sha = "", branch = "main") {
  if (!repo) throw new Error("putGithubContents: missing repo (owner/name)");
  if (!path) throw new Error("putGithubContents: missing path");
  if (!message) message = `Update ${path}`;

  const url = `https://api.github.com/repos/${repo}/contents/${path.replace(/^\//, "")}`;
  const body = {
    message,
    content: b64EncodeUtf8(contentText ?? ""),
    branch: branch || "main",
  };
  if (sha) body.sha = sha;

  const r = await ghFetch(env, url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await r.text();
  return { ok: r.ok, raw, status: r.status };
}
