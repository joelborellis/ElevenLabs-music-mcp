<#
.SYNOPSIS
    Ship the current commit to the keepsong-mcp Container App.

.DESCRIPTION
    Builds gtlcr.azurecr.io/keepsong-mcp:<git sha> in ACR, points the app at it, waits for
    the new revision to report healthy, and prints the rollback command. Refuses to deploy
    an uncommitted tree unless -Force is given (the image tag must mean something).

.EXAMPLE
    pwsh deploy/deploy.ps1
    pwsh deploy/deploy.ps1 -Force      # deploy with local, uncommitted changes
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/config.ps1"
Set-Location (Resolve-Path "$PSScriptRoot/..")

if (-not $Force -and (git status --porcelain)) {
    throw "Working tree has uncommitted changes. Commit first, or pass -Force."
}

Use-DeploySubscription
$sha = Get-GitSha
if ($Force) { $sha = "$sha-dirty-$(Get-Date -Format yyyyMMddHHmm)" }
$image = "$($Deploy.RegistryServer)/$($Deploy.Image):$sha"

$previous = (az containerapp revision list -g $Deploy.ResourceGroup -n $Deploy.App `
    --query "[?properties.active].name | [0]" -o tsv).Trim()

Invoke-AcrBuild -Tag $sha -IncludeUncommitted:$Force

Write-Host "==> Updating $($Deploy.App)"
az containerapp update -g $Deploy.ResourceGroup -n $Deploy.App --image $image | Out-Null
if ($LASTEXITCODE -ne 0) { throw "az containerapp update failed." }

Write-Host "==> Waiting for the new revision to be healthy"
$revision = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 5
    $rev = az containerapp revision list -g $Deploy.ResourceGroup -n $Deploy.App `
        --query "[?properties.active] | sort_by(@, &properties.createdTime) | [-1].{name:name, health:properties.healthState, running:properties.runningState}" -o json | ConvertFrom-Json
    if ($rev -and $rev.health -eq "Healthy" -and $rev.running -eq "Running") { $revision = $rev; break }
    Write-Host "   $($rev.name): $($rev.health) / $($rev.running)"
}
if (-not $revision) {
    Write-Warning "Revision not healthy after ~2.5 minutes. Check: az containerapp logs show -g $($Deploy.ResourceGroup) -n $($Deploy.App) --tail 100"
    exit 1
}

$fqdn = Get-AppFqdn
Write-Host ""
Write-Host "Deployed $image as revision $($revision.name)"
Write-Host "MCP URL:  https://$fqdn/mcp"
Write-Host "Logs:     az containerapp logs show -g $($Deploy.ResourceGroup) -n $($Deploy.App) --follow"
if ($previous) {
    Write-Host "Rollback: az containerapp revision activate -g $($Deploy.ResourceGroup) -n $($Deploy.App) --revision $previous; az containerapp ingress traffic set -g $($Deploy.ResourceGroup) -n $($Deploy.App) --revision-weight $previous=100"
}
