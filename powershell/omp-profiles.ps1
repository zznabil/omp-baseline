# >>> OMP lean profiles >>>
$script:OmpExecutable = Join-Path $HOME '.bun\bin\omp.exe'
$script:OmpBaseConfig = Join-Path $HOME '.omp\agent\config.yml'
$script:OmpLifecycleExtension = Join-Path $HOME '.omp\agent\extensions\mcp-session-lifecycle.ts'
$script:OmpQuotaExtension = Join-Path $HOME '.omp\agent\extensions\openai-weekly-quota.ts'
$script:OmpHealthExtension = Join-Path $HOME '.omp\agent\extensions\omp-survival-health.ts'
$script:OmpCoreTools = 'read,bash,edit,write,grep,glob,lsp,todo,ask,web_search'
$script:OmpAuthBrokerUrl = 'http://127.0.0.1:8765'
$script:OmpAuthBrokerTokenFile = Join-Path $HOME '.omp\auth-broker.token'

function Test-OmpAuthBroker {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $connected = $client.ConnectAsync('127.0.0.1', 8765).Wait(250)
        return $connected -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Start-OmpAuthBroker {
    if (-not (Test-OmpAuthBroker)) {
        Start-Process -FilePath $script:OmpExecutable `
            -ArgumentList @('auth-broker', 'serve', '--bind=127.0.0.1:8765') `
            -WindowStyle Hidden | Out-Null
        foreach ($attempt in 1..20) {
            Start-Sleep -Milliseconds 250
            if (Test-OmpAuthBroker) { break }
        }
    }
    if (-not (Test-OmpAuthBroker)) {
        throw 'OMP auth broker did not start on 127.0.0.1:8765.'
    }
    if (-not (Test-Path -LiteralPath $script:OmpAuthBrokerTokenFile -PathType Leaf)) {
        throw "OMP auth broker token not found at $script:OmpAuthBrokerTokenFile."
    }
    return (Get-Content -LiteralPath $script:OmpAuthBrokerTokenFile -Raw).Trim()
}

function Invoke-OmpProfile {
    param([string[]]$LaunchArgs)

    $token = Start-OmpAuthBroker
    $previousUrl = $env:OMP_AUTH_BROKER_URL
    $previousToken = $env:OMP_AUTH_BROKER_TOKEN
    try {
        $env:OMP_AUTH_BROKER_URL = $script:OmpAuthBrokerUrl
        $env:OMP_AUTH_BROKER_TOKEN = $token
        & $script:OmpExecutable @LaunchArgs
    } finally {
        if ($null -eq $previousUrl) {
            Remove-Item Env:OMP_AUTH_BROKER_URL -ErrorAction SilentlyContinue
        } else {
            $env:OMP_AUTH_BROKER_URL = $previousUrl
        }
        if ($null -eq $previousToken) {
            Remove-Item Env:OMP_AUTH_BROKER_TOKEN -ErrorAction SilentlyContinue
        } else {
            $env:OMP_AUTH_BROKER_TOKEN = $previousToken
        }
    }
}

function omp {
    & $script:OmpExecutable "--tools=$script:OmpCoreTools" @args
}

function omp-research {
    $overlay = Join-Path $HOME '.omp\profiles\research\agent\overlay.yml'
    $launchArgs = @(
        '--profile=research', '--config', $script:OmpBaseConfig, '--config', $overlay,
        '--extension', $script:OmpLifecycleExtension, '--extension', $script:OmpQuotaExtension,
        '--extension', $script:OmpHealthExtension,
        '--tools=read,bash,edit,write,grep,glob,lsp,todo,ask,web_search,browser'
    ) + $args
    Invoke-OmpProfile $launchArgs
}

function omp-browser {
    $overlay = Join-Path $HOME '.omp\profiles\browser\agent\overlay.yml'
    $launchArgs = @(
        '--profile=browser', '--config', $script:OmpBaseConfig, '--config', $overlay,
        '--extension', $script:OmpLifecycleExtension, '--extension', $script:OmpQuotaExtension,
        '--extension', $script:OmpHealthExtension,
        '--tools=read,bash,edit,write,grep,glob,lsp,todo,ask,web_search,computer,inspect_image,browser'
    ) + $args
    Invoke-OmpProfile $launchArgs
}

function omp-reverse {
    $overlay = Join-Path $HOME '.omp\profiles\reverse\agent\overlay.yml'
    $launchArgs = @(
        '--profile=reverse', '--config', $script:OmpBaseConfig, '--config', $overlay,
        '--extension', $script:OmpLifecycleExtension, '--extension', $script:OmpQuotaExtension,
        '--extension', $script:OmpHealthExtension,
        '--tools=read,bash,edit,write,grep,glob,lsp,todo,ask,web_search,computer,inspect_image'
    ) + $args
    Invoke-OmpProfile $launchArgs
}

function omp-full {
    $overlay = Join-Path $HOME '.omp\profiles\full\agent\overlay.yml'
    $launchArgs = @(
        '--profile=full', '--config', $script:OmpBaseConfig, '--config', $overlay,
        '--extension', $script:OmpLifecycleExtension, '--extension', $script:OmpQuotaExtension,
        '--extension', $script:OmpHealthExtension
    ) + $args
    Invoke-OmpProfile $launchArgs
}

function omp-profiles {
    Write-Host 'omp          Lean coding profile'
    Write-Host 'omp-research Research and repository MCPs'
    Write-Host 'omp-browser  Browser, desktop, image and design tools'
    Write-Host 'omp-reverse  IDA, Ghidra, x64dbg and Cheat Engine'
    Write-Host 'omp-full     All tools, skills and MCPs'
}
# <<< OMP lean profiles <<<
