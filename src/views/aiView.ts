import * as vscode from 'vscode';

export class AIView {
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
                    body { background: #1e1e1e; color: #d4d4d4; font-family: sans-serif; display: flex; flex-direction: column; height: 100vh; margin: 0; padding: 0; box-sizing: border-box; }
                    .tabs { display: flex; background: #252526; border-bottom: 1px solid #333; }
                    .tab { padding: 10px 15px; cursor: pointer; color: #969696; border-bottom: 2px solid transparent; font-size: 13px; flex: 1; text-align: center; }
                    .tab:hover { color: #d4d4d4; }
                    .tab.active { color: #fff; border-bottom: 2px solid #007acc; }
                    .content { flex: 1; overflow-y: auto; padding: 10px; display: none; }
                    .content.active { display: flex; flex-direction: column; }
                    
                    /* AI specific */
                    .chat-container { flex: 1; overflow-y: auto; margin-bottom: 10px; }
                    .input-container { display: flex; gap: 5px; }
                    input[type="text"] { flex: 1; background: #333; border: 1px solid #555; color: white; padding: 8px; border-radius: 4px; }
                    button { background: #007acc; color: white; border: none; padding: 8px 15px; cursor: pointer; border-radius: 4px; }
                    .msg { margin-bottom: 10px; padding: 8px; border-radius: 4px; font-size: 13px; }
                    .ai { background: #2d2d2d; border-left: 3px solid #007acc; }
                    .user { background: #3d3d3d; text-align: right; }

                    /* Tasks specific */
                    .task-list { display: flex; flex-direction: column; gap: 8px; }
                    .task-item { background: #2d2d2d; border-left: 3px solid #555; padding: 8px 12px; border-radius: 4px; font-size: 12px; position: relative; }
                    .task-item.running { border-color: #007acc; }
                    .task-item.completed { border-color: #4ec9b0; }
                    .task-item.failed { border-color: #f14c4c; }
                    .task-item.ready { border-color: #cca700; }
                    .task-title { font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; }
                    .task-meta { color: #888; font-size: 11px; }
                    .task-cancel { display: none; position: absolute; right: 10px; bottom: 8px; font-size: 11px; color: #f14c4c; cursor: pointer; background: transparent; border: 1px solid #f14c4c; padding: 2px 5px; }
                    .task-item.running:hover .task-cancel, .task-item.ready:hover .task-cancel { display: block; }
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
                    <div style="margin-bottom: 10px;">
                        <span style="font-size: 14px; font-weight: bold;">Assets Manager</span>
                    </div>
                    <div style="color: #888; font-size: 12px; font-style: italic;">Assets Manager coming soon in our Core Productivity roadmap!</div>
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

                    function renderTasks(tasks) {
                        const list = document.getElementById('task-list');
                        list.innerHTML = '';
                        if (!tasks || tasks.length === 0) {
                            list.innerHTML = '<div style="color: #888; font-size: 12px; font-style: italic;">No recent tasks found.</div>';
                            return;
                        }
                        
                        // Render top 30 tasks
                        tasks.slice(0, 30).forEach(t => {
                            const div = document.createElement('div');
                            let stateClass = '';
                            let stateColor = '#888';
                            if (t.state === 'RUNNING') { stateClass = 'running'; stateColor = '#007acc'; }
                            else if (t.state === 'COMPLETED') { stateClass = 'completed'; stateColor = '#4ec9b0'; }
                            else if (t.state === 'FAILED') { stateClass = 'failed'; stateColor = '#f14c4c'; }
                            else if (t.state === 'READY') { stateClass = 'ready'; stateColor = '#cca700'; }
                            
                            div.className = 'task-item ' + stateClass;
                            
                            let desc = t.description || t.id;
                            let duration = '';
                            if (t.update_timestamp_ms && t.creation_timestamp_ms) {
                                let min = Math.round((t.update_timestamp_ms - t.creation_timestamp_ms) / 60000);
                                if (t.state === 'RUNNING') {
                                    min = Math.round((Date.now() - t.creation_timestamp_ms) / 60000);
                                }
                                duration = min > 0 ? \` (\${min}m)\` : ' (<1m)';
                            }

                            div.innerHTML = \`
                                <div class="task-title">
                                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;" title="\${desc}">\${desc}</span> 
                                    <span style="color: \${stateColor}; flex-shrink: 0;">\${t.state}\${duration}</span>
                                </div>
                                <div class="task-meta">Type: \${t.task_type}</div>
                                \${(t.state === 'RUNNING' || t.state === 'READY') ? \`<button class="task-cancel" onclick="cancelTask('\${t.id}')">Cancel</button>\` : ''}
                            \`;
                            list.appendChild(div);
                        });
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
                        } else if (message.command === 'tasksData') {
                            renderTasks(message.tasks);
                        }
                    });

                    // Initial fetch
                    refreshTasks();
                </script>
            </body>
            </html>
        `;
    }
}
