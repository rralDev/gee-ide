import * as vscode from 'vscode';

export class AIView {
    private panel: vscode.WebviewPanel | undefined;
    public get isCreated(): boolean { return this.panel !== undefined; }
    private messageCallback: ((message: any) => void) | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    public onMessage(callback: (message: any) => void) {
        this.messageCallback = callback;
    }

    public async show(column?: vscode.ViewColumn, preserveFocus: boolean = true) {
        const targetColumn = column || vscode.ViewColumn.Four;
        if (this.panel) {
            this.panel.reveal(column !== undefined ? column : this.panel.viewColumn, preserveFocus);
        } else {
            await this.closeExistingTabs();

            this.panel = vscode.window.createWebviewPanel(
                'geeAI',
                'GEE Tools',
                { viewColumn: targetColumn, preserveFocus },
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
                    .tree-title { display: flex; align-items: center; gap: 6px; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
                    .tree-icon { font-size: 14px; width: 16px; text-align: center; }
                    .tree-meta { display: flex; align-items: center; gap: 8px; }
                    .tree-type { color: var(--vscode-descriptionForeground, #888); font-size: 10px; text-transform: uppercase; }
                    .tree-item:hover .task-action-btn { display: block; }
                    
                    .folder-chevron { display: inline-block; width: 14px; font-size: 10px; color: var(--vscode-icon-foreground); text-align: center; }
                    details.asset-details[open] > summary .folder-chevron { transform: rotate(90deg); }
                
                    /* Modal styles */
                    .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
                    .modal-overlay.active { display: flex; }
                    .modal-content { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); padding: 20px; border-radius: 6px; width: 90%; max-width: 400px; max-height: 90vh; overflow-y: auto; position: relative; }
                    .modal-close { position: absolute; top: 10px; right: 10px; cursor: pointer; background: transparent; color: var(--vscode-icon-foreground); border: none; font-size: 16px; }
                    .modal-close:hover { color: var(--vscode-errorForeground); }
                    .modal-title { font-size: 14px; font-weight: bold; margin-bottom: 10px; word-break: break-all; }
                    .modal-body pre { background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
                    .tree-item:focus { outline: 1px solid var(--vscode-focusBorder); background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
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
                        <button onclick="refreshTasks()" style="background: #333; border: 1px solid #555; padding: 4px 8px; font-size: 11px;">🔄 Refresh</button>
                    </div>
                    <div class="task-list" id="task-list">
                        <div style="color: #888; font-size: 12px; font-style: italic;">Loading tasks...</div>
                    </div>
                </div>

                <div id="assets" class="content">
                    <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; font-weight: bold;">Assets Manager</span>
                        <div>
                            <button onclick="vscode.postMessage({command: 'createFolder'})" style="background: transparent; border: 1px solid var(--vscode-button-secondaryBorder, #555); padding: 4px; font-size: 11px; cursor: pointer;" title="New Folder (Cmd+Shift+N)">📁+</button>
                            <button onclick="refreshAssets()" style="background: #333; border: 1px solid #555; padding: 4px 8px; font-size: 11px;">🔄 Refresh</button>
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

                
                <div class="modal-overlay" id="asset-modal">
                    <div class="modal-content">
                        <button class="modal-close" onclick="closeModal()">×</button>
                        <div class="modal-title" id="modal-title">Asset Details</div>
                        <div class="modal-body" id="modal-body">Loading...</div>
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

                                                                                function renderTasks(tasksData) {
                        const list = document.getElementById('task-list');
                        list.innerHTML = '';
                        
                        if (tasksData && tasksData.error) {
                            if (tasksData.error === 'not_initialized') {
                                list.innerHTML = '<div style="color: var(--vscode-charts-yellow); font-size: 12px; padding: 10px; border: 1px solid var(--vscode-charts-yellow); background: var(--vscode-editorWidget-background); border-radius: 4px;">⚠️ GEE no está inicializado. Por favor corre un script o inicia el Workspace primero para ver tus tareas.</div>';
                            } else {
                                list.innerHTML = \`<div style="color: var(--vscode-charts-red); font-size: 12px;">Error: \${tasksData.error}</div>\`;
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
                        
                        // Render top 30 tasks
                        tasks.slice(0, 30).forEach(t => {
                            const div = document.createElement('div');
                            let stateClass = '';
                            let stateColor = '#888';
                            if (t.state === 'RUNNING') { stateClass = 'running'; stateColor = 'var(--vscode-charts-blue)'; }
                            else if (t.state === 'COMPLETED') { stateClass = 'completed'; stateColor = 'var(--vscode-charts-green)'; }
                            else if (t.state === 'FAILED') { stateClass = 'failed'; stateColor = 'var(--vscode-charts-red)'; }
                            else if (t.state === 'READY') { stateClass = 'ready'; stateColor = 'var(--vscode-charts-yellow)'; }
                            
                            div.className = 'tree-item';
                            div.tabIndex = 0;
                            div.dataset.path = t.id;
                            div.dataset.type = t.task_type;
                            
                            let desc = t.description || t.id;
                            let duration = '';
                            if (t.update_timestamp_ms && t.creation_timestamp_ms) {
                                let min = Math.round((t.update_timestamp_ms - t.creation_timestamp_ms) / 60000);
                                if (t.state === 'RUNNING') {
                                    min = Math.round((Date.now() - t.creation_timestamp_ms) / 60000);
                                }
                                duration = min > 0 ? \` (\${min}m)\` : ' (<1m)';
                            }

                            let icon = '⏳';
                            if (t.state === 'COMPLETED') icon = '✅';
                            else if (t.state === 'FAILED') icon = '❌';
                            else if (t.state === 'RUNNING') icon = '🔄';

                            let actionsHTML = '';
                            if (t.state === 'RUNNING' || t.state === 'READY') {
                                actionsHTML += \`<button class="task-action-btn cancel-btn" title="Cancelar Tarea" onclick="event.preventDefault(); event.stopPropagation(); cancelTask('\${t.id}')">🛑</button>\`;
                            }
                            if (t.state === 'COMPLETED' && t.task_type === 'EXPORT_IMAGE') {
                                const searchUrl = \`https://drive.google.com/drive/search?q=\${encodeURIComponent(desc)}\`;
                                actionsHTML += \`<button class="task-action-btn" title="Buscar en Google Drive" onclick="event.preventDefault(); event.stopPropagation(); vscode.postMessage({command: 'openExternal', url: '\${searchUrl}'})">📁</button>\`;
                            }
                            actionsHTML += \`<button class="task-action-btn" title="Copiar ID" onclick="event.preventDefault(); event.stopPropagation(); vscode.postMessage({command: 'copyToClipboard', text: '\${t.id}'})">📋</button>\`;
                            
                            if (t.state === 'FAILED' && t.error_message) {
                                const errorMsg = t.error_message.replace(/'/g, "\\\\\\'").replace(/\\n/g, ' ');
                                actionsHTML += \`<button class="task-action-btn" title="Copiar Error" onclick="event.preventDefault(); event.stopPropagation(); vscode.postMessage({command: 'copyToClipboard', text: '\${errorMsg}'})">⚠️</button>\`;
                            }

                            div.innerHTML = \`
                                <div class="tree-title">
                                    <span class="tree-icon">\${icon}</span>
                                    <span title="\${t.id}">\${desc}</span>
                                </div>
                                <div class="tree-meta">
                                    <span class="tree-type" style="color: \${stateColor}">\${t.state}\${duration}</span>
                                    \${actionsHTML}
                                </div>
                            \`;
                            list.appendChild(div);
                        });
                    }
const openFolders = new Set();
                    function refreshAssets() {
                        const list = document.getElementById("assets-list");
                        list.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 12px; font-style: italic;">Loading assets...</div>';
                        vscode.postMessage({ command: "getAssets", parent: "~" });
                    }
function deleteAsset(id) {
                        vscode.postMessage({ command: "deleteAsset", assetId: id });
                    }

                    function onFolderToggle(detailsEl, path) {
                        if (detailsEl.open) {
                            openFolders.add(path);
                            if (!detailsEl.dataset.loaded) {
                                detailsEl.dataset.loaded = "true";
                                vscode.postMessage({ command: "getAssets", parent: path });
                            }
                        } else {
                            openFolders.delete(path);
                        }
                    }

                    function renderAssets(message) {
                        const isRoot = !message.parent || message.parent === '~';
                        const safeParentId = isRoot ? '' : message.parent.replace(/[^a-zA-Z0-9_-]/g, '-');
                        const containerId = isRoot ? 'assets-list' : 'content-' + safeParentId;
                        const container = document.getElementById(containerId);
                        if (!container) return;
                        
                        if (message && message.error) {
                            if (message.error === 'not_initialized') {
                                container.innerHTML = '<div style="color: var(--vscode-charts-yellow); font-size: 12px; padding: 10px; border: 1px solid var(--vscode-charts-yellow); background: var(--vscode-editorWidget-background); border-radius: 4px;">⚠️ GEE no está inicializado. Por favor corre un script o inicia el Workspace primero para ver tus assets.</div>';
                            } else {
                                container.innerHTML = '<div style="color: var(--vscode-errorForeground); font-size: 12px;">Error: ' + message.error + '</div>';
                            }
                            return;
                        }

                        let assets = message.assets || [];
                        if (assets.length === 0) {
                            container.innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 12px; font-style: italic; padding: 2px 20px;">(Empty folder)</div>';
                            return;
                        }

                        let html = '';
                        assets.sort((a, b) => {
                            const aIsFolder = (a.type === 'FOLDER' || a.type === 'FOLDER_ROOT' || a.type === 'IMAGE_COLLECTION');
                            const bIsFolder = (b.type === 'FOLDER' || b.type === 'FOLDER_ROOT' || b.type === 'IMAGE_COLLECTION');
                            if (aIsFolder && !bIsFolder) return -1;
                            if (!aIsFolder && bIsFolder) return 1;
                            return a.name.localeCompare(b.name);
                        }).forEach(a => {
                            let icon = '📄';
                            const isFolder = (a.type === 'FOLDER' || a.type === 'FOLDER_ROOT' || a.type === 'IMAGE_COLLECTION' || a.isRoot);
                            if (isFolder) icon = '📁';
                            else if (a.type === 'IMAGE') icon = '🖼️';
                            else if (a.type === 'TABLE') icon = '📊';

                            let typeColor = 'var(--vscode-descriptionForeground)';
                            if (a.type === 'IMAGE') typeColor = 'var(--vscode-charts-green)';
                            else if (a.type === 'TABLE') typeColor = 'var(--vscode-charts-yellow)';

                            const safeId = a.id.replace(/[^a-zA-Z0-9_-]/g, '-');
                            const isOpen = openFolders.has(a.id) ? 'open' : '';
                            
                            const deleteBtn = (!a.isRoot) ? '<button class="task-action-btn cancel-btn" title="Eliminar Asset" onclick="event.preventDefault(); event.stopPropagation(); deleteAsset(\\\'' + a.id + '\\\')">❌</button>' : '';
                            const copyBtn = '<button class="task-action-btn" title="Copiar ID" onclick="event.preventDefault(); event.stopPropagation(); vscode.postMessage({command: \\\'copyToClipboard\\\', text: \\\'\' + a.id + \'\\\'})">📋</button>';
                            const insertBtn = (!isFolder) ? '<button class="task-action-btn" title="Insertar en Editor" onclick="event.preventDefault(); event.stopPropagation(); vscode.postMessage({command: \\\'insertInEditor\\\', text: \\\'\' + a.id + \'\\\'})">➕</button>' : '';
                            
                            const cardContent = 
                                '<div class="tree-title">' +
                                    '<span class="folder-chevron">' + (isFolder ? '▶' : '') + '</span>' +
                                    '<span class="tree-icon">' + icon + '</span>' +
                                    '<span title="' + a.id + '">' + a.name + '</span>' +
                                '</div>' +
                                '<div class="tree-meta">' +
                                    '<span class="tree-type" style="color: ' + typeColor + '">' + (a.type || 'Unknown') + '</span>' +
                                    insertBtn + copyBtn + deleteBtn +
                                '</div>';

                            if (isFolder) {
                                html += '<details class="asset-details" id="details-' + safeId + '" ontoggle="onFolderToggle(this, \\\'' + a.id + '\\\')" ' + isOpen + '>' +
                                    '<summary class="tree-item" tabindex="0" data-path="' + a.id + '" data-type="' + a.type + '">' +
                                        cardContent +
                                    '</summary>' +
                                    '<div class="folder-content" id="content-' + safeId + '" style="padding-left: 14px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke, #444); margin-left: 6px;">' +
                                        '<div style="color: var(--vscode-descriptionForeground); font-size: 11px; font-style: italic; padding: 2px 10px;">Loading...</div>' +
                                    '</div>' +
                                '</details>';
                            } else {
                                html += '<div class="tree-item" tabindex="0" data-path="' + a.id + '" data-type="' + a.type + '" ondblclick="showAssetModal(\\\'' + a.id + '\\\')">' +
                                    cardContent +
                                '</div>';
                            }
                        });

                        container.innerHTML = html;
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
                    
                    function showAssetModal(id) {
                        document.getElementById('modal-title').innerText = id;
                        document.getElementById('modal-body').innerHTML = '<div style="color: var(--vscode-descriptionForeground); font-size: 11px;">Loading details...</div>';
                        document.getElementById('asset-modal').classList.add('active');
                        vscode.postMessage({ command: 'getAssetDetails', assetId: id });
                    }
                    function closeModal() {
                        document.getElementById('asset-modal').classList.remove('active');
                    }
                    
                    document.addEventListener('keydown', (e) => {
                        // Global create folder
                        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
                            vscode.postMessage({ command: 'createFolder' });
                            return;
                        }
                        
                        const active = document.activeElement;
                        if (!active || !active.classList.contains('tree-item')) return;
                        
                        const path = active.dataset.path;
                        const type = active.dataset.type;
                        
                        if (e.key === 'ArrowRight') {
                            if (active.tagName === 'SUMMARY') {
                                const details = active.parentElement;
                                if (!details.open) details.open = true;
                            }
                        } else if (e.key === 'ArrowLeft') {
                            if (active.tagName === 'SUMMARY') {
                                const details = active.parentElement;
                                if (details.open) details.open = false;
                            }
                        } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const items = Array.from(document.querySelectorAll('.tree-item:visible, details[open] > summary.tree-item, details[open] > .folder-content > details > summary.tree-item, details[open] > .folder-content > .tree-item, #assets-list > details > summary.tree-item, #assets-list > .tree-item'));
                            // Simplified next visible element focus:
                            const allFocusable = Array.from(document.querySelectorAll('.tree-item'));
                            const visibleFocusable = allFocusable.filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
                            const idx = visibleFocusable.indexOf(active);
                            if (idx >= 0 && idx < visibleFocusable.length - 1) visibleFocusable[idx+1].focus();
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            const allFocusable = Array.from(document.querySelectorAll('.tree-item'));
                            const visibleFocusable = allFocusable.filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
                            const idx = visibleFocusable.indexOf(active);
                            if (idx > 0) visibleFocusable[idx-1].focus();
                        } else if (e.key === 'Enter') {
                            if (active.tagName === 'SUMMARY') {
                                const details = active.parentElement;
                                details.open = !details.open;
                            } else {
                                vscode.postMessage({ command: 'insertInEditor', text: path });
                            }
                        } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                            vscode.postMessage({ command: 'copyToClipboard', text: path });
                        }
                    });
                    
                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        if (message.command === 'assetDetailsData') {
                            document.getElementById('modal-body').innerHTML = '<pre>' + JSON.stringify(message.details, null, 2) + '</pre>';
                        } else if (message.command === 'focus') {
                            const inp = document.getElementById('input');
                            if (inp) {
                                inp.focus();
                                inp.select();
                            }
                        } else if (message.command === 'tasksData') {
                            renderTasks(message.tasks || message);
                        } else if (message.command === 'assetsData') {
                            renderAssets(message);
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
