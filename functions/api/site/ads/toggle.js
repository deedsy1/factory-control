import YAML from "yaml";
import { ghFetch } from "../../../_lib/github_app.js";
import { json } from "../../../_lib/d1.js";

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

function ensureAdsShape(doc) {
  if (!doc || typeof doc !== "object") doc = {};
  doc.site = doc.site && typeof doc.site === "object" ? doc.site : {};
  doc.ads = doc.ads && typeof doc.ads === "object" ? doc.ads : {};
  return doc;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const repo = (body.repo || "").trim();
    if (!repo) return json({ message: "repo is required" }, 400);

    const eligible = (typeof body.eligible === "boolean") ? body.eligible : null;
    const provider = (typeof body.provider === "string" && body.provider.trim()) ? body.provider.trim() : null;

    if (eligible === null && provider === null) {
      return json({ message: "Provide eligible (boolean) and/or provider (string)" }, 400);
    }

    const targetPath = "data/site.yaml";
    const { sha, content } = await getFile(env, repo, targetPath);

    const doc = ensureAdsShape(YAML.parse(content) || {});
    // Keep ads config under doc.ads to match your contract.
    if (eligible !== null) doc.ads.eligible = eligible;
    if (provider !== null) doc.ads.provider = provider;

    const out = YAML.stringify(doc);
    await putFile(env, repo, targetPath, out, `chore: update ads settings (${repo})`, sha);

    return json({ ok: true, repo, ads: doc.ads });
  } catch (e) {
    return json({ message: e?.message || String(e) }, 500);
  }
}
