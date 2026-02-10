export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function text(msg, status = 200, headers = {}) {
  return new Response(msg, { status, headers });
}

export function requireDB(env) {
  if (!env || !env.DB || !env.DB.prepare) {
    throw new Error(
      "Missing D1 binding 'DB'. Bind a D1 database to this Pages project (Settings → Functions → D1 database bindings)."
    );
  }
  return env.DB;
}

export function nowIso() {
  return new Date().toISOString();
}

export async function sha1Hex(str) {
  const enc = new TextEncoder();
  const buf = enc.encode(String(str));
  const digest = await crypto.subtle.digest("SHA-1", buf);
  const bytes = new Uint8Array(digest);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getRequester(request) {
  const h = request.headers;
  const email = h.get("cf-access-authenticated-user-email") || "";
  const sub = h.get("cf-access-authenticated-user-userid") || "";
  const uname = h.get("cf-access-authenticated-user") || "";
  return {
    email,
    sub,
    username: uname,
    id: email ? `email:${email}` : sub ? `sub:${sub}` : uname ? `user:${uname}` : "unknown",
  };
}
