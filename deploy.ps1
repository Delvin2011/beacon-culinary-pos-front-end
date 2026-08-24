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

$ErrorActionPreference = "Stop"

$RG  = "road-freight-api-rg"
$APP = "beacon-culinary-frontend-12345"

# 1. Build
npm run build

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
