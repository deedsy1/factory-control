import { requireDB } from "../../_lib/d1.js";

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function onRequestGet({ request, env }) {
  const db = requireDB(env);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 5000));
  const status = (url.searchParams.get("status") || "").trim();
  const repo = (url.searchParams.get("repo") || "").trim();

  const where = [];
  const params = [];
  if (status && status !== "all") { where.push("status=?"); params.push(status); }
  if (repo) { where.push("repo LIKE ?"); params.push(`%${repo}%`); }

  const sql = `
    SELECT id, created_at, created_by, repo, site_name, mode, pages, status, error, gh_run_url, gh_conclusion
    FROM jobs
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const rows = (await db.prepare(sql).bind(...params).all()).results || [];
  const header = ["id","created_at","created_by","repo","site_name","mode","pages","status","error","gh_run_url","gh_conclusion"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(header.map((k) => csvEscape(r[k])).join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="jobs-${new Date().toISOString().slice(0,10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
