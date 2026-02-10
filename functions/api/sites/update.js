import { parseYAML, stringifyYAML } from "../../_lib/yaml_lite.js";
import { ghFetch } from "../../_lib/github_app.js";
import { json } from "../../_lib/d1.js";

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

async function getFile(env, repo, path, ref = "main") {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
  const r = await ghFetch(env, url, { method: "GET" });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || `GitHub GET failed: ${r.status}`);
  if (!data.content) throw new Error("No file content returned from GitHub");
  return { sha: data.sha, content: b64decode(data.content.replace(/\n/g, "")) };
}

async function putFile(env, repo, path, content, message, sha = null, branch = "main") {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const body = { message, content: b64encode(content), branch, ...(sha ? { sha } : {}) };
  const r = await ghFetch(env, url, { method:"PUT", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || `GitHub PUT failed: ${r.status}`);
  return data;
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const repo = String(body.repo || "").trim();
    const patch = body.patch || {};
    if (!repo) return json({ message:"repo required" }, 400);

    const sitesRepo = env.SITES_REPO;
    const sitesPath = env.SITES_PATH || "sites.yaml";
    if (!sitesRepo) return json({ message:"SITES_REPO not set" }, 500);

    const f = await getFile(env, sitesRepo, sitesPath);
    const doc = parseYAML(f.content) || {};
    const sites = Array.isArray(doc.sites) ? doc.sites : [];
    const idx = sites.findIndex(s => String(s.repo||"").trim() === repo);
    if (idx < 0) return json({ message:"site not found in sites.yaml", repo }, 404);

    if ("total_pages" in patch) {
      const n = toIntOrNull(patch.total_pages);
      if (n === null) delete sites[idx].total_pages;
      else sites[idx].total_pages = Math.max(0, n);
    }
    if ("default_pages" in patch) {
      const n = toIntOrNull(patch.default_pages);
      if (n === null) delete sites[idx].default_pages;
      else sites[idx].default_pages = Math.max(1, n);
    }

    doc.sites = sites;
    const out = stringifyYAML(doc) + "\n";
    await putFile(env, sitesRepo, sitesPath, out, `chore: update site settings for ${repo}`, f.sha);
    return json({ ok:true, repo, updated: patch });
  } catch (e) {
    return json({ message: e?.message || String(e) }, 500);
  }
}
