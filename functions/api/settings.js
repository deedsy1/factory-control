import { json, requireDB, nowIso } from "../_lib/d1.js";

async function ensureSettings(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
}

export async function onRequestGet({ env }) {
  const db = requireDB(env);
  await ensureSettings(db);
  const rows = (await db.prepare("SELECT key, value, updated_at FROM settings").all()).results || [];
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return json({ ok: true, settings: out, rows });
}

export async function onRequestPost({ request, env }) {
  const db = requireDB(env);
  await ensureSettings(db);
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || "").trim();
  const value = String(body.value ?? "").trim();
  if (!key) return json({ ok: false, error: "key required" }, 400);
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(key, value, nowIso()).run();
  return json({ ok: true, key, value });
}
