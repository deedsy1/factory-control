import { ghFetch } from "../_lib/github_app.js";

function parseSitesYaml(yamlText) {
  const lines = String(yamlText || "").split(/\r?\n/);

  const sites = [];
  let inSites = false;
  let current = null;
  let inTags = false;
      inAds = false;
      inAds = false;
  let inAds = false;

  const stripQuotes = (s) => s.replace(/^["']|["']$/g, "");

  for (let rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed === "sites:" || trimmed.startsWith("sites:")) {
      inSites = true;
      continue;
    }
    if (!inSites) continue;

    // New item
    if (trimmed.startsWith("- ")) {
      // If this is "- name: xyz" start a new site
      if (current) sites.push(current);
      current = {};
      inTags = false;
      inAds = false;
      inAds = false;

      const rest = trimmed.slice(2).trim();
      if (rest.startsWith("name:")) {
        current.name = stripQuotes(rest.slice("name:".length).trim());
      }
      continue;
    }

    if (!current) continue;

    // Key: value
    const m = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (m) {
      const key = m[1];
      let val = m[2] ?? "";
      val = val.trim();

      if (key === "ads") {
        current.ads = current.ads || {};
        inAds = true;
        inTags = false;
      inAds = false;
        continue;
      }

      if (key === "tags") {
        current.tags = [];
        inTags = true;
        continue;
      }

      inTags = false;
      inAds = false;
      inAds = false;

      // ads subkeys
      if (inAds && current.ads && (key === "eligible" || key === "provider")) {
        if (key === "eligible") {
          current.ads.eligible = (val === "true" || val === "1" || val === "yes");
        } else {
          current.ads.provider = stripQuotes(val);
        }
        continue;
      }

      // numbers
      if (key === "default_pages") {
        const n = parseInt(val, 10);
        current.default_pages = Number.isFinite(n) ? n : 5;
        continue;
      }

      // strings
      if (val === "" || val === "null") {
        current[key] = "";
      } else {
        current[key] = stripQuotes(val);
      }
      continue;
    }

    // Tags list items (expects "- camping")
    if (inTags && trimmed.startsWith("- ")) {
      const tag = stripQuotes(trimmed.slice(2).trim());
      if (tag) current.tags.push(tag);
      continue;
    }
  }

  if (current) sites.push(current);

  // Filter minimum shape
  const cleaned = sites
    .filter((s) => s && s.repo)
    .map((s) => ({
      name: s.name || s.repo,
      repo: s.repo,
      default_pages: s.default_pages ?? 5,
      tags: Array.isArray(s.tags) ? s.tags : [],
      ads: (s.ads && typeof s.ads === 'object') ? s.ads : { eligible: false, provider: 'none' },
    }));

  return { sites: cleaned };
}

export async function onRequestGet({ env }) {
  const repo = env.SITES_REPO;
  const path = env.SITES_PATH || "sites.yaml";

  if (!repo || !repo.includes("/")) {
    return new Response("Set SITES_REPO in Cloudflare env (e.g. deedsy1/factory-control)", { status: 500 });
  }

  const [owner, name] = repo.split("/");
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`;

  const r = await ghFetch(env, url, { method: "GET" });
  const data = await r.json();

  if (!r.ok) {
    return new Response(JSON.stringify(data, null, 2), { status: 500 });
  }

  const raw = atob(String(data.content).replace(/\n/g, ""));
  const parsed = parseSitesYaml(raw);

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
