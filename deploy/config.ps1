# Azure resource names for keepsong-mcp. Dot-source this from the other scripts:
#   . "$PSScriptRoot/config.ps1"
# Nothing here is secret; secrets are prompted for in first-run.ps1 and stored as
# Container Apps secrets.

$Deploy = @{
    Subscription         = "083988ac-0bc4-4fde-9006-b0d10c9d3b5c"   # gametolearn Subscription
    ResourceGroup        = "ElevenLabsMusic"
    Environment          = "elevenlabs-env"                           # existing Container Apps environment
    App                  = "keepsong-mcp"
    Registry             = "gtlcr"
    RegistryServer       = "gtlcr.azurecr.io"
    Image                = "keepsong-mcp"
    StorageAccount       = "gtlopenaidemostorage"
    StorageResourceGroup = "StorageServices"
    StorageContainer     = "music"
    TenantId             = "2a57864c-da2a-4a44-953c-9781f73f880a"
    EntraClientId        = "6b5abbe7-25c7-414c-bcbd-1b8e4257c246"   # the keepsong-mcp app registration
    Cpu                  = "0.5"
    Memory               = "1Gi"
    Port                 = 3000
}

# The Azure CLI on Windows streams ACR build logs through a cp1252 console and crashes on
# Vite's "✓ built" line (UnicodeEncodeError), abandoning the log stream mid-build. UTF-8 mode fixes it.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Use-DeploySubscription {
    az account set --subscription $Deploy.Subscription | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "az account set failed — run `az login` first." }
}

function Get-GitSha {
    $sha = (git rev-parse --short=12 HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $sha) { throw "Not a git checkout." }
    return $sha
}

function Get-AppFqdn {
    return (az containerapp show -g $Deploy.ResourceGroup -n $Deploy.App --query "properties.configuration.ingress.fqdn" -o tsv).Trim()
}

<#
    Export the repo to a temp folder and build from there. `az acr build` walks the whole
    source tree before applying .dockerignore, and node_modules on Windows contains paths
    longer than MAX_PATH, which makes the upload fail. Tracked files only by default;
    -IncludeUncommitted adds untracked-but-not-ignored files (e.g. before the first commit
    of a new file, or with deploy.ps1 -Force).
#>
function New-BuildContext {
    param([switch]$IncludeUncommitted)
    $ctx = Join-Path ([IO.Path]::GetTempPath()) "keepsong-mcp-build-$([guid]::NewGuid().ToString('n'))"
    New-Item -ItemType Directory -Path $ctx | Out-Null
    $files = if ($IncludeUncommitted) { git ls-files -co --exclude-standard } else { git ls-files }
    foreach ($rel in $files) {
        $dest = Join-Path $ctx $rel
        $dir = Split-Path $dest -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Copy-Item -LiteralPath $rel -Destination $dest
    }
    return $ctx
}

function Invoke-AcrBuild {
    param([string]$Tag, [switch]$IncludeUncommitted)
    $ctx = New-BuildContext -IncludeUncommitted:$IncludeUncommitted
    try {
        Write-Host "==> Building $($Deploy.RegistryServer)/$($Deploy.Image):$Tag in ACR (cloud build from $ctx)"
        az acr build --registry $Deploy.Registry --image "$($Deploy.Image):$Tag" --file Dockerfile $ctx
        if ($LASTEXITCODE -ne 0) {
            # The CLI's log stream can die (console encoding) while the build carries on in
            # ACR, so the exit code alone isn't the verdict — ask ACR for the run's status.
            Write-Host "==> Log stream ended early; checking the run status in ACR"
            do {
                Start-Sleep -Seconds 10
                $run = az acr task list-runs -r $Deploy.Registry --top 1 --query "[0].{id:runId, status:status}" -o json | ConvertFrom-Json
                Write-Host "   run $($run.id): $($run.status)"
            } while ($run.status -in @("Queued", "Running", "Started"))
            if ($run.status -ne "Succeeded") {
                throw "ACR build run $($run.id) ended with status $($run.status). Logs: az acr task logs -r $($Deploy.Registry) --run-id $($run.id)"
            }
        }
    } finally {
        Remove-Item -LiteralPath $ctx -Recurse -Force -ErrorAction SilentlyContinue
    }
}
