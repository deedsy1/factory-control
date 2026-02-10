import { json, requireDB } from "../_lib/d1.js";
import { ghFetch } from "../_lib/github_app.js";
import { parseYAML } from "../_lib/yaml_lite.js";

async function loadSites(env) {
  const repo = env.SITES_REPO;
  const path = env.SITES_PATH || "sites.yaml";
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const r = await ghFetch(env, url);
  if (!r.ok) return [];
  const data = await r.json();
  const decoded = atob((data.content || "").replace(/\n/g, ""));
  const parsed = parseYAML(decoded) || {};
  return Array.isArray(parsed.sites) ? parsed.sites : [];
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const repo = String(body.repo || "").trim();
  const site_name = String(body.site_name || "").trim();
  const pages = Number(body.pages || 0);
  const mode = String(body.mode || "generate");
  const patchKinds = Array.isArray(body.patches) ? body.patches : [];
  const willTouch = [];
  if (patchKinds.includes("plan")) willTouch.push("data/plan.yaml");
  if (patchKinds.some((k) => ["prompts","gates","ads"].includes(k))) willTouch.push("data/site.yaml");
  willTouch.push(".github/workflows/factory.yml (dispatch payload only)");

  const sites = await loadSites(env);
  const site = sites.find((s) => (repo && s.repo === repo) || (site_name && s.name === site_name)) || null;

  return json({
    ok: true,
    summary: {
      repo: repo || site?.repo,
      site_name: site_name || site?.name,
      pages,
      mode,
      paused: !!site?.paused,
      frozen: !!site?.frozen,
      tags: site?.tags || [],
      contracts: site?.contracts || {},
    },
    will_touch: willTouch,
    note: "Dry-run only: no GitHub changes or dispatch performed.",
  });
}
