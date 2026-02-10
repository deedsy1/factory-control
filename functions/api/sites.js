// NOTE: this file lives at functions/api/sites.js. Shared helpers live at functions/_lib/*
// so the correct relative import is ../_lib/...
import { ghFetch } from "../_lib/github_app.js";
import { parseYaml } from "../_lib/yaml_lite.js";

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function normalizeSites(raw) {
  const sites = Array.isArray(raw?.sites) ? raw.sites : [];
  return sites.map((s) => {
    const out = { ...s };
    out.tags = Array.isArray(out.tags) ? out.tags : [];
    const pt = Number(out.pages_total ?? out.total_pages ?? out.page_total ?? 0);
    out.pages_total = Number.isFinite(pt) ? pt : 0;
    const dp = Number(out.default_pages ?? 0);
    out.default_pages = Number.isFinite(dp) ? dp : 0;
    out.prompt_version = out.prompt_version || "page_writer@v2";
    out.paused = !!out.paused;
    out.frozen = !!out.frozen;
    out.ads = out.ads || {};
    out.ads.mode = out.ads.mode || "manual"; // manual|auto
    out.ads.eligible = !!out.ads.eligible;
    out.ads.rules = out.ads.rules || { min_pages: 40, min_completion: 0.7 };
    return out;
  });
}

export async function onRequestGet({ env }) {
  const repo = env.SITES_REPO;
  const path = env.SITES_PATH || "sites.yaml";
  if (!repo) return json({ ok: false, message: "Set SITES_REPO in Cloudflare env (e.g. deedsy1/factory-control)" }, { status: 400 });

  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const r = await ghFetch(env, url);

  let data;
  try {
    data = await r.json();
  } catch {
    const t = await r.text();
    return json({ ok: false, message: `GitHub response not JSON`, details: t, status: r.status }, { status: 502 });
  }

  if (!r.ok) {
    return json(
      {
        ok: false,
        message: data?.message || "GitHub error",
        status: r.status,
        documentation_url: data?.documentation_url,
      },
      { status: 502 }
    );
  }

  const content = data?.content;
  if (!content) {
    return json({ ok: false, message: `sites file not found or empty: ${repo}/${path}` }, { status: 404 });
  }

  const decoded = atob(content.replace(/\n/g, ""));
  const parsed = parseYaml(decoded) || {};
  const sites = normalizeSites(parsed);
  const tags = [...new Set(sites.flatMap((s) => s.tags || []))].sort();
  return json({ ok: true, repo, path, sites, tags });
}
