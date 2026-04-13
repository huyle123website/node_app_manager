#!/bin/bash
# ============================================================================
# Node.js App Manager - Uninstall Script
# Run before plugin is removed via DirectAdmin Plugin Manager
# ============================================================================

PLUGIN_DIR="/usr/local/directadmin/plugins/node_app_manager"
DATA_DIR="${PLUGIN_DIR}/data"

echo "============================================"
echo "  Node.js App Manager - Uninstalling"
echo "============================================"

# ── Stop all managed PM2 processes ──
echo "[1/3] Stopping managed Node.js applications..."
if command -v pm2 &>/dev/null; then
    # Find all processes managed by this plugin (prefixed with da-)
    pm2 jlist 2>/dev/null | python3 -c "
import json, sys
try:
    procs = json.load(sys.stdin)
    for p in procs:
        name = p.get('name', '')
        if name.startswith('da-'):
            print(name)
except:
    pass
" 2>/dev/null | while read proc_name; do
        echo "  Stopping: ${proc_name}"
        pm2 delete "$proc_name" 2>/dev/null
    done
    pm2 save 2>/dev/null
    echo "  ✓ All managed processes stopped"
else
    echo "  ⚠ PM2 not found, skipping process cleanup"
fi

# ── Remove proxy configurations ──
echo "[2/3] Cleaning up proxy configurations..."
for user_dir in "${DATA_DIR}"/*/; do
    [ -d "$user_dir" ] || continue
    username=$(basename "$user_dir")
    
    # Remove nginx custom configs
    nginx_dir="/usr/local/directadmin/data/users/${username}/nginx_custom"
    if [ -d "$nginx_dir" ]; then
        rm -f "${nginx_dir}"/node_*.conf 2>/dev/null
        echo "  Removed nginx configs for: ${username}"
    fi
    
    # Remove apache custom configs
    httpd_dir="/usr/local/directadmin/data/users/${username}/httpd_custom"
    if [ -d "$httpd_dir" ]; then
        rm -f "${httpd_dir}"/node_*.conf 2>/dev/null
        echo "  Removed apache configs for: ${username}"
    fi
done

# Reload web server
if command -v nginx &>/dev/null; then
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null
fi
if command -v httpd &>/dev/null; then
    httpd -t 2>/dev/null && systemctl reload httpd 2>/dev/null
fi
echo "  ✓ Proxy configurations cleaned"

# ── Clean up data ──
echo "[3/3] Cleaning up plugin data..."
# Note: We intentionally do NOT remove the data directory
# to preserve user app configurations in case of re-install
echo "  ⚠ App configuration data preserved in: ${DATA_DIR}"
echo "    Delete manually if no longer needed: rm -rf ${DATA_DIR}"

echo ""
echo "============================================"
echo "  ✅ Uninstall Complete!"
echo "============================================"
echo ""
echo "  Note: Node.js and PM2 were NOT removed."
echo "  User application files were NOT deleted."
echo ""
