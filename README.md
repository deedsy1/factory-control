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
