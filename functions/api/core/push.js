import YAML from "yaml";
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
  const body = {
    message,
    content: b64encode(content),
    branch,
    ...(sha ? { sha } : {}),
  };
  const r = await ghFetch(env, url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || `GitHub PUT failed: ${r.status}`);
  return data;
}

function deepMerge(target, patch) {
  if (patch === null || patch === undefined) return target;
  if (Array.isArray(patch)) return patch.slice();
  if (typeof patch !== "object") return patch;
  if (typeof target !== "object" || target === null || Array.isArray(target)) target = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = deepMerge(target[k], v);
    } else {
      target[k] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return target;
}

async function loadSitesList(env) {
  const sitesRepo = env.SITES_REPO;
  const sitesPath = env.SITES_PATH || "sites.yaml";
  if (!sitesRepo) throw new Error("SITES_REPO not set");
  const { content } = await getFile(env, sitesRepo, sitesPath);
  const doc = YAML.parse(content) || {};
  const sites = Array.isArray(doc.sites) ? doc.sites : [];
  return sites;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const scope = (body.scope || "selected").trim(); // selected|all|tag
    const tag = (body.tag || "").trim();
    const reposIn = Array.isArray(body.repos) ? body.repos : [];

    const patchRepo = env.SITES_REPO; // by default store patch in factory-control repo (same as sites.yaml)
    const patchPath = env.CORE_PATCH_PATH || "core/site_patch.yaml";
    const patchFile = await getFile(env, patchRepo, patchPath);
    const patch = YAML.parse(patchFile.content) || {};

    const sites = await loadSitesList(env);

    let targets = [];
    if (scope === "all") {
      targets = sites;
    } else if (scope === "tag") {
      if (!tag) return json({ message: "tag required when scope=tag" }, 400);
      targets = sites.filter(s => Array.isArray(s.tags) && s.tags.map(t=>String(t).toLowerCase()).includes(tag.toLowerCase()));
    } else {
      // selected
      const set = new Set(reposIn.map(r => String(r).trim()).filter(Boolean));
      targets = sites.filter(s => set.has(String(s.repo)));
    }

    if (!targets.length) return json({ message: "No target sites matched" }, 400);

    let updated = 0;
    const results = [];
    const patchHash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(patchFile.content));
    const patchHex = Array.from(new Uint8Array(patchHash)).map(b=>b.toString(16).padStart(2,"0")).join("");
    const msg = `chore: apply contract patch ${patchHex.slice(0,7)}`;

    for (const s of targets) {
      const repo = String(s.repo || "").trim();
      if (!repo) continue;
      try {
        const targetPath = "data/site.yaml";
        const existing = await getFile(env, repo, targetPath);
        const doc = YAML.parse(existing.content) || {};
        const merged = deepMerge(doc, patch);
        const out = YAML.stringify(merged);
        await putFile(env, repo, targetPath, out, msg, existing.sha);
        updated += 1;
        results.push({ repo, ok: true });
      } catch (e) {
        results.push({ repo: s.repo, ok: false, error: e?.message || String(e) });
      }
    }

    return json({ ok: true, updated, results, patch: { repo: patchRepo, path: patchPath } });
  } catch (e) {
    return json({ message: e?.message || String(e) }, 500);
  }
}
