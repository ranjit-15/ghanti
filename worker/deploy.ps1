<#
Helper PowerShell script to assist with Cloudflare Worker deployment.

Usage: run from project root in PowerShell with Wrangler installed.

This script optionally creates a KV namespace and updates `worker/wrangler.toml`.
It does NOT store secrets; you must run `wrangler secret put TURNSTILE_SECRET` yourself.
#>

function Ensure-Wrangler {
    if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
        Write-Error "wrangler CLI not found. Install with: npm install -g wrangler"
        exit 1
    }
}

Ensure-Wrangler

Write-Host "This helper will (optionally) create a KV namespace and update worker/wrangler.toml"
$createKV = Read-Host "Create a new KV namespace now? (y/N)"
if ($createKV -match '^[yY]') {
    $name = Read-Host "Enter KV namespace name (default: VOTES_KV)"
    if (-not $name) { $name = 'VOTES_KV' }
    Write-Host "Creating KV namespace '$name'..."
    $out = wrangler kv:namespace create "$name" 2>&1
    Write-Host $out
    # Attempt to parse id from output
    if ($out -match 'Success.*id:\s*([a-f0-9-]{10,})') {
        $kvId = $matches[1]
    } else {
        # Try to find "id: " pattern
        $m = ($out | Select-String -Pattern 'id:\s*([a-f0-9-]{10,})').Matches
        if ($m.Count -gt 0) { $kvId = $m[0].Groups[1].Value }
    }
    if ($kvId) { Write-Host "KV id: $kvId" } else { Write-Warning "Could not parse KV id. Copy the id from the wrangler output." }
} else {
    $kvId = Read-Host "Enter existing KV id (or leave blank to update later)"
}

$account = Read-Host "Enter your Cloudflare account id (or leave blank to set later)"
$siteOrigin = Read-Host "Enter your GitHub Pages site origin (e.g. https://<user>.github.io/ghanti)"

if ($kvId -or $account -or $siteOrigin) {
    $toml = Get-Content worker/wrangler.toml -Raw
    if ($account) {
        $toml = $toml -replace 'account_id\s*=\s*"[^"]*"', "account_id = \"$account\""
    }
    if ($kvId) {
        $toml = $toml -replace 'id\s*=\s*"REPLACE_WITH_KV_ID"', "id = \"$kvId\""
    }
    if ($siteOrigin) {
        $escaped = $siteOrigin -replace '\\', '\\\\'
        $toml = $toml -replace 'SITE_ORIGIN\s*=\s*"[^"]*"', "SITE_ORIGIN = \"$escaped\""
    }
    Set-Content worker/wrangler.toml -Value $toml -Encoding UTF8
    Write-Host "Updated worker/wrangler.toml"
}

Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  - Run: wrangler secret put TURNSTILE_SECRET" -ForegroundColor Yellow
Write-Host "  - Then: wrangler publish" -ForegroundColor Yellow
