$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$ompAgent = Join-Path $HOME ".omp\agent"
$extensionDir = Join-Path $ompAgent "extensions"
$sembleSkillDir = Join-Path $HOME ".agents\skills\semble"
$ponytailPackage = "github:DietrichGebert/ponytail#974d940a1c5344210874150b98ff0d2c861fab6a"

$ompCommand = Get-Command omp -ErrorAction SilentlyContinue
if ($null -eq $ompCommand)
{ throw "omp is required." }
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if ($null -eq $uvCommand)
{ throw "uv is required: https://docs.astral.sh/uv/getting-started/installation/" }

$xdgConfigHome = [Environment]::GetEnvironmentVariable("XDG_CONFIG_HOME")
if ([string]::IsNullOrEmpty($xdgConfigHome))
{
  $appData = [Environment]::GetEnvironmentVariable("APPDATA")
  if ([string]::IsNullOrEmpty($appData))
  {
    $userProfile = [Environment]::GetEnvironmentVariable("USERPROFILE")
    if ([string]::IsNullOrEmpty($userProfile))
    {
      $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    }
    if ([string]::IsNullOrEmpty($userProfile))
    { throw "USERPROFILE is required when APPDATA is unavailable." }
    $appData = Join-Path $userProfile "AppData\Roaming"
  }
  $ponytailConfigDir = Join-Path $appData "ponytail"
}
else
{
  $ponytailConfigDir = Join-Path $xdgConfigHome "ponytail"
}
$ponytailConfigPath = Join-Path $ponytailConfigDir "config.json"

$ponytailSerializer = $null
if ($PSEdition -eq "Desktop")
{
  try
  {
    Add-Type -AssemblyName System.Web.Extensions
    $ponytailSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  }
  catch
  {
    throw "The JSON serializer required by Windows PowerShell is unavailable."
  }
}

$ponytailConfig = $null
if (Test-Path -LiteralPath $ponytailConfigPath)
{
  if (-not (Test-Path -LiteralPath $ponytailConfigPath -PathType Leaf))
  { throw "Ponytail configuration path $ponytailConfigPath is not a file; refusing to overwrite it." }
  $ponytailConfigText = (Get-Content -LiteralPath $ponytailConfigPath -Raw).TrimStart([char]0xFEFF)
  try
  {
    if ($null -ne $ponytailSerializer)
    {
      $ponytailConfig = $ponytailSerializer.DeserializeObject($ponytailConfigText)
    }
    else
    {
      $ponytailConfig = $ponytailConfigText | ConvertFrom-Json -AsHashtable
    }
  }
  catch
  {
    throw "Ponytail configuration at $ponytailConfigPath is not valid JSON; refusing to overwrite it."
  }
}
else
{
  if ($null -ne $ponytailSerializer)
  {
    $ponytailConfig = $ponytailSerializer.DeserializeObject("{}")
  }
  else
  {
    $ponytailConfig = "{}" | ConvertFrom-Json -AsHashtable
  }
}
if ($null -eq $ponytailConfig -or $ponytailConfig -isnot [System.Collections.IDictionary])
{ throw "Ponytail configuration at $ponytailConfigPath must contain a JSON object; refusing to overwrite it." }
$hasDefaultMode = @($ponytailConfig.Keys | Where-Object { $_ -ceq "defaultMode" }).Count -gt 0
if ($hasDefaultMode)
{
  $ponytailConfig["defaultMode"] = "ultra"
}
else
{
  $ponytailConfig.Add("defaultMode", "ultra")
}
if ($null -ne $ponytailSerializer)
{
  $ponytailConfigJson = $ponytailSerializer.Serialize($ponytailConfig)
}
else
{
  $ponytailConfigJson = $ponytailConfig | ConvertTo-Json -Depth 100
}
$null = & omp plugin install $ponytailPackage --force
if ($LASTEXITCODE -ne 0)
{ throw "Ponytail installation failed for $ponytailPackage with exit code $LASTEXITCODE." }

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

& uv tool install "semble==0.5.5" --force
if ($LASTEXITCODE -ne 0)
{ throw "Semble installation failed with exit code $LASTEXITCODE."
}

New-Item -ItemType Directory -Force -Path $ponytailConfigDir | Out-Null
[System.IO.File]::WriteAllText($ponytailConfigPath, $ponytailConfigJson, [System.Text.UTF8Encoding]::new($false))

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

Write-Host "Installed: OMP baseline config, Ponytail default mode ultra (pinned upstream commit 974d940a1c5344210874150b98ff0d2c861fab6a), OpenAI quota statusline, Semble 0.5.5."
Write-Host "Ponytail config: $ponytailConfigPath (existing unrelated fields preserved)."
Write-Host "Restart OMP."
