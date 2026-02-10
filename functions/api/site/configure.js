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

function buildSiteYaml({ title, description, theme_pack }) {
  const brand = title;
  const theme = theme_pack || "calm-paper";
  const meta = description || "Evergreen, practical reassurance — not advice.";
  // NOTE: base_url is intentionally not set here; keep whatever your Pages/custom domain uses.
  return `site:
  title: "${title.replace(/"/g, '\\"')}"
  brand: "${brand.replace(/"/g, '\\"')}"
  language_code: "en-us"
  base_url: ""
  default_meta_description: "${meta.replace(/"/g, '\\"')}"
theme:
  pack: "${theme.replace(/"/g, '\\"')}"
  font_sans: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif"
  font_serif: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif"
  content_max: "74ch"
  radius: "16px"
taxonomy:
  hubs:
    - id: "work-career"
      label: "Work & Career"
    - id: "money-stress"
      label: "Money & Stress"
    - id: "burnout-load"
      label: "Burnout & Load"
    - id: "milestones"
      label: "Milestones"
    - id: "social-norms"
      label: "Social Norms"
generation:
  no_advice_notice: "NO medical, legal, or financial advice."
  forbidden_words:
    - diagnose
    - diagnosis
    - prescribed
    - guaranteed
    - sue
  page_types:
    - is-it-normal
    - checklist
    - red-flags
    - myth-vs-reality
    - explainer
  outline_h2:
    - "What this feeling usually means"
    - "Common reasons"
    - "What makes it worse"
    - "What helps (non-advice)"
    - "When it might signal a bigger issue"
    - "FAQs"
  closing_reassurance_templates:
    - "If this is hitting a nerve, you're not alone — and you don't have to have it all figured out today."
    - "You're not failing for feeling this. Start small, be kind to yourself, and keep it simple."
    - "It's okay if this takes time. Tiny changes count more than perfect plans."
internal_linking:
  enabled: true
  same_hub_first: 3
  other_hubs_fill: 3
ads:
  provider: "none"
  adsense_client: ""
gates:
  required_frontmatter:
    - title
    - slug
    - summary
    - description
    - date
    - hub
    - page_type
    - gen_version
    - contract_hash
    - prompt_hash
  allow_extra_h2: false
`;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const repoFull = String(body.repo || "").trim();
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    const theme_pack = String(body.theme_pack || "").trim();

    if (!repoFull.includes("/")) return json({ message: "repo must be owner/repo" }, 400);
    if (!title) return json({ message: "title is required" }, 400);

    const [owner, repo] = repoFull.split("/", 2);
    const path = "data/site.yaml";
    const message = `chore: configure site contract for ${title}`;
    const existing = await getFile({ owner, repo, path, ref: "main", env });
    const content = buildSiteYaml({ title, description, theme_pack });

    const res = await putFile({
      owner, repo, path,
      message,
      content,
      sha: existing?.sha,
      env,
      branch: "main",
    });

    return json({ ok: true, commit: res.commit?.sha || null, path });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
