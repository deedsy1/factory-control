import { d1, json } from "../../_lib/d1.js";

// Returns simple progress numbers for a repo.
// GET /api/jobs/progress?repo=owner/repo
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const repo = (url.searchParams.get("repo") || "").trim();
  if (!repo) return json({ ok: false, error: "repo is required" }, 400);

  const db = d1(env);
  const done = await db
    .prepare("SELECT COALESCE(SUM(pages), 0) AS pages_done FROM jobs WHERE repo = ? AND status = 'success'")
    .bind(repo)
    .first();

  return json({ ok: true, repo, pages_done: Number(done?.pages_done || 0) });
}
