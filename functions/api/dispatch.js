import { ghFetch } from "../_lib/github_app.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const repo = body.repo;
  const event_type = body.event_type || "factory_run";
  const pages = body.pages || 5;

  if (!repo || !repo.includes("/")) {
    return new Response("Missing/invalid repo (expected OWNER/REPO)", { status: 400 });
  }
  const [owner, name] = repo.split("/");

  const client_payload = {
    pages,
    mode: body.mode || "generate",
    regen_rule: body.regen_rule || "",
    regen_hub: body.regen_hub || "",
    regen_slugs: body.regen_slugs || "",
  };

  const url = `https://api.github.com/repos/${owner}/${name}/dispatches`;
  const r = await ghFetch(env, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, client_payload }),
  });

  const txt = await r.text();
  // GitHub returns 204 on success
  if (r.status === 204) return new Response("OK (204)", { status: 200 });
  return new Response(`GitHub API ${r.status}\n${txt}`, { status: 500 });
}
