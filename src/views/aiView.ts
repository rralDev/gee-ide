import * as vscode from 'vscode';

export class AIView {
    public get isCreated(): boolean { return !!this.panel; }
    private panel: vscode.WebviewPanel | undefined;
    private messageCallback: ((message: any) => void) | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    public onMessage(callback: (message: any) => void) {
        this.messageCallback = callback;
    }

    public async show(column: vscode.ViewColumn = vscode.ViewColumn.Four, preserveFocus: boolean = true) {
        if (this.panel) {
            this.panel.reveal(column, preserveFocus);
        } else {
            await this.closeExistingTabs();

            this.panel = vscode.window.createWebviewPanel(
                'geeAI',
                'GEE Tools',
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
    }

    public dispose() {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }

    private async closeExistingTabs() {
        try {
            const tabsToClose: vscode.Tab[] = [];
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'geeAI') {
                        tabsToClose.push(tab);
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
            this.panel.reveal();
            this.panel.webview.postMessage({ command: 'focus' });
        } else {
            this.show();
            setTimeout(() => {
                if (this.panel) {
                    this.panel.webview.postMessage({ command: 'focus' });
                }
            }, 250);
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
                <title>GEE Tools</title>
                <style>
                    body { 
                        background-color: var(--vscode-editor-background, #1e1e1e); 
                        color: var(--vscode-editor-foreground, #d4d4d4); 
                        font-family: var(--vscode-font-family, sans-serif); 
                        display: flex; flex-direction: column; height: 100vh; margin: 0; padding: 0; box-sizing: border-box; 
                    }
                    .tabs { display: flex; background-color: var(--vscode-editorWidget-background, #252526); border-bottom: 1px solid var(--vscode-panel-border, #333); }
                    .tab { padding: 8px 15px; cursor: pointer; color: var(--vscode-tab-inactiveForeground, #969696); border-bottom: 2px solid transparent; font-size: 13px; flex: 1; text-align: center; }
                    .tab:hover { color: var(--vscode-tab-hoverForeground, #d4d4d4); background-color: var(--vscode-tab-hoverBackground, transparent); }
                    .tab.active { color: var(--vscode-tab-activeForeground, #fff); border-bottom: 2px solid var(--vscode-panelTitle-activeBorder, #007acc); background-color: var(--vscode-tab-activeBackground, transparent); }
                    .content { flex: 1; overflow-y: auto; padding: 10px; display: none; }
                    .content.active { display: flex; flex-direction: column; }
                    
                    /* AI specific */
                    .chat-container { flex: 1; overflow-y: auto; margin-bottom: 10px; }
                    .input-container { display: flex; gap: 5px; }
                    input[type="text"] { flex: 1; background-color: var(--vscode-input-background, #333); border: 1px solid var(--vscode-input-border, #555); color: var(--vscode-input-foreground, white); padding: 8px; border-radius: 4px; }
                    input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder, #007acc); }
                    button { background-color: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, white); border: none; padding: 8px 15px; cursor: pointer; border-radius: 4px; }
                    button:hover { background-color: var(--vscode-button-hoverBackground, #005f9e); }
                    .msg { margin-bottom: 10px; padding: 8px; border-radius: 4px; font-size: 13px; }
                    .ai { background-color: var(--vscode-editorWidget-background, #2d2d2d); border-left: 3px solid var(--vscode-textLink-foreground, #007acc); }
                    .user { background-color: var(--vscode-editorWidget-background, #3d3d3d); text-align: right; }

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
                    <div class="tab" onclick="switchTab('ai')">🧠 AI</div>
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

                <div id="ai" class="content">
                    <div class="chat-container" id="chat">
                        <div class="msg ai">
                            <strong>GEE IDE Assistant (WIP)</strong><br>
                            Hello! I am your geospatial AI assistant.<br><br>
                            <em>Note: The AI engine is currently in active development. We are designing a smart system to cascade through free AI APIs and support local LLM execution!</em>
                        </div>
                    </div>
                    <div class="input-container">
                        <input type="text" id="input" placeholder="e.g. How to calculate NDVI?..." />
                        <button id="send">Send</button>
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

                    function cancelTask(taskId) {
                        vscode.postMessage({ command: 'cancelTask', taskId: taskId });
                        setTimeout(refreshTasks, 1000);
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
                        vscode.postMessage({ command: "getAssets", parent: "~", refresh: true });
                    }

                    function deleteAsset(id) {
                        vscode.postMessage({ command: "deleteAsset", assetId: id });
                    }

                    function onFolderToggle(detailsEl, path) {
                        if (detailsEl.open && !detailsEl.dataset.loaded) {
                            detailsEl.dataset.loaded = "true";
                            vscode.postMessage({ command: "getAssets", parent: path });
                        }
                    }

                    let selectedAssetData = null;
                    function selectAsset(el, id, isFolder, safeId) {
                        document.querySelectorAll('.tree-item.selected').forEach(x => x.classList.remove('selected'));
                        if (el) el.classList.add('selected');
                        selectedAssetData = { id: id, isFolder: isFolder, safeId: safeId };
                    }

                    function buildQuotaHtml(q) {
                        if (!q) return '';
                        const useMb = (q.usageBytes || 0) / (1024 * 1024);
                        const limMb = (q.limitBytes || 0) / (1024 * 1024);
                        const useStr = useMb >= 1024 ? (useMb / 1024).toFixed(2) + ' GB' : useMb.toFixed(1) + ' MB';
                        const limStr = limMb >= 1024 ? (limMb / 1024).toFixed(0) + ' GB' : (limMb > 0 ? limMb.toFixed(0) + ' MB' : 'Ilimitado');
                        const pct = limMb > 0 ? Math.min(100, Math.round((useMb / limMb) * 1000) / 10) : 0;
                        let barColor = 'var(--vscode-charts-green, #4ec9b0)';
                        if (pct >= 90) barColor = 'var(--vscode-charts-red, #f14c4c)';
                        else if (pct >= 70) barColor = 'var(--vscode-charts-yellow, #cca700)';

                        const countStr = (q.countUsage != null) ? q.countUsage + ' assets' : '';
                        const pctStr = limMb > 0 ? ' (' + pct + '%)' : '';

                        return '<div class="quota-inline-card" style="margin: 0 8px; min-width: 140px; max-width: 380px; flex: 1; flex-shrink: 0; padding: 2px 8px; background: var(--vscode-editorWidget-background, rgba(255,255,255,0.04)); border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08)); border-radius: 4px;">' +
                            '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; margin-bottom: 2px;">' +
                                '<span style="color: var(--vscode-foreground); font-weight: 500; white-space: nowrap;">💾 Cuota: <strong>' + useStr + '</strong> / ' + limStr + pctStr + '</span>' +
                                '<span style="color: var(--vscode-descriptionForeground); font-size: 9.5px; white-space: nowrap; margin-left: 6px;">' + countStr + '</span>' +
                            '</div>' +
                            '<div style="width: 100%; height: 3px; background: var(--vscode-progressBar-background, rgba(255,255,255,0.1)); border-radius: 2px; overflow: hidden;">' +
                                '<div style="width: ' + (limMb > 0 ? Math.max(2, pct) : 2) + '%; height: 100%; background: ' + barColor + '; border-radius: 2px;"></div>' +
                            '</div>' +
                        '</div>';
                    }

                    window.addEventListener('keydown', (e) => {
                        const assetsTab = document.getElementById('assets');
                        if (!assetsTab || !assetsTab.classList.contains('active')) return;
                        if (!selectedAssetData) return;

                        if (e.key === 'Enter') {
                            if (selectedAssetData.isFolder) {
                                const detailsEl = document.getElementById('details-' + selectedAssetData.safeId);
                                if (detailsEl) {
                                    detailsEl.open = !detailsEl.open;
                                }
                            } else {
                                e.preventDefault();
                                insertText(selectedAssetData.id);
                            }
                        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
                            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
                            e.preventDefault();
                            copyText(selectedAssetData.id);
                        }
                    });

                    function renderAssetCard(a) {
                        const isFolder = (a.type === 'FOLDER' || a.type === 'FOLDER_ROOT' || a.type === 'IMAGE_COLLECTION' || a.isRoot);
                        let icon = '📄';
                        if (isFolder) icon = '📁';
                        else if (a.type === 'IMAGE') icon = '🖼️';
                        else if (a.type === 'TABLE') icon = '📊';

                        let typeColor = 'var(--vscode-descriptionForeground)';
                        if (a.type === 'IMAGE') typeColor = 'var(--vscode-charts-green)';
                        else if (a.type === 'TABLE') typeColor = 'var(--vscode-charts-yellow)';

                        const assetId = String(a.id || a.name || '');
                        const assetName = String(a.name || a.id || '').split('/').pop() || assetId || 'unnamed';
                        const safeId = (assetId || 'item-' + Math.random().toString(36).substring(2, 6)).replace(/[^a-zA-Z0-9_-]/g, '-');

                        const deleteBtn = (!a.isRoot) ? '<button class="task-action-btn cancel-btn" title="Eliminar Asset" onclick="event.preventDefault(); event.stopPropagation(); deleteAsset(&apos;' + assetId + '&apos;)">❌</button>' : '';
                        const copyBtn = '<button class="task-action-btn" title="Copiar ID" onclick="event.preventDefault(); event.stopPropagation(); copyText(&apos;' + assetId + '&apos;)">📋</button>';
                        const insertBtn = (!isFolder) ? '<button class="task-action-btn" title="Insertar en Editor" onclick="event.preventDefault(); event.stopPropagation(); insertText(&apos;' + assetId + '&apos;)">➕</button>' : '';

                        let quotaHtml = '';
                        if (a.isRoot && a.quota) {
                            quotaHtml = buildQuotaHtml(a.quota);
                        }

                        const quotaSlot = (a.isRoot) ? '<div class="quota-slot" id="quota-' + safeId + '">' + quotaHtml + '</div>' : '';

                        const cardContent = 
                            '<div class="tree-title"' + (a.isRoot && quotaHtml ? ' style="flex: 0 1 auto; max-width: 220px; min-width: 60px;"' : '') + '>' +
                                '<span class="folder-chevron">' + (isFolder ? '▶' : '') + '</span>' +
                                '<span class="tree-icon">' + icon + '</span>' +
                                '<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + assetId + '">' + assetName + '</span>' +
                            '</div>' +
                            quotaSlot +
                            '<div class="tree-meta" style="flex-shrink: 0;">' +
                                '<span class="tree-type" style="color: ' + typeColor + '">' + (a.type || 'Unknown') + '</span>' +
                                insertBtn + copyBtn + deleteBtn +
                            '</div>';

                        if (isFolder) {
                            return '<details class="asset-details" id="details-' + safeId + '" ontoggle="onFolderToggle(this, &apos;' + assetId + '&apos;)">' +
                                '<summary class="tree-item" tabindex="0" onclick="selectAsset(this, &apos;' + assetId + '&apos;, true, &apos;' + safeId + '&apos;)">' +
                                    cardContent +
                                '</summary>' +
                                '<div class="folder-content" id="content-' + safeId + '" style="padding-left: 14px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke, #444); margin-left: 6px;">' +
                                    '<div style="color: var(--vscode-descriptionForeground); font-size: 11px; font-style: italic; padding: 2px 10px;">Loading...</div>' +
                                '</div>' +
                            '</details>';
                        } else {
                            return '<div class="tree-item" id="item-' + safeId + '" tabindex="0" onclick="selectAsset(this, &apos;' + assetId + '&apos;, false, &apos;' + safeId + '&apos;)">' +
                                cardContent +
                            '</div>';
                        }
                    }

                    function renderAssets(message) {
                        const isRoot = !message.parent || message.parent === '~';
                        const safeParentId = isRoot ? '' : String(message.parent).replace(/[^a-zA-Z0-9_-]/g, '-');
                        const containerId = isRoot ? 'assets-list' : 'content-' + safeParentId;
                        const container = document.getElementById(containerId);
                        if (!container) return;
                        
                        if (message && message.error) {
                            if (message.error === 'not_initialized') {
                                container.innerHTML = '<div style="color: var(--vscode-charts-yellow); font-size: 12px; padding: 10px; border: 1px solid var(--vscode-charts-yellow); background: var(--vscode-editorWidget-background); border-radius: 4px;">⚠️ GEE no está inicializado. Por favor corre un script o inicia el Workspace primero para ver tus assets.</div>';
                            } else {
                                container.innerHTML = '<div style="color: var(--vscode-errorForeground); font-size: 12px; padding: 4px 10px;">Error: ' + message.error + '</div>';
                            }
                            return;
                        }

                        let assets = message.assets || [];
                        if (assets.length === 0) {
                            container.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 12px; font-style: italic; padding: 2px 20px;">(Empty folder)</div>';
                            return;
                        }

                        try {
                            if (isRoot) {
                                const cloudAssets = assets.filter(a => a.category !== 'LEGACY');
                                const legacyAssets = assets.filter(a => a.category === 'LEGACY');

                                const sortFn = (a, b) => {
                                    const nameA = String(a.name || a.id || '');
                                    const nameB = String(b.name || b.id || '');
                                    return nameA.localeCompare(nameB);
                                };
                                cloudAssets.sort(sortFn);
                                legacyAssets.sort(sortFn);

                                let html = '';
                                if (cloudAssets.length > 0) {
                                    html += '<div style="font-size: 11px; font-weight: 700; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 4px 4px 4px; display: flex; align-items: center; gap: 5px;">☁️ CLOUD ASSETS</div>';
                                    cloudAssets.forEach(a => { html += renderAssetCard(a); });
                                }
                                if (legacyAssets.length > 0) {
                                    html += '<div style="font-size: 11px; font-weight: 700; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 4px 4px 4px; border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06)); margin-top: 6px; display: flex; align-items: center; gap: 5px;">📁 LEGACY ASSETS</div>';
                                    legacyAssets.forEach(a => { html += renderAssetCard(a); });
                                }
                                container.innerHTML = html;
                            } else {
                                assets.sort((a, b) => {
                                    const aIsFolder = (a.type === 'FOLDER' || a.type === 'FOLDER_ROOT' || a.type === 'IMAGE_COLLECTION');
                                    const bIsFolder = (b.type === 'FOLDER' || b.type === 'FOLDER_ROOT' || b.type === 'IMAGE_COLLECTION');
                                    if (aIsFolder && !bIsFolder) return -1;
                                    if (!aIsFolder && bIsFolder) return 1;
                                    const nameA = String(a.name || a.id || '');
                                    const nameB = String(b.name || b.id || '');
                                    return nameA.localeCompare(nameB);
                                });
                                let html = '';
                                assets.forEach(a => { html += renderAssetCard(a); });
                                container.innerHTML = html;
                            }
                        } catch (err) {
                            container.innerHTML = '<div style="color: red; font-size: 11px; padding: 10px; word-break: break-all;">RENDER ERROR: ' + err.message + '<br/>' + err.stack + '</div>';
                        }
                    }
// --- AI LOGIC ---
                    const chat = document.getElementById('chat');
                    const input = document.getElementById('input');
                    const send = document.getElementById('send');

                    function doSend() {
                        const text = input.value.trim();
                        if (!text) return;
                        
                        const userMsg = document.createElement('div');
                        userMsg.className = 'msg user';
                        userMsg.textContent = text;
                        chat.appendChild(userMsg);
                        
                        input.value = '';
                        chat.scrollTop = chat.scrollHeight;
                        
                        setTimeout(() => {
                            const aiMsg = document.createElement('div');
                            aiMsg.className = 'msg ai';
                            aiMsg.innerHTML = "<strong>Assistant:</strong> Understood. I'm analyzing your request about <em>" + text + "</em>. <br><br>I will provide optimized code snippets and best practices shortly.";
                            chat.appendChild(aiMsg);
                            chat.scrollTop = chat.scrollHeight;
                        }, 600);
                    }

                    send.addEventListener('click', doSend);
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            doSend();
                        }
                    });

                    // --- MESSAGES FROM EXTENSION ---
                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        if (message.command === 'focus') {
                            const inp = document.getElementById('input');
                            if (inp) {
                                inp.focus();
                                inp.select();
                            }
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
