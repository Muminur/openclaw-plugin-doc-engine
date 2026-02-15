#!/usr/bin/env bash
# ============================================================================
# OpenClaw Plugin: doc-engine — Installer (Linux / macOS)
# ============================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Muminur/openclaw-plugin-doc-engine/main/scripts/install.sh | bash
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
NC='\033[0m' # No Color

info()    { printf "${CYAN}[info]${NC}  %s\n" "$*"; }
success() { printf "${GREEN}[ok]${NC}    %s\n" "$*"; }
warn()    { printf "${YELLOW}[warn]${NC}  %s\n" "$*"; }
error()   { printf "${RED}[error]${NC} %s\n" "$*" >&2; }
fatal()   { error "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
REPO_URL="https://github.com/Muminur/openclaw-plugin-doc-engine.git"
PLUGIN_DIR="$HOME/.openclaw/plugins/doc-engine"
CONFIG_FILE="$HOME/.openclaw/openclaw.json"
MIN_NODE_MAJOR=20

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------
detect_os() {
    local uname_out
    uname_out="$(uname -s)"
    case "$uname_out" in
        Linux*)  OS="linux"  ;;
        Darwin*) OS="macos"  ;;
        *)       fatal "Unsupported operating system: $uname_out. This installer supports Linux and macOS." ;;
    esac
    info "Detected OS: $OS"
}

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fatal "'$1' is required but not found in PATH. Please install it first."
}

check_node_version() {
    local node_version major
    node_version="$(node --version 2>/dev/null)" || fatal "node is required but not found in PATH."
    # Strip leading 'v' and extract major
    major="${node_version#v}"
    major="${major%%.*}"
    if [ "$major" -lt "$MIN_NODE_MAJOR" ]; then
        fatal "Node.js >= $MIN_NODE_MAJOR is required (found $node_version). Please upgrade."
    fi
    success "Node.js $node_version"
}

check_prerequisites() {
    info "Checking prerequisites..."
    check_node_version
    require_cmd npm   && success "npm $(npm --version)"
    require_cmd git   && success "git $(git --version | awk '{print $3}')"
    require_cmd openclaw && success "openclaw CLI found"
}

# ---------------------------------------------------------------------------
# Clone or update
# ---------------------------------------------------------------------------
install_plugin() {
    mkdir -p "$(dirname "$PLUGIN_DIR")"

    if [ -d "$PLUGIN_DIR/.git" ]; then
        info "Existing installation detected — updating via git pull..."
        git -C "$PLUGIN_DIR" pull --ff-only || fatal "git pull failed. Resolve conflicts manually in $PLUGIN_DIR"
        success "Repository updated"
    else
        if [ -d "$PLUGIN_DIR" ]; then
            warn "Directory $PLUGIN_DIR exists but is not a git repo. Removing and re-cloning..."
            rm -rf "$PLUGIN_DIR"
        fi
        info "Cloning repository..."
        git clone "$REPO_URL" "$PLUGIN_DIR" || fatal "git clone failed."
        success "Repository cloned to $PLUGIN_DIR"
    fi
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
build_plugin() {
    info "Installing dependencies..."
    (cd "$PLUGIN_DIR" && npm install --production=false) || fatal "npm install failed."
    success "Dependencies installed"

    info "Building plugin..."
    (cd "$PLUGIN_DIR" && npm run build) || fatal "npm run build failed."
    success "Build completed"
}

# ---------------------------------------------------------------------------
# Configure openclaw.json
# ---------------------------------------------------------------------------
configure_openclaw() {
    if [ ! -f "$CONFIG_FILE" ]; then
        warn "openclaw.json not found at $CONFIG_FILE"
        warn "Skipping automatic configuration. You will need to add the plugin config manually."
        return
    fi

    info "Configuring openclaw.json..."

    # Use node for reliable JSON manipulation (jq may not be installed)
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

// Ensure plugins structure exists
if (!config.plugins || typeof config.plugins !== 'object') {
    config.plugins = {};
}

// Enable plugins
config.plugins.enabled = true;

// Ensure load.paths exists
if (!config.plugins.load || typeof config.plugins.load !== 'object') {
    config.plugins.load = {};
}
if (!Array.isArray(config.plugins.load.paths)) {
    config.plugins.load.paths = [];
}

// Add plugin path if not already present
if (!config.plugins.load.paths.includes(pluginPath)) {
    config.plugins.load.paths.push(pluginPath);
}

// Ensure entries structure exists
if (!config.plugins.entries || typeof config.plugins.entries !== 'object') {
    config.plugins.entries = {};
}

// Add doc-engine entry if not present, or just enable it
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
" || fatal "Failed to update openclaw.json"

    success "openclaw.json configured"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
    echo ""
    printf "${GREEN}${BOLD}============================================${NC}\n"
    printf "${GREEN}${BOLD}  doc-engine plugin installed successfully  ${NC}\n"
    printf "${GREEN}${BOLD}============================================${NC}\n"
    echo ""
    info "Plugin location: $PLUGIN_DIR"
    echo ""
    printf "${BOLD}Next steps:${NC}\n"
    echo ""
    echo "  1. Add your documentation repositories to the plugin config:"
    echo ""
    printf "     ${CYAN}openclaw config edit${NC}\n"
    echo ""
    echo "     Then add entries to plugins.entries.doc-engine.config.repositories:"
    echo ""
    printf "     ${CYAN}\"repositories\": [${NC}\n"
    printf "     ${CYAN}  {${NC}\n"
    printf "     ${CYAN}    \"name\": \"my-docs\",${NC}\n"
    printf "     ${CYAN}    \"path\": \"/path/to/your/docs\"${NC}\n"
    printf "     ${CYAN}  }${NC}\n"
    printf "     ${CYAN}]${NC}\n"
    echo ""
    echo "  2. Restart the gateway to load the plugin:"
    echo ""
    printf "     ${CYAN}openclaw gateway restart${NC}\n"
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo ""
    printf "${BOLD}OpenClaw doc-engine plugin installer${NC}\n"
    echo ""

    detect_os
    check_prerequisites
    install_plugin
    build_plugin
    configure_openclaw
    print_summary
}

main "$@"
