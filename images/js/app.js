/**
 * ============================================================================
 * Node.js App Manager - SPA Frontend Application
 * DirectAdmin Plugin
 * ============================================================================
 */

(function() {
    'use strict';

    // ========================================================================
    // Configuration
    // ========================================================================

    const CONFIG = {
        apiBase: '',  // Set dynamically based on user level
        pollInterval: 10000,
        toastDuration: 4000,
        maxLogLines: 200,
    };

    // Detect user level from current URL
    if (window.location.pathname.includes('CMD_PLUGINS_ADMIN')) {
        CONFIG.apiBase = '/CMD_PLUGINS_ADMIN/node_app_manager/api.raw';
    } else if (window.location.pathname.includes('CMD_PLUGINS_RESELLER')) {
        CONFIG.apiBase = '/CMD_PLUGINS_RESELLER/node_app_manager/api.raw';
    } else {
        CONFIG.apiBase = '/CMD_PLUGINS/node_app_manager/api.raw';
    }

    // ========================================================================
    // State Management
    // ========================================================================

    const state = {
        currentView: 'dashboard',
        apps: [],
        selectedApp: null,
        nodeVersions: { nvm_versions: [], system_version: '' },
        domains: [],
        systemInfo: {},
        loading: false,
        pollTimer: null,
    };

    // ========================================================================
    // API Client
    // ========================================================================

    const api = {
        async request(action, params = {}, method = 'GET') {
            try {
                let url = `${CONFIG.apiBase}?action=${action}`;
                const options = { method, headers: {} };

                if (method === 'GET') {
                    Object.keys(params).forEach(key => {
                        url += `&${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`;
                    });
                } else {
                    options.headers['Content-Type'] = 'application/json';
                    options.body = JSON.stringify({ action, ...params });
                }

                const response = await fetch(url, options);
                const data = await response.json();
                return data;
            } catch (err) {
                console.error('API Error:', err);
                return { success: false, error: err.message };
            }
        },

        // Shortcuts
        listApps: () => api.request('list'),
        createApp: (data) => api.request('create', data, 'POST'),
        deleteApp: (name) => api.request('delete', { app: name }, 'POST'),
        startApp: (name) => api.request('start', { app: name }, 'POST'),
        stopApp: (name) => api.request('stop', { app: name }, 'POST'),
        restartApp: (name) => api.request('restart', { app: name }, 'POST'),
        npmInstall: (name) => api.request('npm_install', { app: name }, 'POST'),
        npmRun: (name, script) => api.request('npm_run', { app: name, script }, 'POST'),
        npmScripts: (name) => api.request('npm_scripts', { app: name }),
        getLogs: (name, type = 'out', lines = 100) => api.request('logs', { app: name, type, lines }),
        clearLogs: (name) => api.request('clear_logs', { app: name }, 'POST'),
        saveEnv: (name, env_vars) => api.request('save_env', { app: name, env_vars }, 'POST'),
        updateConfig: (name, field, value) => api.request('update_config', { app: name, field, value }, 'POST'),
        getNodeVersions: () => api.request('node_versions'),
        getDomains: () => api.request('domains'),
        getSystemInfo: () => api.request('system_info'),
        browse: (path) => api.request('browse', { path }),
        setupProxy: (name, domain, port) => api.request('setup_proxy', { app: name, domain, port }, 'POST'),
    };

    // ========================================================================
    // Toast Notifications
    // ========================================================================

    const toast = {
        container: null,

        init() {
            this.container = document.createElement('div');
            this.container.className = 'nam-toast-container';
            document.body.appendChild(this.container);
        },

        show(type, title, message = '') {
            const icons = {
                success: '✓',
                error: '✕',
                warning: '⚠',
                info: 'ℹ'
            };

            const el = document.createElement('div');
            el.className = `nam-toast ${type}`;
            el.innerHTML = `
                <span class="nam-toast-icon">${icons[type] || 'ℹ'}</span>
                <div class="nam-toast-content">
                    <div class="nam-toast-title">${this.escape(title)}</div>
                    ${message ? `<div class="nam-toast-message">${this.escape(message)}</div>` : ''}
                </div>
                <button class="nam-toast-close" onclick="this.closest('.nam-toast').remove()">✕</button>
            `;

            this.container.appendChild(el);

            setTimeout(() => {
                el.classList.add('removing');
                setTimeout(() => el.remove(), 200);
            }, CONFIG.toastDuration);
        },

        escape(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        success: (title, msg) => toast.show('success', title, msg),
        error: (title, msg) => toast.show('error', title, msg),
        warning: (title, msg) => toast.show('warning', title, msg),
        info: (title, msg) => toast.show('info', title, msg),
    };

    // ========================================================================
    // Template Helpers
    // ========================================================================

    const h = {
        escape(str) {
            if (!str) return '';
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
            return String(str).replace(/[&<>"']/g, m => map[m]);
        },

        formatBytes(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        },

        formatUptime(timestamp) {
            if (!timestamp) return '—';
            const now = Date.now();
            const diff = now - parseInt(timestamp);
            if (diff < 0) return '—';

            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) return `${days}d ${hours % 24}h`;
            if (hours > 0) return `${hours}h ${minutes % 60}m`;
            if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
            return `${seconds}s`;
        },

        timeAgo(dateStr) {
            if (!dateStr) return '—';
            const date = new Date(dateStr);
            const now = new Date();
            const diff = now - date;
            const mins = Math.floor(diff / 60000);
            const hours = Math.floor(mins / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
            if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
            if (mins > 0) return `${mins} min${mins > 1 ? 's' : ''} ago`;
            return 'Just now';
        },

        statusBadge(status) {
            const map = {
                online: { class: 'nam-badge-success', text: 'Online', icon: '●' },
                stopped: { class: 'nam-badge-danger', text: 'Stopped', icon: '●' },
                errored: { class: 'nam-badge-warning', text: 'Error', icon: '●' },
                launching: { class: 'nam-badge-info', text: 'Starting...', icon: '◌' },
            };
            const s = map[status] || map.stopped;
            return `<span class="nam-badge ${s.class}">${s.icon} ${s.text}</span>`;
        },

        colorizeLog(text) {
            if (!text) return '';
            return text
                .replace(/\b(error|Error|ERROR|fatal|FATAL|fail|FAIL)\b/g, '<span class="log-error">$1</span>')
                .replace(/\b(warn|Warning|WARN|warning)\b/g, '<span class="log-warn">$1</span>')
                .replace(/\b(info|INFO)\b/g, '<span class="log-info">$1</span>')
                .replace(/\b(success|SUCCESS|ok|OK)\b/g, '<span class="log-success">$1</span>')
                .replace(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*)/g, '<span class="log-time">$1</span>');
        },
    };

    // ========================================================================
    // View Renderers
    // ========================================================================

    const views = {
        // ====================================================================
        // Dashboard View
        // ====================================================================
        dashboard() {
            const apps = state.apps;
            const running = apps.filter(a => a.live_status === 'online').length;
            const stopped = apps.filter(a => a.live_status !== 'online').length;
            const totalMem = apps.reduce((sum, a) => sum + (a.live_memory || 0), 0);

            return `
                <div class="nam-view-enter">
                    <!-- Stats Cards -->
                    <div class="nam-stats-grid">
                        <div class="nam-stat-card">
                            <div class="nam-stat-icon apps">📦</div>
                            <div class="nam-stat-content">
                                <div class="nam-stat-value">${apps.length}</div>
                                <div class="nam-stat-label">Total Apps</div>
                            </div>
                        </div>
                        <div class="nam-stat-card">
                            <div class="nam-stat-icon running">▶</div>
                            <div class="nam-stat-content">
                                <div class="nam-stat-value">${running}</div>
                                <div class="nam-stat-label">Running</div>
                            </div>
                        </div>
                        <div class="nam-stat-card">
                            <div class="nam-stat-icon stopped">■</div>
                            <div class="nam-stat-content">
                                <div class="nam-stat-value">${stopped}</div>
                                <div class="nam-stat-label">Stopped</div>
                            </div>
                        </div>
                        <div class="nam-stat-card">
                            <div class="nam-stat-icon cpu">⚡</div>
                            <div class="nam-stat-content">
                                <div class="nam-stat-value">${h.formatBytes(totalMem)}</div>
                                <div class="nam-stat-label">Memory Usage</div>
                            </div>
                        </div>
                    </div>

                    <!-- App List -->
                    <div class="nam-card">
                        <div class="nam-card-header">
                            <div class="nam-card-title">📋 Applications</div>
                            <button class="nam-btn nam-btn-primary" onclick="NodeAppManager.showCreateModal()">
                                + Create App
                            </button>
                        </div>
                        <div class="nam-card-body" style="padding:0">
                            ${apps.length === 0 ? views.emptyState() : views.appList(apps)}
                        </div>
                    </div>
                </div>
            `;
        },

        emptyState() {
            return `
                <div class="nam-empty-state">
                    <div class="nam-empty-state-icon">🚀</div>
                    <div class="nam-empty-state-title">No applications yet</div>
                    <div class="nam-empty-state-desc">
                        Create your first Node.js application to get started.
                        Deploy and manage your apps with ease.
                    </div>
                    <button class="nam-btn nam-btn-primary nam-btn-lg" onclick="NodeAppManager.showCreateModal()">
                        + Create First App
                    </button>
                </div>
            `;
        },

        appList(apps) {
            return `
                <div class="nam-app-list" style="padding: var(--space-4)">
                    ${apps.map(app => {
                        const status = app.live_status || 'stopped';
                        return `
                            <div class="nam-app-item ${status}" 
                                 onclick="NodeAppManager.showAppDetail('${h.escape(app.name)}')"
                                 title="Click to manage">
                                <div class="nam-app-status-dot ${status}"></div>
                                <div class="nam-app-info">
                                    <div class="nam-app-name">
                                        ${h.escape(app.name)}
                                        ${h.statusBadge(status)}
                                        ${app.node_version ? `<span class="nam-badge nam-badge-node">${h.escape(app.node_version)}</span>` : ''}
                                    </div>
                                    <div class="nam-app-meta">
                                        <div class="nam-app-meta-item">
                                            <span class="label">Port:</span> ${app.port}
                                        </div>
                                        <div class="nam-app-meta-item">
                                            <span class="label">Mode:</span> ${h.escape(app.mode || 'production')}
                                        </div>
                                        ${status === 'online' ? `
                                            <div class="nam-app-meta-item">
                                                <span class="label">CPU:</span> ${app.live_cpu || 0}%
                                            </div>
                                            <div class="nam-app-meta-item">
                                                <span class="label">RAM:</span> ${h.formatBytes(app.live_memory || 0)}
                                            </div>
                                            <div class="nam-app-meta-item">
                                                <span class="label">Uptime:</span> ${h.formatUptime(app.live_uptime)}
                                            </div>
                                        ` : ''}
                                        <div class="nam-app-meta-item">
                                            <span class="label">File:</span> ${h.escape(app.startup_file)}
                                        </div>
                                    </div>
                                </div>
                                <div class="nam-app-actions" onclick="event.stopPropagation()">
                                    ${status === 'online' ? `
                                        <button class="nam-btn nam-btn-warning nam-btn-sm" 
                                                onclick="NodeAppManager.restartApp('${h.escape(app.name)}')" title="Restart">
                                            ⟳ Restart
                                        </button>
                                        <button class="nam-btn nam-btn-danger nam-btn-sm" 
                                                onclick="NodeAppManager.stopApp('${h.escape(app.name)}')" title="Stop">
                                            ■ Stop
                                        </button>
                                    ` : `
                                        <button class="nam-btn nam-btn-success nam-btn-sm" 
                                                onclick="NodeAppManager.startApp('${h.escape(app.name)}')" title="Start">
                                            ▶ Start
                                        </button>
                                    `}
                                    <button class="nam-btn nam-btn-danger nam-btn-icon nam-btn-sm" 
                                            onclick="NodeAppManager.confirmDelete('${h.escape(app.name)}')" title="Delete">
                                        🗑
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        },

        // ====================================================================
        // App Detail View
        // ====================================================================
        appDetail(app) {
            const status = app.live_status || 'stopped';

            return `
                <div class="nam-view-enter">
                    <!-- Header -->
                    <div class="nam-detail-header">
                        <div class="nam-detail-back" onclick="NodeAppManager.navigate('dashboard')" title="Back">←</div>
                        <div class="nam-detail-info">
                            <div class="nam-detail-title">
                                ${h.escape(app.name)}
                                ${h.statusBadge(status)}
                            </div>
                            <div class="nam-detail-subtitle">${h.escape(app.root)}</div>
                        </div>
                        <div class="nam-btn-group">
                            ${status === 'online' ? `
                                <button class="nam-btn nam-btn-warning" onclick="NodeAppManager.restartApp('${h.escape(app.name)}')">
                                    ⟳ Restart
                                </button>
                                <button class="nam-btn nam-btn-danger" onclick="NodeAppManager.stopApp('${h.escape(app.name)}')">
                                    ■ Stop
                                </button>
                            ` : `
                                <button class="nam-btn nam-btn-success" onclick="NodeAppManager.startApp('${h.escape(app.name)}')">
                                    ▶ Start
                                </button>
                            `}
                            <button class="nam-btn nam-btn-secondary" onclick="NodeAppManager.runNpmInstall('${h.escape(app.name)}')">
                                📦 NPM Install
                            </button>
                        </div>
                    </div>

                    <!-- Tabs -->
                    <div class="nam-tabs" id="detail-tabs">
                        <button class="nam-tab active" data-tab="overview" onclick="NodeAppManager.switchTab('overview')">
                            📊 Overview
                        </button>
                        <button class="nam-tab" data-tab="env" onclick="NodeAppManager.switchTab('env')">
                            🔧 Environment
                        </button>
                        <button class="nam-tab" data-tab="logs" onclick="NodeAppManager.switchTab('logs')">
                            📄 Logs
                        </button>
                        <button class="nam-tab" data-tab="npm" onclick="NodeAppManager.switchTab('npm')">
                            📦 NPM Scripts
                        </button>
                        <button class="nam-tab" data-tab="settings" onclick="NodeAppManager.switchTab('settings')">
                            ⚙ Settings
                        </button>
                    </div>

                    <!-- Tab Content -->
                    <div id="tab-content">
                        ${views.tabOverview(app)}
                    </div>
                </div>
            `;
        },

        tabOverview(app) {
            const status = app.live_status || 'stopped';
            return `
                <div class="nam-card nam-mb-6">
                    <div class="nam-card-header">
                        <div class="nam-card-title">Application Information</div>
                    </div>
                    <div class="nam-card-body">
                        <div class="nam-info-grid">
                            <div class="nam-info-item">
                                <div class="nam-info-label">Status</div>
                                <div class="nam-info-value">${h.statusBadge(status)}</div>
                            </div>
                            <div class="nam-info-item">
                                <div class="nam-info-label">Port</div>
                                <div class="nam-info-value">${app.port}</div>
                            </div>
                            <div class="nam-info-item">
                                <div class="nam-info-label">Node Version</div>
                                <div class="nam-info-value">${h.escape(app.node_version) || 'System'}</div>
                            </div>
                            <div class="nam-info-item">
                                <div class="nam-info-label">Mode</div>
                                <div class="nam-info-value">${h.escape(app.mode)}</div>
                            </div>
                            <div class="nam-info-item">
                                <div class="nam-info-label">Startup File</div>
                                <div class="nam-info-value">${h.escape(app.startup_file)}</div>
                            </div>
                            <div class="nam-info-item">
                                <div class="nam-info-label">App Root</div>
                                <div class="nam-info-value" style="word-break:break-all">${h.escape(app.root)}</div>
                            </div>
                            <div class="nam-info-item">
                                <div class="nam-info-label">Application URL</div>
                                <div class="nam-info-value">${app.app_url ? `<a href="${h.escape(app.app_url)}" target="_blank">${h.escape(app.app_url)}</a>` : '—'}</div>
                            </div>
                            <div class="nam-info-item">
                                <div class="nam-info-label">Created</div>
                                <div class="nam-info-value" style="font-family:var(--font-sans)">${h.timeAgo(app.created_at)}</div>
                            </div>
                        </div>
                    </div>
                </div>

                ${status === 'online' ? `
                <div class="nam-card">
                    <div class="nam-card-header">
                        <div class="nam-card-title">⚡ Live Metrics</div>
                    </div>
                    <div class="nam-card-body">
                        <div class="nam-stats-grid" style="margin-bottom:0">
                            <div class="nam-stat-card">
                                <div class="nam-stat-icon running">⏱</div>
                                <div class="nam-stat-content">
                                    <div class="nam-stat-value">${h.formatUptime(app.live_uptime)}</div>
                                    <div class="nam-stat-label">Uptime</div>
                                </div>
                            </div>
                            <div class="nam-stat-card">
                                <div class="nam-stat-icon cpu">⚡</div>
                                <div class="nam-stat-content">
                                    <div class="nam-stat-value">${app.live_cpu || 0}%</div>
                                    <div class="nam-stat-label">CPU Usage</div>
                                </div>
                            </div>
                            <div class="nam-stat-card">
                                <div class="nam-stat-icon apps">💾</div>
                                <div class="nam-stat-content">
                                    <div class="nam-stat-value">${h.formatBytes(app.live_memory || 0)}</div>
                                    <div class="nam-stat-label">Memory</div>
                                </div>
                            </div>
                            <div class="nam-stat-card">
                                <div class="nam-stat-icon stopped">🔄</div>
                                <div class="nam-stat-content">
                                    <div class="nam-stat-value">${app.live_restarts || 0}</div>
                                    <div class="nam-stat-label">Restarts</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}
            `;
        },

        tabEnv(app) {
            const envVars = app.env_vars || {};
            const entries = Object.entries(envVars);

            return `
                <div class="nam-card">
                    <div class="nam-card-header">
                        <div class="nam-card-title">🔧 Environment Variables</div>
                        <button class="nam-btn nam-btn-secondary nam-btn-sm" onclick="NodeAppManager.addEnvRow()">
                            + Add Variable
                        </button>
                    </div>
                    <div class="nam-card-body">
                        <div class="nam-env-editor" id="env-editor">
                            <div class="nam-env-row" style="margin-bottom:var(--space-2);">
                                <div class="nam-label" style="margin:0;padding:var(--space-1) var(--space-3)">Key</div>
                                <div class="nam-label" style="margin:0;padding:var(--space-1) var(--space-3)">Value</div>
                                <div style="width:36px"></div>
                            </div>
                            ${entries.map(([key, val], i) => `
                                <div class="nam-env-row" data-env-row="${i}">
                                    <input type="text" class="nam-input env-key" value="${h.escape(key)}" placeholder="KEY_NAME">
                                    <input type="text" class="nam-input env-value" value="${h.escape(val)}" placeholder="value">
                                    <button class="nam-btn nam-btn-danger nam-btn-icon nam-btn-sm" onclick="this.closest('.nam-env-row').remove()">✕</button>
                                </div>
                            `).join('')}
                            ${entries.length === 0 ? `
                                <div class="nam-env-row" data-env-row="0">
                                    <input type="text" class="nam-input env-key" value="" placeholder="KEY_NAME">
                                    <input type="text" class="nam-input env-value" value="" placeholder="value">
                                    <button class="nam-btn nam-btn-danger nam-btn-icon nam-btn-sm" onclick="this.closest('.nam-env-row').remove()">✕</button>
                                </div>
                            ` : ''}
                        </div>
                        <div class="nam-form-hint nam-mt-4">
                            💡 PORT and NODE_ENV are set automatically. Restart the app after saving to apply changes.
                        </div>
                    </div>
                    <div class="nam-card-footer" style="display:flex;justify-content:flex-end;gap:var(--space-3)">
                        <button class="nam-btn nam-btn-primary" onclick="NodeAppManager.saveEnvVars('${h.escape(app.name)}')">
                            💾 Save Variables
                        </button>
                    </div>
                </div>
            `;
        },

        tabLogs(app) {
            return `
                <div class="nam-card">
                    <div class="nam-card-header">
                        <div class="nam-card-title">📄 Application Logs</div>
                        <div class="nam-btn-group">
                            <button class="nam-btn nam-btn-secondary nam-btn-sm active" id="btn-log-out"
                                    onclick="NodeAppManager.loadLogs('${h.escape(app.name)}', 'out')">
                                Output
                            </button>
                            <button class="nam-btn nam-btn-secondary nam-btn-sm" id="btn-log-error"
                                    onclick="NodeAppManager.loadLogs('${h.escape(app.name)}', 'error')">
                                Errors
                            </button>
                            <button class="nam-btn nam-btn-danger nam-btn-sm"
                                    onclick="NodeAppManager.clearAppLogs('${h.escape(app.name)}')">
                                🗑 Clear
                            </button>
                            <button class="nam-btn nam-btn-secondary nam-btn-sm"
                                    onclick="NodeAppManager.loadLogs('${h.escape(app.name)}', 'out')">
                                ↻ Refresh
                            </button>
                        </div>
                    </div>
                    <div class="nam-card-body" style="padding:0">
                        <div class="nam-terminal">
                            <div class="nam-terminal-header">
                                <div class="nam-terminal-dots">
                                    <div class="nam-terminal-dot red"></div>
                                    <div class="nam-terminal-dot yellow"></div>
                                    <div class="nam-terminal-dot green"></div>
                                </div>
                                <div class="nam-terminal-title">${h.escape(app.name)} — logs</div>
                            </div>
                            <div class="nam-terminal-body" id="log-output">
                                <span class="nam-text-muted">Loading logs...</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        },

        tabNpm(app) {
            return `
                <div class="nam-card nam-mb-6">
                    <div class="nam-card-header">
                        <div class="nam-card-title">📦 NPM Operations</div>
                    </div>
                    <div class="nam-card-body">
                        <div class="nam-btn-group" style="flex-wrap:wrap">
                            <button class="nam-btn nam-btn-primary" onclick="NodeAppManager.runNpmInstall('${h.escape(app.name)}')">
                                📦 Run NPM Install
                            </button>
                        </div>
                        <div id="npm-output" class="nam-mt-4 nam-hidden">
                            <div class="nam-label">Output:</div>
                            <div class="nam-npm-output" id="npm-output-content"></div>
                        </div>
                    </div>
                </div>
                <div class="nam-card">
                    <div class="nam-card-header">
                        <div class="nam-card-title">🏃 Available Scripts</div>
                        <button class="nam-btn nam-btn-secondary nam-btn-sm" onclick="NodeAppManager.loadNpmScripts('${h.escape(app.name)}')">
                            ↻ Refresh
                        </button>
                    </div>
                    <div class="nam-card-body" style="padding:0">
                        <div id="npm-scripts-list">
                            <div class="nam-text-muted nam-text-center" style="padding:var(--space-6)">
                                Loading scripts from package.json...
                            </div>
                        </div>
                    </div>
                </div>
            `;
        },

        tabSettings(app) {
            return `
                <div class="nam-card nam-mb-6">
                    <div class="nam-card-header">
                        <div class="nam-card-title">⚙ Application Settings</div>
                    </div>
                    <div class="nam-card-body">
                        <div class="nam-form-row">
                            <div class="nam-form-group">
                                <label class="nam-label">Application Mode</label>
                                <select class="nam-select" id="setting-mode" onchange="NodeAppManager.updateSetting('${h.escape(app.name)}', 'mode', this.value)">
                                    <option value="production" ${app.mode === 'production' ? 'selected' : ''}>Production</option>
                                    <option value="development" ${app.mode === 'development' ? 'selected' : ''}>Development</option>
                                </select>
                            </div>
                            <div class="nam-form-group">
                                <label class="nam-label">Startup File</label>
                                <input type="text" class="nam-input nam-input-mono" id="setting-startup" 
                                       value="${h.escape(app.startup_file)}"
                                       onchange="NodeAppManager.updateSetting('${h.escape(app.name)}', 'startup_file', this.value)">
                            </div>
                        </div>
                        <div class="nam-form-row">
                            <div class="nam-form-group">
                                <label class="nam-label">Node.js Version</label>
                                <select class="nam-select" id="setting-node-version"
                                        onchange="NodeAppManager.updateSetting('${h.escape(app.name)}', 'node_version', this.value)">
                                    <option value="">System Default</option>
                                    ${state.nodeVersions.nvm_versions.map(v => 
                                        `<option value="${h.escape(v)}" ${app.node_version === v ? 'selected' : ''}>${h.escape(v)}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="nam-form-group">
                                <label class="nam-label">Application URL</label>
                                <input type="text" class="nam-input nam-input-mono" id="setting-app-url"
                                       value="${h.escape(app.app_url || '')}" placeholder="https://example.com"
                                       onchange="NodeAppManager.updateSetting('${h.escape(app.name)}', 'app_url', this.value)">
                            </div>
                        </div>
                        <div class="nam-form-hint">
                            💡 After changing settings, restart the application to apply.
                        </div>
                    </div>
                </div>

                <div class="nam-card">
                    <div class="nam-card-header">
                        <div class="nam-card-title nam-text-danger">⚠ Danger Zone</div>
                    </div>
                    <div class="nam-card-body" style="display:flex;align-items:center;justify-content:space-between;">
                        <div>
                            <div style="font-weight:600;color:var(--color-text-primary);">Delete Application</div>
                            <div class="nam-text-xs nam-text-muted">This will permanently stop and remove this application.</div>
                        </div>
                        <button class="nam-btn nam-btn-danger" onclick="NodeAppManager.confirmDelete('${h.escape(app.name)}')">
                            🗑 Delete App
                        </button>
                    </div>
                </div>
            `;
        },

        // ====================================================================
        // Loading State
        // ====================================================================
        loading() {
            return `
                <div class="nam-view-enter">
                    <div class="nam-stats-grid">
                        ${Array(4).fill('<div class="nam-skeleton" style="height:80px;border-radius:var(--radius-lg)"></div>').join('')}
                    </div>
                    <div class="nam-card">
                        <div class="nam-card-body">
                            ${Array(3).fill('<div class="nam-skeleton nam-skeleton-card"></div>').join('')}
                        </div>
                    </div>
                </div>
            `;
        },
    };

    // ========================================================================
    // Modal Management
    // ========================================================================

    const modal = {
        show(content) {
            const existing = document.querySelector('.nam-modal-backdrop');
            if (existing) existing.remove();

            const backdrop = document.createElement('div');
            backdrop.className = 'nam-modal-backdrop';
            backdrop.innerHTML = content;
            
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) modal.close();
            });

            document.body.appendChild(backdrop);
        },

        close() {
            const backdrop = document.querySelector('.nam-modal-backdrop');
            if (backdrop) {
                backdrop.style.animation = 'fadeIn 0.15s ease-in reverse';
                setTimeout(() => backdrop.remove(), 150);
            }
        },

        createApp() {
            const versions = state.nodeVersions.nvm_versions || [];
            const domains = state.domains || [];

            return `
                <div class="nam-modal nam-modal-lg">
                    <div class="nam-modal-header">
                        <div class="nam-modal-title">🚀 Create New Application</div>
                        <button class="nam-btn nam-btn-icon nam-btn-sm nam-btn-secondary" onclick="NodeAppManager.closeModal()">✕</button>
                    </div>
                    <div class="nam-modal-body">
                        <div class="nam-form-row">
                            <div class="nam-form-group">
                                <label class="nam-label">Application Name <span class="required">*</span></label>
                                <input type="text" class="nam-input" id="create-name" placeholder="my-node-app" 
                                       pattern="[a-zA-Z0-9_-]+" title="Only letters, numbers, hyphens and underscores">
                                <div class="nam-form-hint">Only alphanumeric, hyphens, underscores</div>
                            </div>
                            <div class="nam-form-group">
                                <label class="nam-label">Node.js Version</label>
                                <select class="nam-select" id="create-node-version">
                                    <option value="">System Default (${h.escape(state.nodeVersions.system_version || 'auto')})</option>
                                    ${versions.map(v => `<option value="${h.escape(v)}">${h.escape(v)}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="nam-form-group">
                            <label class="nam-label">Application Root <span class="required">*</span></label>
                            <div style="display:flex;gap:var(--space-2)">
                                <input type="text" class="nam-input nam-input-mono" id="create-root" 
                                       placeholder="/home/username/domains/example.com/public_html/myapp"
                                       style="flex:1">
                                <button class="nam-btn nam-btn-secondary" onclick="NodeAppManager.browseFolder('create-root')">📁 Browse</button>
                            </div>
                            <div class="nam-form-hint">Absolute path to your app directory</div>
                        </div>
                        <div class="nam-form-row">
                            <div class="nam-form-group">
                                <label class="nam-label">Startup File <span class="required">*</span></label>
                                <input type="text" class="nam-input nam-input-mono" id="create-startup" value="app.js" placeholder="app.js">
                                <div class="nam-form-hint">Main entry point file (e.g., app.js, server.js, index.js)</div>
                            </div>
                            <div class="nam-form-group">
                                <label class="nam-label">Application Mode</label>
                                <select class="nam-select" id="create-mode">
                                    <option value="production" selected>Production</option>
                                    <option value="development">Development</option>
                                </select>
                            </div>
                        </div>
                        <div class="nam-form-group">
                            <label class="nam-label">Application URL</label>
                            <input type="text" class="nam-input nam-input-mono" id="create-url" 
                                   placeholder="https://example.com">
                            <div class="nam-form-hint">Domain where the app will be accessible (optional)</div>
                        </div>
                    </div>
                    <div class="nam-modal-footer">
                        <button class="nam-btn nam-btn-secondary" onclick="NodeAppManager.closeModal()">Cancel</button>
                        <button class="nam-btn nam-btn-primary" id="btn-create-app" onclick="NodeAppManager.createApp()">
                            🚀 Create Application
                        </button>
                    </div>
                </div>
            `;
        },

        confirmDelete(appName) {
            return `
                <div class="nam-modal" style="max-width:440px">
                    <div class="nam-modal-header">
                        <div class="nam-modal-title">Delete Application</div>
                        <button class="nam-btn nam-btn-icon nam-btn-sm nam-btn-secondary" onclick="NodeAppManager.closeModal()">✕</button>
                    </div>
                    <div class="nam-modal-body">
                        <div class="nam-confirm-icon danger">🗑</div>
                        <div class="nam-confirm-text">
                            Are you sure you want to delete 
                            <span class="nam-confirm-name">${h.escape(appName)}</span>?
                            <br><br>
                            This will stop the process and remove all configuration. 
                            Your application files will <strong>not</strong> be deleted.
                        </div>
                    </div>
                    <div class="nam-modal-footer">
                        <button class="nam-btn nam-btn-secondary" onclick="NodeAppManager.closeModal()">Cancel</button>
                        <button class="nam-btn nam-btn-danger" onclick="NodeAppManager.deleteApp('${h.escape(appName)}')">
                            🗑 Delete Forever
                        </button>
                    </div>
                </div>
            `;
        },

        npmOutput(title, output, success) {
            return `
                <div class="nam-modal nam-modal-lg">
                    <div class="nam-modal-header">
                        <div class="nam-modal-title">${success ? '✅' : '❌'} ${h.escape(title)}</div>
                        <button class="nam-btn nam-btn-icon nam-btn-sm nam-btn-secondary" onclick="NodeAppManager.closeModal()">✕</button>
                    </div>
                    <div class="nam-modal-body">
                        <div class="nam-terminal">
                            <div class="nam-terminal-header">
                                <div class="nam-terminal-dots">
                                    <div class="nam-terminal-dot red"></div>
                                    <div class="nam-terminal-dot yellow"></div>
                                    <div class="nam-terminal-dot green"></div>
                                </div>
                                <div class="nam-terminal-title">npm</div>
                            </div>
                            <div class="nam-terminal-body">${h.colorizeLog(h.escape(output || 'No output'))}</div>
                        </div>
                    </div>
                    <div class="nam-modal-footer">
                        <button class="nam-btn nam-btn-primary" onclick="NodeAppManager.closeModal()">Close</button>
                    </div>
                </div>
            `;
        },

        folderBrowser(path, items) {
            return `
                <div class="nam-modal nam-modal-lg">
                    <div class="nam-modal-header">
                        <div class="nam-modal-title">📁 Browse Folder</div>
                        <button class="nam-btn nam-btn-icon nam-btn-sm nam-btn-secondary" onclick="NodeAppManager.closeModal()">✕</button>
                    </div>
                    <div class="nam-modal-body">
                        <div class="nam-breadcrumb nam-mb-4">
                            <span class="nam-text-mono nam-text-sm nam-text-muted">${h.escape(path)}</span>
                        </div>
                        <div style="max-height:400px;overflow-y:auto">
                            <div class="nam-app-list">
                                <div class="nam-app-item" onclick="NodeAppManager.browseUp('${h.escape(path)}')" style="cursor:pointer">
                                    <span>📁</span>
                                    <div class="nam-app-info">
                                        <div class="nam-app-name">..</div>
                                        <div class="nam-app-meta"><span class="nam-text-xs nam-text-muted">Parent directory</span></div>
                                    </div>
                                    <div></div>
                                </div>
                                ${(items || []).filter(i => i.type === 'directory').map(item => `
                                    <div class="nam-app-item" onclick="NodeAppManager.browseTo('${h.escape(item.path)}')" style="cursor:pointer">
                                        <span>📁</span>
                                        <div class="nam-app-info">
                                            <div class="nam-app-name">${h.escape(item.name)}</div>
                                        </div>
                                        <div></div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="nam-modal-footer">
                        <button class="nam-btn nam-btn-secondary" onclick="NodeAppManager.closeModal()">Cancel</button>
                        <button class="nam-btn nam-btn-primary" onclick="NodeAppManager.selectFolder('${h.escape(path)}')">
                            ✓ Select This Folder
                        </button>
                    </div>
                </div>
            `;
        },
    };

    // ========================================================================
    // Main Application Controller
    // ========================================================================

    const NodeAppManager = {
        // Current browse target
        browseTargetInput: null,

        async init() {
            toast.init();
            this.render(views.loading());
            
            // Load initial data
            await Promise.all([
                this.loadApps(),
                this.loadNodeVersions(),
                this.loadDomains(),
                this.loadSystemInfo(),
            ]);

            this.render(views.dashboard());
            this.startPolling();
        },

        render(html) {
            const container = document.getElementById('nam-content');
            if (container) {
                container.innerHTML = html;
            }
        },

        // ====================================================================
        // Data Loading
        // ====================================================================

        async loadApps() {
            const result = await api.listApps();
            if (result.success) {
                state.apps = result.apps || [];
            }
            return result;
        },

        async loadNodeVersions() {
            const result = await api.getNodeVersions();
            if (result.nvm_versions || result.system_version) {
                state.nodeVersions = result;
            }
        },

        async loadDomains() {
            const result = await api.getDomains();
            if (result.success) {
                state.domains = result.domains || [];
            }
        },

        async loadSystemInfo() {
            const result = await api.getSystemInfo();
            if (result.success) {
                state.systemInfo = result;
            }
        },

        // ====================================================================
        // Navigation
        // ====================================================================

        navigate(view, data) {
            state.currentView = view;

            switch (view) {
                case 'dashboard':
                    this.loadApps().then(() => this.render(views.dashboard()));
                    break;
                case 'detail':
                    state.selectedApp = data;
                    this.render(views.appDetail(data));
                    break;
            }
        },

        async showAppDetail(appName) {
            await this.loadApps();
            const app = state.apps.find(a => a.name === appName);
            if (app) {
                this.navigate('detail', app);
            } else {
                toast.error('App Not Found', `Application "${appName}" not found`);
            }
        },

        // ====================================================================
        // Tab Management
        // ====================================================================

        switchTab(tabName) {
            // Update tab buttons
            document.querySelectorAll('#detail-tabs .nam-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.tab === tabName);
            });

            // Render tab content
            const app = state.selectedApp;
            const tabEl = document.getElementById('tab-content');
            if (!tabEl || !app) return;

            switch (tabName) {
                case 'overview':
                    tabEl.innerHTML = views.tabOverview(app);
                    break;
                case 'env':
                    tabEl.innerHTML = views.tabEnv(app);
                    break;
                case 'logs':
                    tabEl.innerHTML = views.tabLogs(app);
                    this.loadLogs(app.name, 'out');
                    break;
                case 'npm':
                    tabEl.innerHTML = views.tabNpm(app);
                    this.loadNpmScripts(app.name);
                    break;
                case 'settings':
                    tabEl.innerHTML = views.tabSettings(app);
                    break;
            }
        },

        // ====================================================================
        // App CRUD
        // ====================================================================

        showCreateModal() {
            modal.show(modal.createApp());
        },

        async createApp() {
            const name = document.getElementById('create-name')?.value?.trim();
            const root = document.getElementById('create-root')?.value?.trim();
            const startup = document.getElementById('create-startup')?.value?.trim();
            const nodeVersion = document.getElementById('create-node-version')?.value;
            const mode = document.getElementById('create-mode')?.value;
            const appUrl = document.getElementById('create-url')?.value?.trim();

            if (!name || !root || !startup) {
                toast.error('Missing Fields', 'Please fill in all required fields');
                return;
            }

            if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
                toast.error('Invalid Name', 'App name can only contain letters, numbers, hyphens and underscores');
                return;
            }

            const btn = document.getElementById('btn-create-app');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner"></span> Creating...';
            }

            const result = await api.createApp({
                name, root, startup_file: startup,
                node_version: nodeVersion, mode, app_url: appUrl
            });

            if (result.success) {
                toast.success('App Created', `${name} created on port ${result.port}`);
                modal.close();
                await this.loadApps();
                if (state.currentView === 'dashboard') {
                    this.render(views.dashboard());
                }
            } else {
                toast.error('Create Failed', result.error || 'Unknown error');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '🚀 Create Application';
                }
            }
        },

        confirmDelete(appName) {
            modal.show(modal.confirmDelete(appName));
        },

        async deleteApp(appName) {
            modal.close();
            toast.info('Deleting...', `Removing ${appName}`);

            const result = await api.deleteApp(appName);
            if (result.success) {
                toast.success('Deleted', `${appName} has been removed`);
                await this.loadApps();
                this.navigate('dashboard');
            } else {
                toast.error('Delete Failed', result.error);
            }
        },

        // ====================================================================
        // Process Control
        // ====================================================================

        async startApp(appName) {
            toast.info('Starting...', `Starting ${appName}`);
            const result = await api.startApp(appName);
            if (result.success) {
                toast.success('Started', result.message);
            } else {
                toast.error('Start Failed', result.error);
            }
            await this.refreshCurrentView(appName);
        },

        async stopApp(appName) {
            toast.info('Stopping...', `Stopping ${appName}`);
            const result = await api.stopApp(appName);
            if (result.success) {
                toast.success('Stopped', result.message);
            } else {
                toast.error('Stop Failed', result.error);
            }
            await this.refreshCurrentView(appName);
        },

        async restartApp(appName) {
            toast.info('Restarting...', `Restarting ${appName}`);
            const result = await api.restartApp(appName);
            if (result.success) {
                toast.success('Restarted', result.message);
            } else {
                toast.error('Restart Failed', result.error);
            }
            await this.refreshCurrentView(appName);
        },

        async refreshCurrentView(appName) {
            await this.loadApps();
            if (state.currentView === 'detail' && state.selectedApp?.name === appName) {
                const app = state.apps.find(a => a.name === appName);
                if (app) {
                    state.selectedApp = app;
                    this.render(views.appDetail(app));
                }
            } else {
                this.render(views.dashboard());
            }
        },

        // ====================================================================
        // NPM Operations
        // ====================================================================

        async runNpmInstall(appName) {
            toast.info('Running...', 'npm install in progress. This may take a moment...');

            const result = await api.npmInstall(appName);
            if (result.success) {
                toast.success('NPM Install', 'Dependencies installed successfully');
                modal.show(modal.npmOutput('NPM Install Complete', result.output, true));
            } else {
                toast.error('NPM Install Failed', result.error);
                modal.show(modal.npmOutput('NPM Install Failed', result.output || result.error, false));
            }
        },

        async runNpmScript(appName, scriptName) {
            toast.info('Running...', `npm run ${scriptName}`);
            const result = await api.npmRun(appName, scriptName);
            if (result.success) {
                toast.success('Script Complete', `npm run ${scriptName} finished`);
            } else {
                toast.error('Script Failed', result.error);
            }
            modal.show(modal.npmOutput(`npm run ${scriptName}`, result.output, result.success));
        },

        async loadNpmScripts(appName) {
            const result = await api.npmScripts(appName);
            const container = document.getElementById('npm-scripts-list');
            if (!container) return;

            if (result.success && result.scripts) {
                const entries = Object.entries(result.scripts);
                if (entries.length === 0) {
                    container.innerHTML = `
                        <div class="nam-text-muted nam-text-center" style="padding:var(--space-6)">
                            No scripts found in package.json
                        </div>
                    `;
                    return;
                }

                container.innerHTML = `
                    <table class="nam-table">
                        <thead>
                            <tr>
                                <th>Script</th>
                                <th>Command</th>
                                <th style="text-align:right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${entries.map(([name, cmd]) => `
                                <tr>
                                    <td><span class="nam-text-mono" style="color:var(--color-primary-light)">${h.escape(name)}</span></td>
                                    <td><span class="nam-text-mono nam-text-xs">${h.escape(cmd)}</span></td>
                                    <td style="text-align:right">
                                        <button class="nam-btn nam-btn-secondary nam-btn-sm" 
                                                onclick="NodeAppManager.runNpmScript('${h.escape(appName)}', '${h.escape(name)}')">
                                            ▶ Run
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                container.innerHTML = `
                    <div class="nam-text-muted nam-text-center" style="padding:var(--space-6)">
                        Could not load scripts. Make sure package.json exists.
                    </div>
                `;
            }
        },

        // ====================================================================
        // Logs
        // ====================================================================

        async loadLogs(appName, type = 'out') {
            // Update button states
            const btnOut = document.getElementById('btn-log-out');
            const btnErr = document.getElementById('btn-log-error');
            if (btnOut) btnOut.classList.toggle('active', type === 'out');
            if (btnErr) btnErr.classList.toggle('active', type === 'error');

            const result = await api.getLogs(appName, type, CONFIG.maxLogLines);
            const logEl = document.getElementById('log-output');
            if (!logEl) return;

            if (result.success) {
                logEl.innerHTML = result.logs 
                    ? h.colorizeLog(h.escape(result.logs))
                    : '<span class="nam-text-muted">No logs available.</span>';
                logEl.scrollTop = logEl.scrollHeight;
            } else {
                logEl.innerHTML = `<span class="log-error">Error loading logs: ${h.escape(result.error)}</span>`;
            }
        },

        async clearAppLogs(appName) {
            const result = await api.clearLogs(appName);
            if (result.success) {
                toast.success('Logs Cleared', 'Application logs have been cleared');
                this.loadLogs(appName, 'out');
            } else {
                toast.error('Clear Failed', result.error);
            }
        },

        // ====================================================================
        // Environment Variables
        // ====================================================================

        addEnvRow() {
            const editor = document.getElementById('env-editor');
            if (!editor) return;

            const row = document.createElement('div');
            row.className = 'nam-env-row';
            row.innerHTML = `
                <input type="text" class="nam-input env-key" value="" placeholder="KEY_NAME">
                <input type="text" class="nam-input env-value" value="" placeholder="value">
                <button class="nam-btn nam-btn-danger nam-btn-icon nam-btn-sm" onclick="this.closest('.nam-env-row').remove()">✕</button>
            `;
            editor.appendChild(row);
            row.querySelector('.env-key').focus();
        },

        async saveEnvVars(appName) {
            const editor = document.getElementById('env-editor');
            if (!editor) return;

            const envVars = {};
            const rows = editor.querySelectorAll('.nam-env-row[data-env-row], .nam-env-row:not(:first-child)');
            
            rows.forEach(row => {
                const key = row.querySelector('.env-key')?.value?.trim();
                const value = row.querySelector('.env-value')?.value || '';
                if (key) {
                    envVars[key] = value;
                }
            });

            const result = await api.saveEnv(appName, envVars);
            if (result.success) {
                toast.success('Saved', result.message);
                // Update local state
                if (state.selectedApp) {
                    state.selectedApp.env_vars = envVars;
                }
            } else {
                toast.error('Save Failed', result.error);
            }
        },

        // ====================================================================
        // Settings
        // ====================================================================

        async updateSetting(appName, field, value) {
            const result = await api.updateConfig(appName, field, value);
            if (result.success) {
                toast.success('Updated', `${field} updated. Restart to apply.`);
                // Update local state
                if (state.selectedApp) {
                    state.selectedApp[field] = value;
                }
            } else {
                toast.error('Update Failed', result.error);
            }
        },

        // ====================================================================
        // Folder Browser
        // ====================================================================

        async browseFolder(inputId) {
            this.browseTargetInput = inputId;
            const currentPath = document.getElementById(inputId)?.value || state.systemInfo.home || '/home';
            
            const result = await api.browse(currentPath || state.systemInfo.home);
            if (result.success) {
                modal.show(modal.folderBrowser(result.path, result.items));
            } else {
                // Fallback to home
                const homeResult = await api.browse(state.systemInfo.home || '/home');
                if (homeResult.success) {
                    modal.show(modal.folderBrowser(homeResult.path, homeResult.items));
                } else {
                    toast.error('Browse Error', result.error);
                }
            }
        },

        async browseTo(path) {
            const result = await api.browse(path);
            if (result.success) {
                modal.show(modal.folderBrowser(result.path, result.items));
            } else {
                toast.error('Browse Error', result.error);
            }
        },

        async browseUp(currentPath) {
            const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
            await this.browseTo(parent);
        },

        selectFolder(path) {
            if (this.browseTargetInput) {
                const input = document.getElementById(this.browseTargetInput);
                if (input) {
                    input.value = path;
                }
            }
            modal.close();
        },

        // ====================================================================
        // Modal
        // ====================================================================

        closeModal() {
            modal.close();
        },

        // ====================================================================
        // Polling
        // ====================================================================

        startPolling() {
            this.stopPolling();
            state.pollTimer = setInterval(async () => {
                await this.loadApps();
                // Only refresh dashboard view silently
                if (state.currentView === 'dashboard') {
                    // Update stats without full re-render to avoid flicker
                    const statCards = document.querySelectorAll('.nam-stat-value');
                    if (statCards.length >= 4) {
                        const running = state.apps.filter(a => a.live_status === 'online').length;
                        const stopped = state.apps.filter(a => a.live_status !== 'online').length;
                        const totalMem = state.apps.reduce((sum, a) => sum + (a.live_memory || 0), 0);
                        statCards[0].textContent = state.apps.length;
                        statCards[1].textContent = running;
                        statCards[2].textContent = stopped;
                        statCards[3].textContent = h.formatBytes(totalMem);
                    }
                }
            }, CONFIG.pollInterval);
        },

        stopPolling() {
            if (state.pollTimer) {
                clearInterval(state.pollTimer);
                state.pollTimer = null;
            }
        },
    };

    // ========================================================================
    // Expose to global scope
    // ========================================================================
    window.NodeAppManager = NodeAppManager;

    // ========================================================================
    // Auto-init when DOM is ready
    // ========================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => NodeAppManager.init());
    } else {
        NodeAppManager.init();
    }

})();
