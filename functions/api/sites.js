import { ghFetch } from "./_lib/github_app.js";

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

// Minimal YAML parser for our simple sites.yaml structure (no external deps).
function parseSitesYaml(text) {
  const sites = [];
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\t/g, "  "));

  let cur = null;
  let inTags = false;
  let inAds = false;

  const commit = () => {
    if (!cur) return;
    if (cur.pages_total != null) {
      const n = Number(cur.pages_total);
      cur.pages_total = Number.isFinite(n) ? n : null;
    }
    if (cur.ads && typeof cur.ads.eligible === "string") {
      cur.ads.eligible = cur.ads.eligible.toLowerCase() === "true";
    }
    sites.push(cur);
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, ""); // strip trailing comments
    if (!line.trim()) continue;

    if (/^\s*-\s+name\s*:\s*/.test(line)) {
      commit();
      cur = { name: line.split(":")[1].trim(), tags: [], ads: { eligible: false } };
      inTags = false;
      inAds = false;
      continue;
    }
    if (!cur) continue;

    // Arrays
    if (/^\s*tags\s*:\s*$/.test(line)) {
      inTags = true;
      inAds = false;
      continue;
    }
    if (inTags && /^\s*-\s+/.test(line)) {
      cur.tags.push(line.replace(/^\s*-\s+/, "").trim());
      continue;
    }

    // Ads block
    if (/^\s*ads\s*:\s*$/.test(line)) {
      inAds = true;
      inTags = false;
      cur.ads = cur.ads || { eligible: false };
      continue;
    }
    if (inAds && /^\s{2,}[a-zA-Z_]+\s*:\s*/.test(line)) {
      const [k, ...rest] = line.trim().split(":");
      const v = rest.join(":").trim();
      if (k === "eligible") cur.ads.eligible = v;
      if (k === "provider") cur.ads.provider = v;
      continue;
    }

    // Simple key: value at current level
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    inTags = false;
    inAds = false;

    if (key === "pages_total") cur.pages_total = val === "" ? null : val;
    else cur[key] = val;
  }

  commit();
  return sites;
}

export async function onRequestGet({ env }) {
  const repo = env.SITES_REPO;
  const path = env.SITES_PATH || "sites.yaml";
  if (!repo) return json({ ok: false, message: "Set SITES_REPO in Cloudflare env (e.g. deedsy1/factory-control)" }, { status: 400 });

  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const r = await ghFetch(url, env);

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
  const sites = parseSitesYaml(decoded);

  return json({ ok: true, repo, path, sites });
}
