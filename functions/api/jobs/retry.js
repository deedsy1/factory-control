import { json, requireDB, nowIso } from "../../_lib/d1.js";

export async function onRequestPost({ request, env }) {
  const db = requireDB(env);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return json({ error: "Missing id" }, 400);

  const job = await db
    .prepare("SELECT id, status, repo, site_name, pages, mode, template FROM jobs WHERE id=?")
    .bind(id)
    .first();

  if (!job) return json({ error: "Job not found" }, 404);

  // Only allow retry for non-queued/running (safety)
  if (job.status === "queued" || job.status === "running") {
    return json({ error: `Job is already ${job.status}.` }, 409);
  }

  const updated_at = nowIso();
  await db
    .prepare(
      `UPDATE jobs
       SET status='queued',
           locked_at=NULL,
           started_at=NULL,
           finished_at=NULL,
           error=NULL,
           gh_run_url=NULL,
           gh_run_id=NULL,
           gh_conclusion=NULL,
           created_at=?
       WHERE id=?`
    )
    .bind(updated_at, id)
    .run();

  return json({ ok: true, id, status: "queued" });
}
