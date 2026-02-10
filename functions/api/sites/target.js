import { json } from "../../_lib/d1.js";
import { getGithubContents, putGithubContents } from "../../_lib/github_app.js";
import { parseYAML, stringifyYAML } from "../../_lib/yaml_lite.js";

// Updates target_pages for a site entry inside sites.yaml.
// Body: { repo: "owner/repo" } OR { name: "site-name" }, and { target_pages: number|null }
export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const repo = (body.repo || "").trim();
  const name = (body.name || "").trim();
  const targetPagesRaw = body.target_pages;

  if (!repo && !name) return json({ ok: false, error: "Provide repo or name" }, 400);

  let target_pages = null;
  if (targetPagesRaw !== null && targetPagesRaw !== undefined && targetPagesRaw !== "") {
    const n = Number(targetPagesRaw);
    if (!Number.isFinite(n) || n < 0) return json({ ok: false, error: "target_pages must be a non-negative number" }, 400);
    target_pages = Math.floor(n);
  }

  const sitesRepo = env.SITES_REPO;
  const sitesPath = env.SITES_PATH || "sites.yaml";
  if (!sitesRepo) return json({ ok: false, error: "Set SITES_REPO" }, 500);

  const { content, sha } = await getGithubContents(env, sitesRepo, sitesPath);
  const data = parseYAML(content || "");
  if (!data || typeof data !== "object") return json({ ok: false, error: "Invalid sites.yaml" }, 500);

  const sites = Array.isArray(data.sites) ? data.sites : [];
  const idx = sites.findIndex((s) => {
    if (!s) return false;
    if (repo && String(s.repo || "").trim().toLowerCase() === repo.toLowerCase()) return true;
    if (name && String(s.site_name || s.name || "").trim().toLowerCase() === name.toLowerCase()) return true;
    return false;
  });
  if (idx === -1) return json({ ok: false, error: "Site not found in sites.yaml" }, 404);

  const updated = { ...sites[idx] };
  if (target_pages === null) {
    delete updated.target_pages;
  } else {
    updated.target_pages = target_pages;
  }
  sites[idx] = updated;
  data.sites = sites;

  const newContent = stringifyYAML(data);
  await putGithubContents(env, sitesRepo, sitesPath, newContent, sha, `Update target_pages for ${repo || name}`);
  return json({ ok: true, repo: updated.repo, target_pages: updated.target_pages ?? null });
}
