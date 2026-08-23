$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$ompAgent = Join-Path $HOME ".omp\agent"
$extensionDir = Join-Path $ompAgent "extensions"
$cavemanSkillDir = Join-Path $HOME ".agents\skills\caveman"
$sembleSkillDir = Join-Path $HOME ".agents\skills\semble"
$ponytailConfigDir = Join-Path $env:APPDATA "ponytail"

New-Item -ItemType Directory -Force -Path $extensionDir, $cavemanSkillDir, $sembleSkillDir, $ponytailConfigDir | Out-Null

Copy-Item (Join-Path $repoRoot "agent\extensions\openai-weekly-quota.ts") $extensionDir -Force
Copy-Item (Join-Path $repoRoot "agent\extensions\caveman-ultra.ts") $extensionDir -Force
Copy-Item (Join-Path $repoRoot "agent\skills\semble\SKILL.md") $sembleSkillDir -Force

& omp plugin install "@dietrichgebert/ponytail@4.9.0" --force
if ($LASTEXITCODE -ne 0) { throw "Ponytail installation failed with exit code $LASTEXITCODE." }
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw "uv is required: https://docs.astral.sh/uv/getting-started/installation/" }

& uv tool install "semble==0.5.5" --force
if ($LASTEXITCODE -ne 0) { throw "Semble installation failed with exit code $LASTEXITCODE." }


Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/JuliusBrussee/caveman/v2.3.1/skills/caveman/SKILL.md" `
  -OutFile (Join-Path $cavemanSkillDir "SKILL.md")

$ponytailConfig = @'
{
  "defaultMode": "ultra"
}
'@
[IO.File]::WriteAllText((Join-Path $ponytailConfigDir "config.json"), $ponytailConfig, (New-Object Text.UTF8Encoding($false)))

Write-Host "Installed: OpenAI quota statusline, Ponytail 4.9.0 ultra, Caveman 2.3.1 ultra, Semble 0.5.5."
Write-Host "Restart OMP."
