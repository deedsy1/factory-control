import { ghFetch } from "../../_lib/github_app.js";
import { json } from "../../_lib/d1.js";

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

async function getFile({ owner, repo, path, ref, env }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  const r = await ghFetch(env, url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub getFile failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  const content = data.content ? b64decode(String(data.content).replace(/\n/g, "")) : "";
  return { sha: data.sha, content };
}

async function putFile({ owner, repo, path, message, content, sha, env, branch = "main" }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
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
  if (!r.ok) throw new Error(`GitHub putFile failed: ${r.status} ${await r.text()}`);
  return r.json();
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

function parseExistingSlugs(planText) {
  const set = new Set();
  const reSlug = /^\s*-\s*slug:\s*"?([^"\n]+)"?\s*$/gm;
  let m;
  while ((m = reSlug.exec(String(planText || "")))) {
    set.add(String(m[1]).trim());
  }
  return set;
}

function appendPlanYaml({ existingText, items }) {
  const header = "items:\n";
  let out = existingText && String(existingText).trim() ? String(existingText).replace(/\s+$/,"") + "\n" : header;
  if (!out.startsWith("items:")) out = header;
  if (!out.endsWith("\n")) out += "\n";
  for (const it of items) {
    out += `  - slug: "${it.slug}"\n`;
    out += `    title: "${it.title.replace(/"/g,'\\"')}"\n`;
    if (it.hub) out += `    hub: "${it.hub.replace(/"/g,'\\"')}"\n`;
    if (it.page_type) out += `    page_type: "${it.page_type.replace(/"/g,'\\"')}"\n`;
    out += `    status: "todo"\n`;
  }
  return out;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const repoFull = String(body.repo || "").trim();
    const titles = Array.isArray(body.titles) ? body.titles.map(t => String(t).trim()).filter(Boolean) : [];
    const hub = body.hub ? String(body.hub).trim() : "";
    const page_type = body.page_type ? String(body.page_type).trim() : "";

    if (!repoFull.includes("/")) return json({ message: "repo must be owner/repo" }, 400);
    if (titles.length === 0) return json({ message: "titles[] required" }, 400);

    const [owner, repo] = repoFull.split("/", 2);
    const path = "data/plan.yaml";

    const existing = await getFile({ owner, repo, path, ref: "main", env });
    const existingText = existing?.content || "";
    const existingSlugs = parseExistingSlugs(existingText);

    const toAdd = [];
    for (const t of titles) {
      const slug = slugify(t);
      if (!slug || existingSlugs.has(slug)) continue;
      toAdd.push({ slug, title: t, hub: hub || "", page_type: page_type || "" });
      existingSlugs.add(slug);
    }

    if (toAdd.length === 0) {
      return json({ ok: true, added: 0, path, note: "No new titles (all were duplicates by slug)." });
    }

    const newText = appendPlanYaml({ existingText, items: toAdd });
    const message = `chore: import ${toAdd.length} plan items`;

    const res = await putFile({
      owner, repo, path,
      message,
      content: newText,
      sha: existing?.sha,
      env,
      branch: "main",
    });

    return json({ ok: true, added: toAdd.length, path, commit: res.commit?.sha || null });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
