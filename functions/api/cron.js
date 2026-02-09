import { json, requireDB, nowIso, sha1Hex } from "../_lib/d1.js";

// v2 scaffold: compute due schedules and enqueue jobs.
// For now this endpoint is safe to call; it will no-op unless you add rows to schedules.

function parseIntSafe(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

export async function onRequestPost({ env }) {
  const db = requireDB(env);

  const now = new Date();
  const nowIsoStr = now.toISOString();

  // Load due schedules
  const due = (
    await db
      .prepare("SELECT * FROM schedules WHERE enabled=1 AND (next_run_at IS NULL OR next_run_at <= ?)")
      .bind(nowIsoStr)
      .all()
  ).results || [];

  if (!due.length) {
    return json({ ok: true, note: "no schedules due", at: nowIsoStr });
  }

  const created_at = nowIso();
  const enqueued = [];

  for (const s of due) {
    const repo = String(s.repo || "").trim();
    if (!repo || !repo.includes("/")) continue;

    const pages = parseIntSafe(s.pages, 5);
    const mode = String(s.mode || "generate").trim();

    // Schedule-created jobs are attributed to 'schedule:<id>'
    const created_by = `schedule:${s.id}`;
    const dayBucket = nowIsoStr.slice(0, 10);
    const idemKey = await sha1Hex([created_by, repo, "factory_run", mode, pages, dayBucket].join("|"));

    const existing = await db
      .prepare(
        "SELECT id FROM jobs WHERE idempotency_key=? AND created_at >= datetime('now','-24 hour') LIMIT 1"
      )
      .bind(idemKey)
      .first();

    if (existing) continue;

    const jobId = crypto.randomUUID();
    const payload = {
      event_type: "factory_run",
      client_payload: {
        job_id: jobId,
        site_name: s.site_name,
        pages,
        mode,
        template: "default",
      },
    };

    await db
      .prepare(
        `INSERT INTO jobs (id, created_at, created_by, repo, site_name, event_type, mode, pages, template, payload_json, status, priority, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`
      )
      .bind(
        jobId,
        created_at,
        created_by,
        repo,
        s.site_name,
        "factory_run",
        mode,
        pages,
        "",
        JSON.stringify(payload),
        idemKey
      )
      .run();

    // NOTE: next_run_at calculation intentionally not implemented here.
    // Add it when you start using schedules (hourly/daily/weekly).

    enqueued.push({ job_id: jobId, repo, schedule_id: s.id });
  }

  return json({ ok: true, enqueued, at: nowIsoStr });
}
