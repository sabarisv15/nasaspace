# Builds and publishes ARCNAVE on Cloudflare (docs/deploy/DEPLOY-CLOUDFLARE.md). Run in PowerShell from the repo folder:
#   powershell -ExecutionPolicy Bypass -File deploy\cloudflare\deploy.ps1 https://arcnave.<your-subdomain>.workers.dev
#   (add -SkipBuild to upload deploy\out\cf as it is, e.g. after an upload was cut off)
# The first time, Wrangler opens the browser to allow it; later runs reuse that login. A cut-off upload is tried again
# (up to 5 times); files Cloudflare already has are not sent again.
param([Parameter(Mandatory = $true)][string]$Site, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nodeDir = Join-Path (Split-Path -Parent $root) 'node\node-v24.20.0-win-x64'
if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:Path = "$nodeDir;$env:Path" }
Set-Location $root
if (-not $SkipBuild) {
  Write-Host "Building deploy\out\cf for $Site (2-3 minutes)..."
  & node deploy\cloudflare\build.mjs $Site
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
}
Write-Host 'Uploading (the first time about 2.5 GB: 20-60 minutes; later only changed files)...'
for ($try = 1; $try -le 5; $try++) {
  & npx --yes wrangler@4 deploy --config deploy\cloudflare\wrangler.toml
  if ($LASTEXITCODE -eq 0) { Write-Host "Done: $Site"; exit 0 }
  Write-Host "Upload stopped (try $try of 5). Trying again in 30 s; files already up are skipped..."
  Start-Sleep -Seconds 30
}
throw 'deploy failed 5 times: check the internet connection and run this again'
