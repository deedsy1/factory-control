import { ghFetch } from "../../_lib/github_app.js";
import { parseYAML } from "../../_lib/yaml_lite.js";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function normalizeSites(raw) {
  const sites = Array.isArray(raw?.sites) ? raw.sites : [];
  return sites.map((s) => {
    const out = { ...s };
    out.tags = Array.isArray(out.tags) ? out.tags : [];
    const pt = Number(out.pages_total ?? 0);
    out.pages_total = Number.isFinite(pt) ? pt : 0;
    out.repo = String(out.repo || "").trim();
    return out;
  });
}

export async function onRequestGet({ env }) {
  try {
    const repo = env.SITES_REPO;
    const path = env.SITES_PATH || "sites.yaml";
    if (!repo) return json({ ok: false, error: "Set SITES_REPO" }, { status: 400 });

    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
    const r = await ghFetch(env, url);
    if (!r.ok) return json({ ok: false, error: `GitHub fetch failed (${r.status})`, detail: await r.text() }, { status: 502 });
    const data = await r.json();
    const decoded = atob((data.content || "").replace(/\n/g, ""));
    const parsed = parseYAML(decoded) || {};
    const sites = normalizeSites(parsed);

    // Approx coverage: sum succeeded job pages per repo.
    const rows = await env.DB.prepare(
      `SELECT repo, COALESCE(SUM(pages),0) AS done_pages, COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed_count
       FROM jobs GROUP BY repo`
    ).all();
    const byRepo = new Map();
    for (const row of rows.results || []) {
      byRepo.set(row.repo, { done_pages: Number(row.done_pages || 0), failed_count: Number(row.failed_count || 0) });
    }

    const coverage = sites.map((s) => {
      const stats = byRepo.get(s.repo) || { done_pages: 0, failed_count: 0 };
      const remaining = Math.max(0, Number(s.pages_total || 0) - stats.done_pages);
      const completion = s.pages_total > 0 ? Math.min(1, stats.done_pages / s.pages_total) : 0;
      return {
        name: s.name,
        repo: s.repo,
        pages_total: Number(s.pages_total || 0),
        done_pages: stats.done_pages,
        remaining,
        completion,
        failed_count: stats.failed_count,
      };
    });

    return json({ ok: true, coverage });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
