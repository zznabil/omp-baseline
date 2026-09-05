$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$ompAgent = Join-Path $HOME ".omp\agent"
$extensionDir = Join-Path $ompAgent "extensions"
$sembleSkillDir = Join-Path $HOME ".agents\skills\semble"

New-Item -ItemType Directory -Force -Path $extensionDir, $sembleSkillDir | Out-Null

Copy-Item (Join-Path $repoRoot "agent\extensions\openai-weekly-quota.ts") $extensionDir -Force
Copy-Item (Join-Path $repoRoot "agent\skills\semble\SKILL.md") $sembleSkillDir -Force

$obsoleteCavemanExtension = Join-Path $extensionDir "caveman-ultra.ts"
if (Test-Path -LiteralPath $obsoleteCavemanExtension -PathType Leaf)
{
  Remove-Item -LiteralPath $obsoleteCavemanExtension -Force
}
$cavemanExtensionDir = Split-Path $obsoleteCavemanExtension
if ((Test-Path -LiteralPath $cavemanExtensionDir -PathType Container) -and @(Get-ChildItem -LiteralPath $cavemanExtensionDir -Force).Count -eq 0)
{
  Remove-Item -LiteralPath $cavemanExtensionDir -Force
}
$cavemanSkillFile = Join-Path $HOME ".agents\skills\caveman\SKILL.md"
if (Test-Path -LiteralPath $cavemanSkillFile -PathType Leaf)
{
  Remove-Item -LiteralPath $cavemanSkillFile -Force
}
$cavemanSkillDir = Split-Path $cavemanSkillFile
if ((Test-Path -LiteralPath $cavemanSkillDir -PathType Container) -and @(Get-ChildItem -LiteralPath $cavemanSkillDir -Force).Count -eq 0)
{
  Remove-Item -LiteralPath $cavemanSkillDir -Force
}
$ponytailConfigFile = Join-Path $env:APPDATA "ponytail\config.json"
if (Test-Path -LiteralPath $ponytailConfigFile -PathType Leaf)
{
  Remove-Item -LiteralPath $ponytailConfigFile -Force
}
$ponytailConfigDir = Split-Path $ponytailConfigFile
if ((Test-Path -LiteralPath $ponytailConfigDir -PathType Container) -and @(Get-ChildItem -LiteralPath $ponytailConfigDir -Force).Count -eq 0)
{
  Remove-Item -LiteralPath $ponytailConfigDir -Force
}
$null = & omp plugin uninstall "@dietrichgebert/ponytail" 2>$null

$ompSettings = @(
  @("providers.openai-codex.codeMode", "on"),
  @("textVerbosity", "low"),
  @("personality", "friendly"),
  @("astGrep.enabled", "true"),
  @("checkpoint.enabled", "true"),
  @("task.enableLsp", "true"),
  @("task.maxRecursionDepth", "1"),
  @("lsp.formatOnWrite", "true"),
  @("lsp.diagnosticsOnEdit", "true"),
  @("edit.mode", "hashline")
)
foreach ($setting in $ompSettings)
{
  & omp config set $setting[0] $setting[1]
  if ($LASTEXITCODE -ne 0)
  { throw "OMP configuration failed for $($setting[0]) with exit code $LASTEXITCODE."
  }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue))
{ throw "uv is required: https://docs.astral.sh/uv/getting-started/installation/"
}

& uv tool install "semble==0.5.5" --force
if ($LASTEXITCODE -ne 0)
{ throw "Semble installation failed with exit code $LASTEXITCODE."
}

Write-Host "Installed: OMP baseline config, OpenAI quota statusline, Semble 0.5.5."
Write-Host "Restart OMP."
