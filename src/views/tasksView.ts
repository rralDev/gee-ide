import * as vscode from 'vscode';

export class TasksView {
    public get isCreated(): boolean { return !!this.panel; }
    private panel: vscode.WebviewPanel | undefined;
    private messageCallback: ((message: any) => void) | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    public onMessage(callback: (message: any) => void) {
        this.messageCallback = callback;
    }

    public findExistingTab(): { tab: vscode.Tab; group: vscode.TabGroup } | undefined {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputWebview) {
                    const vt = tab.input.viewType || '';
                    const label = tab.label || '';
                    if (vt.includes('geeTasks') || vt.includes('geeAI') || label.includes('GEE Tasks') || label.includes('GEE Tools')) {
                        return { tab, group };
                    }
                }
            }
        }
        return undefined;
    }

    public async show(column: vscode.ViewColumn = vscode.ViewColumn.Four, preserveFocus: boolean = true) {
        if (this.panel) {
            this.panel.reveal(column !== undefined ? column : this.panel.viewColumn, preserveFocus);
            return;
        }

        await this.closeExistingTabs();

        this.panel = vscode.window.createWebviewPanel(
            'geeTasks',
            'GEE Tasks & Assets',
            { viewColumn: column, preserveFocus },
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getHtml();
        this.panel.webview.onDidReceiveMessage(message => {
            if (this.messageCallback) this.messageCallback(message);
        }, undefined, this.context.subscriptions);

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, null, this.context.subscriptions);
    }

    public dispose() {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }

    public async closeExistingTabs(keepPanel?: vscode.WebviewPanel) {
        try {
            const tabsToClose: vscode.Tab[] = [];
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputWebview) {
                        const vt = tab.input.viewType || '';
                        const label = tab.label || '';
                        if (vt.includes('geeTasks') || vt.includes('geeAI') || label.includes('GEE Tasks') || label.includes('GEE Tools')) {
                            if (keepPanel && this.panel === keepPanel && tab.isActive) {
                                continue;
                            }
                            tabsToClose.push(tab);
                        }
                    }
                }
            }
            if (tabsToClose.length > 0) {
                await vscode.window.tabGroups.close(tabsToClose);
            }
        } catch (e) {}
    }

    public sendMessage(message: any) {
        if (this.panel) {
            this.panel.webview.postMessage(message);
        }
    }

    public focus() {
        if (this.panel) {
            this.panel.reveal(this.panel.viewColumn, false);
            this.panel.webview.postMessage({ command: 'focus' });
        }
    }

    public attachPanel(panel: vscode.WebviewPanel) {
        if (this.panel && this.panel !== panel) {
            this.panel.dispose();
        }
        this.panel = panel;
        this.panel.webview.options = {
            enableScripts: true
        };
        this.panel.webview.onDidReceiveMessage(message => {
            if (this.messageCallback) this.messageCallback(message);
        }, undefined, this.context.subscriptions);
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, null, this.context.subscriptions);
        this.panel.webview.html = this.getHtml();
    }

    private getHtml() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>GEE Tasks & Assets</title>
                <style>
                    body { 
                        background-color: var(--vscode-editor-background, #1e1e1e); 
                        color: var(--vscode-editor-foreground, #d4d4d4); 
                        font-family: var(--vscode-font-family, sans-serif); 
                        display: flex; flex-direction: column; height: 100vh; margin: 0; padding: 0; box-sizing: border-box; 
                    }
                    .tabs { display: flex; background-color: var(--vscode-editorWidget-background, #252526); border-bottom: 1px solid var(--vscode-panel-border, #333); }
                    .tab { padding: 8px 15px; cursor: pointer; color: var(--vscode-tab-inactiveForeground, #969696); border-bottom: 2px solid transparent; font-size: 13px; flex: 1; text-align: center; user-select: none; }
                    .tab:hover { color: var(--vscode-tab-hoverForeground, #d4d4d4); background-color: var(--vscode-tab-hoverBackground, transparent); }
                    .tab.active { color: var(--vscode-tab-activeForeground, #fff); border-bottom: 2px solid var(--vscode-panelTitle-activeBorder, #007acc); background-color: var(--vscode-tab-activeBackground, transparent); font-weight: 500; }
                    .content { flex: 1; overflow-y: auto; padding: 10px; display: none; }
                    .content.active { display: flex; flex-direction: column; }
                    
                    button { background-color: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, white); border: none; padding: 6px 12px; cursor: pointer; border-radius: 3px; font-size: 12px; }
                    button:hover { background-color: var(--vscode-button-hoverBackground, #005f9e); }

                    /* Tasks specific */
                    .task-list { display: flex; flex-direction: column; gap: 8px; }
                    .task-item { background-color: var(--vscode-editorWidget-background, #2d2d2d); border-left: 3px solid var(--vscode-widget-border, #555); padding: 8px 12px; border-radius: 4px; font-size: 12px; position: relative; }
                    .task-item.running { border-color: var(--vscode-charts-blue, #007acc); }
                    .task-item.completed { border-color: var(--vscode-charts-green, #4ec9b0); }
                    .task-item.failed { border-color: var(--vscode-charts-red, #f14c4c); }
                    .task-item.ready { border-color: var(--vscode-charts-yellow, #cca700); }
                    .task-title { font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; }
                    .task-meta { color: var(--vscode-descriptionForeground, #888); font-size: 11px; }
                    .task-action-btn { display: none; font-size: 11px; cursor: pointer; background: transparent; color: var(--vscode-icon-foreground, #ccc); border: 1px solid var(--vscode-button-secondaryBorder, transparent); padding: 3px 6px; border-radius: 3px; }
                    .task-action-btn:hover { background-color: var(--vscode-button-secondaryHoverBackground, #444); color: var(--vscode-button-secondaryForeground, white); border-color: var(--vscode-button-secondaryBorder, #777); }
                    .cancel-btn:hover { background-color: var(--vscode-errorForeground, #f14c4c); color: white; }
                    .task-item:hover .task-action-btn { display: block; }
                    
                    /* Assets Tree specific */
                    details.asset-details > summary { list-style: none; }
                    details.asset-details > summary::-webkit-details-marker { display: none; }
                    
                    .tree-item { 
                        display: flex; justify-content: space-between; align-items: center; 
                        padding: 3px 4px; cursor: pointer; border-radius: 3px; 
                        font-family: var(--vscode-editor-font-family, sans-serif);
                        font-size: 13px;
                        color: var(--vscode-editor-foreground);
                        border: 1px solid transparent;
                    }
                    .tree-item:hover { background-color: var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31)); }
                    .tree-item.selected { background-color: var(--vscode-list-activeSelectionBackground, rgba(0, 120, 215, 0.35)); outline: 1px solid var(--vscode-focusBorder, #007acc); }
                    .tree-title { display: flex; align-items: center; gap: 6px; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
                    .tree-icon { font-size: 14px; width: 16px; text-align: center; }
                    .tree-meta { display: flex; align-items: center; gap: 8px; }
                    .tree-type { color: var(--vscode-descriptionForeground, #888); font-size: 10px; text-transform: uppercase; }
                    .tree-item:hover .task-action-btn { display: block; }
                    
                    .folder-chevron { display: inline-block; width: 14px; font-size: 10px; color: var(--vscode-icon-foreground); text-align: center; }
                    details.asset-details[open] > summary .folder-chevron { transform: rotate(90deg); }
                </style>
            </head>
            <body>
                <div class="tabs">
                    <div class="tab active" onclick="switchTab('tasks')">⏳ Tasks</div>
                    <div class="tab" onclick="switchTab('assets')">🗂️ Assets</div>
                </div>
                
                <div id="tasks" class="content active">
                    <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; font-weight: bold;">Export Tasks</span>
                        <button onclick="refreshTasks()" style="background: var(--vscode-button-secondaryBackground, #333); color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid var(--vscode-contrastBorder, #555); padding: 4px 8px; font-size: 11px; border-radius: 3px; cursor: pointer;">🔄 Refresh</button>
                    </div>
                    <div class="task-list" id="task-list">
                        <div style="color: #888; font-size: 12px; font-style: italic;">Loading tasks...</div>
                    </div>
                </div>

                <div id="assets" class="content">
                    <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; font-weight: bold;">Assets Manager</span>
                        <div style="display: flex; gap: 6px;">
                            <button onclick="vscode.postMessage({command: 'addProject'})" style="background: var(--vscode-button-secondaryBackground, #333); color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid var(--vscode-contrastBorder, #555); padding: 4px 8px; font-size: 11px; border-radius: 3px; cursor: pointer;" title="Agregar Cloud Project o Legacy Asset">➕ Add Project</button>
                            <button onclick="vscode.postMessage({command: 'createFolder'})" style="background: var(--vscode-button-secondaryBackground, #333); color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid var(--vscode-contrastBorder, #555); padding: 4px 8px; font-size: 11px; border-radius: 3px; cursor: pointer;" title="Nueva Carpeta">📁+</button>
                            <button onclick="refreshAssets()" style="background: var(--vscode-button-secondaryBackground, #333); color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid var(--vscode-contrastBorder, #555); padding: 4px 8px; font-size: 11px; border-radius: 3px; cursor: pointer;" title="Refrescar">🔄 Refresh</button>
                        </div>
                    </div>
                    <div class="task-list" id="assets-list">
                        <div style="color: #888; font-size: 12px; font-style: italic;">Click Refresh to load assets...</div>
                    </div>
                </div>

                <script>
                    let vscode;
                    try {
                        vscode = acquireVsCodeApi();
                    } catch (e) {
                        vscode = window.__vscodeApi;
                    }
                    window.__vscodeApi = vscode;

                    function switchTab(id) {
                        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                        document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
                        event.target.classList.add('active');
                        document.getElementById(id).classList.add('active');
                        if (id === 'tasks') {
                            refreshTasks();
                        } else if (id === 'assets') {
                            const list = document.getElementById('assets-list');
                            if (!list || !list.children.length || list.innerText.includes('Click Refresh')) {
                                refreshAssets();
                            }
                        }
                    }

                    // --- TASKS LOGIC ---
                    function refreshTasks() {
                        const list = document.getElementById('task-list');
                        list.innerHTML = '<div style="color: #888; font-size: 12px; font-style: italic;">Loading tasks...</div>';
                        vscode.postMessage({ command: 'getTasks' });
                    }

                    function copyText(text) {
                        vscode.postMessage({ command: 'copyToClipboard', text: text });
                    }
                    function insertText(text) {
                        vscode.postMessage({ command: 'insertInEditor', text: text });
                    }
                    function openUrl(url) {
                        vscode.postMessage({ command: 'openExternal', url: url });
                    }

                    function cancelTask(taskId) {
                        vscode.postMessage({ command: 'cancelTask', taskId: taskId });
                    }

                    function renderTasks(tasksData) {
                        const list = document.getElementById('task-list');
                        list.innerHTML = '';
                        
                        if (tasksData && tasksData.error) {
                            if (tasksData.error === 'not_initialized') {
                                list.innerHTML = '<div style="color: var(--vscode-charts-yellow); font-size: 12px; padding: 10px; border: 1px solid var(--vscode-charts-yellow); background: var(--vscode-editorWidget-background); border-radius: 4px;">⚠️ GEE no está inicializado. Por favor corre un script o inicia el Workspace primero para ver tus tareas.</div>';
                            } else {
                                list.innerHTML = '<div style="color: var(--vscode-charts-red); font-size: 12px; padding: 4px 10px;">Error: ' + tasksData.error + '</div>';
                            }
                            return;
                        }

                        let tasks = tasksData;
                        if (tasksData && Array.isArray(tasksData.tasks)) {
                            tasks = tasksData.tasks;
                        }

                        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
                            list.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 12px; font-style: italic; padding: 2px 20px;">No recent tasks found.</div>';
                            return;
                        }
                        
                        // Render top 30 tasks in compact tree-item style
                        tasks.slice(0, 30).forEach(t => {
                            const div = document.createElement('div');
                            div.className = 'tree-item';
                            div.tabIndex = 0;
                            
                            let stateColor = 'var(--vscode-descriptionForeground)';
                            let icon = '⏳';
                            if (t.state === 'RUNNING') { stateColor = 'var(--vscode-charts-blue)'; icon = '🔄'; }
                            else if (t.state === 'COMPLETED') { stateColor = 'var(--vscode-charts-green)'; icon = '✅'; }
                            else if (t.state === 'FAILED') { stateColor = 'var(--vscode-charts-red)'; icon = '❌'; }
                            else if (t.state === 'READY') { stateColor = 'var(--vscode-charts-yellow)'; icon = '⏳'; }
                            
                            const desc = String(t.description || t.id || 'Task');
                            let duration = '';
                            if (t.update_timestamp_ms && t.creation_timestamp_ms) {
                                let min = Math.round((t.update_timestamp_ms - t.creation_timestamp_ms) / 60000);
                                if (t.state === 'RUNNING') {
                                    min = Math.round((Date.now() - t.creation_timestamp_ms) / 60000);
                                }
                                duration = min > 0 ? (' (' + min + 'm)') : ' (<1m)';
                            }

                            let actionsHTML = '';
                            if (t.state === 'RUNNING' || t.state === 'READY') {
                                actionsHTML += '<button class="task-action-btn cancel-btn" title="Cancelar Tarea" onclick="event.preventDefault(); event.stopPropagation(); cancelTask(&apos;' + t.id + '&apos;)">🛑</button>';
                            }
                            if (t.state === 'COMPLETED' && t.task_type === 'EXPORT_IMAGE') {
                                const searchUrl = 'https://drive.google.com/drive/search?q=' + encodeURIComponent(desc);
                                actionsHTML += '<button class="task-action-btn" title="Buscar en Google Drive" onclick="event.preventDefault(); event.stopPropagation(); openUrl(&apos;' + searchUrl + '&apos;)">📁</button>';
                            }
                            actionsHTML += '<button class="task-action-btn" title="Copiar ID" onclick="event.preventDefault(); event.stopPropagation(); copyText(&apos;' + t.id + '&apos;)">📋</button>';
                            
                            if (t.state === 'FAILED' && t.error_message) {
                                const errorMsg = String(t.error_message).split(String.fromCharCode(10)).join(' ').split(String.fromCharCode(13)).join(' ').split(String.fromCharCode(39)).join('').split(String.fromCharCode(34)).join('');
                                actionsHTML += '<button class="task-action-btn" title="Copiar Error" onclick="event.preventDefault(); event.stopPropagation(); copyText(&apos;' + errorMsg + '&apos;)">⚠️</button>';
                            }

                            div.innerHTML = 
                                '<div class="tree-title">' +
                                    '<span class="tree-icon">' + icon + '</span>' +
                                    '<span title="' + desc + ' (' + t.id + ')">' + desc + '</span>' +
                                '</div>' +
                                '<div class="tree-meta">' +
                                    '<span class="tree-type" style="color: ' + stateColor + '">' + t.state + duration + '</span>' +
                                    actionsHTML +
                                '</div>';
                            list.appendChild(div);
                        });
                    }

                    // --- ASSETS LOGIC ---
                    function refreshAssets() {
                        const list = document.getElementById("assets-list");
                        list.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 12px; font-style: italic; padding: 4px 10px;">Loading assets...</div>';
                        vscode.postMessage({ command: 'getAssets', parent: '~' });
                    }

                    function formatBytes(bytes) {
                        if (!bytes || isNaN(bytes)) return '0 B';
                        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                        let i = 0;
                        let val = bytes;
                        while (val >= 1024 && i < units.length - 1) {
                            val /= 1024;
                            i++;
                        }
                        return val.toFixed(1) + ' ' + units[i];
                    }

                    function buildQuotaHtml(q) {
                        if (!q || !q.limitBytes) return '';
                        const pct = Math.min(100, Math.round((q.usageBytes / q.limitBytes) * 100));
                        let barColor = 'var(--vscode-charts-green, #4ec9b0)';
                        if (pct > 80) barColor = 'var(--vscode-charts-red, #f14c4c)';
                        else if (pct > 60) barColor = 'var(--vscode-charts-yellow, #cca700)';

                        return '<span style="display:inline-flex; align-items:center; gap:6px; font-size:10px; color:var(--vscode-descriptionForeground); font-family:var(--vscode-editor-font-family);">' +
                            '<span style="display:inline-block; width:45px; height:5px; background:rgba(128,128,128,0.25); border-radius:3px; overflow:hidden; vertical-align:middle;">' +
                                '<span style="display:block; height:100%; width:' + pct + '%; background:' + barColor + ';"></span>' +
                            '</span>' +
                            '<span>' + formatBytes(q.usageBytes) + ' / ' + formatBytes(q.limitBytes) + ' (' + pct + '%)</span>' +
                        '</span>';
                    }

                    function renderAssets(data) {
                        const list = document.getElementById("assets-list");
                        if (!data) return;

                        if (data.error) {
                            if (data.error === 'not_initialized') {
                                list.innerHTML = '<div style="color: var(--vscode-charts-yellow); font-size: 12px; padding: 10px; border: 1px solid var(--vscode-charts-yellow); background: var(--vscode-editorWidget-background); border-radius: 4px;">⚠️ GEE no está autenticado. Presiona Cmd+Shift+P -> "GEE IDE: Login with Google"</div>';
                            } else {
                                list.innerHTML = '<div style="color: var(--vscode-charts-red); font-size: 12px; padding: 4px 10px;">Error: ' + data.error + '</div>';
                            }
                            return;
                        }

                        const assets = data.assets || [];
                        const parent = data.parent || '~';

                        if (parent === '~') {
                            list.innerHTML = '';
                            if (assets.length === 0) {
                                list.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 12px; font-style: italic; padding: 4px 10px;">No asset roots found. Click "Add Project" to add your GCP Project or legacy folder.</div>';
                                return;
                            }
                            assets.forEach(root => {
                                const details = document.createElement('details');
                                details.className = 'asset-details';
                                details.dataset.folderId = root.id;

                                const summary = document.createElement('summary');
                                summary.className = 'tree-item';
                                summary.tabIndex = 0;

                                const icon = root.category === 'CLOUD' ? '☁️' : '📁';
                                const badge = root.category === 'CLOUD' ? '<span style="font-size:9px; padding:1px 4px; border-radius:3px; background:rgba(0,122,204,0.25); color:var(--vscode-charts-blue); margin-left:4px;">GCP</span>' : '';
                                const safeId = root.id.replace(/[^a-zA-Z0-9_-]/g, '-');

                                summary.innerHTML = 
                                    '<div class="tree-title">' +
                                        '<span class="folder-chevron">▶</span>' +
                                        '<span class="tree-icon">' + icon + '</span>' +
                                        '<span title="' + root.id + '">' + root.name + '</span>' +
                                        badge +
                                    '</div>' +
                                    '<div class="tree-meta">' +
                                        '<span id="quota-' + safeId + '">' + (root.quota ? buildQuotaHtml(root.quota) : '') + '</span>' +
                                        '<button class="task-action-btn" title="Copiar ID de Raíz" onclick="event.preventDefault(); event.stopPropagation(); copyText(&apos;' + root.id + '&apos;)">📋</button>' +
                                    '</div>';

                                const childContainer = document.createElement('div');
                                childContainer.style.paddingLeft = '16px';
                                childContainer.className = 'child-container';

                                details.appendChild(summary);
                                details.appendChild(childContainer);

                                details.addEventListener('toggle', () => {
                                    if (details.open && !childContainer.dataset.loaded) {
                                        childContainer.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 11px; padding: 2px 4px; font-style: italic;">Loading...</div>';
                                        vscode.postMessage({ command: 'getAssets', parent: root.id });
                                        if (!root.quota) {
                                            vscode.postMessage({ command: 'getAssetQuota', rootId: root.id });
                                        }
                                    }
                                });

                                list.appendChild(details);
                            });
                            return;
                        }

                        // Populate child container
                        const parentDetails = document.querySelector('details.asset-details[data-folder-id="' + parent + '"]');
                        if (!parentDetails) return;
                        const container = parentDetails.querySelector('.child-container');
                        if (!container) return;

                        container.dataset.loaded = 'true';
                        container.innerHTML = '';

                        if (assets.length === 0) {
                            container.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 11px; padding: 2px 4px; font-style: italic;">(Empty folder)</div>';
                            return;
                        }

                        assets.forEach(asset => {
                            if (asset.type === 'FOLDER' || asset.type === 'IMAGE_COLLECTION') {
                                const details = document.createElement('details');
                                details.className = 'asset-details';
                                details.dataset.folderId = asset.id;

                                const summary = document.createElement('summary');
                                summary.className = 'tree-item';
                                summary.tabIndex = 0;

                                const icon = asset.type === 'FOLDER' ? '📁' : '🗂️';
                                const typeLabel = asset.type === 'FOLDER' ? 'Folder' : 'ImageCollection';

                                summary.innerHTML = 
                                    '<div class="tree-title">' +
                                        '<span class="folder-chevron">▶</span>' +
                                        '<span class="tree-icon">' + icon + '</span>' +
                                        '<span title="' + asset.id + '">' + asset.name + '</span>' +
                                    '</div>' +
                                    '<div class="tree-meta">' +
                                        '<span class="tree-type">' + typeLabel + '</span>' +
                                        '<button class="task-action-btn" title="Insertar en Editor" onclick="event.preventDefault(); event.stopPropagation(); insertText(&apos;&quot;' + asset.id + '&quot;&apos;)">📥</button>' +
                                        '<button class="task-action-btn" title="Copiar ID" onclick="event.preventDefault(); event.stopPropagation(); copyText(&apos;' + asset.id + '&apos;)">📋</button>' +
                                        '<button class="task-action-btn cancel-btn" title="Eliminar Carpeta" onclick="event.preventDefault(); event.stopPropagation(); deleteAsset(&apos;' + asset.id + '&apos;)">🗑️</button>' +
                                    '</div>';

                                const childCont = document.createElement('div');
                                childCont.style.paddingLeft = '16px';
                                childCont.className = 'child-container';

                                details.appendChild(summary);
                                details.appendChild(childCont);

                                details.addEventListener('toggle', () => {
                                    if (details.open && !childCont.dataset.loaded) {
                                        childCont.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 11px; padding: 2px 4px; font-style: italic;">Loading...</div>';
                                        vscode.postMessage({ command: 'getAssets', parent: asset.id });
                                    }
                                });

                                container.appendChild(details);
                            } else {
                                const div = document.createElement('div');
                                div.className = 'tree-item';
                                div.tabIndex = 0;

                                let icon = '📄';
                                let typeLabel = asset.type || 'Asset';
                                if (asset.type === 'IMAGE') { icon = '🛰️'; typeLabel = 'Image'; }
                                else if (asset.type === 'TABLE') { icon = '📊'; typeLabel = 'Table'; }

                                div.innerHTML = 
                                    '<div class="tree-title">' +
                                        '<span style="display:inline-block; width:14px;"></span>' +
                                        '<span class="tree-icon">' + icon + '</span>' +
                                        '<span title="' + asset.id + '">' + asset.name + '</span>' +
                                    '</div>' +
                                    '<div class="tree-meta">' +
                                        '<span class="tree-type">' + typeLabel + '</span>' +
                                        '<button class="task-action-btn" title="Ver Detalles y Metadatos" onclick="event.preventDefault(); event.stopPropagation(); inspectAsset(&apos;' + asset.id + '&apos;)">ℹ️</button>' +
                                        '<button class="task-action-btn" title="Insertar en Editor" onclick="event.preventDefault(); event.stopPropagation(); insertText(&apos;&quot;' + asset.id + '&quot;&apos;)">📥</button>' +
                                        '<button class="task-action-btn" title="Copiar ID" onclick="event.preventDefault(); event.stopPropagation(); copyText(&apos;' + asset.id + '&apos;)">📋</button>' +
                                        '<button class="task-action-btn cancel-btn" title="Eliminar Asset" onclick="event.preventDefault(); event.stopPropagation(); deleteAsset(&apos;' + asset.id + '&apos;)">🗑️</button>' +
                                    '</div>';

                                container.appendChild(div);
                            }
                        });
                    }

                    function inspectAsset(id) {
                        vscode.postMessage({ command: 'getAssetDetails', assetId: id });
                    }

                    function deleteAsset(id) {
                        if (confirm('¿Estás seguro de eliminar el asset?\\n\\n' + id + '\\n\\nEsta acción no se puede deshacer.')) {
                            vscode.postMessage({ command: 'deleteAsset', assetId: id });
                        }
                    }

                    // --- MESSAGES FROM EXTENSION ---
                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        if (message.command === 'focus') {
                            refreshTasks();
                        } else if (message.command === 'taskStarting') {
                            const list = document.getElementById('task-list');
                            if (list) {
                                const desc = message.description || 'Export Task';
                                const existingTemp = document.getElementById('temp-task-item');
                                if (existingTemp) existingTemp.remove();
                                const tempDiv = document.createElement('div');
                                tempDiv.className = 'tree-item';
                                tempDiv.id = 'temp-task-item';
                                tempDiv.innerHTML = 
                                    '<div class="tree-title">' +
                                        '<span class="tree-icon">🔄</span>' +
                                        '<span style="font-weight: 500; color: var(--vscode-charts-yellow);">' + desc + '</span>' +
                                    '</div>' +
                                    '<div class="tree-meta">' +
                                        '<span class="tree-type" style="color: var(--vscode-charts-yellow);">Enviando a GEE...</span>' +
                                    '</div>';
                                list.insertBefore(tempDiv, list.firstChild);
                            }
                        } else if (message.command === 'tasksData') {
                            renderTasks(message.tasks || message);
                        } else if (message.command === 'assetsData') {
                            renderAssets(message);
                        } else if (message.command === 'assetQuota') {
                            const safeId = (message.id || '').replace(/[^a-zA-Z0-9_-]/g, '-');
                            const slot = document.getElementById('quota-' + safeId);
                            if (slot && message.quota) {
                                slot.innerHTML = buildQuotaHtml(message.quota);
                                const parentItem = slot.parentElement;
                                if (parentItem) {
                                    const titleEl = parentItem.querySelector('.tree-title');
                                    if (titleEl) {
                                        titleEl.style.flex = '0 1 auto';
                                        titleEl.style.maxWidth = '220px';
                                        titleEl.style.minWidth = '60px';
                                    }
                                }
                            }
                        } else if (message.command === 'assetDeleted') {
                            refreshAssets();
                        }
                    });

                    // Initial fetch
                    refreshTasks();
                    refreshAssets();
                </script>
            </body>
            </html>
        `;
    }
}

// Backward-compatibility alias so any reference doesn't break
export { TasksView as AIView };
