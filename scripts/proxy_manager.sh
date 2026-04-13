#!/bin/bash
# ============================================================================
# Node.js Application Manager - Reverse Proxy Manager
# Supports: Nginx, Apache, OpenLiteSpeed
# ============================================================================

PLUGIN_DIR="/usr/local/directadmin/plugins/node_app_manager"
DA_USER="${1:-${USERNAME}}"
WEBSERVER_TYPE=""

# Detect web server
detect_webserver() {
    if command -v nginx &>/dev/null || [ -d "/etc/nginx" ]; then
        WEBSERVER_TYPE="nginx"
    elif command -v httpd &>/dev/null || command -v apache2 &>/dev/null; then
        WEBSERVER_TYPE="apache"
    elif command -v lsws &>/dev/null || [ -d "/usr/local/lsws" ]; then
        WEBSERVER_TYPE="openlitespeed"
    else
        WEBSERVER_TYPE="nginx"  # default
    fi
    echo "$WEBSERVER_TYPE"
}

# ============================================================================
# Nginx Proxy
# ============================================================================

nginx_create_proxy() {
    local domain="$1"
    local port="$2"
    local app_name="$3"
    local config_dir="/etc/nginx/conf.d"
    local da_config_dir="/usr/local/directadmin/data/users/${DA_USER}/nginx.conf"
    
    # DirectAdmin custom nginx config location
    local custom_dir="/usr/local/directadmin/data/users/${DA_USER}/nginx_custom"
    mkdir -p "$custom_dir"
    
    local proxy_file="${custom_dir}/node_${app_name}.conf"
    
    cat > "$proxy_file" << NGINX_CONF
# Node.js App Manager - ${app_name}
# Auto-generated - Do not edit manually
location / {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_cache_bypass \$http_upgrade;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}
NGINX_CONF
    
    # Reload nginx
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null
    
    echo "{\"success\":true,\"message\":\"Nginx proxy created for ${domain} -> port ${port}\"}"
}

nginx_remove_proxy() {
    local app_name="$1"
    local custom_dir="/usr/local/directadmin/data/users/${DA_USER}/nginx_custom"
    local proxy_file="${custom_dir}/node_${app_name}.conf"
    
    rm -f "$proxy_file"
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null
    
    echo '{"success":true,"message":"Nginx proxy removed"}'
}

# ============================================================================
# Apache Proxy
# ============================================================================

apache_create_proxy() {
    local domain="$1"
    local port="$2"
    local app_name="$3"
    
    local custom_dir="/usr/local/directadmin/data/users/${DA_USER}/httpd_custom"
    mkdir -p "$custom_dir"
    
    local proxy_file="${custom_dir}/node_${app_name}.conf"
    
    cat > "$proxy_file" << APACHE_CONF
# Node.js App Manager - ${app_name}
# Auto-generated - Do not edit manually
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:${port}/
ProxyPassReverse / http://127.0.0.1:${port}/
RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}

RewriteEngine On
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule /(.*) ws://127.0.0.1:${port}/\$1 [P,L]
APACHE_CONF
    
    # Reload Apache
    if command -v httpd &>/dev/null; then
        httpd -t 2>/dev/null && systemctl reload httpd 2>/dev/null
    elif command -v apache2 &>/dev/null; then
        apache2ctl -t 2>/dev/null && systemctl reload apache2 2>/dev/null
    fi
    
    echo "{\"success\":true,\"message\":\"Apache proxy created for ${domain} -> port ${port}\"}"
}

apache_remove_proxy() {
    local app_name="$1"
    local custom_dir="/usr/local/directadmin/data/users/${DA_USER}/httpd_custom"
    local proxy_file="${custom_dir}/node_${app_name}.conf"
    
    rm -f "$proxy_file"
    
    if command -v httpd &>/dev/null; then
        httpd -t 2>/dev/null && systemctl reload httpd 2>/dev/null
    elif command -v apache2 &>/dev/null; then
        apache2ctl -t 2>/dev/null && systemctl reload apache2 2>/dev/null
    fi
    
    echo '{"success":true,"message":"Apache proxy removed"}'
}

# ============================================================================
# OpenLiteSpeed Proxy
# ============================================================================

ols_create_proxy() {
    local domain="$1"
    local port="$2"
    local app_name="$3"
    
    local vhost_conf="/usr/local/lsws/conf/vhosts/${domain}/vhconf.conf"
    
    # Add external app and proxy context
    local ols_config="
# Node.js App Manager - ${app_name}
extprocessor node_${app_name} {
  type                    proxy
  address                 127.0.0.1:${port}
  maxConns                100
  pcKeepAliveTimeout      60
  initTimeout             60
  retryTimeout            0
  respBuffer              0
}

context / {
  type                    proxy
  handler                 node_${app_name}
  addDefaultCharset       off
}
"
    
    # Backup and append
    if [ -f "$vhost_conf" ]; then
        cp "$vhost_conf" "${vhost_conf}.bak"
        echo "$ols_config" >> "$vhost_conf"
    fi
    
    # Graceful restart OLS
    /usr/local/lsws/bin/lswsctrl restart 2>/dev/null
    
    echo "{\"success\":true,\"message\":\"OLS proxy created for ${domain} -> port ${port}\"}"
}

ols_remove_proxy() {
    local app_name="$1"
    local domain="$2"
    local vhost_conf="/usr/local/lsws/conf/vhosts/${domain}/vhconf.conf"
    
    if [ -f "$vhost_conf" ]; then
        # Remove the block between markers
        sed -i "/# Node.js App Manager - ${app_name}/,/^}/d" "$vhost_conf"
        /usr/local/lsws/bin/lswsctrl restart 2>/dev/null
    fi
    
    echo '{"success":true,"message":"OLS proxy removed"}'
}

# ============================================================================
# Main Router
# ============================================================================

ACTION="$2"
detect_webserver

case "$ACTION" in
    create)
        DOMAIN="$3"
        PORT="$4"
        APP_NAME="$5"
        case "$WEBSERVER_TYPE" in
            nginx)          nginx_create_proxy "$DOMAIN" "$PORT" "$APP_NAME" ;;
            apache)         apache_create_proxy "$DOMAIN" "$PORT" "$APP_NAME" ;;
            openlitespeed)  ols_create_proxy "$DOMAIN" "$PORT" "$APP_NAME" ;;
        esac
        ;;
    remove)
        APP_NAME="$3"
        DOMAIN="${4:-}"
        case "$WEBSERVER_TYPE" in
            nginx)          nginx_remove_proxy "$APP_NAME" ;;
            apache)         apache_remove_proxy "$APP_NAME" ;;
            openlitespeed)  ols_remove_proxy "$APP_NAME" "$DOMAIN" ;;
        esac
        ;;
    detect)
        echo "{\"webserver\":\"${WEBSERVER_TYPE}\"}"
        ;;
    *)
        echo '{"success":false,"error":"Unknown proxy action"}'
        ;;
esac
