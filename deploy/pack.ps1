# Makes deploy\out\arcnave-deploy.tgz (the app + demo-cache, without the local cache, backups and docs) to copy to the server.
# Run in PowerShell from the repo folder "D:\ARCNAVE-SPHEREX\ARCNAVE SPHEREX":   powershell -ExecutionPolicy Bypass -File deploy\pack.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$outDir = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir 'arcnave-deploy.tgz'
$ex = @('./cache', './debug-cutouts', './test', './archive', './docs', './reports',
        './scorecard', './deploy/.env', './deploy/out', './*.zip', './*.tgz',
        './node_modules', './.git')
$tarArgs = @('-czf', $out) + ($ex | ForEach-Object { "--exclude=$_" }) + @('.')
& "$env:SystemRoot\System32\tar.exe" @tarArgs
if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" }
$mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host "Made $out ($mb MB). Next: copy it to the server (docs/deploy/DEPLOY-DOCKER-ORACLE.md step 6)."
