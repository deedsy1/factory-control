param(
  [string]$Repo = "",
  [string]$Tag = "",
  [string]$WorkflowFile = "factory.yml",
  [string]$SitesFile = "sites.yaml"
)

function Get-SitesFromYaml($path) {
  if (!(Test-Path $path)) { throw "sites file not found: $path" }
  $raw = Get-Content $path -Raw
  if (Get-Command ConvertFrom-Yaml -ErrorAction SilentlyContinue) {
    return ($raw | ConvertFrom-Yaml).sites
  }
  throw "ConvertFrom-Yaml not available. Install PowerShell 7+ or add a YAML parser module."
}

$token = $env:GITHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) { throw "Set `$env:GITHUB_TOKEN` first." }

$targets = @()
if ($Repo) {
  $targets = @(@{ repo = $Repo })
} else {
  $sites = Get-SitesFromYaml $SitesFile
  if ($Tag) {
    $targets = $sites | Where-Object { $_.tags -contains $Tag }
  } else {
    $targets = $sites
  }
}

foreach ($t in $targets) {
  $r = $t.repo
  $uri = "https://api.github.com/repos/$r/actions/workflows/$WorkflowFile/runs?per_page=1"
  try {
    $resp = Invoke-RestMethod -Method Get -Uri $uri -Headers @{
      Authorization = "Bearer $token"
      Accept = "application/vnd.github+json"
      "X-GitHub-Api-Version" = "2022-11-28"
      "User-Agent" = "factory-control"
    }
    $run = $resp.workflow_runs[0]
    $status = $run.status
    $conclusion = $run.conclusion
    $updated = $run.updated_at
    Write-Host "$r  |  $status / $conclusion  |  $updated"
  } catch {
    Write-Host "$r  |  ERROR: $($_.Exception.Message)" -ForegroundColor Red
  }
}
