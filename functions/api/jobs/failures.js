import { json, requireDB } from "../../_lib/d1.js";

function bucketize(err) {
  const e = String(err || "").toLowerCase();
  if (!e) return "unknown";
  if (e.includes("github api") || e.includes("bad credentials") || e.includes("401") || e.includes("403")) return "github_auth";
  if (e.includes("not found") || e.includes("404")) return "github_not_found";
  if (e.includes("rate") && e.includes("limit")) return "rate_limit";
  if (e.includes("workflow") || e.includes("actions")) return "actions_workflow";
  if (e.includes("yaml") || e.includes("parse")) return "config_parse";
  return "other";
}

export async function onRequestGet({ env }) {
  const db = requireDB(env);
  const limit = 200;
  const rows = (await db.prepare(
    "SELECT id, repo, status, error, created_at FROM jobs WHERE status='failed' ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all()).results || [];

  const buckets = new Map();
  for (const r of rows) {
    const b = bucketize(r.error);
    if (!buckets.has(b)) buckets.set(b, { bucket: b, count: 0, jobs: [] });
    const entry = buckets.get(b);
    entry.count += 1;
    entry.jobs.push({ id: r.id, repo: r.repo, created_at: r.created_at, error: r.error });
  }

  return json({ ok: true, buckets: Array.from(buckets.values()).sort((a,b)=>b.count-a.count) });
}
