import { ghFetch } from "../_lib/github_app.js";
import YAML from "yaml";

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
  const parsed = YAML.parse(raw) || { sites: [] };

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
