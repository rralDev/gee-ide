import * as vscode from 'vscode';

export class AIView {
    private panel: vscode.WebviewPanel | undefined;
    private messageCallback: ((message: any) => void) | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    public onMessage(callback: (message: any) => void) {
        this.messageCallback = callback;
    }

    public show(column: vscode.ViewColumn = vscode.ViewColumn.Four, preserveFocus: boolean = true) {
        if (this.panel) {
            this.panel.reveal(column, preserveFocus);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'geeAI',
                'GEE AI Assistant',
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
                <title>GEE AI</title>
                <style>
                    body { 
                        background: #1e1e1e; 
                        color: #d4d4d4; 
                        font-family: sans-serif;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        margin: 0;
                        padding: 10px;
                        box-sizing: border-box;
                    }
                    .chat-container { flex: 1; overflow-y: auto; margin-bottom: 10px; }
                    .input-container { display: flex; gap: 5px; }
                    input { 
                        flex: 1; 
                        background: #333; 
                        border: 1px solid #555; 
                        color: white; 
                        padding: 8px;
                        border-radius: 4px;
                    }
                    button { 
                        background: #007acc; 
                        color: white; 
                        border: none; 
                        padding: 8px 15px; 
                        cursor: pointer;
                        border-radius: 4px;
                    }
                    .msg { margin-bottom: 10px; padding: 8px; border-radius: 4px; font-size: 13px; }
                    .ai { background: #2d2d2d; border-left: 3px solid #007acc; }
                    .user { background: #3d3d3d; text-align: right; }
                </style>
            </head>
            <body>
                <div class="chat-container" id="chat">
                    <div class="msg ai">
                        <strong>GEE IDE Assistant (WIP)</strong><br>
                        Hello! I am your geospatial AI assistant.<br><br>
                        <em>Note: The AI engine is currently in active development. We are designing a smart system to cascade through free AI APIs and support local LLM execution!</em><br><br>
                        How can I help you today?
                    </div>
                </div>
                <div class="input-container">
                    <input type="text" id="input" placeholder="e.g. How to calculate NDVI?..." />
                    <button id="send">Send</button>
                </div>
                <script>
                    let vscode;
                    try {
                        vscode = acquireVsCodeApi();
                    } catch (e) {
                        vscode = window.__vscodeApi;
                    }
                    window.__vscodeApi = vscode;

                    window.addEventListener('keydown', (e) => {
                        const isCmdOrCtrl = e.metaKey || e.ctrlKey;
                        if (isCmdOrCtrl && ['1', '2', '3', '4'].includes(e.key)) {
                            e.preventDefault();
                            e.stopPropagation();
                            vscode.postMessage({
                                command: 'focusQuadrant',
                                quadrant: Number(e.key)
                            });
                        }
                    }, true);

                    window.addEventListener('message', (event) => {
                        if (event.data.command === 'focus') {
                            const inp = document.getElementById('input');
                            if (inp) {
                                inp.focus();
                                inp.select();
                            }
                        }
                    });

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
                        
                        // Mock Expert Response
                        setTimeout(() => {
                            const aiMsg = document.createElement('div');
                            aiMsg.className = 'msg ai';
                            aiMsg.innerHTML = "<strong>Assistant:</strong> Understood. I'm analyzing your request about <em>" + text + "</em>. <br><br>I will provide optimized code snippets and best practices for this task shortly.";
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
                </script>
            </body>
            </html>
        `;
    }
}
