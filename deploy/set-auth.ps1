<#
.SYNOPSIS
    Add the prod agent's audience and widget host to the running Container App.

.DESCRIPTION
    After provisioning the Copilot prod agent, the Teams developer portal generates an
    Application ID URI (api://auth-<uuid>/<client-id>) and the widget host is derived from
    the Azure domain. This appends both to ENTRA_AUDIENCE and CORS_ALLOWED_ORIGINS without
    disturbing existing entries (no restart needed beyond the revision the update creates).

.EXAMPLE
    pwsh deploy/set-auth.ps1 -AudienceUri "api://auth-1234…/6b5abbe7-…" -WidgetHost "https://<hash>.widget-renderer.usercontent.microsoft"
#>
[CmdletBinding()]
param(
    [string]$AudienceUri,
    [string]$WidgetHost
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/config.ps1"
Use-DeploySubscription

if (-not $AudienceUri -and -not $WidgetHost) { throw "Give -AudienceUri and/or -WidgetHost." }

function Get-EnvValue([string]$Name) {
    $value = az containerapp show -g $Deploy.ResourceGroup -n $Deploy.App `
        --query "properties.template.containers[0].env[?name=='$Name'].value | [0]" -o tsv
    return ($value ?? "").Trim()
}

function Add-ListEntry([string]$Current, [string]$Entry) {
    $items = @($Current -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($items -notcontains $Entry) { $items += $Entry }
    return ($items -join ",")
}

$updates = @()
if ($AudienceUri) {
    $audience = Add-ListEntry (Get-EnvValue "ENTRA_AUDIENCE") $AudienceUri
    $updates += "ENTRA_AUDIENCE=$audience"
    Write-Host "ENTRA_AUDIENCE = $audience"
}
if ($WidgetHost) {
    $cors = Add-ListEntry (Get-EnvValue "CORS_ALLOWED_ORIGINS") $WidgetHost
    $updates += "CORS_ALLOWED_ORIGINS=$cors"
    Write-Host "CORS_ALLOWED_ORIGINS = $cors"
}

az containerapp update -g $Deploy.ResourceGroup -n $Deploy.App --set-env-vars @updates | Out-Null
if ($LASTEXITCODE -ne 0) { throw "az containerapp update failed." }
Write-Host "Updated. The app rolls to a new revision with the new values."
