import { json, requireDB } from "../../_lib/d1.js";

export async function onRequestGet({ params, env }) {
  const db = requireDB(env);
  const id = String(params.id || "").trim();
  if (!id) return json({ error: "Missing id" }, 400);

  const row = await db
    .prepare(
      `SELECT id, created_at, created_by, repo, site_name, event_type, mode, pages, template, payload_json, status, priority,
              locked_at, started_at, finished_at, error, gh_run_url, gh_run_id, gh_conclusion
       FROM jobs WHERE id = ? LIMIT 1`
    )
    .bind(id)
    .first();

  if (!row) return json({ error: "Not found" }, 404);
  return json({ job: row });
}
