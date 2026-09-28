# Starts the NestLedger demo publicly from this laptop (SPEC §7.7 fallback: laptop + Cloudflare quick tunnel).
# Opens 4 windows: backend tunnel, frontend tunnel, backend (API + indexer + AI agent + keeper), frontend.
# Keep this laptop awake and online while judges use it. Stop everything by closing the 4 windows.
#
#   powershell -ExecutionPolicy Bypass -File .\start-public.ps1
#
# Needs: pnpm install done, repo-root .env.local with the demo keys, cloudflared at $Cloudflared.
param(
  [string]$Cloudflared = "$env:USERPROFILE\tools\cloudflared.exe"
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if (-not (Test-Path $Cloudflared)) { throw "cloudflared not found at $Cloudflared" }
foreach ($port in 8080, 3000) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -Confirm:$false }
}

function Start-Tunnel([int]$port) {
  $log = Join-Path $env:TEMP "nestledger-tunnel-$port.log"
  if (Test-Path $log) { Remove-Item $log }
  Start-Process -FilePath $Cloudflared -ArgumentList "tunnel --no-autoupdate --url http://localhost:$port" `
    -RedirectStandardError $log -WindowStyle Minimized | Out-Null
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
      if ($m) { return $m.Matches[0].Value }
    }
  }
  throw "tunnel for port $port did not start (see $log)"
}

Write-Host "Starting tunnels..."
$api = Start-Tunnel 8080
$web = Start-Tunnel 3000
Write-Host "  backend  $api"
Write-Host "  frontend $web"

# Backend: accepts sign-in and CORS from the public frontend URL and from localhost.
Start-Process powershell -ArgumentList "-NoExit", "-Command",
  "`$env:PUBLIC_WEB_ORIGIN='$web,http://localhost:3000'; Set-Location '$root\packages\backend'; pnpm start"

# Frontend: production build that calls the public backend URL.
Start-Process powershell -ArgumentList "-NoExit", "-Command",
  "`$env:NEXT_PUBLIC_API_URL='$api'; Set-Location '$root\packages\frontend'; pnpm build; if (`$?) { pnpm exec next start -p 3000 }"

$info = @"
NestLedger is starting (the frontend build takes about a minute).
  App (judges):        $web
  Public dashboard:    $web/public/society/1
  Status:              $web/status
  Backend API:         $api/health
"@
Write-Host $info
$info | Set-Content -Path (Join-Path $root "PUBLIC-URLS.local.txt") -Encoding utf8
