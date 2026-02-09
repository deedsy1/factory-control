import { json, requireDB } from "../../../_lib/d1.js";

export async function onRequestGet({ params, env }) {
  const db = requireDB(env);
  const jobId = String(params.id || "").trim();
  if (!jobId) return json({ error: "Missing id" }, 400);

  const rows = (
    await db
      .prepare(
        "SELECT id, job_id, ts, type, message, data_json FROM job_events WHERE job_id=? ORDER BY ts DESC LIMIT 200"
      )
      .bind(jobId)
      .all()
  ).results || [];

  return json({ events: rows });
}
