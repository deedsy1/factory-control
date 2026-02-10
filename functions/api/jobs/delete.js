import { d1, getRequester, json } from "../../_lib/d1.js";

// Deletes a job (and its related events) from D1.
// Safety: only the creator of the job can delete it.
export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const id = body?.id;
  if (!id || typeof id !== "string") {
    return json({ ok: false, error: "Missing job id" }, 400);
  }

  const db = d1(env);
  const requester = getRequester(request);
  if (!requester?.id) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const job = await db
    .prepare("SELECT id, created_by FROM jobs WHERE id = ?")
    .bind(id)
    .first();

  if (!job) {
    // already gone
    return json({ ok: true, deleted: true, already: true });
  }

  if (job.created_by && job.created_by !== requester.id) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  await db.batch([
    db.prepare("DELETE FROM job_events WHERE job_id = ?").bind(id),
    db.prepare("DELETE FROM jobs WHERE id = ?").bind(id),
  ]);

  return json({ ok: true, deleted: true });
}
