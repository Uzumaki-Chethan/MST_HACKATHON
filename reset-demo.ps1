# Fresh demo state in one command (SPEC §11.2). Contracts and passports can't be rewound by design,
# so a reset means: fresh contracts + fresh backend DB + seed, behind the SAME public tunnel URLs.
# Needs start-public.ps1 to have run (tunnels up, PUBLIC-URLS.local.txt written). Takes ~15 min.
#
#   powershell -ExecutionPolicy Bypass -File .\reset-demo.ps1            # dry-run / rehearsal reset
#   powershell -ExecutionPolicy Bypass -File .\reset-demo.ps1 -Verify    # final reset: also verify on MSTScan
param([switch]$Verify)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$urls = Get-Content (Join-Path $root "PUBLIC-URLS.local.txt") -Raw
$web = [regex]::Match($urls, "App \(judges\):\s+(\S+)").Groups[1].Value
$api = [regex]::Match($urls, "Backend API:\s+(\S+?)/health").Groups[1].Value
if (-not $web -or -not $api) { throw "Run start-public.ps1 first (no URLs in PUBLIC-URLS.local.txt)" }
Write-Host "Public URLs stay the same: $web  /  $api"

function Stop-Port([int]$port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -Confirm:$false }
}
function Step([string]$name, [scriptblock]$cmd) {
  Write-Host "`n== $name"
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" }
}

# 1. Backend off; keep the old DB (evidence, reports) next to it.
Stop-Port 8080
Start-Sleep 2
$backend = Join-Path $root "packages\backend"
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
if (Test-Path "$backend\data") { Rename-Item "$backend\data" "data-before-$stamp"; Write-Host "old DB kept as packages\backend\data-before-$stamp" }

# 2. Fresh contracts + the demo cast registered and verified on them.
Set-Location "$root\packages\contracts"
Step "deploy contracts" { pnpm deploy:testnet }
Step "register demo cast" { pnpm exec hardhat run scripts/actors/register-cast.ts --network testnet }
if ($Verify) { Step "verify on MSTScan" { pnpm verify:testnet } }

# 3. Backend on a fresh DB (same flags as start-public.ps1), then seed.
Start-Process powershell -ArgumentList "-NoExit", "-Command",
  "`$env:PUBLIC_WEB_ORIGIN='$web,http://localhost:3000'; `$env:DEMO_UPLOADS='1'; Set-Location '$backend'; pnpm start"
Write-Host "`n== waiting for the backend"
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-WebRequest http://localhost:8080/health -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch { Start-Sleep 2 }
}
Set-Location $backend
Step "seed (society, plumbing history, lease 1)" { pnpm exec tsx scripts/seed.ts }

# 4. Frontend rebuilt with the new addresses.
Stop-Port 3000
Start-Process powershell -ArgumentList "-NoExit", "-Command",
  "`$env:NEXT_PUBLIC_API_URL='$api'; `$env:NEXT_PUBLIC_ALLOW_UPLOAD='1'; Set-Location '$root\packages\frontend'; pnpm build; if (`$?) { pnpm exec next start -p 3000 }"

Set-Location $root
Write-Host "`nReset done. The frontend rebuild takes about a minute, then: $web/rent/1 and $web/public/society/1"
Write-Host "New addresses are in packages\shared\src\addresses.ts (commit them, and update the README after the final reset)."
