# Node.js App Manager for DirectAdmin

A premium DirectAdmin plugin that provides a full-featured Node.js application manager with a modern, professional UI — rivaling cPanel's Node.js App Setup.

![Version](https://img.shields.io/badge/version-1.0.0-green)
![DirectAdmin](https://img.shields.io/badge/DirectAdmin-1.6%2B-blue)
![License](https://img.shields.io/badge/license-MIT-blue)

## ✨ Features

### Core Features (cPanel parity)
- **Create Application** — Wizard tạo app mới với đầy đủ config
- **Node.js Version Select** — Chọn version Node.js (detect từ NVM)
- **App Mode Toggle** — Development / Production
- **Application Root** — Chọn thư mục chứa app với folder browser
- **Application URL** — Mapping domain/subdomain
- **Startup File** — Chỉ định file khởi động
- **NPM Install** — Chạy npm install từ GUI
- **Start/Stop/Restart** — Process control trực quan
- **Environment Variables** — CRUD env vars với UI đẹp
- **Log Viewer** — Terminal-style log viewer (stdout + stderr)

### Premium Features (vượt cPanel)
- **Dashboard Overview** — Stats tổng quan: CPU, Memory, Uptime
- **Multi-app Management** — Quản lý nhiều app cùng lúc
- **Auto-restart** — PM2 auto-restart khi app crash
- **NPM Scripts Runner** — Chạy bất kỳ npm script từ package.json
- **Resource Monitoring** — Live CPU/Memory usage
- **Modern Dark UI** — Glassmorphism, animations, responsive

## 🚀 Installation

### Prerequisites
- DirectAdmin 1.6+ with Evolution skin
- Node.js (via NVM recommended)
- PM2 process manager

### Quick Install

```bash
# 1. Upload plugin to DirectAdmin
cd /usr/local/directadmin/plugins/
# Copy thư mục node_app_manager vào đây

# 2. Run installation script
bash /usr/local/directadmin/plugins/node_app_manager/scripts/install.sh

# 3. Restart DirectAdmin
systemctl restart directadmin
```

### Manual Install

```bash
# Clone / Extract plugin
cp -r node_app_manager /usr/local/directadmin/plugins/

# Set permissions
chmod 755 /usr/local/directadmin/plugins/node_app_manager/user/index.html
chmod 755 /usr/local/directadmin/plugins/node_app_manager/user/api.raw
chmod 755 /usr/local/directadmin/plugins/node_app_manager/admin/index.html
chmod 755 /usr/local/directadmin/plugins/node_app_manager/scripts/*.sh

# Install PM2 if not present
npm install -g pm2

# Restart DirectAdmin
systemctl restart directadmin
```

## 📁 Plugin Structure

```
node_app_manager/
├── plugin.conf              # Plugin metadata
├── README.md                # This file
├── admin/
│   └── index.html           # Admin entry point (PHP)
├── user/
│   ├── index.html           # User entry point (PHP)
│   └── api.raw              # API endpoint (RAW mode)
├── hooks/
│   ├── admin_txt.html       # Admin menu entry
│   ├── user_txt.html        # User menu entry
│   └── reseller_txt.html    # Reseller menu entry
├── images/
│   ├── icon.svg             # Plugin icon
│   ├── admin_icon.svg       # Admin menu icon
│   ├── user_icon.svg        # User menu icon
│   ├── reseller_icon.svg    # Reseller menu icon
│   ├── menu.json            # Pluggable menu config
│   ├── css/
│   │   └── app.css          # Premium design system
│   └── js/
│       └── app.js           # SPA frontend application
├── scripts/
│   ├── install.sh           # Post-install script
│   ├── uninstall.sh         # Uninstall cleanup
│   ├── node_manager.sh      # PM2 management
│   └── proxy_manager.sh     # Reverse proxy config
└── data/                    # Per-user app configs
```

## 🔧 API Endpoints

All API calls go through `user/api.raw` in RAW mode:

| Action | Method | Description |
|--------|--------|-------------|
| `list` | GET | List all apps with live status |
| `create` | POST | Create new application |
| `delete` | POST | Delete application |
| `start` | POST | Start application |
| `stop` | POST | Stop application |
| `restart` | POST | Restart application |
| `npm_install` | POST | Run npm install |
| `npm_run` | POST | Run npm script |
| `npm_scripts` | GET | List available npm scripts |
| `logs` | GET | Get application logs |
| `clear_logs` | POST | Clear application logs |
| `save_env` | POST | Save environment variables |
| `update_config` | POST | Update app configuration |
| `node_versions` | GET | List available Node.js versions |
| `domains` | GET | List user's domains |
| `system_info` | GET | Get system information |
| `browse` | GET | Browse file system |

## 🌐 Web Server Support

Auto-detects and supports:
- **Nginx** — Creates location blocks in DirectAdmin custom config
- **Apache** — Creates ProxyPass rules in httpd custom config  
- **OpenLiteSpeed** — Creates external app and proxy context

## 📝 License

MIT License — Free to use and modify.

## 👤 Author

**HuyLe** — Built with ❤️ for the DirectAdmin community.
