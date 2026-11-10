<#
.SYNOPSIS
    Let a Foundry agent identity call keepsong-mcp by assigning it an app role.

.DESCRIPTION
    Agent Identity tokens are app-only (no `scp` claim), so the server admits them by app
    role instead of the access_as_user scope. This assigns the role (default Mcp.Invoke) on
    the keepsong-mcp Entra app to the agent's identity. The role must already exist on the
    app registration (App roles → allowed member types: Applications). Safe to re-run.

    The server only honours the role once ENTRA_ALLOWED_APP_ROLE is set to the same value;
    pass -SetServerEnv to set it on the Container App as well.

.EXAMPLE
    pwsh deploy/grant-agent-role.ps1 -AgentObjectId 2147a718-16e7-4a11-98a6-a9c0427833b7

.EXAMPLE
    pwsh deploy/grant-agent-role.ps1 -AgentObjectId 2147a718-16e7-4a11-98a6-a9c0427833b7 -SetServerEnv
#>
[CmdletBinding()]
param(
    # Object ID of the Foundry agent identity (the service principal, not an app/client ID).
    [Parameter(Mandatory)][guid]$AgentObjectId,
    [string]$RoleValue = "Mcp.Invoke",
    [switch]$SetServerEnv
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/config.ps1"
Use-DeploySubscription

$graph = "https://graph.microsoft.com/v1.0"

# Look up the enterprise app (service principal) and the role by name, so no IDs are hand-copied.
$sp = az ad sp show --id $Deploy.EntraClientId -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $sp) { throw "No enterprise application found for client ID $($Deploy.EntraClientId)." }

$role = $sp.appRoles | Where-Object { $_.value -eq $RoleValue -and $_.isEnabled }
if (-not $role) { throw "App role '$RoleValue' not found (or disabled) on $($sp.displayName). Create it under App registrations → App roles." }
if ($role.allowedMemberTypes -notcontains "Application") {
    throw "App role '$RoleValue' does not allow Applications as members; edit its allowed member types."
}

Write-Host "Resource : $($sp.displayName) ($($sp.id))"
Write-Host "Role     : $RoleValue ($($role.id))"
Write-Host "Agent    : $AgentObjectId"

$existing = az rest --method GET --uri "$graph/servicePrincipals/$AgentObjectId/appRoleAssignments" -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Could not read the agent identity's role assignments — check -AgentObjectId." }

if ($existing.value | Where-Object { $_.resourceId -eq $sp.id -and $_.appRoleId -eq $role.id }) {
    Write-Host "Already assigned; nothing to do."
} else {
    # The JSON goes through a file: az is a batch file on Windows, and PowerShell strips
    # the double quotes from an inline JSON argument on the way to it.
    $bodyFile = Join-Path $PSScriptRoot ".role-assignment-$([guid]::NewGuid().ToString('n')).json"
    try {
        @{ principalId = "$AgentObjectId"; resourceId = $sp.id; appRoleId = $role.id } |
            ConvertTo-Json -Compress | Set-Content -LiteralPath $bodyFile -Encoding utf8NoBOM
        az rest --method POST `
            --uri "$graph/servicePrincipals/$AgentObjectId/appRoleAssignments" `
            --headers "Content-Type=application/json" `
            --body "@$bodyFile" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Role assignment failed (see the error above)." }
        Write-Host "Assigned $RoleValue to the agent identity."
    } finally {
        Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue
    }
}

if ($SetServerEnv) {
    az containerapp update -g $Deploy.ResourceGroup -n $Deploy.App --set-env-vars "ENTRA_ALLOWED_APP_ROLE=$RoleValue" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "az containerapp update failed." }
    Write-Host "ENTRA_ALLOWED_APP_ROLE=$RoleValue set; the app rolls to a new revision."
} else {
    Write-Host "Next: deploy the build that reads ENTRA_ALLOWED_APP_ROLE, then re-run with -SetServerEnv."
}
