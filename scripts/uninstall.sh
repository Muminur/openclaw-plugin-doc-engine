#!/usr/bin/env bash
# ============================================================================
# OpenClaw Plugin: doc-engine — Uninstaller (Linux / macOS)
# ============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Colours & helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { printf "${CYAN}[info]${NC}  %s\n" "$*"; }
success() { printf "${GREEN}[ok]${NC}    %s\n" "$*"; }
warn()    { printf "${YELLOW}[warn]${NC}  %s\n" "$*"; }
error()   { printf "${RED}[error]${NC} %s\n" "$*" >&2; }

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
PLUGIN_DIR="$HOME/.openclaw/plugins/doc-engine"
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

# ---------------------------------------------------------------------------
# Remove plugin directory
# ---------------------------------------------------------------------------
remove_plugin_dir() {
    if [ -d "$PLUGIN_DIR" ]; then
        info "Removing plugin directory: $PLUGIN_DIR"
        rm -rf "$PLUGIN_DIR"
        success "Plugin directory removed"
    else
        warn "Plugin directory not found at $PLUGIN_DIR (already removed?)"
    fi
}

# ---------------------------------------------------------------------------
# Clean openclaw.json
# ---------------------------------------------------------------------------
remove_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        warn "openclaw.json not found at $CONFIG_FILE — skipping config cleanup."
        return
    fi

    info "Removing doc-engine entries from openclaw.json..."

    node -e "
const fs = require('fs');
const path = '${CONFIG_FILE}';
const pluginPath = '~/.openclaw/plugins/doc-engine';

let config;
try {
    config = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch (e) {
    console.error('Failed to parse openclaw.json:', e.message);
    process.exit(1);
}

let changed = false;

// Remove from plugins.load.paths
if (config.plugins?.load?.paths && Array.isArray(config.plugins.load.paths)) {
    const idx = config.plugins.load.paths.indexOf(pluginPath);
    if (idx !== -1) {
        config.plugins.load.paths.splice(idx, 1);
        changed = true;
    }
}

// Remove from plugins.entries
if (config.plugins?.entries?.['doc-engine']) {
    delete config.plugins.entries['doc-engine'];
    changed = true;
}

if (changed) {
    fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.log('Config entries removed.');
} else {
    console.log('No doc-engine entries found in config.');
}
" || {
        error "Failed to update openclaw.json. You may need to remove doc-engine entries manually."
        return
    }

    success "openclaw.json cleaned"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    printf "${GREEN}${BOLD}===============================================${NC}\n"
    printf "${GREEN}${BOLD}  doc-engine plugin uninstalled successfully   ${NC}\n"
    printf "${GREEN}${BOLD}===============================================${NC}\n"
    echo ""
    echo "  To apply changes, restart the gateway:"
    echo ""
    printf "     ${CYAN}openclaw gateway restart${NC}\n"
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo ""
    printf "${BOLD}OpenClaw doc-engine plugin uninstaller${NC}\n"
    echo ""

    remove_plugin_dir
    remove_config
    print_summary
}

main "$@"
