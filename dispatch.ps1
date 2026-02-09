param(
  [string]$Repo = "",
  [string]$EventType = "factory_run",
  [ValidateSet("generate","regen")][string]$Mode = "generate",
  [string]$RegenRule = "",
  [string]$RegenHub = "",
  [string]$RegenSlugs = "",
  [int]$Pages = 5,
  [string]$GenVersion = "2",
  [string]$Tag = "",
  [string]$SitesFile = "sites.yaml"
)

function Get-SitesFromYaml($path) {
  if (!(Test-Path $path)) { throw "sites file not found: $path" }
  $raw = Get-Content $path -Raw
  # ConvertFrom-Yaml exists in PowerShell 7+. If missing, we fall back to a tiny parser for our simple structure.
  if (Get-Command ConvertFrom-Yaml -ErrorAction SilentlyContinue) {
    return ($raw | ConvertFrom-Yaml).sites
  }
  throw "ConvertFrom-Yaml not available. Install PowerShell 7+ or add a YAML parser module."
}

$token = $env:GITHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) { throw "Set `$env:GITHUB_TOKEN` first." }

$targets = @()
if ($Repo) {
  $targets = @(@{ repo = $Repo; default_pages = $Pages })
} else {
  $sites = Get-SitesFromYaml $SitesFile
  if ($Tag) {
    $targets = $sites | Where-Object { $_.tags -contains $Tag }
  } else {
    $targets = $sites
  }
}

if ($targets.Count -eq 0) { throw "No target repos found." }

foreach ($t in $targets) {
  $r = $t.repo
  $p = $Pages
  if ($t.default_pages) { $p = $Pages } # explicit Pages wins; keep simple

  $payload = @{
    event_type = $EventType
    client_payload = @{
      mode = $Mode
      pages = $p
      regen_rule = $RegenRule
      regen_hub = $RegenHub
      regen_slugs = $RegenSlugs
      gen_version = $GenVersion
    }
  } | ConvertTo-Json -Depth 6

  $uri = "https://api.github.com/repos/$r/dispatches"
  Write-Host "Dispatch -> $r ($EventType, mode=$Mode, pages=$p)" -ForegroundColor Cyan

  Invoke-RestMethod -Method Post -Uri $uri -Headers @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent" = "factory-control"
  } -Body $payload -ContentType "application/json"
}
