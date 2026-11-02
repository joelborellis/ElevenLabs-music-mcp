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
# az writes progress and warnings to stderr; never let those become terminating errors.
$PSNativeCommandUseErrorActionPreference = $false

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
    # Not under the user profile: az.cmd is a batch file and breaks on paths with
    # parentheses or spaces (e.g. C:\Users\Name(org)\...). The repo's parent folder is safe.
    $root = if ($env:KEEPSONG_BUILD_ROOT) { $env:KEEPSONG_BUILD_ROOT } else { Resolve-Path "$PSScriptRoot/../.." }
    $ctx = Join-Path $root "keepsong-mcp-build-$([guid]::NewGuid().ToString('n'))"
    if ($ctx -match '[()\s]') { throw "Build context path '$ctx' contains parentheses or spaces; set KEEPSONG_BUILD_ROOT to a plain path (e.g. C:\build)." }
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
        # Tee the stream so we can pick up the run id ("Queued a build with ID: xyz").
        $output = az acr build --registry $Deploy.Registry --image "$($Deploy.Image):$Tag" --file Dockerfile $ctx 2>&1 | ForEach-Object { Write-Host $_; "$_" }
        $exit = $LASTEXITCODE
        $runId = ($output | Select-String -Pattern "Queued a build with ID:\s*(\S+)" | Select-Object -First 1).Matches.Groups[1].Value
        if (-not $runId) { throw "az acr build did not start a run (see the output above)." }
        if ($exit -ne 0) {
            # The CLI's log stream can die (console encoding) while the build carries on in
            # ACR, so the exit code alone isn't the verdict — follow THIS run to its end.
            Write-Host "==> Log stream ended early; following run $runId in ACR"
            do {
                Start-Sleep -Seconds 10
                $status = (az acr task show-run -r $Deploy.Registry --run-id $runId --query status -o tsv).Trim()
                Write-Host "   run ${runId}: $status"
            } while ($status -in @("Queued", "Running", "Started"))
            if ($status -ne "Succeeded") {
                throw "ACR build run $runId ended with status $status. Logs: az acr task logs -r $($Deploy.Registry) --run-id $runId"
            }
        }
        # Belt and braces: the tag must exist before anything tries to pull it.
        az acr repository show -n $Deploy.Registry --image "$($Deploy.Image):$Tag" --query digest -o tsv | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Image $($Deploy.Image):$Tag is not in the registry after the build." }
    } finally {
        Remove-Item -LiteralPath $ctx -Recurse -Force -ErrorAction SilentlyContinue
    }
}
