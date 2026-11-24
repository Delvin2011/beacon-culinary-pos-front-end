# Deploy the Next.js frontend (output: 'standalone') to Azure App Service (Linux).
#
# App-level settings this deployment depends on (already set on the Azure resource,
# listed here so they're not lost if the app is ever recreated):
#   WEBSITE_RUN_FROM_PACKAGE = 1          -> mounts the zip read-only instead of extracting/rsyncing it.
#                                             Kudu's parallel rsync extraction was unreliable against
#                                             Azure Files for this package's ~1880 files (400 on deploy).
#   HOSTNAME                 = 0.0.0.0    -> Docker injects HOSTNAME=<container-id> into the container.
#                                             .next/standalone/server.js binds to
#                                             process.env.HOSTNAME || '0.0.0.0', so without this override
#                                             it tries to listen on the container id, hangs ~30-60s, and
#                                             the worker-start probe times out.

param(
    # T1-0d: confirms the App Service is behind Azure Front Door, which sends /api/* to the backend.
    [switch] $BehindFrontDoor
)

$ErrorActionPreference = "Stop"

# T1-0d: this app calls /api on its own address, which only Azure Front Door serves; this App Service has no /api
# route. Production deploys from main only; the integration branch is never deployed (docs/2026-11-24-relative-api.md).
# (git's own error output must not stop the script before the clear message below: Windows PowerShell 5.1 turns it into
# a terminating error under "Stop".)
$branch = & { $ErrorActionPreference = "Continue"; git -C $PSScriptRoot rev-parse --abbrev-ref HEAD 2>$null }
if ($LASTEXITCODE -ne 0 -or -not $branch) { throw "deploy.ps1: can't tell the current git branch. Only main is deployed." }
$branch = "$branch".Trim()
if ($branch -ne "main") {
    throw "deploy.ps1 deploys to the current Azure App Service, which has no /api route. Only main is deployed. Current branch: $branch."
}
# Once T1-0d is merged into main, main calls /api too: deploying it needs Front Door in front, said explicitly.
if ((Test-Path (Join-Path $PSScriptRoot "src\lib\api-url.ts")) -and -not $BehindFrontDoor) {
    throw "This build calls /api on its own address, which only Azure Front Door serves. Deploy it only behind Front Door, with -BehindFrontDoor."
}

$RG  = "road-freight-api-rg"
$APP = "beacon-culinary-frontend-12345"

# 1. Build
#    $ErrorActionPreference does not apply to native commands like npm, so check the exit
#    code explicitly - otherwise a failed build silently deploys a stale .next/standalone.
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE) - aborting deploy." }

# 2. Copy static assets into the standalone output.
#    `output: 'standalone'` deliberately excludes .next/static (and public/, if present) -
#    without this, the site starts but CSS/JS assets 404.
Remove-Item .next\standalone\.next\static -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path .next\standalone\.next\static | Out-Null
Copy-Item -Recurse -Force .next\static\* .next\standalone\.next\static\
if (Test-Path public) {
    Copy-Item -Recurse -Force public .next\standalone\public
}

# 3. Zip the CONTENTS of .next/standalone (server.js must be at the zip root, not nested).
#    Built with 7-Zip, not Compress-Archive: Compress-Archive produced backslash path
#    separators in this environment (unzip warned "appears to use backslashes as path
#    separators"), which is a bad enough archive shape that it's worth avoiding on principle
#    even though it wasn't the actual cause of the startup failure.
Remove-Item frontend.zip -ErrorAction SilentlyContinue
Push-Location .next\standalone
& 7z a -tzip -mx=5 "$PSScriptRoot\frontend.zip" . -xr'!'.git | Out-Null
Pop-Location

# 4. Deploy
az webapp deploy --resource-group $RG --name $APP --src-path .\frontend.zip --type zip

# 5. Verify
$resp = Invoke-WebRequest -Uri "https://$APP.azurewebsites.net/" -UseBasicParsing -TimeoutSec 30
Write-Output "Status: $($resp.StatusCode)"

# O3: the POS service worker must be there and never cached long (an old worker would keep an old POS).
$sw = Invoke-WebRequest -Uri "https://$APP.azurewebsites.net/sw.js" -UseBasicParsing -TimeoutSec 30
Write-Output "sw.js: $($sw.StatusCode), Cache-Control: $($sw.Headers['Cache-Control'])"
