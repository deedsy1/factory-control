import { json, requireDB, nowIso, sha1Hex, getRequester } from "../../_lib/d1.js";

function parseIntSafe(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export async function onRequestGet({ request, env }) {
  const db = requireDB(env);
  const u = new URL(request.url);
  const status = (u.searchParams.get("status") || "").trim();
  const repo = (u.searchParams.get("repo") || "").trim();
  const limit = clamp(parseIntSafe(u.searchParams.get("limit"), 30), 1, 200);
  const offset = clamp(parseIntSafe(u.searchParams.get("offset"), 0), 0, 1000000);

  const where = [];
  const binds = [];
  if (status) {
    where.push("status = ?");
    binds.push(status);
  }
  if (repo) {
    where.push("repo = ?");
    binds.push(repo);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const stmt = db
    .prepare(
      `SELECT id, created_at, created_by, repo, site_name, event_type, mode, pages, template, status, priority, started_at, finished_at, error, gh_run_url, gh_conclusion
       FROM jobs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, limit, offset);

  const rows = (await stmt.all()).results || [];
  return json({ jobs: rows, limit, offset });
}

export async function onRequestPost({ request, env }) {
  const db = requireDB(env);
  const body = await request.json().catch(() => ({}));
  const repo = String(body.repo || "").trim();
  const site_name = String(body.site_name || "").trim();
  const event_type = String(body.event_type || "factory_run").trim();
  const mode = String(body.mode || "generate").trim();
  const template = String(body.template || "").trim();
  const pages = clamp(parseIntSafe(body.pages, 5), 1, 2000);
  const dry_run = !!body.dry_run;
  const priority = parseIntSafe(body.priority, 0);

  if (!repo || !repo.includes("/")) {
    return json({ error: "Missing/invalid repo (expected OWNER/REPO)" }, 400);
  }

  // Guardrails
  const requester = getRequester(request);
  const created_by = requester.id;

  const maxHourly = parseIntSafe(env.RATE_LIMIT_HOURLY, 20);
  const maxDaily = parseIntSafe(env.RATE_LIMIT_DAILY, 200);

  // Count jobs for requester in last hour/day
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

  const dayBucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const idemKey = await sha1Hex([created_by, repo, event_type, mode, pages, template, dayBucket].join("|"));

  // If identical job already exists in last 24h, return it (idempotent).
  const existing = await db
    .prepare(
      "SELECT id, status, created_at FROM jobs WHERE idempotency_key=? AND created_at >= datetime('now','-24 hour') ORDER BY created_at DESC LIMIT 1"
    )
    .bind(idemKey)
    .first();

  if (existing) {
    return json({ ok: true, reused: true, job: existing, idempotency_key: idemKey });
  }

  const payload = {
    job_id: null,
    site_name: site_name || repo,
    pages,
    mode,
    template: template || "default",
  };

  const jobId = crypto.randomUUID();
  payload.job_id = jobId;

  const created_at = nowIso();

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
    return json({ ok: true, dry_run: true, would_enqueue: jobRow, dispatch_payload: JSON.parse(jobRow.payload_json) });
  }

  await db
    .prepare(
      `INSERT INTO jobs (id, created_at, created_by, repo, site_name, event_type, mode, pages, template, payload_json, status, priority, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      jobRow.id,
      jobRow.created_at,
      jobRow.created_by,
      jobRow.repo,
      jobRow.site_name,
      jobRow.event_type,
      jobRow.mode,
      jobRow.pages,
      jobRow.template,
      jobRow.payload_json,
      jobRow.status,
      jobRow.priority,
      jobRow.idempotency_key
    )
    .run();

  return json({ ok: true, job_id: jobId, status: "queued", idempotency_key: idemKey });
}
