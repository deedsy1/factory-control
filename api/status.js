import { ghFetch } from "../_lib/github_app.js";

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const repo = u.searchParams.get("repo");

  if (!repo || !repo.includes("/")) {
    return new Response("Missing/invalid repo (expected OWNER/REPO)", { status: 400 });
  }
  const [owner, name] = repo.split("/");

  const url = `https://api.github.com/repos/${owner}/${name}/actions/runs?per_page=5`;
  const r = await ghFetch(env, url, { method: "GET" });

  const txt = await r.text();
  return new Response(txt, {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}
