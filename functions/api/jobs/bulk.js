import { json, requireDB, nowIso, sha1Hex, getRequester } from "../../_lib/d1.js";

function parseIntSafe(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export async function onRequestPost({ request, env }) {
  const db = requireDB(env);
  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.jobs) ? body.jobs : [];
  const dry_run = !!body.dry_run;

  if (!items.length) return json({ error: "Missing jobs[]" }, 400);

  const requester = getRequester(request);
  const created_by = requester.id;

  // Guardrails (same as single enqueue) — counts all jobs as 1 request, but still enforces limits.
  const maxHourly = parseIntSafe(env.RATE_LIMIT_HOURLY, 20);
  const maxDaily = parseIntSafe(env.RATE_LIMIT_DAILY, 200);

  const hourlyCount = (
    await db
      .prepare(
        "SELECT COUNT(1) as n FROM jobs WHERE created_by=? AND created_at >= datetime('now','-1 hour')"
      )
      .bind(created_by)
      .first()
  )?.n;

  if (maxHourly > 0 && (hourlyCount || 0) >= maxHourly) {
    return json({ error: `Rate limit exceeded (hourly). Try again later.`, hourlyCount, maxHourly }, 429);
  }

  const dailyCount = (
    await db
      .prepare(
        "SELECT COUNT(1) as n FROM jobs WHERE created_by=? AND created_at >= datetime('now','-24 hour')"
      )
      .bind(created_by)
      .first()
  )?.n;

  if (maxDaily > 0 && (dailyCount || 0) >= maxDaily) {
    return json({ error: `Rate limit exceeded (daily). Try again later.`, dailyCount, maxDaily }, 429);
  }

  const created_at = nowIso();
  const dayBucket = new Date().toISOString().slice(0, 10);

  const results = [];
  const toInsert = [];

  for (const raw of items.slice(0, 50)) {
    const repo = String(raw.repo || "").trim();
    const site_name = String(raw.site_name || "").trim();
    const event_type = String(raw.event_type || "factory_run").trim();
    const mode = String(raw.mode || "generate").trim();
    const template = String(raw.template || "").trim();
    const pages = clamp(parseIntSafe(raw.pages, 5), 1, 2000);
    const priority = parseIntSafe(raw.priority, 0);

    if (!repo || !repo.includes("/")) {
      results.push({ ok: false, error: "invalid repo", repo });
      continue;
    }

    const idemKey = await sha1Hex([created_by, repo, event_type, mode, pages, template, dayBucket].join("|"));

    const existing = await db
      .prepare(
        "SELECT id, status, created_at FROM jobs WHERE idempotency_key=? AND created_at >= datetime('now','-24 hour') ORDER BY created_at DESC LIMIT 1"
      )
      .bind(idemKey)
      .first();

    if (existing) {
      results.push({ ok: true, reused: true, job: existing, idempotency_key: idemKey, repo });
      continue;
    }

    const jobId = crypto.randomUUID();
    const payload = {
      job_id: jobId,
      site_name: site_name || repo,
      pages,
      mode,
      template: template || "default",
    };

    const jobRow = {
      id: jobId,
      created_at,
      created_by,
      repo,
      site_name: site_name || repo,
      event_type,
      mode,
      pages,
      template: template || "",
      payload_json: JSON.stringify({ event_type, client_payload: payload }),
      status: "queued",
      priority,
      idempotency_key: idemKey,
    };

    if (dry_run) {
      results.push({ ok: true, dry_run: true, would_enqueue: jobRow, repo });
    } else {
      toInsert.push(jobRow);
      results.push({ ok: true, job_id: jobId, status: "queued", idempotency_key: idemKey, repo });
    }
  }

  if (!dry_run && toInsert.length) {
    const stmt = db.prepare(
      `INSERT INTO jobs (id, created_at, created_by, repo, site_name, event_type, mode, pages, template, payload_json, status, priority, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const batch = toInsert.map((r) =>
      stmt.bind(
        r.id,
        r.created_at,
        r.created_by,
        r.repo,
        r.site_name,
        r.event_type,
        r.mode,
        r.pages,
        r.template,
        r.payload_json,
        r.status,
        r.priority,
        r.idempotency_key
      )
    );
    await db.batch(batch);
  }

  return json({ ok: true, results });
}
