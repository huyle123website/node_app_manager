#!/bin/bash
# ============================================================================
# Node.js Application Manager - Core Management Script
# For DirectAdmin Plugin
# ============================================================================

PLUGIN_DIR="/usr/local/directadmin/plugins/node_app_manager"
DATA_DIR="${PLUGIN_DIR}/data"

# Get username from argument or environment
DA_USER="${1:-${USERNAME}}"
APP_DATA_DIR="${DATA_DIR}/${DA_USER}"

# Ensure data directory exists
mkdir -p "${APP_DATA_DIR}"

# ============================================================================
# Utility Functions
# ============================================================================

get_nvm_dir() {
    local user_home
    if [ "${DA_USER}" = "root" ]; then
        user_home="/root"
    else
        user_home="/home/${DA_USER}"
    fi
    
    # Check common NVM locations
    for dir in "${user_home}/.nvm" "/usr/local/nvm" "/opt/nvm"; do
        if [ -d "$dir" ]; then
            echo "$dir"
            return 0
        fi
    done
    echo ""
    return 1
}

load_nvm() {
    local nvm_dir=$(get_nvm_dir)
    if [ -n "$nvm_dir" ] && [ -s "${nvm_dir}/nvm.sh" ]; then
        export NVM_DIR="$nvm_dir"
        . "${nvm_dir}/nvm.sh"
        return 0
    fi
    return 1
}

get_node_path() {
    local version="$1"
    local nvm_dir=$(get_nvm_dir)
    
    if [ -n "$nvm_dir" ] && [ -d "${nvm_dir}/versions/node/${version}" ]; then
        echo "${nvm_dir}/versions/node/${version}/bin"
        return 0
    fi
    
    # Fallback to system node
    local sys_node=$(which node 2>/dev/null)
    if [ -n "$sys_node" ]; then
        echo "$(dirname $sys_node)"
        return 0
    fi
    
    echo ""
    return 1
}

find_free_port() {
    local start_port="${1:-3000}"
    local port=$start_port
    local max_port=$((start_port + 1000))
    
    while [ $port -lt $max_port ]; do
        if ! ss -tlnp 2>/dev/null | grep -q ":${port} " && \
           ! grep -rq "\"port\":${port}" "${DATA_DIR}/" 2>/dev/null; then
            echo $port
            return 0
        fi
        port=$((port + 1))
    done
    
    echo ""
    return 1
}

get_app_config() {
    local app_name="$1"
    local config_file="${APP_DATA_DIR}/${app_name}.json"
    
    if [ -f "$config_file" ]; then
        cat "$config_file"
        return 0
    fi
    return 1
}

save_app_config() {
    local app_name="$1"
    local config_data="$2"
    local config_file="${APP_DATA_DIR}/${app_name}.json"
    
    echo "$config_data" > "$config_file"
    chmod 644 "$config_file"
}

# ============================================================================
# Node.js Version Management
# ============================================================================

list_node_versions() {
    local versions="[]"
    local nvm_dir=$(get_nvm_dir)
    
    if [ -n "$nvm_dir" ] && [ -d "${nvm_dir}/versions/node" ]; then
        versions=$(ls -1 "${nvm_dir}/versions/node/" 2>/dev/null | sort -V | \
            awk 'BEGIN{printf "["} NR>1{printf ","} {printf "\"%s\"", $0} END{printf "]"}')
    fi
    
    # Check system node
    local sys_version=""
    if command -v node &>/dev/null; then
        sys_version=$(node --version 2>/dev/null)
    fi
    
    echo "{\"nvm_versions\":${versions},\"system_version\":\"${sys_version}\"}"
}

# ============================================================================
# Application CRUD
# ============================================================================

create_app() {
    local app_name="$1"
    local app_root="$2"
    local startup_file="$3"
    local node_version="$4"
    local app_url="$5"
    local app_mode="${6:-production}"
    
    # Validate
    if [ -z "$app_name" ] || [ -z "$app_root" ] || [ -z "$startup_file" ]; then
        echo '{"success":false,"error":"Missing required fields: name, root, startup_file"}'
        return 1
    fi
    
    # Check if app already exists
    if [ -f "${APP_DATA_DIR}/${app_name}.json" ]; then
        echo '{"success":false,"error":"Application already exists"}'
        return 1
    fi
    
    # Validate app root exists
    if [ ! -d "$app_root" ]; then
        echo "{\"success\":false,\"error\":\"Application root directory does not exist: ${app_root}\"}"
        return 1
    fi
    
    # Validate startup file exists
    if [ ! -f "${app_root}/${startup_file}" ]; then
        echo "{\"success\":false,\"error\":\"Startup file not found: ${app_root}/${startup_file}\"}"
        return 1
    fi
    
    # Find free port
    local port=$(find_free_port 3000)
    if [ -z "$port" ]; then
        echo '{"success":false,"error":"No available ports"}'
        return 1
    fi
    
    # Create config
    local now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local config=$(cat <<EOF
{
    "name": "${app_name}",
    "root": "${app_root}",
    "startup_file": "${startup_file}",
    "node_version": "${node_version}",
    "app_url": "${app_url}",
    "port": ${port},
    "mode": "${app_mode}",
    "env_vars": {},
    "status": "stopped",
    "created_at": "${now}",
    "updated_at": "${now}",
    "user": "${DA_USER}"
}
EOF
)
    
    save_app_config "$app_name" "$config"
    
    echo "{\"success\":true,\"message\":\"Application created\",\"port\":${port}}"
}

delete_app() {
    local app_name="$1"
    
    # Stop app first
    stop_app "$app_name" >/dev/null 2>&1
    
    # Remove config
    rm -f "${APP_DATA_DIR}/${app_name}.json"
    
    # Remove PM2 process
    local node_path=$(get_node_path "")
    if [ -n "$node_path" ]; then
        export PATH="${node_path}:$PATH"
    fi
    
    pm2 delete "da-${DA_USER}-${app_name}" 2>/dev/null
    pm2 save 2>/dev/null
    
    echo '{"success":true,"message":"Application deleted"}'
}

list_apps() {
    local apps="["
    local first=true
    
    if [ -d "$APP_DATA_DIR" ]; then
        for config_file in "${APP_DATA_DIR}"/*.json; do
            [ -f "$config_file" ] || continue
            
            local app_name=$(basename "$config_file" .json)
            local config=$(cat "$config_file")
            
            # Get live status from PM2
            local pm2_name="da-${DA_USER}-${app_name}"
            local live_status="stopped"
            local cpu="0"
            local memory="0"
            local uptime=""
            local pid=""
            local restarts="0"
            
            if command -v pm2 &>/dev/null; then
                local pm2_info=$(pm2 jlist 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    for proc in data:
        if proc.get('name') == '${pm2_name}':
            env = proc.get('pm2_env', {})
            monit = proc.get('monit', {})
            print(json.dumps({
                'status': env.get('status', 'stopped'),
                'cpu': monit.get('cpu', 0),
                'memory': monit.get('memory', 0),
                'uptime': env.get('pm_uptime', ''),
                'pid': proc.get('pid', ''),
                'restarts': env.get('restart_time', 0)
            }))
            sys.exit(0)
    print('{\"status\":\"stopped\",\"cpu\":0,\"memory\":0}')
except:
    print('{\"status\":\"stopped\",\"cpu\":0,\"memory\":0}')
" 2>/dev/null)
                
                if [ -n "$pm2_info" ]; then
                    live_status=$(echo "$pm2_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','stopped'))" 2>/dev/null || echo "stopped")
                    cpu=$(echo "$pm2_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('cpu',0))" 2>/dev/null || echo "0")
                    memory=$(echo "$pm2_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('memory',0))" 2>/dev/null || echo "0")
                    uptime=$(echo "$pm2_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('uptime',''))" 2>/dev/null || echo "")
                    pid=$(echo "$pm2_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('pid',''))" 2>/dev/null || echo "")
                    restarts=$(echo "$pm2_info" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('restarts',0))" 2>/dev/null || echo "0")
                fi
            fi
            
            # Update config with live status
            local updated_config=$(echo "$config" | python3 -c "
import json, sys
config = json.load(sys.stdin)
config['live_status'] = '${live_status}'
config['live_cpu'] = ${cpu}
config['live_memory'] = ${memory}
config['live_uptime'] = '${uptime}'
config['live_pid'] = '${pid}'
config['live_restarts'] = ${restarts}
print(json.dumps(config))
" 2>/dev/null || echo "$config")
            
            if [ "$first" = true ]; then
                first=false
            else
                apps="${apps},"
            fi
            apps="${apps}${updated_config}"
        done
    fi
    
    apps="${apps}]"
    echo "$apps"
}

# ============================================================================
# Process Management
# ============================================================================

start_app() {
    local app_name="$1"
    local config=$(get_app_config "$app_name")
    
    if [ -z "$config" ]; then
        echo '{"success":false,"error":"Application not found"}'
        return 1
    fi
    
    local app_root=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['root'])" 2>/dev/null)
    local startup_file=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['startup_file'])" 2>/dev/null)
    local node_version=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['node_version'])" 2>/dev/null)
    local port=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['port'])" 2>/dev/null)
    local app_mode=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['mode'])" 2>/dev/null)
    local env_vars=$(echo "$config" | python3 -c "
import json, sys
config = json.load(sys.stdin)
env = config.get('env_vars', {})
env['PORT'] = str(config.get('port', 3000))
env['NODE_ENV'] = config.get('mode', 'production')
result = ' '.join([f'{k}={v}' for k, v in env.items()])
print(result)
" 2>/dev/null)
    
    # Set up node path
    local node_path=$(get_node_path "$node_version")
    if [ -n "$node_path" ]; then
        export PATH="${node_path}:$PATH"
    fi
    
    local pm2_name="da-${DA_USER}-${app_name}"
    
    # Check if already running
    if pm2 list 2>/dev/null | grep -q "$pm2_name.*online"; then
        echo '{"success":false,"error":"Application is already running"}'
        return 1
    fi
    
    # Create PM2 ecosystem file
    local ecosystem_file="${APP_DATA_DIR}/${app_name}.ecosystem.config.js"
    
    # Build env object
    local env_json=$(echo "$config" | python3 -c "
import json, sys
config = json.load(sys.stdin)
env = dict(config.get('env_vars', {}))
env['PORT'] = str(config.get('port', 3000))
env['NODE_ENV'] = config.get('mode', 'production')
print(json.dumps(env))
" 2>/dev/null || echo '{"PORT":"3000","NODE_ENV":"production"}')
    
    cat > "$ecosystem_file" << ECOSYSTEM
module.exports = {
  apps: [{
    name: '${pm2_name}',
    script: '${startup_file}',
    cwd: '${app_root}',
    env: ${env_json},
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '${APP_DATA_DIR}/${app_name}-error.log',
    out_file: '${APP_DATA_DIR}/${app_name}-out.log',
    merge_logs: true,
    uid: '${DA_USER}'
  }]
};
ECOSYSTEM
    
    # Start with PM2
    if [ -n "$node_path" ]; then
        env PATH="${node_path}:$PATH" pm2 start "$ecosystem_file" 2>&1
    else
        pm2 start "$ecosystem_file" 2>&1
    fi
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        # Update config status
        local updated=$(echo "$config" | python3 -c "
import json, sys
from datetime import datetime
config = json.load(sys.stdin)
config['status'] = 'online'
config['updated_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
print(json.dumps(config, indent=4))
" 2>/dev/null)
        save_app_config "$app_name" "$updated"
        pm2 save 2>/dev/null
        echo '{"success":true,"message":"Application started successfully"}'
    else
        echo '{"success":false,"error":"Failed to start application"}'
    fi
}

stop_app() {
    local app_name="$1"
    local config=$(get_app_config "$app_name")
    
    if [ -z "$config" ]; then
        echo '{"success":false,"error":"Application not found"}'
        return 1
    fi
    
    local node_path=$(get_node_path "")
    if [ -n "$node_path" ]; then
        export PATH="${node_path}:$PATH"
    fi
    
    local pm2_name="da-${DA_USER}-${app_name}"
    
    pm2 stop "$pm2_name" 2>/dev/null
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        local updated=$(echo "$config" | python3 -c "
import json, sys
from datetime import datetime
config = json.load(sys.stdin)
config['status'] = 'stopped'
config['updated_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
print(json.dumps(config, indent=4))
" 2>/dev/null)
        save_app_config "$app_name" "$updated"
        pm2 save 2>/dev/null
        echo '{"success":true,"message":"Application stopped"}'
    else
        echo '{"success":false,"error":"Failed to stop application"}'
    fi
}

restart_app() {
    local app_name="$1"
    local config=$(get_app_config "$app_name")
    
    if [ -z "$config" ]; then
        echo '{"success":false,"error":"Application not found"}'
        return 1
    fi
    
    local node_path=$(get_node_path "")
    if [ -n "$node_path" ]; then
        export PATH="${node_path}:$PATH"
    fi
    
    local pm2_name="da-${DA_USER}-${app_name}"
    
    pm2 restart "$pm2_name" 2>/dev/null
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        local updated=$(echo "$config" | python3 -c "
import json, sys
from datetime import datetime
config = json.load(sys.stdin)
config['status'] = 'online'
config['updated_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
print(json.dumps(config, indent=4))
" 2>/dev/null)
        save_app_config "$app_name" "$updated"
        pm2 save 2>/dev/null
        echo '{"success":true,"message":"Application restarted"}'
    else
        echo '{"success":false,"error":"Failed to restart application"}'
    fi
}

# ============================================================================
# NPM Operations
# ============================================================================

npm_install() {
    local app_name="$1"
    local config=$(get_app_config "$app_name")
    
    if [ -z "$config" ]; then
        echo '{"success":false,"error":"Application not found"}'
        return 1
    fi
    
    local app_root=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['root'])" 2>/dev/null)
    local node_version=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['node_version'])" 2>/dev/null)
    
    local node_path=$(get_node_path "$node_version")
    if [ -n "$node_path" ]; then
        export PATH="${node_path}:$PATH"
    fi
    
    cd "$app_root"
    
    if [ -f "package-lock.json" ]; then
        output=$(npm ci --production 2>&1)
    else
        output=$(npm install --production 2>&1)
    fi
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo "{\"success\":true,\"message\":\"NPM install completed\",\"output\":$(echo "$output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')}"
    else
        echo "{\"success\":false,\"error\":\"NPM install failed\",\"output\":$(echo "$output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')}"
    fi
}

npm_run_script() {
    local app_name="$1"
    local script_name="$2"
    local config=$(get_app_config "$app_name")
    
    if [ -z "$config" ]; then
        echo '{"success":false,"error":"Application not found"}'
        return 1
    fi
    
    local app_root=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['root'])" 2>/dev/null)
    local node_version=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['node_version'])" 2>/dev/null)
    
    local node_path=$(get_node_path "$node_version")
    if [ -n "$node_path" ]; then
        export PATH="${node_path}:$PATH"
    fi
    
    cd "$app_root"
    output=$(npm run "$script_name" 2>&1)
    local exit_code=$?
    
    echo "{\"success\":$([ $exit_code -eq 0 ] && echo true || echo false),\"output\":$(echo "$output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')}"
}

get_npm_scripts() {
    local app_name="$1"
    local config=$(get_app_config "$app_name")
    
    if [ -z "$config" ]; then
        echo '{"success":false,"error":"Application not found"}'
        return 1
    fi
    
    local app_root=$(echo "$config" | python3 -c "import json,sys; print(json.load(sys.stdin)['root'])" 2>/dev/null)
    
    if [ -f "${app_root}/package.json" ]; then
        python3 -c "
import json
with open('${app_root}/package.json') as f:
    pkg = json.load(f)
    scripts = pkg.get('scripts', {})
    print(json.dumps({'success': True, 'scripts': scripts}))
" 2>/dev/null || echo '{"success":true,"scripts":{}}'
    else
        echo '{"success":true,"scripts":{}}'
    fi
}

# ============================================================================
# Log Management
# ============================================================================

get_logs() {
    local app_name="$1"
    local lines="${2:-100}"
    local log_type="${3:-out}" # out or error
    
    local log_file="${APP_DATA_DIR}/${app_name}-${log_type}.log"
    
    if [ -f "$log_file" ]; then
        local content=$(tail -n "$lines" "$log_file" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')
        echo "{\"success\":true,\"logs\":${content},\"file\":\"${log_file}\"}"
    else
        echo '{"success":true,"logs":"No logs available yet.","file":""}'
    fi
}

clear_logs() {
    local app_name="$1"
    
    > "${APP_DATA_DIR}/${app_name}-out.log" 2>/dev/null
    > "${APP_DATA_DIR}/${app_name}-error.log" 2>/dev/null
    
    local node_path=$(get_node_path "")
    if [ -n "$node_path" ]; then
        export PATH="${node_path}:$PATH"
    fi
    
    pm2 flush "da-${DA_USER}-${app_name}" 2>/dev/null
    
    echo '{"success":true,"message":"Logs cleared"}'
}

# ============================================================================
# Environment Variables
# ============================================================================

save_env_vars() {
    local app_name="$1"
    local env_json="$2"
    local config=$(get_app_config "$app_name")
    
    if [ -z "$config" ]; then
        echo '{"success":false,"error":"Application not found"}'
        return 1
    fi
    
    local updated=$(echo "$config" | python3 -c "
import json, sys
from datetime import datetime
config = json.load(sys.stdin)
new_env = json.loads('${env_json}')
config['env_vars'] = new_env
config['updated_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
print(json.dumps(config, indent=4))
" 2>/dev/null)
    
    if [ -n "$updated" ]; then
        save_app_config "$app_name" "$updated"
        echo '{"success":true,"message":"Environment variables saved. Restart the app to apply changes."}'
    else
        echo '{"success":false,"error":"Failed to save environment variables"}'
    fi
}

# ============================================================================
# Config Update
# ============================================================================

update_config() {
    local app_name="$1"
    local field="$2"
    local value="$3"
    local config=$(get_app_config "$app_name")
    
    if [ -z "$config" ]; then
        echo '{"success":false,"error":"Application not found"}'
        return 1
    fi
    
    local updated=$(echo "$config" | python3 -c "
import json, sys
from datetime import datetime
config = json.load(sys.stdin)
field = '${field}'
value = '${value}'
if field in ['port']:
    config[field] = int(value)
else:
    config[field] = value
config['updated_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
print(json.dumps(config, indent=4))
" 2>/dev/null)
    
    if [ -n "$updated" ]; then
        save_app_config "$app_name" "$updated"
        echo '{"success":true,"message":"Configuration updated"}'
    else
        echo '{"success":false,"error":"Failed to update configuration"}'
    fi
}

# ============================================================================
# User Domains
# ============================================================================

list_user_domains() {
    local user_home="/home/${DA_USER}"
    local domains_dir="${user_home}/domains"
    local domains="[]"
    
    if [ -d "$domains_dir" ]; then
        domains=$(ls -1 "$domains_dir" 2>/dev/null | \
            awk 'BEGIN{printf "["} NR>1{printf ","} {printf "\"%s\"", $0} END{printf "]"}')
    fi
    
    echo "{\"success\":true,\"domains\":${domains}}"
}

# ============================================================================
# Main Command Router
# ============================================================================

ACTION="$2"

case "$ACTION" in
    list_versions)
        list_node_versions
        ;;
    create)
        create_app "$3" "$4" "$5" "$6" "$7" "$8"
        ;;
    delete)
        delete_app "$3"
        ;;
    list)
        list_apps
        ;;
    start)
        start_app "$3"
        ;;
    stop)
        stop_app "$3"
        ;;
    restart)
        restart_app "$3"
        ;;
    npm_install)
        npm_install "$3"
        ;;
    npm_run)
        npm_run_script "$3" "$4"
        ;;
    npm_scripts)
        get_npm_scripts "$3"
        ;;
    logs)
        get_logs "$3" "$4" "$5"
        ;;
    clear_logs)
        clear_logs "$3"
        ;;
    save_env)
        save_env_vars "$3" "$4"
        ;;
    update_config)
        update_config "$3" "$4" "$5"
        ;;
    domains)
        list_user_domains
        ;;
    status)
        get_app_config "$3"
        ;;
    *)
        echo '{"success":false,"error":"Unknown action: '"$ACTION"'"}'
        exit 1
        ;;
esac
