# ============================================================================
# OpenClaw Plugin: doc-engine — Installer (Windows PowerShell)
# ============================================================================
# Usage:
#   irm https://raw.githubusercontent.com/Muminur/openclaw-plugin-doc-engine/main/scripts/install-windows.ps1 | iex
# ============================================================================
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Info    { param([string]$Msg) Write-Host "[info]  $Msg" -ForegroundColor Cyan }
function Write-Ok      { param([string]$Msg) Write-Host "[ok]    $Msg" -ForegroundColor Green }
function Write-Warn    { param([string]$Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Write-Err     { param([string]$Msg) Write-Host "[error] $Msg" -ForegroundColor Red }
function Write-Fatal   { param([string]$Msg) Write-Err $Msg; exit 1 }

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
$RepoUrl    = "https://github.com/Muminur/openclaw-plugin-doc-engine.git"
$PluginDir  = Join-Path $env:USERPROFILE ".openclaw\plugins\doc-engine"
$ConfigFile = Join-Path $env:USERPROFILE ".openclaw\openclaw.json"
$MinNodeMajor = 20

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
function Test-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Fatal "'$Name' is required but not found in PATH. Please install it first."
    }
}

function Test-NodeVersion {
    Test-Command "node"
    $version = & node --version 2>&1
    if ($version -match '^v(\d+)') {
        $major = [int]$Matches[1]
        if ($major -lt $MinNodeMajor) {
            Write-Fatal "Node.js >= $MinNodeMajor is required (found $version). Please upgrade."
        }
        Write-Ok "Node.js $version"
    } else {
        Write-Fatal "Could not determine Node.js version."
    }
}

function Test-Prerequisites {
    Write-Info "Checking prerequisites..."
    Test-NodeVersion

    Test-Command "npm"
    $npmVer = & npm --version 2>&1
    Write-Ok "npm $npmVer"

    Test-Command "git"
    $gitVer = & git --version 2>&1
    Write-Ok "$gitVer"

    Test-Command "openclaw"
    Write-Ok "openclaw CLI found"
}

# ---------------------------------------------------------------------------
# Clone or update
# ---------------------------------------------------------------------------
function Install-Plugin {
    $parentDir = Split-Path $PluginDir -Parent
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    $gitDir = Join-Path $PluginDir ".git"
    if (Test-Path $gitDir) {
        Write-Info "Existing installation detected - updating via git pull..."
        & git -C $PluginDir pull --ff-only
        if ($LASTEXITCODE -ne 0) {
            Write-Fatal "git pull failed. Resolve conflicts manually in $PluginDir"
        }
        Write-Ok "Repository updated"
    } else {
        if (Test-Path $PluginDir) {
            Write-Warn "Directory $PluginDir exists but is not a git repo. Removing and re-cloning..."
            Remove-Item -Recurse -Force $PluginDir
        }
        Write-Info "Cloning repository..."
        & git clone $RepoUrl $PluginDir
        if ($LASTEXITCODE -ne 0) {
            Write-Fatal "git clone failed."
        }
        Write-Ok "Repository cloned to $PluginDir"
    }
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
function Build-Plugin {
    Write-Info "Installing dependencies..."
    Push-Location $PluginDir
    try {
        & npm install --production=false
        if ($LASTEXITCODE -ne 0) { Write-Fatal "npm install failed." }
        Write-Ok "Dependencies installed"

        Write-Info "Building plugin..."
        & npm run build
        if ($LASTEXITCODE -ne 0) { Write-Fatal "npm run build failed." }
        Write-Ok "Build completed"
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# Configure openclaw.json
# ---------------------------------------------------------------------------
function Set-OpenclawConfig {
    if (-not (Test-Path $ConfigFile)) {
        Write-Warn "openclaw.json not found at $ConfigFile"
        Write-Warn "Skipping automatic configuration. You will need to add the plugin config manually."
        return
    }

    Write-Info "Configuring openclaw.json..."

    $nodeScript = @"
const fs = require('fs');
const path = process.argv[1];
const pluginPath = '~/.openclaw/plugins/doc-engine';

let config;
try {
    config = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch (e) {
    console.error('Failed to parse openclaw.json:', e.message);
    process.exit(1);
}

if (!config.plugins || typeof config.plugins !== 'object') {
    config.plugins = {};
}

config.plugins.enabled = true;

if (!config.plugins.load || typeof config.plugins.load !== 'object') {
    config.plugins.load = {};
}
if (!Array.isArray(config.plugins.load.paths)) {
    config.plugins.load.paths = [];
}

if (!config.plugins.load.paths.includes(pluginPath)) {
    config.plugins.load.paths.push(pluginPath);
}

if (!config.plugins.entries || typeof config.plugins.entries !== 'object') {
    config.plugins.entries = {};
}

if (!config.plugins.entries['doc-engine'] || typeof config.plugins.entries['doc-engine'] !== 'object') {
    config.plugins.entries['doc-engine'] = {
        enabled: true,
        config: {
            repositories: []
        }
    };
} else {
    config.plugins.entries['doc-engine'].enabled = true;
}

fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
"@

    & node -e $nodeScript -- $ConfigFile
    if ($LASTEXITCODE -ne 0) {
        Write-Fatal "Failed to update openclaw.json"
    }
    Write-Ok "openclaw.json configured"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
function Write-Summary {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  doc-engine plugin installed successfully  " -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Info "Plugin location: $PluginDir"
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host ""
    Write-Host "  1. Add your documentation repositories to the plugin config:" -ForegroundColor White
    Write-Host ""
    Write-Host "     openclaw config edit" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "     Then add entries to plugins.entries.doc-engine.config.repositories:" -ForegroundColor White
    Write-Host ""
    Write-Host '     "repositories": [' -ForegroundColor Cyan
    Write-Host '       {' -ForegroundColor Cyan
    Write-Host '         "name": "my-docs",' -ForegroundColor Cyan
    Write-Host '         "path": "C:\path\to\your\docs"' -ForegroundColor Cyan
    Write-Host '       }' -ForegroundColor Cyan
    Write-Host '     ]' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  2. Restart the gateway to load the plugin:" -ForegroundColor White
    Write-Host ""
    Write-Host "     openclaw gateway restart" -ForegroundColor Cyan
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "OpenClaw doc-engine plugin installer" -ForegroundColor White
Write-Host ""

Test-Prerequisites
Install-Plugin
Build-Plugin
Set-OpenclawConfig
Write-Summary
