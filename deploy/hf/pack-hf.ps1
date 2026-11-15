# Makes deploy\out\hf-space: the folder to upload to the Hugging Face Space (deploy/hf/upload-hf.py does the upload).
# It holds the app (what the Docker image needs, like .dockerignore), this PC's whole cache (every field opened here:
# SPHEREx cutouts, archive answers, sky tiles, NEOSSat pictures, the pinned start-screen list), and the Space's own
# Dockerfile and README card from deploy/hf.
# Run in PowerShell from the repo folder:   powershell -ExecutionPolicy Bypass -File deploy\hf\pack-hf.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$out = Join-Path $root 'deploy\out\hf-space'
New-Item -ItemType Directory -Force $out | Out-Null

function Copy-Tree($from, $to, $extra) {
  # /MIR: the folder ends up exactly like the source (files removed here are removed there too), so a re-run is quick
  $rc = @($from, $to, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') + $extra
  & robocopy @rc | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE) copying $from" }
}

Write-Host 'Copying the app...'
$skipDirs = @('cache', 'node_modules', 'debug-cutouts', 'test', '.git', '.claude', 'deploy', 'reports', 'docs', 'archive',
  'scorecard') | ForEach-Object { Join-Path $root $_ }
$skipFiles = @('*.zip', '*.tgz', '*.tmp', 'replay*', 'HANDOFF-PROMPT.md',
  'HOW-TO-RUN.txt', 'make-share.bat', 'start.bat', 'start.sh', 'render.yaml', 'Dockerfile', 'README.md', '.dockerignore', '.gitignore')
# /XD and /XF only apply to the source tree; the cache folder in $out is kept apart below with its own copy
Copy-Tree $root $out (@('/XD') + $skipDirs + @((Join-Path $out 'cache')) + @('/XF') + $skipFiles)

Write-Host 'Copying the cache (about 2.3 GB, a few minutes the first time)...'
$cache = Join-Path $root 'cache'
foreach ($d in 'cutouts', 'api', 'hips', 'neossat') {
  $src = Join-Path $cache $d
  if (Test-Path $src) { Copy-Tree $src (Join-Path $out "cache\$d") @('/XF', '*.tmp') }
}
if (Test-Path (Join-Path $cache 'pinned.json')) { Copy-Item (Join-Path $cache 'pinned.json') (Join-Path $out 'cache\pinned.json') -Force }

Copy-Item (Join-Path $PSScriptRoot 'Dockerfile') (Join-Path $out 'Dockerfile') -Force
Copy-Item (Join-Path $PSScriptRoot 'README.md') (Join-Path $out 'README.md') -Force

$files = Get-ChildItem $out -Recurse -File
$gb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1GB, 2)
$big = $files | Where-Object { $_.Length -gt 50MB }
Write-Host "Made $out ($($files.Count) files, $gb GB)."
if ($big) { Write-Host "Files over 50 MB (Hugging Face takes them, but check they belong):"; $big | ForEach-Object { Write-Host "  $($_.FullName) $([math]::Round($_.Length / 1MB)) MB" } }
Write-Host 'Next: python deploy\hf\upload-hf.py <your-hf-name>/arcnave   (docs/deploy/DEPLOY-HF-CLOUDFLARE.md, step 3)'
