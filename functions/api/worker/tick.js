import { ghFetch } from "../../_lib/github_app.js";
import { parseYAML } from "../../_lib/yaml_lite.js";
import { json, requireDB, nowIso } from "../../_lib/d1.js";

function parseIntSafe(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}


async function ensureSettings(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
}

async function getSetting(db, key, defVal = null) {
  await ensureSettings(db);
  const row = await db.prepare("SELECT value FROM settings WHERE key=? LIMIT 1").bind(key).first();
  return row?.value ?? defVal;
}

async function loadSitesIndex(env) {
  const repo = env.SITES_REPO;
  const path = env.SITES_PATH || "sites.yaml";
  if (!repo) return new Map();
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const r = await ghFetch(env, url, { method: "GET" });
  if (!r.ok) return new Map();
  const data = await r.json();
  const decoded = atob((data.content || "").replace(/\n/g, ""));
  const parsed = parseYAML(decoded) || {};
  const sites = Array.isArray(parsed.sites) ? parsed.sites : [];
  const byRepo = new Map();
  for (const s of sites) {
    if (!s || !s.repo) continue;
    byRepo.set(String(s.repo).trim(), s);
  }
  return byRepo;
}

function isPausedOrFrozen(site) {
  const paused = !!site?.paused;
  const frozen = !!site?.frozen;
  return { paused, frozen };
}
async function releaseLock(db, repo) {
  await db.prepare("DELETE FROM site_locks WHERE repo=?").bind(repo).run();
}

async function cleanupExpiredLocks(db, lockTtlMinutes) {
  // Delete locks older than TTL
  await db
    .prepare(
      "DELETE FROM site_locks WHERE locked_at <= datetime('now', ? )"
    )
    .bind(`-${lockTtlMinutes} minutes`)
    .run();
}

async function countRunning(db) {
  const row = await db.prepare("SELECT COUNT(1) as n FROM jobs WHERE status='running'").first();
  return row?.n || 0;
}

async function pollAndUpdateRunning(db, env, limit = 15) {
  const running = (
    await db
      .prepare(
        "SELECT id, repo, started_at, gh_run_id FROM jobs WHERE status='running' ORDER BY started_at DESC LIMIT ?"
      )
      .bind(limit)
      .all()
  ).results || [];

  let updated = 0;

  for (const job of running) {
    try {
      const [owner, name] = String(job.repo).split("/");
      const runsUrl = `https://api.github.com/repos/${owner}/${name}/actions/runs?per_page=10`;
      const r = await ghFetch(env, runsUrl, { method: "GET" });
      if (!r.ok) continue;
      const data = await r.json();
      const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];

      const startedAt = job.started_at ? new Date(job.started_at).getTime() : 0;
      const windowStart = startedAt ? startedAt - 10 * 60 * 1000 : 0; // -10m
      const windowEnd = startedAt ? startedAt + 3 * 60 * 60 * 1000 : Date.now() + 3 * 60 * 60 * 1000;

      // Find the best matching repository_dispatch run around started_at
      let match = null;
      for (const run of runs) {
        if (run.event !== "repository_dispatch") continue;
        const t = new Date(run.created_at).getTime();
        if (startedAt) {
          if (t < windowStart || t > windowEnd) continue;
        }
        match = run;
        break;
      }

      if (!match) continue;

      const ghRunUrl = match.html_url || null;
      const ghRunId = match.id || null;
      const ghConclusion = match.conclusion || null;
      const ghStatus = match.status || null; // queued|in_progress|completed

      // Always backfill run url/id/conclusion
      await db
        .prepare(
          "UPDATE jobs SET gh_run_url=?, gh_run_id=?, gh_conclusion=? WHERE id=?"
        )
        .bind(ghRunUrl, ghRunId, ghConclusion, job.id)
        .run();

      if (ghStatus === "completed") {
        const finalStatus = ghConclusion === "success" ? "success" : "failed";
        await db
          .prepare("UPDATE jobs SET status=?, finished_at=?, error=? WHERE id=?")
          .bind(
            finalStatus,
            nowIso(),
            finalStatus === "failed" ? `GitHub conclusion: ${ghConclusion || "unknown"}` : null,
            job.id
          )
          .run();

        await releaseLock(db, job.repo);
        updated += 1;
      }
    } catch (_) {
      // ignore
    }
  }

  return updated;
}

async function acquireRepoLock(db, repo, jobId) {
  const lock = await db.prepare("SELECT repo, job_id, locked_at FROM site_locks WHERE repo=? LIMIT 1").bind(repo).first();
  if (!lock) {
    // attempt insert
    await db.prepare("INSERT OR IGNORE INTO site_locks (repo, job_id, locked_at) VALUES (?, ?, ?)")
      .bind(repo, jobId, nowIso())
      .run();
  }
  const lock2 = await db.prepare("SELECT repo, job_id FROM site_locks WHERE repo=? LIMIT 1").bind(repo).first();
  return lock2 && lock2.job_id === jobId;
}

async function dispatchJobToGitHub(env, repo, payload) {
  const [owner, name] = repo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/dispatches`;
  const r = await ghFetch(env, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r;
}

export async function onRequestPost({ env }) {
  const db = requireDB(env);
  const dispatchDisabled = (await getSetting(db, 'dispatch_disabled', '0')) === '1';
  if (dispatchDisabled) {
    return json({ ok: true, note: 'dispatch disabled', dispatch_disabled: true });
  }
  const sitesByRepo = await loadSitesIndex(env);

  const maxRunning = parseIntSafe(env.MAX_RUNNING, 3);
  const lockTtl = parseIntSafe(env.LOCK_TTL_MINUTES, 120);

  // 0) cleanup + poll running jobs (v1 status updates)
  await cleanupExpiredLocks(db, lockTtl);
  const polled = await pollAndUpdateRunning(db, env, 20);

  // 1) concurrency gate
  const runningCount = await countRunning(db);
  if (maxRunning > 0 && runningCount >= maxRunning) {
    return json({ ok: true, note: "max_running reached", running: runningCount, max_running: maxRunning, polled });
  }

  // 2) claim next queued job
  const candidates = await db
    .prepare(
      "SELECT id, repo, payload_json, event_type FROM jobs WHERE status='queued' ORDER BY priority DESC, created_at ASC LIMIT 25"
    )
    .all();

  const job = (candidates.results || []).find((j) => {
    const site = sitesByRepo.get(j.repo);
    const st = isPausedOrFrozen(site);
    return !st.paused && !st.frozen;
  });

  if (!job) {
    return json({ ok: true, note: "no runnable queued jobs (or all paused/frozen)", running: runningCount, polled });
  }

  // 3) acquire repo lock
  const locked = await acquireRepoLock(db, job.repo, job.id);
  if (!locked) {
    // Repo busy; leave it queued and return.
    return json({ ok: true, note: "repo locked", repo: job.repo, job_id: job.id, polled });
  }

  // 4) move to running
  const startedAt = nowIso();
  await db
    .prepare("UPDATE jobs SET status='running', locked_at=?, started_at=? WHERE id=?")
    .bind(nowIso(), startedAt, job.id)
    .run();

  // 5) dispatch
  let payload;
  try {
    payload = JSON.parse(job.payload_json || "{}");
  } catch {
    payload = {};
  }

  // Ensure payload shape
  if (!payload.event_type) payload.event_type = job.event_type || "factory_run";
  if (!payload.client_payload) payload.client_payload = {};
  payload.client_payload.job_id = job.id;

  const r = await dispatchJobToGitHub(env, job.repo, payload);
  if (r.status === 204) {
    return json({ ok: true, dispatched: true, job_id: job.id, repo: job.repo, polled });
  }

  const errTxt = await r.text().catch(() => "");

  // Mark failed + release lock
  await db
    .prepare("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?")
    .bind(nowIso(), `GitHub API ${r.status}: ${errTxt}`.slice(0, 1000), job.id)
    .run();

  await releaseLock(db, job.repo);

  return json({ ok: false, dispatched: false, job_id: job.id, repo: job.repo, error: `GitHub API ${r.status}` });
}
