# Factory Control Plane

This repo triggers generation/regeneration runs across your site-factory repos using GitHub `repository_dispatch`.

## Prereqs
- PowerShell 7+ recommended (Windows PowerShell works too)
- A GitHub Personal Access Token with `repo` scope (classic) or fine-grained access to the target repos.
  - Store it in an env var: `$env:GITHUB_TOKEN = "..."`

## Files
- `sites.yaml` — list of your site repos
- `dispatch.ps1` — trigger runs (generate or regen)
- `health.ps1` — quick health check (last run + conclusion)

## Examples

Generate 5 pages on one site:
```powershell
./dispatch.ps1 -Repo "OWNER/REPO" -EventType factory_run -Pages 5
```

Regenerate pages with `gen_version` < 2:
```powershell
./dispatch.ps1 -Repo "OWNER/REPO" -EventType factory_regen -Mode regen -RegenRule "version_lt:2" -Pages 10
```

Regenerate a hub:
```powershell
./dispatch.ps1 -Repo "OWNER/REPO" -EventType factory_regen -Mode regen -RegenHub "camping" -Pages 20
```

Regenerate specific slugs:
```powershell
./dispatch.ps1 -Repo "OWNER/REPO" -EventType factory_regen -Mode regen -RegenSlugs "slug-one,slug-two" -Pages 2
```

Trigger all sites with a tag:
```powershell
./dispatch.ps1 -Tag "camping" -EventType factory_run -Pages 5
```

---

## Web UI + D1 Queue (v1) + v2 scaffolding

The Cloudflare Pages UI (`index.html`) can enqueue and process jobs using **Cloudflare D1**.

### 1) Create + bind the D1 database

Cloudflare Dashboard → **Workers & Pages → D1**

1. **Create database** (example name: `factory_control_db`)
2. Go to **Workers & Pages → Pages → factory-control → Settings → Functions → D1 database bindings**
3. Add a binding:
   - **Variable name:** `DB`
   - **D1 database:** `factory_control_db`
4. Repeat for **Preview** if you want preview deployments to work.

### 2) Apply migrations

Open the D1 database in Cloudflare and run the SQL files in order:

- `migrations/0001_jobs.sql`
- `migrations/0002_job_events.sql` (v2 scaffold)
- `migrations/0003_schedules.sql` (v2 scaffold)

### 3) Configure environment variables

Required (already used by GitHub App auth):
- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `SITES_REPO` (e.g. `deedsy1/factory-control`)
- `SITES_PATH` (e.g. `sites.yaml`)

Optional guardrails:
- `MAX_RUNNING` (default: 3)
- `LOCK_TTL_MINUTES` (default: 120)
- `RATE_LIMIT_HOURLY` (default: 20)
- `RATE_LIMIT_DAILY` (default: 200)

### 4) Use the UI

- `/` shows sites + job queue/history
- Enqueue jobs (dry-run supported)
- Run worker tick to dispatch queued jobs

### Notes

- The queue is durable (D1). The worker updates job status by polling the latest GitHub Actions run after dispatch.
- If a repo lock gets stuck (rare), it will auto-expire after `LOCK_TTL_MINUTES`.
