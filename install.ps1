$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$ompAgent = Join-Path $HOME ".omp\agent"
$extensionDir = Join-Path $ompAgent "extensions"
$cavemanSkillDir = Join-Path $HOME ".agents\skills\caveman"
$ponytailConfigDir = Join-Path $env:APPDATA "ponytail"

New-Item -ItemType Directory -Force -Path $extensionDir, $cavemanSkillDir, $ponytailConfigDir | Out-Null

Copy-Item (Join-Path $repoRoot "agent\extensions\openai-weekly-quota.ts") $extensionDir -Force
Copy-Item (Join-Path $repoRoot "agent\extensions\caveman-ultra.ts") $extensionDir -Force

& omp plugin install "@dietrichgebert/ponytail@4.9.0" --force
if ($LASTEXITCODE -ne 0) { throw "Ponytail installation failed with exit code $LASTEXITCODE." }

Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/JuliusBrussee/caveman/v1.10.0/skills/caveman/SKILL.md" `
  -OutFile (Join-Path $cavemanSkillDir "SKILL.md")

@'
{
  "defaultMode": "ultra"
}
'@ | Set-Content -Encoding utf8 (Join-Path $ponytailConfigDir "config.json")

Write-Host "Installed: OpenAI quota statusline, Ponytail 4.9.0 ultra, Caveman 1.10.0 ultra."
Write-Host "Restart OMP."
