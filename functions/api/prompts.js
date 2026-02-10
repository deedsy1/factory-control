import { ghFetch } from "../_lib/github_app.js";
import { parseYaml } from "../_lib/yaml_lite.js";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

export async function onRequestGet({ env }) {
  const repo = (env.PROMPTS_REPO || env.SITES_REPO || "").trim();
  const path = (env.PROMPTS_PATH || "core/prompts.yaml").trim();
  if (!repo) return json({ ok: false, error: "Set PROMPTS_REPO or SITES_REPO" }, { status: 400 });

  try {
    const r = await ghFetch(env, `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`);
    if (!r.ok) {
      const txt = await r.text();
      return json({ ok: false, error: `GitHub fetch failed (${r.status})`, detail: txt }, { status: 502 });
    }
    const data = await r.json();
    const content = atob((data.content || "").replace(/\n/g, ""));
    const parsed = parseYaml(content) || {};
    return json({ ok: true, repo, path, prompts: parsed.prompts || {} });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
