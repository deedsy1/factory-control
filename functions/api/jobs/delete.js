import { json, requireDB } from "../../_lib/d1.js";

export async function onRequestPost({ request, env }) {
  const db = requireDB(env);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return json({ error: "Missing id" }, 400);

  // Delete events first (if table exists)
  try {
    await db.prepare("DELETE FROM job_events WHERE job_id=?").bind(id).run();
  } catch {}

  const res = await db.prepare("DELETE FROM jobs WHERE id=?").bind(id).run();
  return json({ ok: true, id, deleted: res?.meta?.changes || 0 });
}
