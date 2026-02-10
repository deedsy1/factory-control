import { ghFetch } from "../_lib/github_app.js";
import { parseYAML, stringifyYAML } from "../_lib/yaml_lite.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return b;
  if (a && typeof a === "object" && b && typeof b === "object") {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  return b;
}

async function readCoreYaml(env, path) {
  const repo = env.SITES_REPO;
  const basePath = "core/" + path;
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(basePath)}`;
  const r = await ghFetch(env, url);
  if (!r.ok) throw new Error(`Failed to read ${basePath} (${r.status})`);
  const data = await r.json();
  const decoded = atob((data.content || "").replace(/\n/g, ""));
  return parseYAML(decoded) || {};
}

async function getFile(env, repo, path) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const r = await ghFetch(env, url);
  if (r.status === 404) return { ok: true, exists: false, sha: null, content: "" };
  if (!r.ok) return { ok: false, status: r.status, text: await r.text() };
  const data = await r.json();
  const decoded = atob((data.content || "").replace(/\n/g, ""));
  return { ok: true, exists: true, sha: data.sha, content: decoded };
}

async function putFile(env, repo, path, content, sha, message) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const payload = { message, content: btoa(unescape(encodeURIComponent(content))), sha: sha || undefined };
  const r = await ghFetch(env, url, { method: "PUT", body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`GitHub PUT failed (${r.status}): ${await r.text()}`);
  return await r.json();
}

export async function onRequestGet({ env }) {
  try {
    const prompts = await readCoreYaml(env, "prompts.yaml");
    const gates = await readCoreYaml(env, "gates.yaml");
    const ads = await readCoreYaml(env, "ads.yaml");
    return json({ ok: true, prompts, gates, ads });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const kind = String(body.kind || "").trim(); // prompts|gates|ads
    const version = String(body.version || "").trim(); // e.g. v1
    const repos = Array.isArray(body.repos) ? body.repos.map((r) => String(r).trim()).filter(Boolean) : [];
    if (!kind || !version || repos.length === 0) return json({ ok: false, error: "kind, version, repos[] required" }, 400);

    const core = await readCoreYaml(env, `${kind}.yaml`);
    const entry = core?.[kind]?.[version];
    const patch = entry?.patch;
    if (!patch) return json({ ok: false, error: `No patch for ${kind}.${version}` }, 400);

    const results = [];
    for (const repo of repos) {
      const f = await getFile(env, repo, "data/site.yaml");
      if (!f.ok) { results.push({ repo, ok: false, error: f.text }); continue; }
      const current = f.content ? (parseYAML(f.content) || {}) : {};
      const merged = deepMerge(current, patch);
      merged.contracts = merged.contracts || {};
      if (kind === "prompts") merged.contracts.prompt = `page_writer@${version}`;
      if (kind === "gates") merged.contracts.gates = version;
      if (kind === "ads") merged.contracts.ads = version;

      const out = stringifyYAML(merged) + "\n";
      await putFile(env, repo, "data/site.yaml", out, f.sha, `factory-control: apply ${kind} ${version}`);
      results.push({ repo, ok: true });
    }
    return json({ ok: true, kind, version, results });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
