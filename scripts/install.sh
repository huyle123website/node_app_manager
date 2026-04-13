#!/bin/bash
# ============================================================================
# Node.js App Manager - Installation Script
# Run after plugin is installed via DirectAdmin Plugin Manager
# ============================================================================

PLUGIN_DIR="/usr/local/directadmin/plugins/node_app_manager"

echo "============================================"
echo "  Node.js App Manager - Installation"
echo "============================================"

# ── Create data directory ──
echo "[1/5] Creating data directories..."
mkdir -p "${PLUGIN_DIR}/data"
chmod 755 "${PLUGIN_DIR}/data"

# ── Set script permissions ──
echo "[2/5] Setting file permissions..."
chmod 755 "${PLUGIN_DIR}/user/index.html"
chmod 755 "${PLUGIN_DIR}/user/api.raw"
chmod 755 "${PLUGIN_DIR}/admin/index.html"
chmod 755 "${PLUGIN_DIR}/scripts/node_manager.sh"
chmod 755 "${PLUGIN_DIR}/scripts/proxy_manager.sh"
chmod 755 "${PLUGIN_DIR}/scripts/install.sh"
chmod 755 "${PLUGIN_DIR}/scripts/uninstall.sh"

# ── Check Node.js ──
echo "[3/5] Checking Node.js installation..."
NODE_PATH=$(which node 2>/dev/null)
if [ -n "$NODE_PATH" ]; then
    NODE_VERSION=$(node --version 2>/dev/null)
    echo "  ✓ Node.js found: ${NODE_VERSION} at ${NODE_PATH}"
else
    echo "  ⚠ Node.js not found. Please install Node.js."
    echo "    Recommended: Install via NVM (Node Version Manager)"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
fi

# ── Check/Install PM2 ──
echo "[4/5] Checking PM2 process manager..."
PM2_PATH=$(which pm2 2>/dev/null)
if [ -n "$PM2_PATH" ]; then
    PM2_VERSION=$(pm2 --version 2>/dev/null)
    echo "  ✓ PM2 found: v${PM2_VERSION} at ${PM2_PATH}"
else
    echo "  Installing PM2 globally..."
    npm install -g pm2 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "  ✓ PM2 installed successfully"
        
        # Setup PM2 startup script
        pm2 startup 2>/dev/null
        echo "  ✓ PM2 startup configured"
    else
        echo "  ⚠ Failed to install PM2. Please install manually:"
        echo "    npm install -g pm2"
    fi
fi

# ── Setup PM2 log rotation ──
echo "[5/5] Final setup..."
if command -v pm2 &>/dev/null; then
    pm2 install pm2-logrotate 2>/dev/null
    pm2 set pm2-logrotate:max_size 10M 2>/dev/null
    pm2 set pm2-logrotate:retain 7 2>/dev/null
    echo "  ✓ PM2 log rotation configured"
fi

echo ""
echo "============================================"
echo "  ✅ Installation Complete!"
echo "============================================"
echo ""
echo "  Plugin Location: ${PLUGIN_DIR}"
echo "  User Access:     /CMD_PLUGINS/node_app_manager"
echo "  Admin Access:    /CMD_PLUGINS_ADMIN/node_app_manager"
echo ""
echo "  Prerequisites:"
echo "  - Node.js (via NVM or system)"
echo "  - PM2 (process manager)"
echo ""
echo "============================================"
