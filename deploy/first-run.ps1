<#
.SYNOPSIS
    One-time creation of the keepsong-mcp Container App.

.DESCRIPTION
    Builds the image in ACR, creates the app (external ingress on 3000, one replica,
    system-assigned identity), grants the identity AcrPull + Storage Blob Data Contributor,
    stores the four secrets, and sets the environment variables. Idempotent enough to
    re-run: existing resources are updated, not duplicated.

    Prompts for: OPENAI_API_KEY, ELEVENLABS_API_KEY, DATABASE_URL. Generates MEDIA_SIGNING_KEY.

.EXAMPLE
    pwsh deploy/first-run.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/config.ps1"
Set-Location (Resolve-Path "$PSScriptRoot/..")

function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if (-not $plain) { throw "$Prompt is required." }
    return $plain
}

Use-DeploySubscription
$sha = Get-GitSha
$image = "$($Deploy.RegistryServer)/$($Deploy.Image):$sha"

# Uncommitted files are included here so the first run works before the deploy files are committed.
Invoke-AcrBuild -Tag $sha -IncludeUncommitted

$exists = az containerapp show -g $Deploy.ResourceGroup -n $Deploy.App --query name -o tsv 2>$null
if (-not $exists) {
    Write-Host "==> Creating container app $($Deploy.App)"
    # Admin credentials for the very first pull; switched to the managed identity below
    # once AcrPull is granted (the identity doesn't exist until the app does).
    $acrUser = az acr credential show -n $Deploy.Registry --query username -o tsv
    $acrPass = az acr credential show -n $Deploy.Registry --query "passwords[0].value" -o tsv
    az containerapp create `
        --name $Deploy.App `
        --resource-group $Deploy.ResourceGroup `
        --environment $Deploy.Environment `
        --image $image `
        --target-port $Deploy.Port `
        --ingress external `
        --min-replicas 1 --max-replicas 1 `
        --cpu $Deploy.Cpu --memory $Deploy.Memory `
        --system-assigned `
        --registry-server $Deploy.RegistryServer `
        --registry-username $acrUser --registry-password $acrPass
    if ($LASTEXITCODE -ne 0) { throw "az containerapp create failed." }
} else {
    Write-Host "==> Container app exists; updating image to $image"
    az containerapp update -g $Deploy.ResourceGroup -n $Deploy.App --image $image | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "az containerapp update failed." }
}

Write-Host "==> Granting the app's managed identity AcrPull and Storage Blob Data Contributor"
$principalId = (az containerapp show -g $Deploy.ResourceGroup -n $Deploy.App --query identity.principalId -o tsv).Trim()
$acrId = (az acr show -n $Deploy.Registry --query id -o tsv).Trim()
$storageId = (az storage account show -g $Deploy.StorageResourceGroup -n $Deploy.StorageAccount --query id -o tsv).Trim()
az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal `
    --role "AcrPull" --scope $acrId | Out-Null
az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal `
    --role "Storage Blob Data Contributor" --scope $storageId | Out-Null
# Pull with the identity from now on (no stored registry password).
az containerapp registry set -g $Deploy.ResourceGroup -n $Deploy.App `
    --server $Deploy.RegistryServer --identity system | Out-Null

Write-Host "==> Secrets (stored as Container Apps secrets; never echoed)"
$openai = Read-Secret "OPENAI_API_KEY"
$eleven = Read-Secret "ELEVENLABS_API_KEY"
$dbUrl = Read-Secret "DATABASE_URL (postgres://… ; the Python-style postgresql+asyncpg URL is accepted)"
$signingBytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($signingBytes)
$signingKey = [System.Convert]::ToHexString($signingBytes).ToLowerInvariant()
az containerapp secret set -g $Deploy.ResourceGroup -n $Deploy.App --secrets `
    "openai-key=$openai" "elevenlabs-key=$eleven" "db-url=$dbUrl" "media-signing-key=$signingKey" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "az containerapp secret set failed." }

$fqdn = Get-AppFqdn
Write-Host "==> Environment variables (public URL https://$fqdn)"
# ENTRA_AUDIENCE starts with the two static audiences; deploy/set-auth.ps1 appends the
# Teams-generated api://auth-… URI and the widget host once the prod agent is provisioned.
az containerapp update -g $Deploy.ResourceGroup -n $Deploy.App --set-env-vars `
    "ENVIRONMENT=production" `
    "AUTH_ENABLED=true" `
    "ENTRA_TENANT_ID=$($Deploy.TenantId)" `
    "ENTRA_AUDIENCE=$($Deploy.EntraClientId),api://$($Deploy.EntraClientId)" `
    "STORAGE_BACKEND=azure" `
    "AZURE_STORAGE_ACCOUNT_URL=https://$($Deploy.StorageAccount).blob.core.windows.net" `
    "AZURE_STORAGE_CONTAINER=$($Deploy.StorageContainer)" `
    "PUBLIC_BASE_URL=https://$fqdn" `
    "FINETUNES_CACHE_TTL=300" `
    "MCP_PORT=$($Deploy.Port)" `
    "OPENAI_API_KEY=secretref:openai-key" `
    "ELEVENLABS_API_KEY=secretref:elevenlabs-key" `
    "DATABASE_URL=secretref:db-url" `
    "MEDIA_SIGNING_KEY=secretref:media-signing-key" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "az containerapp update (env vars) failed." }

Write-Host ""
Write-Host "Done. MCP URL:  https://$fqdn/mcp"
Write-Host "Health:         https://$fqdn/health"
Write-Host "Logs:           az containerapp logs show -g $($Deploy.ResourceGroup) -n $($Deploy.App) --follow"
Write-Host ""
Write-Host "Next: provision the prod agent (see docs/azure-deploy.md §3), then run deploy/set-auth.ps1"
