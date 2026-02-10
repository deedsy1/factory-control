// functions/_lib/github_app.js
// GitHub App -> Installation token helper for Cloudflare Pages Functions
// Uses WebCrypto (no external deps)

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

// --- Small helpers for GitHub Contents API (used by site contract/patch rollouts)
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decodeUtf8(b64) {
  const bin = atob(String(b64 || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghJson(env, url, options = {}) {
  const r = await ghFetch(env, url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      ...(options.headers || {}),
    },
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch {}
  return { ok: r.ok, status: r.status, data, text: txt };
}

export async function getGithubContents(env, owner, repo, path, ref) {
  const u = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
  if (ref) u.searchParams.set("ref", ref);
  const res = await ghJson(env, u.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`GitHub contents GET failed: HTTP ${res.status}
${res.text}`);
  }
  const data = res.data || {};
  const contentText = data.content ? b64decodeUtf8(String(data.content).replace(/\n/g, "")) : "";
  return { sha: data.sha, contentText, raw: data };
}

export async function putGithubContents(env, owner, repo, path, contentText, message, sha, branch) {
  const u = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
  const body = {
    message: message || `Update ${path}`,
    content: b64encodeUtf8(contentText),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  const res = await ghJson(env, u.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`GitHub contents PUT failed: HTTP ${res.status}
${res.text}`);
  }

  return res.data;
}
