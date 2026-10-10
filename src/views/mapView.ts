import * as vscode from 'vscode';

export class MapView {
    private panel: vscode.WebviewPanel | undefined;
    public get isCreated(): boolean { return this.panel !== undefined; }
    private messageCallback: ((message: any) => void) | undefined;
    private isReady: boolean = false;
    private messageQueue: any[] = [];

    constructor(private context: vscode.ExtensionContext) {}

    public onMessage(callback: (message: any) => void) {
        this.messageCallback = callback;
    }

    public async show(column?: vscode.ViewColumn, preserveFocus: boolean = true) {
        const targetColumn = column || vscode.ViewColumn.Three;
        if (this.panel) {
            this.panel.webview.html = this.getHtml();
            this.panel.reveal(column !== undefined ? column : this.panel.viewColumn, preserveFocus);
        } else {
            await this.closeExistingTabs();

            this.panel = vscode.window.createWebviewPanel(
                'geeMap',
                'GEE Map',
                { viewColumn: targetColumn, preserveFocus },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.isReady = false;
            this.panel.webview.html = this.getHtml();
            
            this.panel.webview.onDidReceiveMessage(message => {
                if (message.command === 'ready') {
                    this.isReady = true;
                    this.flushQueue();
                } else if (message.command === 'webviewError') {
                    console.error('[GEE Map Webview Error]', message.message, message.stack);
                    vscode.window.showErrorMessage('GEE Map Error: ' + message.message);
                } else if (message.command === 'saveSnapshot') {
                    this.handleSaveSnapshot(message);
                }
                if (this.messageCallback) this.messageCallback(message);
            }, undefined, this.context.subscriptions);

            this.panel.onDidDispose(() => {
                this.panel = undefined;
                this.isReady = false;
            }, null, this.context.subscriptions);
        }
    }

    public dispose() {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
            this.isReady = false;
        }
    }

    private async closeExistingTabs() {
        try {
            const tabsToClose: vscode.Tab[] = [];
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'geeMap') {
                        tabsToClose.push(tab);
                    }
                }
            }
            if (tabsToClose.length > 0) {
                await vscode.window.tabGroups.close(tabsToClose);
            }
        } catch (e) {}
    }

    public focus() {
        if (this.panel) {
            this.panel.reveal();
            this.panel.webview.postMessage({ command: 'focus' });
        } else {
            this.show(vscode.ViewColumn.Three);
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
        this.isReady = false;
        this.panel.webview.options = {
            enableScripts: true
        };
        
        this.panel.webview.onDidReceiveMessage(message => {
            if (message.command === 'ready') {
                this.isReady = true;
                this.flushQueue();
            } else if (message.command === 'webviewError') {
                console.error('[GEE Map Webview Error]', message.message, message.stack);
                vscode.window.showErrorMessage('GEE Map Error: ' + message.message);
            } else if (message.command === 'saveSnapshot') {
                this.handleSaveSnapshot(message);
            }
            if (this.messageCallback) this.messageCallback(message);
        }, undefined, this.context.subscriptions);

        this.panel.onDidDispose(() => {
            this.panel = undefined;
            this.isReady = false;
        }, null, this.context.subscriptions);

        this.panel.webview.html = this.getHtml();
    }

    private flushQueue() {
        if (this.panel && this.isReady) {
            while (this.messageQueue.length > 0) {
                const msg = this.messageQueue.shift();
                this.panel.webview.postMessage(msg);
            }
        }
    }

    private sendMessage(msg: any) {
        if (!this.panel) {
            this.show(vscode.ViewColumn.Three);
        }
        if (!this.isReady) {
            this.messageQueue.push(msg);
        } else if (this.panel) {
            this.panel.webview.postMessage(msg);
        }
    }

    public addLayer(mapIdOrUrl: any, name?: string, shown: boolean = true, opacity: number = 1.0, visParams?: any) {
        const urlFormat = typeof mapIdOrUrl === 'string' ? mapIdOrUrl : (mapIdOrUrl?.urlFormat || mapIdOrUrl?.url);
        this.sendMessage({ command: 'addLayer', mapId: { urlFormat }, name, shown, opacity, visParams });
    }

    public showInspectorPopup(lat: number, lon: number, htmlContent: string) {
        this.sendMessage({ command: 'showInspectorPopup', lat, lon, htmlContent });
    }

    public setCenter(lat: number, lng: number, zoom?: number) {
        this.sendMessage({ command: 'setCenter', lat, lng, zoom });
    }

    public clear() {
        this.sendMessage({ command: 'clear' });
    }

    private async handleSaveSnapshot(message: { data: string; filename: string; promptSaveAs: boolean }) {
        try {
            const buffer = Buffer.from(message.data, 'base64');
            let targetUri: vscode.Uri | undefined;

            if (message.promptSaveAs) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
                targetUri = await vscode.window.showSaveDialog({
                    defaultUri: workspaceFolder ? vscode.Uri.joinPath(workspaceFolder, message.filename) : undefined,
                    filters: { 'Images (*.png)': ['png'] }
                });
                if (!targetUri) return;
            } else {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (workspaceFolder) {
                    const screenshotsDir = vscode.Uri.joinPath(workspaceFolder, 'Screenshots');
                    try {
                        await vscode.workspace.fs.createDirectory(screenshotsDir);
                    } catch (e) {}
                    targetUri = vscode.Uri.joinPath(screenshotsDir, message.filename);
                } else {
                    targetUri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(message.filename),
                        filters: { 'Images (*.png)': ['png'] }
                    });
                    if (!targetUri) return;
                }
            }

            await vscode.workspace.fs.writeFile(targetUri, buffer);
            const relPath = vscode.workspace.asRelativePath(targetUri);
            const action = await vscode.window.showInformationMessage(
                `📸 Screenshot saved: ${relPath}`,
                'Open Image',
                'Copy Path'
            );
            if (action === 'Open Image') {
                vscode.commands.executeCommand('vscode.open', targetUri);
            } else if (action === 'Copy Path') {
                vscode.env.clipboard.writeText(targetUri.fsPath);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage('Error saving screenshot: ' + (err?.message || err));
        }
    }

    private getHtml() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>GEE Map Pro</title>
                <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css" />
                <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>
                <style>
                    body { margin: 0; padding: 0; height: 100vh; background: #1e1e1e; }
                    #map { height: 100%; width: 100%; }
                    /* Custom Leaflet Design */
                    .leaflet-bar { border: none !important; box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important; }
                    .leaflet-bar a { background-color: #252526 !important; color: #cccccc !important; border-bottom: 1px solid #383838 !important; }
                    .leaflet-bar a:hover { background-color: #37373d !important; color: #ffffff !important; }
                    .leaflet-control-layers { background: #252526 !important; color: #cccccc !important; border: none !important; box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important; }
                    
                    /* Corrected Drawing Icons Style - Match Zoom Buttons Exactly */
                    .leaflet-draw-toolbar {
                        margin-top: 12px !important;
                        border: none !important;
                    }
                    .leaflet-draw-toolbar a {
                        background-color: #252526 !important;
                        border: 1px solid #383838 !important;
                        width: 30px !important;
                        height: 30px !important;
                        line-height: 30px !important;
                        border-radius: 4px !important;
                        margin-bottom: 2px;
                        position: relative;
                        background-image: none !important; /* Hide original sprite */
                    }
                    .leaflet-draw-toolbar a:hover {
                        background-color: #37373d !important;
                    }
                    /* Add icon as pseudo-element to filter ONLY the icon, not the background */
                    .leaflet-draw-toolbar a::before {
                        content: '';
                        display: block;
                        width: 100%;
                        height: 100%;
                        background-image: url('https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/images/spritesheet.png');
                        background-repeat: no-repeat;
                        filter: invert(100%) brightness(200%);
                    }
                    /* Position the sprite for each tool */
                    .leaflet-draw-draw-polyline::before { background-position: -1px -1px !important; }
                    .leaflet-draw-draw-polygon::before { background-position: -31px -1px !important; }
                    .leaflet-draw-draw-rectangle::before { background-position: -61px -1px !important; }
                    .leaflet-draw-draw-circle::before { background-position: -91px -1px !important; }
                    .leaflet-draw-draw-marker::before { background-position: -121px -1px !important; }
                    .leaflet-draw-edit-edit::before { background-position: -151px -1px !important; }
                    .leaflet-draw-edit-remove::before { background-position: -181px -1px !important; }

                    .leaflet-draw-actions {
                        left: 35px !important;
                    }
                    .leaflet-draw-actions a {
                        background-color: #252526 !important;
                        color: #ffffff !important;
                        border: 1px solid #383838 !important;
                    }

                    /* Sleek Dark Theme for Leaflet Popups (Micro-Dock) */
                    .leaflet-popup-content-wrapper {
                        background: rgba(20, 20, 22, 0.94) !important;
                        backdrop-filter: blur(12px) !important;
                        -webkit-backdrop-filter: blur(12px) !important;
                        color: #e0e0e0 !important;
                        border: 1px solid rgba(255, 255, 255, 0.14) !important;
                        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.65) !important;
                        border-radius: 8px !important;
                        padding: 0px !important;
                        width: auto !important;
                        box-sizing: border-box !important;
                    }
                    .leaflet-popup-tip-container {
                        width: 14px !important;
                        height: 7px !important;
                        margin: 0 auto !important;
                    }
                    .leaflet-popup-tip {
                        width: 8px !important;
                        height: 8px !important;
                        margin: -4px auto 0 !important;
                        padding: 0 !important;
                        background: rgba(20, 20, 22, 0.94) !important;
                        border: 1px solid rgba(255, 255, 255, 0.14) !important;
                        box-shadow: none !important;
                    }
                    .leaflet-popup-content {
                        margin: 4px 6px !important;
                        line-height: normal !important;
                        width: auto !important;
                        min-width: 0 !important;
                        max-width: none !important;
                        box-sizing: border-box !important;
                    }

                    /* Sleek Vertex & Edit Handles (Zero-jitter micro-dots) */
                    .leaflet-editing-icon {
                        border-radius: 50% !important;
                        width: 9px !important;
                        height: 9px !important;
                        margin-left: -4.5px !important;
                        margin-top: -4.5px !important;
                        background: #ffffff !important;
                        border: 2px solid #007acc !important;
                        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6) !important;
                        box-sizing: border-box !important;
                        transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease !important;
                    }
                    .leaflet-editing-icon:hover {
                        background: #4ec9b0 !important;
                        border-color: #ffffff !important;
                        box-shadow: 0 0 8px rgba(78, 201, 176, 0.8) !important;
                        cursor: pointer !important;
                    }
                    .leaflet-editing-icon.leaflet-edit-marker-selected {
                        background: #4ec9b0 !important;
                        border-color: #ffffff !important;
                        box-shadow: 0 0 8px rgba(78, 201, 176, 0.9) !important;
                    }

                    .coords-label {
                        position: absolute;
                        top: 12px;
                        left: 52px;
                        transform: none;
                        z-index: 1000;
                        background: rgba(15, 15, 15, 0.85);
                        backdrop-filter: blur(8px);
                        -webkit-backdrop-filter: blur(8px);
                        color: #00ff00;
                        padding: 4px 14px;
                        border-radius: 20px;
                        font-family: 'JetBrains Mono', 'Consolas', monospace;
                        font-size: 11px;
                        border: 1px solid rgba(255, 255, 255, 0.15);
                        box-shadow: 0 4px 15px rgba(0,0,0,0.6);
                        pointer-events: none;
                        letter-spacing: 0.6px;
                        white-space: nowrap;
                        display: block;
                        width: fit-content !important;
                        height: fit-content !important;
                        line-height: normal !important;
                    }

                    /* Floating Toolbar Styles */
                    .toolbar-container {
                        position: absolute;
                        bottom: 20px;
                        left: 20px;
                        z-index: 1000;
                        display: flex;
                        gap: 8px;
                        align-items: center;
                    }
                    .floating-toolbar {
                        display: flex;
                        gap: 6px;
                        background: rgba(30, 30, 30, 0.75);
                        backdrop-filter: blur(15px);
                        -webkit-backdrop-filter: blur(15px);
                        padding: 5px;
                        border-radius: 10px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        box-shadow: 0 8px 30px rgba(0,0,0,0.5);
                        transition: all 0.3s ease;
                    }
                    .floating-toolbar.hidden {
                        opacity: 0;
                        transform: translateX(-10px) scale(0.95);
                        pointer-events: none;
                    }
                    .floating-toolbar button {
                        background: rgba(255, 255, 255, 0.05);
                        color: #ddd;
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        padding: 4px 10px;
                        border-radius: 6px;
                        font-family: 'Segoe UI', system-ui, sans-serif;
                        font-size: 11px;
                        font-weight: 500;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        display: flex;
                        align-items: center;
                        gap: 5px;
                    }
                    .floating-toolbar button:hover {
                        background: rgba(255, 255, 255, 0.15);
                        color: #fff;
                    }
                    .toolbar-toggle {
                        background: rgba(45, 45, 45, 0.9) !important;
                        color: #fff !important;
                        width: 30px;
                        height: 30px;
                        border-radius: 8px !important;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        border: 1px solid rgba(255, 255, 255, 0.1) !important;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.4);
                        font-size: 14px;
                    }
                    /* Custom GEE Layer & Basemap Manager */
                    .gee-layer-manager {
                        background: rgba(25, 25, 25, 0.94);
                        backdrop-filter: blur(16px);
                        -webkit-backdrop-filter: blur(16px);
                        color: #cccccc;
                        border: 1px solid rgba(255, 255, 255, 0.14);
                        border-radius: 9px;
                        box-shadow: 0 10px 35px rgba(0, 0, 0, 0.65);
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                        font-size: 11.5px;
                        min-width: 240px;
                        max-width: 290px;
                        overflow: hidden;
                        transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
                        user-select: none;
                    }
                    .gee-layer-manager.collapsed {
                        min-width: unset;
                        width: 34px;
                        height: 34px;
                        padding: 0;
                        cursor: pointer;
                        border-radius: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: rgba(35, 35, 35, 0.92);
                    }
                    .gee-layer-manager.collapsed .gee-layer-content {
                        display: none !important;
                    }
                    .gee-layer-toggle-icon {
                        font-size: 17px;
                        display: none;
                    }
                    .gee-layer-manager.collapsed .gee-layer-toggle-icon {
                        display: block;
                    }
                    .gee-layer-header {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 6px 10px;
                        background: rgba(45, 45, 45, 0.6);
                        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                        font-weight: 600;
                        font-size: 11px;
                        letter-spacing: 0.3px;
                    }
                    .gee-layer-header-actions {
                        display: flex;
                        align-items: center;
                        gap: 5px;
                    }
                    .gee-btn-icon {
                        background: rgba(255, 255, 255, 0.06);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        color: #bbb;
                        border-radius: 5px;
                        padding: 2px 6px;
                        cursor: pointer;
                        font-size: 11px;
                        transition: all 0.15s ease;
                        line-height: normal;
                    }
                    .gee-btn-icon:hover {
                        background: rgba(255, 255, 255, 0.18);
                        color: #fff;
                    }
                    .gee-btn-icon.active {
                        color: #4ec9b0;
                        background: rgba(78, 201, 176, 0.2);
                        border-color: rgba(78, 201, 176, 0.5);
                    }
                    .gee-layer-body {
                        padding: 7px 9px;
                        max-height: 380px;
                        overflow-y: auto;
                    }
                    .gee-layer-body::-webkit-scrollbar {
                        width: 5px;
                    }
                    .gee-layer-body::-webkit-scrollbar-thumb {
                        background: rgba(255, 255, 255, 0.2);
                        border-radius: 3px;
                    }
                    .gee-section-title {
                        font-size: 9.5px;
                        text-transform: uppercase;
                        letter-spacing: 0.8px;
                        color: #888;
                        margin: 5px 0 3px 0;
                        font-weight: 700;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .gee-basemap-select {
                        width: 100%;
                        background: #1e1e1e url('data:image/svg+xml;utf8,<svg fill="%23cccccc" height="18" viewBox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>') no-repeat right 4px center;
                        color: #eee;
                        border: 1px solid #454545;
                        border-radius: 5px;
                        padding: 4px 22px 4px 7px;
                        font-size: 10.5px;
                        outline: none;
                        cursor: pointer;
                        margin-bottom: 6px;
                        -webkit-appearance: none;
                        appearance: none;
                    }
                    .gee-basemap-select:focus {
                        border-color: #007acc;
                    }
                    .gee-layer-item {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 4px 6px;
                        border-radius: 5px;
                        margin-bottom: 3px;
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid rgba(255, 255, 255, 0.05);
                        transition: background 0.15s ease;
                        gap: 8px;
                    }
                    .gee-layer-item:hover {
                        background: rgba(255, 255, 255, 0.08);
                    }
                    .gee-layer-legend {
                        transition: all 0.2s ease;
                    }
                    .gee-hide-legends .gee-layer-legend {
                        display: none !important;
                    }
                    .gee-layer-left {
                        display: flex;
                        align-items: center;
                        gap: 7px;
                        flex: 1;
                        overflow: hidden;
                    }
                    .gee-layer-left input[type="checkbox"] {
                        margin: 0;
                        padding: 0;
                        cursor: pointer;
                        accent-color: #4ec9b0;
                        flex-shrink: 0;
                    }
                    .gee-layer-badge {
                        background: #333;
                        color: #4ec9b0;
                        font-family: 'JetBrains Mono', 'Consolas', monospace;
                        font-size: 9.5px;
                        padding: 2px 4px;
                        border-radius: 3px;
                        font-weight: 600;
                        flex-shrink: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        line-height: 1;
                    }
                    .gee-layer-name {
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        font-size: 11.5px;
                        color: #ddd;
                        line-height: 1.2;
                    }
                    .gee-layer-opacity {
                        width: 50px;
                        accent-color: #4ec9b0;
                        height: 3px;
                        cursor: pointer;
                        flex-shrink: 0;
                        margin: 0;
                    }
                    /* Dark Mode Leaflet Controls */
                    .leaflet-bar a, .leaflet-bar a:hover {
                        background-color: #252526 !important;
                        color: #cccccc !important;
                        border-bottom: 1px solid #3c3c3c !important;
                    }
                    .leaflet-control-zoom-in, .leaflet-control-zoom-out {
                        color: #cccccc !important;
                    }
                    /* Group Styling */
                    .gee-layer-group {
                        margin-top: 5px;
                        margin-bottom: 5px;
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        border-radius: 6px;
                        overflow: hidden;
                        background: rgba(0, 0, 0, 0.25);
                    }
                    .gee-group-header {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 5px 8px;
                        background: rgba(255, 255, 255, 0.05);
                        font-weight: 600;
                        font-size: 11px;
                        cursor: pointer;
                    }
                    .gee-group-items {
                        padding: 4px 6px;
                    }
                    /* Floating HUD Notification */
                    .gee-hud {
                        position: absolute;
                        bottom: 60px;
                        left: 50%;
                        transform: translateX(-50%);
                        background: rgba(15, 15, 15, 0.9);
                        backdrop-filter: blur(12px);
                        -webkit-backdrop-filter: blur(12px);
                        border: 1px solid rgba(78, 201, 176, 0.35);
                        color: #4ec9b0;
                        padding: 6px 18px;
                        border-radius: 20px;
                        font-size: 12px;
                        font-weight: 500;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.7);
                        pointer-events: none;
                        opacity: 0;
                        transition: opacity 0.2s ease, transform 0.2s ease;
                        z-index: 1500;
                        white-space: nowrap;
                    }
                    .gee-hud.show {
                        opacity: 1;
                        transform: translateX(-50%) translateY(-5px);
                    }

                    /* Help Popup */
                    .help-popup {
                        display: none;
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: rgba(30, 30, 30, 0.95);
                        backdrop-filter: blur(20px);
                        padding: 25px;
                        border-radius: 15px;
                        border: 1px solid #444;
                        z-index: 2000;
                        color: white;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.8);
                        width: 300px;
                    }
                    .help-popup h3 { margin-top: 0; color: #00ff00; }
                    .help-popup kbd {
                        background: #444;
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-family: monospace;
                    }
                    .help-popup .close {
                        display: block;
                        margin-top: 15px;
                        text-align: center;
                        color: #aaa;
                        cursor: pointer;
                        text-decoration: underline;
                    }

                    /* Crosshair Inspector Mode */
                    .crosshair-mode, .crosshair-mode .leaflet-interactive, .crosshair-mode .leaflet-container {
                        cursor: crosshair !important;
                    }

                    /* Snapshot Modal */
                    .gee-snapshot-modal {
                        position: fixed;
                        bottom: 65px;
                        right: 20px;
                        background: rgba(25, 25, 25, 0.96);
                        backdrop-filter: blur(18px);
                        -webkit-backdrop-filter: blur(18px);
                        border: 1px solid rgba(255, 255, 255, 0.15);
                        border-radius: 12px;
                        box-shadow: 0 15px 45px rgba(0,0,0,0.7);
                        width: 290px;
                        z-index: 2500;
                        color: #ddd;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                        font-size: 12px;
                        overflow: hidden;
                        animation: snapFadeIn 0.18s ease-out;
                    }
                    @keyframes snapFadeIn {
                        from { opacity: 0; transform: translateY(8px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    .gee-modal-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 8px 12px;
                        background: rgba(45, 45, 45, 0.6);
                        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                        font-weight: 600;
                        font-size: 12px;
                    }
                    .gee-modal-close {
                        background: none;
                        border: none;
                        color: #aaa;
                        cursor: pointer;
                        font-size: 14px;
                        padding: 0 4px;
                    }
                    .gee-modal-close:hover { color: #fff; }
                    .gee-modal-body {
                        padding: 12px;
                    }
                    .gee-modal-opts {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        margin-bottom: 12px;
                    }
                    .gee-modal-opts label {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        cursor: pointer;
                        font-size: 11.5px;
                        color: #ccc;
                    }
                    .gee-modal-opts input[type="checkbox"] {
                        accent-color: #4ec9b0;
                        cursor: pointer;
                    }
                    .gee-modal-actions {
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                    }
                    .gee-btn-action {
                        border: none;
                        border-radius: 6px;
                        padding: 7px 10px;
                        font-size: 11.5px;
                        font-weight: 500;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 6px;
                        transition: background 0.15s ease;
                    }
                    .gee-btn-action.primary {
                        background: #007acc;
                        color: white;
                    }
                    .gee-btn-action.primary:hover {
                        background: #0098ff;
                    }
                    .gee-btn-action.secondary {
                        background: rgba(255, 255, 255, 0.08);
                        color: #ddd;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                    }
                    .gee-btn-action.secondary:hover {
                        background: rgba(255, 255, 255, 0.16);
                        color: #fff;
                    }
                </style>
            </head>
            <body>
                <div id="map" tabindex="0" style="outline: none;"></div>
                <div id="coords" class="coords-label">Lat: 0.0000, Lng: 0.0000</div>
                <div id="mapHud" class="gee-hud"></div>
                
                <div class="toolbar-container" style="left: 20px; bottom: 20px;">
                    <button class="toolbar-toggle" onclick="showHelp()" title="Help & Shortcuts">❓</button>
                </div>

                <div class="toolbar-container" style="right: 20px; bottom: 20px; left: auto; display: flex; flex-direction: column; gap: 8px;">
                    <button class="toolbar-toggle" id="btn-swipe" onclick="toggleSwipeMode()" title="Swipe Tool (Before/After Comparison) - Hold Shift for Horizontal Mode" style="font-size: 15px; border: 1px solid rgba(255, 255, 255, 0.1);">🔀</button>
                    <button class="toolbar-toggle" style="background: rgba(180, 40, 40, 0.9) !important; border: 1px solid rgba(255, 120, 120, 0.4) !important; font-size: 15px;" onclick="promptResetEnv()" title="Reset Environment & Map">🧹</button>
                </div>

                <div id="swipe-divider" style="display: none; position: absolute; top: 0; bottom: 0; left: 50%; width: 3px; background: #fff; z-index: 1000; cursor: col-resize; box-shadow: 0 0 10px rgba(0,0,0,0.6);">
                    <div id="swipe-handle" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 14px; height: 36px; background: #fff; border-radius: 3px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 5px rgba(0,0,0,0.5);">
                        <span id="swipe-icon" style="color: #666; font-size: 9px; font-weight: bold; transform: rotate(90deg);">=</span>
                    </div>
                </div>

                <div id="resetConfirmModal" class="gee-snapshot-modal" style="display: none; width: 280px; z-index: 2100;">
                    <div class="gee-modal-header" style="background: rgba(220, 50, 50, 0.2); border-bottom: 1px solid rgba(255, 100, 100, 0.2);">
                        <span>⚠️ Confirm Reset</span>
                        <button class="gee-modal-close" onclick="cancelResetEnv()">✕</button>
                    </div>
                    <div class="gee-modal-body" style="gap: 12px;">
                        <div style="font-size: 12px; color: #ccc; line-height: 1.4;">
                            Do you want to reset the execution environment and clear all map layers?
                        </div>
                        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
                            <button class="gee-btn-action secondary" style="flex: 1;" onclick="cancelResetEnv()">Cancel</button>
                            <button class="gee-btn-action" style="background: #e51400; color: white; flex: 1;" onclick="confirmResetEnv()">🧹 Yes, reset</button>
                        </div>
                    </div>
                </div>

                <div id="snapshotModal" class="gee-snapshot-modal" style="display: none;">
                    <div class="gee-modal-header">
                        <span>📸 HD Map Snapshot</span>
                        <button class="gee-modal-close" onclick="toggleSnapshotModal()">✕</button>
                    </div>
                    <div class="gee-modal-body">
                        <div class="gee-modal-opts">
                            <label><input type="checkbox" id="snapOptHd" checked /> High Resolution (2x Retina HD)</label>
                            <label><input type="checkbox" id="snapOptCoords" checked /> Include coordinates and scale</label>
                            <label><input type="checkbox" id="snapOptDrawings" checked /> Include drawings and annotations</label>
                        </div>
                        <div class="gee-modal-actions">
                            <button class="gee-btn-action primary" onclick="takeSnapshot('workspace')">💾 Save to Screenshots/</button>
                            <button class="gee-btn-action secondary" onclick="takeSnapshot('saveAs')">📁 Save As...</button>
                            <button class="gee-btn-action secondary" onclick="takeSnapshot('clipboard')">📋 Copy to Clipboard</button>
                        </div>
                    </div>
                </div>

                <div id="helpPopup" class="help-popup">
                    <h3>GEE IDE Shortcuts</h3>
                    <p><kbd>Cmd</kbd> + <kbd>Enter</kbd> : Run Selection / Smart Block</p>
                    <p><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd> : Run Entire Script</p>
                    <p><kbd>Cmd</kbd> + <kbd>1..4</kbd> : Switch Focus (Editor/Console/Map/AI)</p>
                    <p><kbd>Option</kbd> + <kbd>S</kbd> : Map Snapshot (HD Screenshot)</p>
                    <p><kbd>1..9</kbd> / <kbd>Alt</kbd> + <kbd>1..9</kbd> : Toggle Layer 1..9</p>
                    <p><kbd>0</kbd> / <kbd>Alt</kbd> + <kbd>0</kbd> : Toggle All Layers</p>
                    <p><kbd>↑ ↓ ← →</kbd> / <kbd>+</kbd> <kbd>-</kbd> : Pan & Zoom Map</p>
                    <hr style="border: 0; border-top: 1px solid #444;">
                    <p><small>Reset (🧹) clears environment variables to avoid redeclaration errors.</small></p>
                    <div class="close" onclick="showHelp()">Close</div>
                </div>

                <script>
                    let vscode;
                    try {
                        vscode = acquireVsCodeApi();
                    } catch (e) {
                        vscode = window.__vscodeApi;
                    }
                    window.__vscodeApi = vscode;

                    window.onerror = function(message, source, lineno, colno, error) {
                        try {
                            if (vscode && vscode.postMessage) {
                                vscode.postMessage({
                                    command: 'webviewError',
                                    message: String(message) + ' (line ' + lineno + ')',
                                    stack: error ? error.stack : ''
                                });
                            }
                        } catch (e) {}
                    };

                    let webviewState = {};
                    try {
                        if (vscode && vscode.getState) {
                            webviewState = vscode.getState() || {};
                        }
                    } catch (e) {}

                    function getSetting(key, fallback) {
                        if (webviewState && webviewState[key] !== undefined) {
                            return webviewState[key];
                        }
                        try {
                            if (typeof window !== 'undefined' && window.localStorage) {
                                const v = localStorage.getItem(key);
                                if (v !== null && v !== undefined) return v;
                            }
                        } catch (e) {}
                        return fallback;
                    }

                    function setSetting(key, val) {
                        try {
                            webviewState[key] = val;
                            if (vscode && vscode.setState) {
                                vscode.setState(webviewState);
                            }
                        } catch (e) {}
                        try {
                            if (typeof window !== 'undefined' && window.localStorage) {
                                localStorage.setItem(key, String(val));
                            }
                        } catch (e) {}
                    }
                    
                    function showHelp() {
                        const hp = document.getElementById('helpPopup');
                        hp.style.display = hp.style.display === 'block' ? 'none' : 'block';
                    }

                    function runAll() { vscode.postMessage({ command: 'runAll' }); }
                    function runLine() { vscode.postMessage({ command: 'runLine' }); }
                    function promptResetEnv() {
                        const m = document.getElementById('resetConfirmModal');
                        if (m) m.style.display = 'block';
                    }
                    function cancelResetEnv() {
                        const m = document.getElementById('resetConfirmModal');
                        if (m) m.style.display = 'none';
                    }
                    function confirmResetEnv() {
                        const m = document.getElementById('resetConfirmModal');
                        if (m) m.style.display = 'none';
                        vscode.postMessage({ command: 'reset' });
                        showHud('🧹 Environment & map reset');
                    }
                    function resetEnv() { promptResetEnv(); }
                    
                    // Basemap Definitions (100% Free - No API Key required)
                    const baseMaps = {
                        "hybrid": {
                            name: "Google Hybrid (Satellite + Labels)",
                            layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 24, maxNativeZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; Google' })
                        },
                        "satellite": {
                            name: "Google Satellite (Pure Satellite)",
                            layer: L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 24, maxNativeZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; Google' })
                        },
                        "streets": {
                            name: "Google Streets (Roads / Streets)",
                            layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 24, maxNativeZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; Google' })
                        },
                        "terrain": {
                            name: "Google Terrain (Relief / Topo)",
                            layer: L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', { maxZoom: 24, maxNativeZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; Google' })
                        },
                        "esri": {
                            name: "Esri World Imagery (HD Aerial)",
                            layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 24, maxNativeZoom: 19, crossOrigin: 'anonymous', attribution: '&copy; Esri' })
                        },
                        "esridark": {
                            name: "Esri Dark Gray (Dark Mode)",
                            layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 24, maxNativeZoom: 16, crossOrigin: 'anonymous', attribution: '&copy; Esri' })
                        },
                        "osm": {
                            name: "OpenStreetMap (Standard)",
                            layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 24, maxNativeZoom: 19, crossOrigin: 'anonymous', attribution: '&copy; OpenStreetMap' })
                        },
                        "opentopo": {
                            name: "OpenTopoMap (Topographic)",
                            layer: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 24, maxNativeZoom: 17, crossOrigin: 'anonymous', attribution: '&copy; OpenTopoMap' })
                        }
                    };

                    let currentBaseKey = getSetting('gee_selected_basemap', 'hybrid');
                    if (!baseMaps[currentBaseKey]) currentBaseKey = 'hybrid';
                    let activeBaseLayer = baseMaps[currentBaseKey].layer;

                    const map = L.map('map', {
                        center: [-12.0464, -77.0428],
                        zoom: 5,
                        maxZoom: 24,
                        preferCanvas: true,
                        layers: [activeBaseLayer]
                    });

                    function setBasemap(key) {
                        if (key === currentBaseKey || !baseMaps[key]) return;
                        map.removeLayer(activeBaseLayer);
                        currentBaseKey = key;
                        activeBaseLayer = baseMaps[key].layer;
                        activeBaseLayer.addTo(map);
                        if (activeBaseLayer.bringToBack) activeBaseLayer.bringToBack();
                        geeLayers.forEach(item => {
                            if (map.hasLayer(item.layer) && item.layer.bringToFront) {
                                item.layer.bringToFront();
                            }
                        });
                        setSetting('gee_selected_basemap', key);
                        showHud('🗺️ ' + baseMaps[key].name.split(' (')[0]);
                    }

                    // Floating HUD Notification
                    let hudTimer = null;
                    function showHud(text) {
                        const hud = document.getElementById('mapHud');
                        if (!hud) return;
                        hud.textContent = text;
                        hud.classList.add('show');
                        if (hudTimer) clearTimeout(hudTimer);
                        hudTimer = setTimeout(() => {
                            hud.classList.remove('show');
                        }, 1400);
                    }

                    // Custom SVG Marker Icon Generator (Crisp HD & Safe Base64 Data URI)
                    function createPinIcon(fillColor = '#2A81CB') {
                        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41" width="25" height="41">' +
                            '<path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="' + fillColor + '" stroke="#FFFFFF" stroke-width="1.5"/>' +
                            '<circle cx="12.5" cy="12.5" r="4.5" fill="#FFFFFF"/>' +
                            '</svg>';
                        return L.icon({
                            iconUrl: 'data:image/svg+xml;base64,' + btoa(svg),
                            iconSize: [25, 41],
                            iconAnchor: [12, 41],
                            popupAnchor: [0, -42],
                            shadowUrl: ''
                        });
                    }

                    const defaultPinIcon = createPinIcon('#2A81CB');
                    L.Marker.prototype.options.icon = defaultPinIcon;

                    // Drawing Implementation & Localization
                    if (window.L && L.drawLocal) {
                        L.drawLocal.draw.toolbar.buttons.polygon = 'Draw Polygon';
                        L.drawLocal.draw.toolbar.buttons.polyline = 'Draw Polyline';
                        L.drawLocal.draw.toolbar.buttons.rectangle = 'Draw Rectangle';
                        L.drawLocal.draw.toolbar.buttons.marker = 'Place Marker / Point';
                    }

                    const drawnItems = new L.FeatureGroup();
                    map.addLayer(drawnItems);

                    // Left toolbar only keeps geometry creation tools (cleaner UI)
                    const drawControl = new L.Control.Draw({
                        edit: false,
                        draw: {
                            polygon: true,
                            polyline: true,
                            rectangle: true,
                            circle: false,
                            marker: { icon: defaultPinIcon },
                            circlemarker: false
                        }
                    });
                    map.addControl(drawControl);

                    // Contextual Mini-Toolbar for Individual Geometries (Ultra-compact & Elevated)
                    function attachGeometryPopup(layer) {
                        const isMarker = layer instanceof L.Marker;
                        const popupOffset = isMarker ? [0, -8] : [0, -18];

                        layer.bindPopup(function() {
                            const container = document.createElement('div');
                            container.style.cssText = 'display: flex; flex-direction: column; gap: 2px; padding: 2px; align-items: center;';

                            const row = document.createElement('div');
                            row.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%;';

                            // 1. Edit / Save button (only affects this specific object)
                            const isEditing = layer._isEditing || false;
                            const btnEdit = document.createElement('button');
                            btnEdit.title = isEditing ? 'Save changes' : 'Edit / Move shape';
                            btnEdit.innerHTML = isEditing ? '💾' : '✏️';
                            btnEdit.style.cssText = 'width: 22px; height: 22px; border-radius: 4px; border: ' + (isEditing ? '1px solid rgba(78, 201, 176, 0.5)' : 'none') + '; background: ' + (isEditing ? 'rgba(78, 201, 176, 0.25)' : 'transparent') + '; color: #fff; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; padding: 0;';
                            
                            btnEdit.onmouseover = function() {
                                if (!layer._isEditing) btnEdit.style.background = 'rgba(255, 255, 255, 0.15)';
                            };
                            btnEdit.onmouseout = function() {
                                if (!layer._isEditing) btnEdit.style.background = 'transparent';
                            };

                            btnEdit.onclick = function(e) {
                                e.stopPropagation();
                                if (layer._isEditing) {
                                    // Save edit
                                    if (layer instanceof L.Marker) {
                                        if (layer.dragging) layer.dragging.disable();
                                    } else if (layer.editing) {
                                        layer.editing.disable();
                                    }
                                    layer._isEditing = false;
                                    btnEdit.innerHTML = '✏️';
                                    btnEdit.title = 'Edit / Move shape';
                                    btnEdit.style.background = 'transparent';
                                    btnEdit.style.border = 'none';
                                    showHud('💾 Geometry saved');
                                    vscode.postMessage({
                                        command: 'geometryEdited',
                                        geometry: layer.toGeoJSON()
                                    });
                                } else {
                                    // Start edit
                                    if (layer instanceof L.Marker) {
                                        if (layer.dragging) layer.dragging.enable();
                                    } else if (layer.editing) {
                                        layer.editing.enable();
                                    }
                                    layer._isEditing = true;
                                    btnEdit.innerHTML = '💾';
                                    btnEdit.title = 'Guardar cambios';
                                    btnEdit.style.background = 'rgba(78, 201, 176, 0.3)';
                                    btnEdit.style.border = '1px solid rgba(78, 201, 176, 0.6)';
                                    showHud(layer instanceof L.Marker ? '📍 Arrastra el marcador para moverlo' : '✏️ Arrastra los vértices para editar');
                                }
                            };

                            function applyColorToLayer(layer, col) {
                                if (!col) return;
                                if (!col.startsWith('#')) col = '#' + col;
                                layer._customColor = col;
                                if (layer instanceof L.Marker) {
                                    layer.setIcon(createPinIcon(col));
                                } else if (layer.setStyle) {
                                    layer.setStyle({ color: col, fillColor: col });
                                }
                                showHud('🎨 Color: ' + col.toUpperCase());
                            }

                            // 2. Color picker button
                            const btnColor = document.createElement('button');
                            btnColor.title = 'Cambiar color';
                            btnColor.innerHTML = '🎨';
                            btnColor.style.cssText = 'width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: #fff; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; padding: 0;';
                            btnColor.onmouseover = function() { btnColor.style.background = 'rgba(255, 255, 255, 0.15)'; };
                            btnColor.onmouseout = function() { if (colorPalette.style.display !== 'flex') btnColor.style.background = 'transparent'; };

                            const colorPalette = document.createElement('div');
                            colorPalette.style.cssText = 'display: none; flex-direction: column; gap: 4px; margin-top: 3px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.12); width: 130px; box-sizing: border-box;';

                            // Row 1: Extended Preset Dots (10 colors in 2 rows of 5)
                            const dotsGrid = document.createElement('div');
                            dotsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; justify-items: center; width: 100%;';

                            const presetColors = [
                                '#2A81CB', // Ocean Blue
                                '#00BCD4', // Cyan
                                '#00E676', // Emerald
                                '#FFEA00', // Yellow
                                '#FF9800', // Orange
                                '#F44336', // Red
                                '#E91E63', // Magenta Pink
                                '#9C27B0', // Purple
                                '#607D8B', // Slate / Gray
                                '#FFFFFF'  // White
                            ];

                            presetColors.forEach(col => {
                                const dot = document.createElement('div');
                                dot.style.cssText = 'width: 12px; height: 12px; border-radius: 50%; background: ' + col + '; cursor: pointer; border: 1px solid rgba(255,255,255,0.35); transition: transform 0.1s ease; box-sizing: border-box;';
                                dot.title = col;
                                dot.onmouseover = function() { dot.style.transform = 'scale(1.3)'; };
                                dot.onmouseout = function() { dot.style.transform = 'scale(1.0)'; };
                                dot.onclick = function(e) {
                                    e.stopPropagation();
                                    applyColorToLayer(layer, col);
                                    colorPalette.style.display = 'none';
                                    btnColor.style.background = 'transparent';
                                };
                                dotsGrid.appendChild(dot);
                            });
                            colorPalette.appendChild(dotsGrid);

                            // Row 2: Custom HTML/HEX Input + Native Color Picker
                            const customRow = document.createElement('div');
                            customRow.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-top: 2px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); width: 100%; box-sizing: border-box;';

                            // Rainbow native picker trigger
                            const pickerLabel = document.createElement('label');
                            pickerLabel.title = 'Selector visual / Espectro de color';
                            pickerLabel.style.cssText = 'cursor: pointer; width: 18px; height: 18px; border-radius: 4px; background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.3); position: relative; overflow: hidden; flex-shrink: 0;';

                            const nativeColorInput = document.createElement('input');
                            nativeColorInput.type = 'color';
                            nativeColorInput.value = layer._customColor || '#2A81CB';
                            nativeColorInput.style.cssText = 'opacity: 0; position: absolute; width: 100%; height: 100%; cursor: pointer; top: 0; left: 0; border: none; padding: 0;';
                            pickerLabel.appendChild(nativeColorInput);

                            // Hex code text input (accepts full HTML color with #, e.g. #F46D43)
                            const hexWrap = document.createElement('div');
                            hexWrap.style.cssText = 'display: flex; align-items: center; background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 4px; padding: 1px 4px; flex: 1; min-width: 0;';

                            const hexInput = document.createElement('input');
                            hexInput.type = 'text';
                            hexInput.placeholder = '#F46D43';
                            hexInput.maxLength = 16;
                            const curHex = (layer._customColor || '#2A81CB').toUpperCase();
                            hexInput.value = curHex.startsWith('#') ? curHex : '#' + curHex;
                            hexInput.style.cssText = 'width: 100%; min-width: 48px; background: transparent; border: none; outline: none; color: #fff; font-family: "JetBrains Mono", "Consolas", monospace; font-size: 10px; text-transform: uppercase; padding: 0;';

                            function normalizeHtmlColor(str) {
                                if (!str) return null;
                                let clean = str.trim().replace(/['"]/g, '');
                                if (/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(clean)) {
                                    if (!clean.startsWith('#')) clean = '#' + clean;
                                    if (clean.length === 4) {
                                        clean = '#' + clean[1] + clean[1] + clean[2] + clean[2] + clean[3] + clean[3];
                                    }
                                    return clean.toUpperCase();
                                }
                                const testEl = document.createElement('div');
                                testEl.style.color = clean;
                                if (testEl.style.color) {
                                    return clean.toLowerCase();
                                }
                                return null;
                            }

                            const applyHex = function(closePanel = true) {
                                const norm = normalizeHtmlColor(hexInput.value);
                                if (norm) {
                                    if (norm.startsWith('#')) {
                                        hexInput.value = norm;
                                        if (norm.length === 7) nativeColorInput.value = norm;
                                    }
                                    applyColorToLayer(layer, norm);
                                    if (closePanel) {
                                        colorPalette.style.display = 'none';
                                        btnColor.style.background = 'transparent';
                                    }
                                } else if (closePanel) {
                                    showHud('⚠️ Invalid HTML/HEX color (e.g. #F46D43)');
                                }
                            };

                            hexInput.oninput = function(e) {
                                e.stopPropagation();
                                const norm = normalizeHtmlColor(hexInput.value);
                                if (norm) {
                                    applyColorToLayer(layer, norm);
                                    if (norm.startsWith('#') && norm.length === 7) {
                                        nativeColorInput.value = norm;
                                    }
                                }
                            };

                            nativeColorInput.oninput = function(e) {
                                e.stopPropagation();
                                const val = e.target.value.toUpperCase();
                                hexInput.value = val;
                                applyColorToLayer(layer, val);
                            };

                            hexInput.onkeydown = function(e) {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                    applyHex(true);
                                }
                            };

                            hexWrap.appendChild(hexInput);

                            // Apply button (check mark)
                            const btnApply = document.createElement('button');
                            btnApply.title = 'Apply HTML / HEX color';
                            btnApply.innerHTML = '✓';
                            btnApply.style.cssText = 'width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(78, 201, 176, 0.5); background: rgba(78, 201, 176, 0.25); color: #4ec9b0; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; font-weight: bold;';
                            btnApply.onmouseover = function() { btnApply.style.background = 'rgba(78, 201, 176, 0.4)'; };
                            btnApply.onmouseout = function() { btnApply.style.background = 'rgba(78, 201, 176, 0.25)'; };
                            btnApply.onclick = function(e) {
                                e.stopPropagation();
                                applyHex(true);
                            };

                            customRow.appendChild(pickerLabel);
                            customRow.appendChild(hexWrap);
                            customRow.appendChild(btnApply);
                            colorPalette.appendChild(customRow);

                            btnColor.onclick = function(e) {
                                e.stopPropagation();
                                const isOpen = colorPalette.style.display === 'flex';
                                colorPalette.style.display = isOpen ? 'none' : 'flex';
                                btnColor.style.background = isOpen ? 'transparent' : 'rgba(255, 255, 255, 0.18)';
                                if (!isOpen) {
                                    const cur = (layer._customColor || (layer instanceof L.Marker ? '#2A81CB' : '#3388FF')).toUpperCase();
                                    hexInput.value = cur.startsWith('#') ? cur : '#' + cur;
                                    if (cur.startsWith('#') && cur.length === 7) {
                                        nativeColorInput.value = cur;
                                    }
                                }
                            };

                            // 3. Delete button & Inline Confirmation Row
                            const btnDelete = document.createElement('button');
                            btnDelete.title = 'Delete object';
                            btnDelete.innerHTML = '🗑️';
                            btnDelete.style.cssText = 'width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: #fff; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; padding: 0;';
                            btnDelete.onmouseover = function() { btnDelete.style.background = 'rgba(235, 60, 60, 0.3)'; };
                            btnDelete.onmouseout = function() { btnDelete.style.background = 'transparent'; };

                            // Confirmation row (initially hidden, prevents accidental deletions)
                            const confirmRow = document.createElement('div');
                            confirmRow.style.cssText = 'display: none; align-items: center; justify-content: center; gap: 5px; padding: 1px 2px;';

                            const confirmLabel = document.createElement('span');
                            confirmLabel.textContent = 'Delete?';
                            confirmLabel.style.cssText = 'font-size: 11px; color: #ff6b6b; font-weight: 600; white-space: nowrap;';

                            const btnConfirmYes = document.createElement('button');
                            btnConfirmYes.title = 'Yes, delete permanently';
                            btnConfirmYes.textContent = '✓';
                            btnConfirmYes.style.cssText = 'width: 20px; height: 20px; border-radius: 4px; border: none; background: #e51400; color: #fff; font-size: 11px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; transition: background 0.15s ease;';
                            btnConfirmYes.onmouseover = function() { btnConfirmYes.style.background = '#ff2a1a'; };
                            btnConfirmYes.onmouseout = function() { btnConfirmYes.style.background = '#e51400'; };

                            const btnConfirmNo = document.createElement('button');
                            btnConfirmNo.title = 'Cancel';
                            btnConfirmNo.textContent = '✕';
                            btnConfirmNo.style.cssText = 'width: 20px; height: 20px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.1); color: #ccc; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; transition: all 0.15s ease;';
                            btnConfirmNo.onmouseover = function() { btnConfirmNo.style.background = 'rgba(255,255,255,0.2)'; btnConfirmNo.style.color = '#fff'; };
                            btnConfirmNo.onmouseout = function() { btnConfirmNo.style.background = 'rgba(255,255,255,0.1)'; btnConfirmNo.style.color = '#ccc'; };

                            confirmRow.appendChild(confirmLabel);
                            confirmRow.appendChild(btnConfirmYes);
                            confirmRow.appendChild(btnConfirmNo);

                            btnDelete.onclick = function(e) {
                                e.stopPropagation();
                                colorPalette.style.display = 'none';
                                btnColor.style.background = 'transparent';
                                row.style.display = 'none';
                                confirmRow.style.display = 'flex';
                            };

                            btnConfirmNo.onclick = function(e) {
                                e.stopPropagation();
                                confirmRow.style.display = 'none';
                                row.style.display = 'flex';
                            };

                            btnConfirmYes.onclick = function(e) {
                                e.stopPropagation();
                                if (layer._isEditing) {
                                    if (layer instanceof L.Marker && layer.dragging) layer.dragging.disable();
                                    if (layer.editing) layer.editing.disable();
                                }
                                drawnItems.removeLayer(layer);
                                map.closePopup();
                                showHud('🗑️ Geometry deleted');
                                vscode.postMessage({
                                    command: 'geometryDeleted',
                                    layers: drawnItems.toGeoJSON()
                                });
                            };

                            row.appendChild(btnEdit);
                            row.appendChild(btnColor);
                            row.appendChild(btnDelete);
                            container.appendChild(row);
                            container.appendChild(confirmRow);
                            container.appendChild(colorPalette);

                            return container;
                        }, { closeButton: false, offset: popupOffset, maxWidth: 300, minWidth: 50 });

                        if (layer instanceof L.Marker) {
                            layer.on('dragend', function() {
                                showHud('📍 Position updated');
                                vscode.postMessage({
                                    command: 'geometryEdited',
                                    geometry: layer.toGeoJSON()
                                });
                                setTimeout(() => {
                                    layer.openPopup();
                                }, 50);
                            });
                        }
                    }

                    map.on(L.Draw.Event.CREATED, function (event) {
                        const layer = event.layer;
                        drawnItems.addLayer(layer);
                        attachGeometryPopup(layer);

                        vscode.postMessage({
                            command: 'geometryCreated',
                            type: event.layerType,
                            geometry: layer.toGeoJSON()
                        });
                    });

                    const coordsDiv = document.getElementById('coords');

                    map.on('mousemove', (e) => {
                        coordsDiv.innerHTML = 'Lat: ' + e.latlng.lat.toFixed(4) + ', Lng: ' + e.latlng.lng.toFixed(4);
                    });

                    // Pixel Inspector: Listen for modifier keys to toggle crosshair
                    document.addEventListener('keydown', (e) => {
                        if (e.altKey || e.metaKey || e.ctrlKey) {
                            document.getElementById('map').classList.add('crosshair-mode');
                        }
                        if (e.key === 'Escape') {
                            map.closePopup();
                        }
                    });
                    document.addEventListener('keyup', (e) => {
                        if (!e.altKey && !e.metaKey && !e.ctrlKey) {
                            document.getElementById('map').classList.remove('crosshair-mode');
                        }
                    });

                    // Pixel Inspector: Send coordinates only on Alt/Cmd/Ctrl + Click
                    map.on('click', (e) => {
                        const evt = e.originalEvent;
                        if ((evt.metaKey || evt.ctrlKey) && evt.shiftKey) {
                            // Cmd + Shift + Click -> Fly to Google Earth
                            vscode.postMessage({
                                command: 'flyToGoogleEarth',
                                lat: e.latlng.lat,
                                lng: e.latlng.lng
                            });
                        } else if (evt.altKey || evt.metaKey || evt.ctrlKey) {
                            // Standard Modifier + Click -> Inspect Pixel
                            vscode.postMessage({
                                command: 'mapClicked',
                                lat: e.latlng.lat,
                                lng: e.latlng.lng
                            });
                        }
                    });

                    const geeLayers = [];
                    let isPinned = getSetting('gee_layers_pinned', false) === true || getSetting('gee_layers_pinned', 'false') === 'true';

                    // Custom Layer Manager Control
                    const layerManagerControl = new L.Control({ position: 'topright' });
                    layerManagerControl.onAdd = function() {
                        const container = L.DomUtil.create('div', 'gee-layer-manager' + (isPinned ? ' pinned' : ' collapsed'));
                        container.id = 'layerManager';
                        L.DomEvent.disableClickPropagation(container);
                        L.DomEvent.disableScrollPropagation(container);

                        const optionsHtml = Object.keys(baseMaps).map(k => 
                            '<option value="' + k + '" ' + (k === currentBaseKey ? 'selected' : '') + '>' + baseMaps[k].name + '</option>'
                        ).join('');

                        container.innerHTML = 
                            '<div class="gee-layer-toggle-icon" title="Layers & Basemaps">🗺️</div>' +
                            '<div class="gee-layer-content">' +
                                '<div class="gee-layer-header">' +
                                    '<span>Layers</span>' +
                                    '<div class="gee-layer-header-actions">' +
                                        '<button class="gee-btn-icon" id="snapHeaderBtn" title="HD Map Snapshot [Shortcut: Option+S]">📸</button>' +
                                        '<button class="gee-btn-icon" id="toggleAllBtn" title="Toggle All Layers (Shortcut: 0)">[0] All</button>' +
                                        '<button class="gee-btn-icon ' + (isPinned ? 'active' : '') + '" id="pinBtn" title="' + (isPinned ? 'Unpin panel' : 'Pin panel (📌)') + '">📌</button>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="gee-layer-body">' +
                                    '<div class="gee-section-title">' +
                                        '<span>🗺️ BASEMAP</span>' +
                                    '</div>' +
                                    '<select class="gee-basemap-select" id="basemapSelect">' +
                                        optionsHtml +
                                    '</select>' +
                                    '<div class="gee-section-title" style="display: flex; justify-content: space-between; align-items: center;">' +
                                        '<span>🛰️ EE LAYERS</span>' +
                                        '<div style="display: flex; align-items: center; gap: 8px;">' +
                                            '<label style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: #9cdcfe; cursor: pointer; user-select: none;" title="Toggle legends visibility">' +
                                                '<input type="checkbox" id="toggleLegendsChk" style="cursor: pointer; width: 11px; height: 11px; accent-color: #4ec9b0; margin: 0;" />' +
                                                '<span>LEGENDS</span>' +
                                            '</label>' +
                                            '<span id="layerCount" style="color: #4ec9b0; font-weight: bold;">0</span>' +
                                        '</div>' +
                                    '</div>' +
                                    '<div id="geeLayersList">' +
                                        '<div style="font-size: 11px; color: #777; padding: 4px 2px; font-style: italic;">' +
                                            '(No active layers — run Map.addLayer)' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>';

                        const toggleIcon = container.querySelector('.gee-layer-toggle-icon');
                        toggleIcon.addEventListener('click', () => {
                            container.classList.remove('collapsed');
                        });

                        const snapHBtn = container.querySelector('#snapHeaderBtn');
                        if (snapHBtn) {
                            snapHBtn.addEventListener('click', () => {
                                toggleSnapshotModal();
                            });
                        }

                        const pinBtn = container.querySelector('#pinBtn');
                        pinBtn.addEventListener('click', () => {
                            isPinned = !isPinned;
                            if (isPinned) {
                                container.classList.remove('collapsed');
                                container.classList.add('pinned');
                                pinBtn.classList.add('active');
                                pinBtn.title = "Unpin panel (Auto-hide)";
                            } else {
                                container.classList.remove('pinned');
                                pinBtn.classList.remove('active');
                                pinBtn.title = "Pin panel (📌)";
                            }
                            setSetting('gee_layers_pinned', isPinned);
                        });

                        let hoverTimer = null;
                        container.addEventListener('mouseenter', () => {
                            if (hoverTimer) clearTimeout(hoverTimer);
                            container.classList.remove('collapsed');
                        });
                        container.addEventListener('mouseleave', () => {
                            if (!isPinned) {
                                hoverTimer = setTimeout(() => {
                                    container.classList.add('collapsed');
                                }, 280);
                            }
                        });

                        const bSelect = container.querySelector('#basemapSelect');
                        bSelect.addEventListener('change', (e) => {
                            setBasemap(e.target.value);
                        });

                        const toggleAll = container.querySelector('#toggleAllBtn');
                        toggleAll.addEventListener('click', () => {
                            toggleAllLayers();
                        });

                        let showLegends = getSetting('gee_show_legends', true);
                        if (typeof showLegends === 'string') showLegends = showLegends === 'true';

                        const legendsChk = container.querySelector('#toggleLegendsChk');
                        if (legendsChk) {
                            legendsChk.checked = showLegends !== false;
                            legendsChk.addEventListener('change', (e) => {
                                showLegends = e.target.checked;
                                setSetting('gee_show_legends', showLegends);
                                applyLegendsVisibility();
                            });
                        }

                        window.applyLegendsVisibility = function() {
                            const listEl = document.getElementById('geeLayersList');
                            if (listEl) {
                                if (showLegends === false) {
                                    listEl.classList.add('gee-hide-legends');
                                } else {
                                    listEl.classList.remove('gee-hide-legends');
                                }
                            }
                        };

                        return container;
                    };
                    map.addControl(layerManagerControl);

                    function updateLayerManagerUI() {
                        if (typeof swipeMode !== 'undefined' && swipeMode) {
                            window.toggleSwipeMode();
                        }
                        const listEl = document.getElementById('geeLayersList');
                        const countEl = document.getElementById('layerCount');
                        if (!listEl) return;
                        if (countEl) countEl.textContent = String(geeLayers.length);

                        if (geeLayers.length === 0) {
                            listEl.innerHTML = '<div style="font-size: 11px; color: #777; padding: 4px 2px; font-style: italic;">(No active layers — run Map.addLayer)</div>';
                            return;
                        }

                        const groups = {};
                        const standalone = [];

                        geeLayers.forEach((item, idx) => {
                            const keyShortcut = idx < 9 ? String(idx + 1) : '';
                            const slashIdx = item.name.indexOf('/');
                            if (slashIdx !== -1) {
                                const grpName = item.name.substring(0, slashIdx);
                                const subName = item.name.substring(slashIdx + 1);
                                if (!groups[grpName]) groups[grpName] = [];
                                groups[grpName].push({ item, idx, subName, keyShortcut });
                            } else {
                                standalone.push({ item, idx, subName: item.name, keyShortcut });
                            }
                        });

                        let html = '';

                        Object.keys(groups).forEach(grpName => {
                            const items = groups[grpName];
                            const allVisible = items.every(x => map.hasLayer(x.item.layer));
                            html += 
                                '<div class="gee-layer-group">' +
                                    '<div class="gee-group-header" onclick="toggleGroupCollapse(&quot;' + grpName + '&quot;)">' +
                                        '<div style="display:flex; align-items:center; gap:6px;">' +
                                            '<input type="checkbox" ' + (allVisible ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleGroupVisibility(&quot;' + grpName + '&quot;)" />' +
                                            '<span>📁 ' + grpName + '</span>' +
                                        '</div>' +
                                        '<span style="color:#888; font-size:10px;">' + items.length + ' layers</span>' +
                                    '</div>' +
                                    '<div class="gee-group-items" id="grp_items_' + grpName + '">' +
                                        items.map(x => renderLayerItemHtml(x)).join('') +
                                    '</div>' +
                                '</div>';
                        });

                        html += standalone.map(x => renderLayerItemHtml(x)).join('');
                        listEl.innerHTML = html;
                        if (typeof window.applyLegendsVisibility === 'function') {
                            window.applyLegendsVisibility();
                        }

                        geeLayers.forEach((item, idx) => {
                            const chk = document.getElementById('chk_layer_' + idx);
                            if (chk) {
                                chk.addEventListener('change', (e) => {
                                    toggleLayerByIndex(idx, e.target.checked);
                                });
                            }
                            const opRange = document.getElementById('op_layer_' + idx);
                            if (opRange) {
                                opRange.addEventListener('input', (e) => {
                                    const val = parseFloat(e.target.value);
                                    item.opacity = val;
                                    if (item.layer.setOpacity) item.layer.setOpacity(val);
                                });
                            }
                        });
                    }

                    function toValidCssColor(c) {
                        if (!c) return 'transparent';
                        const s = String(c).trim();
                        if (s.startsWith('#')) return s;
                        const lower = s.toLowerCase();
                        if (lower.startsWith('rgb(') || lower.startsWith('rgba(') || lower.startsWith('hsl(') || lower.startsWith('hsla(')) return s;
                        if (/^[0-9a-fA-F]{3,8}$/.test(s)) return '#' + s;
                        return s;
                    }

                    function renderLayerItemHtml(x) {
                        const isVisible = map.hasLayer(x.item.layer);
                        const badge = x.keyShortcut ? ('<span class="gee-layer-badge" title="Shortcut: ' + x.keyShortcut + ' or Alt+' + x.keyShortcut + '">[' + x.keyShortcut + ']</span>') : '';
                        
                        let legendHtml = '';
                        const vp = x.item.visParams;
                        if (vp) {
                            if (vp.palette) {
                                let palette = vp.palette;
                                if (typeof palette === 'string') {
                                    palette = palette.split(',');
                                }
                                if (Array.isArray(palette) && palette.length > 0) {
                                    palette = palette.map(toValidCssColor);
                                    const gradient = 'linear-gradient(to right, ' + palette.join(', ') + ')';
                                    const minVal = vp.min !== undefined ? vp.min : '';
                                    const maxVal = vp.max !== undefined ? vp.max : '';
                                    
                                    legendHtml = 
                                        '<div class="gee-layer-legend" style="margin-top: 5px; padding-left: 20px;">' +
                                            '<div style="height: 6px; width: 100%; border-radius: 2px; background: ' + gradient + '; border: 1px solid rgba(255,255,255,0.15);"></div>' +
                                            '<div style="display: flex; justify-content: space-between; font-size: 8.5px; color: #888; margin-top: 2px; font-family: monospace;">' +
                                                '<span>' + minVal + '</span>' +
                                                '<span>' + maxVal + '</span>' +
                                            '</div>' +
                                        '</div>';
                                }
                            } else if (vp.min !== undefined && vp.max !== undefined) {
                                const lname = (x.item.name || '').toLowerCase();
                                let gradient = 'linear-gradient(to right, #000000, #ffffff)';
                                if (lname.includes('elevation') || lname.includes('dem') || lname.includes('srtm') || lname.includes('topo')) {
                                    gradient = 'linear-gradient(to right, #006600, #002200, #fff700, #ab7634, #c4d0ff, #ffffff)';
                                } else if (lname.includes('ndvi') || lname.includes('evi') || lname.includes('savi')) {
                                    gradient = 'linear-gradient(to right, #FFFFFF, #CE7E45, #DF923D, #F1B555, #FCD163, #99B718, #74A901, #66A000, #529400, #3E8601, #207401, #056201, #004C00)';
                                } else if (lname.includes('ndwi') || lname.includes('water')) {
                                    gradient = 'linear-gradient(to right, #ffffff, #ff0000, #ffff00, #00ffff, #0000ff)';
                                }
                                legendHtml = 
                                    '<div class="gee-layer-legend" style="margin-top: 5px; padding-left: 20px;">' +
                                        '<div style="height: 6px; width: 100%; border-radius: 2px; background: ' + gradient + '; border: 1px solid rgba(255,255,255,0.15);"></div>' +
                                        '<div style="display: flex; justify-content: space-between; font-size: 8.5px; color: #888; margin-top: 2px; font-family: monospace;">' +
                                            '<span>' + vp.min + '</span>' +
                                            '<span>' + vp.max + '</span>' +
                                        '</div>' +
                                    '</div>';
                            } else if (vp.color) {
                                let col = toValidCssColor(vp.color);
                                legendHtml = 
                                    '<div class="gee-layer-legend" style="margin-top: 4px; padding-left: 20px; display: flex; align-items: center; gap: 6px; font-size: 9px; color: #aaa;">' +
                                        '<span style="display: inline-block; width: 14px; height: 4px; border-radius: 2px; background: ' + col + '; border: 1px solid rgba(255,255,255,0.2);"></span>' +
                                        '<span style="font-family: monospace;">Vector (' + col + ')</span>' +
                                    '</div>';
                            } else if (Array.isArray(vp.bands) && vp.bands.length === 3) {
                                const minVal = vp.min !== undefined ? vp.min : '';
                                const maxVal = vp.max !== undefined ? vp.max : '';
                                legendHtml = 
                                    '<div class="gee-layer-legend" style="margin-top: 4px; padding-left: 20px; display: flex; align-items: center; justify-content: space-between; font-size: 8.5px; color: #888; font-family: monospace;">' +
                                        '<span style="display: flex; align-items: center; gap: 5px;">' +
                                            '<span style="display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: linear-gradient(135deg, #ff4444, #44ff44, #4444ff);"></span>' +
                                            '<span>RGB: ' + vp.bands.join(', ') + '</span>' +
                                        '</span>' +
                                        (minVal !== '' ? ('<span>' + minVal + ' - ' + maxVal + '</span>') : '') +
                                    '</div>';
                            }
                        }
                        
                        return '<div class="gee-layer-item" style="flex-direction: column; align-items: stretch;">' +
                            '<div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">' +
                                '<div class="gee-layer-left">' +
                                    '<input type="checkbox" id="chk_layer_' + x.idx + '" ' + (isVisible ? 'checked' : '') + ' />' +
                                    badge +
                                    '<span class="gee-layer-name" title="' + x.item.name + '">' + x.subName + '</span>' +
                                '</div>' +
                                '<input type="range" class="gee-layer-opacity" id="op_layer_' + x.idx + '" min="0" max="1" step="0.05" value="' + (x.item.opacity !== undefined ? x.item.opacity : 1) + '" title="Opacity" />' +
                            '</div>' +
                            legendHtml +
                        '</div>';
                    }

                    window.toggleGroupVisibility = function(grpName) {
                        const items = geeLayers.filter(l => l.name.startsWith(grpName + '/'));
                        const anyVis = items.some(l => map.hasLayer(l.layer));
                        const target = !anyVis;
                        items.forEach(l => {
                            l.shown = target;
                            if (target) {
                                if (!map.hasLayer(l.layer)) l.layer.addTo(map);
                                if (l.layer.bringToFront) l.layer.bringToFront();
                            } else {
                                if (map.hasLayer(l.layer)) map.removeLayer(l.layer);
                            }
                        });
                        updateLayerManagerUI();
                        showHud(target ? ('👁️ Group ' + grpName + ': Visible') : ('🚫 Group ' + grpName + ': Hidden'));
                    };

                    window.toggleGroupCollapse = function(grpName) {
                        const el = document.getElementById('grp_items_' + grpName);
                        if (el) {
                            el.style.display = el.style.display === 'none' ? 'block' : 'none';
                        }
                    };

                    function toggleLayerByIndex(idx, explicitState) {
                        if (idx < 0 || idx >= geeLayers.length) return;
                        const item = geeLayers[idx];
                        const isVisible = map.hasLayer(item.layer);
                        const target = explicitState !== undefined ? explicitState : !isVisible;
                        if (target) {
                            if (!map.hasLayer(item.layer)) item.layer.addTo(map);
                            if (item.layer.bringToFront) item.layer.bringToFront();
                            item.shown = true;
                            showHud('👁️ [' + (idx + 1) + '] ' + item.name + ': Visible');
                        } else {
                            if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
                            item.shown = false;
                            showHud('🚫 [' + (idx + 1) + '] ' + item.name + ': Hidden');
                        }
                        updateLayerManagerUI();
                    }

                    function toggleAllLayers() {
                        if (geeLayers.length === 0) return;
                        const anyVis = geeLayers.some(l => map.hasLayer(l.layer));
                        const target = !anyVis;
                        geeLayers.forEach(item => {
                            item.shown = target;
                            if (target) {
                                if (!map.hasLayer(item.layer)) item.layer.addTo(map);
                                if (item.layer.bringToFront) item.layer.bringToFront();
                            } else {
                                if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
                            }
                        });
                        updateLayerManagerUI();
                        showHud(target ? '👁️ All layers visible' : '🚫 All layers hidden');
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'addLayer': {
                                if (!message.mapId?.urlFormat) break;
                                const layer = L.tileLayer(message.mapId.urlFormat, {
                                    attribution: 'Google Earth Engine',
                                    opacity: message.opacity !== undefined ? message.opacity : 1.0,
                                    maxZoom: 24,
                                    crossOrigin: 'anonymous'
                                });
                                layer.on('tileerror', function(error) {
                                    console.warn('EE tile load issue:', error);
                                });
                                if (message.shown !== false) {
                                    layer.addTo(map);
                                    if (layer.bringToFront) layer.bringToFront();
                                }
                                const layerName = message.name || 'EE Layer ' + (geeLayers.length + 1);
                                const existingIdx = geeLayers.findIndex(l => l.name === layerName);
                                if (existingIdx !== -1) {
                                    if (map.hasLayer(geeLayers[existingIdx].layer)) {
                                        map.removeLayer(geeLayers[existingIdx].layer);
                                    }
                                    geeLayers[existingIdx] = {
                                        layer,
                                        name: layerName,
                                        shown: message.shown !== false,
                                        opacity: message.opacity !== undefined ? message.opacity : 1.0,
                                        visParams: message.visParams
                                    };
                                } else {
                                    geeLayers.push({
                                        layer,
                                        name: layerName,
                                        shown: message.shown !== false,
                                        opacity: message.opacity !== undefined ? message.opacity : 1.0,
                                        visParams: message.visParams
                                    });
                                }
                                updateLayerManagerUI();
                                map.invalidateSize();
                                break;
                            }
                            case 'showInspectorPopup': {
                                L.popup({ autoClose: true, closeOnClick: false })
                                    .setLatLng([message.lat, message.lon])
                                    .setContent(message.htmlContent)
                                    .openOn(map);
                                break;
                            }
                            case 'setCenter':
                                map.invalidateSize();
                                map.setView([message.lat, message.lng], message.zoom || 10, { animate: false });
                                setTimeout(() => { map.invalidateSize(); }, 200);
                                break;
                            case 'focus': {
                                const mapEl = document.getElementById('map');
                                if (mapEl) mapEl.focus();
                                map.invalidateSize();
                                break;
                            }
                            case 'clear':
                                geeLayers.forEach(item => {
                                    map.removeLayer(item.layer);
                                });
                                geeLayers.length = 0;
                                updateLayerManagerUI();
                                break;
                        }
                    });

                    window.addEventListener('keydown', (e) => {
                        const isCmdOrCtrl = e.metaKey || e.ctrlKey;
                        if (isCmdOrCtrl && ['1', '2', '3', '4'].includes(e.key)) {
                            e.preventDefault();
                            e.stopPropagation();
                            vscode.postMessage({
                                command: 'focusQuadrant',
                                quadrant: Number(e.key)
                            });
                            return;
                        }

                        // Map keyboard navigation: pan & zoom
                        const panStep = 80;
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            map.panBy([0, -panStep]);
                            return;
                        } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            map.panBy([0, panStep]);
                            return;
                        } else if (e.key === 'ArrowLeft') {
                            e.preventDefault();
                            map.panBy([-panStep, 0]);
                            return;
                        } else if (e.key === 'ArrowRight') {
                            e.preventDefault();
                            map.panBy([panStep, 0]);
                            return;
                        } else if (e.key === '+' || e.key === '=') {
                            e.preventDefault();
                            map.zoomIn();
                            return;
                        } else if (e.key === '-' || e.key === '_') {
                            e.preventDefault();
                            map.zoomOut();
                            return;
                        }

                        // Layer toggling shortcuts:
                        // Support direct number 1..9, 0 OR Alt/Option + 1..9, 0
                        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                            return;
                        }

                        const isAlt = e.altKey;

                        // Snapshot shortcut: Option/Alt + S
                        if (isAlt && !isCmdOrCtrl && (e.code === 'KeyS' || e.key === 's' || e.key === 'S' || e.key === 'ß')) {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSnapshotModal();
                            return;
                        }

                        if (e.key === 'Escape') {
                            const snapModal = document.getElementById('snapshotModal');
                            if (snapModal && snapModal.style.display !== 'none') {
                                snapModal.style.display = 'none';
                                return;
                            }
                            const resetModal = document.getElementById('resetConfirmModal');
                            if (resetModal && resetModal.style.display !== 'none') {
                                resetModal.style.display = 'none';
                                return;
                            }
                        }

                        const isDirectNum = !isCmdOrCtrl && !isAlt && /^[0-9]$/.test(e.key);
                        const isAltNum = isAlt && !isCmdOrCtrl && /^[0-9]$/.test(e.key);

                        if (isDirectNum || isAltNum) {
                            e.preventDefault();
                            e.stopPropagation();
                            const num = parseInt(e.key, 10);
                            if (num === 0) {
                                toggleAllLayers();
                            } else {
                                toggleLayerByIndex(num - 1);
                            }
                        }
                    }, true);

                    // Snapshot Implementation
                    window.toggleSnapshotModal = function() {
                        const m = document.getElementById('snapshotModal');
                        if (!m) return;
                        const isVisible = m.style.display === 'block';
                        m.style.display = isVisible ? 'none' : 'block';
                        if (!isVisible) {
                            const optHd = document.getElementById('snapOptHd');
                            const optCoords = document.getElementById('snapOptCoords');
                            const optDraw = document.getElementById('snapOptDrawings');
                            if (optHd) optHd.checked = getSetting('snap_hd', true) !== false;
                            if (optCoords) optCoords.checked = getSetting('snap_coords', true) !== false;
                            if (optDraw) optDraw.checked = getSetting('snap_drawings', true) !== false;
                        }
                    };

                    async function captureMapToCanvas() {
                        const mapEl = document.getElementById('map');
                        if (!mapEl) throw new Error('Mapa no encontrado');

                        const optHd = document.getElementById('snapOptHd');
                        const optCoords = document.getElementById('snapOptCoords');
                        const optDraw = document.getElementById('snapOptDrawings');

                        const isHd = optHd ? optHd.checked : true;
                        const includeCoords = optCoords ? optCoords.checked : true;
                        const includeDrawings = optDraw ? optDraw.checked : true;

                        setSetting('snap_hd', isHd);
                        setSetting('snap_coords', includeCoords);
                        setSetting('snap_drawings', includeDrawings);

                        const scale = isHd ? 2 : 1;
                        const width = mapEl.clientWidth;
                        const height = mapEl.clientHeight;

                        const canvas = document.createElement('canvas');
                        canvas.width = width * scale;
                        canvas.height = height * scale;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) throw new Error('No se pudo inicializar Canvas 2D');
                        ctx.scale(scale, scale);

                        ctx.fillStyle = '#1e1e1e';
                        ctx.fillRect(0, 0, width, height);

                        const mapRect = mapEl.getBoundingClientRect();
                        const tiles = Array.from(mapEl.querySelectorAll('.leaflet-tile-pane img.leaflet-tile'));

                        for (const img of tiles) {
                            if (!img.complete || img.naturalWidth === 0) continue;
                            const style = window.getComputedStyle(img);
                            if (style.display === 'none' || style.visibility === 'hidden') continue;
                            const opacity = parseFloat(style.opacity || '1');
                            if (opacity <= 0) continue;

                            const rect = img.getBoundingClientRect();
                            const x = rect.left - mapRect.left;
                            const y = rect.top - mapRect.top;
                            const w = rect.width;
                            const h = rect.height;

                            if (x + w < 0 || x > width || y + h < 0 || y > height) continue;

                            ctx.save();
                            ctx.globalAlpha = opacity;
                            try {
                                ctx.drawImage(img, x, y, w, h);
                            } catch (e) {
                                console.warn('Tile capture warning:', e);
                            }
                            ctx.restore();
                        }

                        if (includeDrawings) {
                            // 1. Canvases in overlay pane (Leaflet Canvas vector renderer)
                            const overlayCanvases = Array.from(mapEl.querySelectorAll('.leaflet-overlay-pane canvas'));
                            for (const ovCanvas of overlayCanvases) {
                                const style = window.getComputedStyle(ovCanvas);
                                if (style.display === 'none' || style.visibility === 'hidden') continue;
                                const opacity = parseFloat(style.opacity || '1');
                                if (opacity <= 0) continue;
                                const rect = ovCanvas.getBoundingClientRect();
                                const x = rect.left - mapRect.left;
                                const y = rect.top - mapRect.top;
                                ctx.save();
                                ctx.globalAlpha = opacity;
                                try {
                                    ctx.drawImage(ovCanvas, x, y, rect.width, rect.height);
                                } catch (e) {
                                    console.warn('Overlay canvas capture warning:', e);
                                }
                                ctx.restore();
                            }

                            // 2. SVG in overlay pane (fallback if SVG renderer is active)
                            const svgEl = mapEl.querySelector('.leaflet-overlay-pane svg');
                            if (svgEl && overlayCanvases.length === 0) {
                                try {
                                    const svgRect = svgEl.getBoundingClientRect();
                                    const clone = svgEl.cloneNode(true);
                                    clone.style.transform = 'none';
                                    clone.style.webkitTransform = 'none';
                                    const svgString = new XMLSerializer().serializeToString(clone);
                                    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                                    const blobUrl = (window.URL || window.webkitURL).createObjectURL(svgBlob);
                                    const svgImg = new Image();
                                    await new Promise((resolve) => {
                                        svgImg.onload = () => {
                                            ctx.drawImage(svgImg, svgRect.left - mapRect.left, svgRect.top - mapRect.top, svgRect.width, svgRect.height);
                                            (window.URL || window.webkitURL).revokeObjectURL(blobUrl);
                                            resolve();
                                        };
                                        svgImg.onerror = () => {
                                            (window.URL || window.webkitURL).revokeObjectURL(blobUrl);
                                            resolve();
                                        };
                                        svgImg.src = blobUrl;
                                    });
                                } catch (e) {
                                    console.warn('SVG capture warning:', e);
                                }
                            }

                            // 3. Markers & Pins (leaflet-marker-pane)
                            const markers = Array.from(mapEl.querySelectorAll('.leaflet-marker-pane img, .leaflet-marker-pane .leaflet-marker-icon'));
                            for (const marker of markers) {
                                const style = window.getComputedStyle(marker);
                                if (style.display === 'none' || style.visibility === 'hidden') continue;
                                const opacity = parseFloat(style.opacity || '1');
                                if (opacity <= 0) continue;
                                const rect = marker.getBoundingClientRect();
                                const x = rect.left - mapRect.left;
                                const y = rect.top - mapRect.top;
                                if (x + rect.width < 0 || x > width || y + rect.height < 0 || y > height) continue;

                                ctx.save();
                                ctx.globalAlpha = opacity;
                                try {
                                    if (marker instanceof HTMLImageElement && marker.src && marker.src.startsWith('data:')) {
                                        ctx.drawImage(marker, x, y, rect.width, rect.height);
                                    } else {
                                        // Safe vector pin fallback (avoids tainted canvas errors with external CORS-restricted images)
                                        const pinW = rect.width || 25;
                                        const pinH = rect.height || 41;
                                        ctx.translate(x + pinW / 2, y);
                                        ctx.fillStyle = '#2A81CB';
                                        ctx.strokeStyle = '#FFFFFF';
                                        ctx.lineWidth = 1.5;
                                        ctx.beginPath();
                                        ctx.arc(0, 12, 10, Math.PI, 0, false);
                                        ctx.lineTo(0, pinH);
                                        ctx.closePath();
                                        ctx.fill();
                                        ctx.stroke();
                                        ctx.fillStyle = '#FFFFFF';
                                        ctx.beginPath();
                                        ctx.arc(0, 12, 4, 0, Math.PI * 2);
                                        ctx.fill();
                                    }
                                } catch (e) {
                                    console.warn('Marker capture warning:', e);
                                }
                                ctx.restore();
                            }
                        }

                        if (includeCoords) {
                            const center = map.getCenter();
                            const zoom = map.getZoom();
                            const text = 'GEE IDE | Lat: ' + center.lat.toFixed(4) + ', Lng: ' + center.lng.toFixed(4) + ' | Zoom: ' + zoom;

                            ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                            const textW = ctx.measureText(text).width;
                            const badgeW = textW + 24;
                            const badgeH = 24;
                            const badgeX = 14;
                            const badgeY = height - 14 - badgeH;

                            ctx.save();
                            ctx.fillStyle = 'rgba(18, 18, 18, 0.85)';
                            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            if (ctx.roundRect) {
                                ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
                            } else {
                                ctx.rect(badgeX, badgeY, badgeW, badgeH);
                            }
                            ctx.fill();
                            ctx.stroke();

                            ctx.fillStyle = '#4ec9b0';
                            ctx.fillText(text, badgeX + 12, badgeY + 16);
                            ctx.restore();
                        }

                        return canvas;
                    }

                    async function waitForTilesToLoad(maxWaitMs = 2500) {
                        const start = Date.now();
                        while (Date.now() - start < maxWaitMs) {
                            let anyTileLoading = false;
                            
                            // Check base layer loading
                            if (activeBaseLayer && activeBaseLayer.isLoading && activeBaseLayer.isLoading()) {
                                anyTileLoading = true;
                            }
                            // Check GEE layers loading
                            for (const item of geeLayers) {
                                if (map.hasLayer(item.layer) && item.layer.isLoading && item.layer.isLoading()) {
                                    anyTileLoading = true;
                                    break;
                                }
                            }
                            // Check visible tile images in DOM
                            const tiles = Array.from(document.querySelectorAll('.leaflet-tile-pane img.leaflet-tile'));
                            for (const img of tiles) {
                                if (!img.complete) {
                                    anyTileLoading = true;
                                    break;
                                }
                            }

                            if (!anyTileLoading) {
                                await new Promise(r => setTimeout(r, 60));
                                return;
                            }

                            showHud('⏳ Waiting for layers to finish loading...');
                            await new Promise(r => setTimeout(r, 180));
                        }
                    }

                    window.takeSnapshot = async function(target) {
                        const m = document.getElementById('snapshotModal');
                        if (m) m.style.display = 'none';

                        try {
                            showHud('📸 Preparing HD snapshot...');
                            await waitForTilesToLoad(2500);
                            showHud('📸 Generating HD image...');
                            const canvas = await captureMapToCanvas();
                            const now = new Date();
                            const pad = (n) => String(n).padStart(2, '0');
                            const filename = 'gee_snapshot_' + now.getFullYear() + 
                                             pad(now.getMonth() + 1) + 
                                             pad(now.getDate()) + '_' + 
                                             pad(now.getHours()) + 
                                             pad(now.getMinutes()) + 
                                             pad(now.getSeconds()) + '.png';

                            if (target === 'clipboard') {
                                canvas.toBlob(async (blob) => {
                                    if (!blob) {
                                        showHud('❌ Error generating image');
                                        return;
                                    }
                                    try {
                                        await navigator.clipboard.write([
                                            new ClipboardItem({ 'image/png': blob })
                                        ]);
                                        showHud('📋 Copied to clipboard!');
                                    } catch (e) {
                                        const dataUrl = canvas.toDataURL('image/png');
                                        const base64 = dataUrl.split(',')[1];
                                        vscode.postMessage({
                                            command: 'saveSnapshot',
                                            data: base64,
                                            filename: filename,
                                            promptSaveAs: false
                                        });
                                        showHud('💾 Saved to Screenshots/ (clipboard restricted)');
                                    }
                                }, 'image/png');
                            } else {
                                const dataUrl = canvas.toDataURL('image/png');
                                const base64 = dataUrl.split(',')[1];
                                vscode.postMessage({
                                    command: 'saveSnapshot',
                                    data: base64,
                                    filename: filename,
                                    promptSaveAs: target === 'saveAs'
                                });
                                showHud(target === 'saveAs' ? '📁 Opening save dialog...' : '💾 Saving to Screenshots/...');
                            }
                        } catch (err) {
                            console.error('Error capturing map:', err);
                            showHud('❌ Error capturing map: ' + (err.message || err));
                        }
                    };

                    // --- SWIPE TOOL LOGIC ---
                    let swipeMode = false;
                    let swipeOrientation = 'vertical';
                    let swipeValue = 50;
                    let draggingSwipe = false;
                    let topSwipeLayer = null;

                    function updateSwipeClip() {
                        if (!swipeMode || !topSwipeLayer || !topSwipeLayer.getContainer()) return;
                        const container = topSwipeLayer.getContainer();
                        const divider = document.getElementById('swipe-divider');
                        const icon = document.getElementById('swipe-icon');

                        const mapSize = map.getSize();
                        const nw = map.containerPointToLayerPoint([0, 0]);
                        const se = map.containerPointToLayerPoint([mapSize.x, mapSize.y]);
                        
                        let clipX = mapSize.x * (swipeValue / 100);
                        let clipY = mapSize.y * (swipeValue / 100);
                        
                        let layerClipX = map.containerPointToLayerPoint([clipX, 0]).x;
                        let layerClipY = map.containerPointToLayerPoint([0, clipY]).y;

                        if (swipeOrientation === 'vertical') {
                            // clip: rect(top, right, bottom, left)
                            container.style.clip = 'rect(' + nw.y + 'px, ' + layerClipX + 'px, ' + se.y + 'px, ' + nw.x + 'px)';
                            container.style.clipPath = ''; // clear old just in case
                            
                            divider.style.left = swipeValue + '%';
                            divider.style.top = '0';
                            divider.style.bottom = '0';
                            divider.style.width = '3px';
                            divider.style.height = 'auto';
                            divider.style.cursor = 'col-resize';
                            icon.style.transform = 'rotate(90deg)';
                        } else {
                            container.style.clip = 'rect(' + nw.y + 'px, ' + se.x + 'px, ' + layerClipY + 'px, ' + nw.x + 'px)';
                            container.style.clipPath = '';
                            
                            divider.style.top = swipeValue + '%';
                            divider.style.left = '0';
                            divider.style.right = '0';
                            divider.style.height = '3px';
                            divider.style.width = 'auto';
                            divider.style.cursor = 'row-resize';
                            icon.style.transform = 'rotate(0deg)';
                        }
                    }

                    map.on('move', updateSwipeClip);
                    map.on('zoom', updateSwipeClip);
                    map.on('resize', updateSwipeClip);

                    window.toggleSwipeMode = function() {
                        swipeMode = !swipeMode;
                        const divider = document.getElementById('swipe-divider');
                        const btn = document.getElementById('btn-swipe');
                        
                        if (swipeMode) {
                            const visibleLayers = geeLayers.filter(l => l.shown);
                            if (visibleLayers.length < 2) {
                                swipeMode = false;
                                vscode.postMessage({command: 'webviewError', message: 'Swipe Tool requires at least 2 visible GEE layers on the map.'});
                                return;
                            }
                            // Top layer is the last one in the array
                            topSwipeLayer = visibleLayers[visibleLayers.length - 1].layer;
                            divider.style.display = 'block';
                            btn.style.background = 'rgba(78, 201, 176, 0.4)';
                            btn.style.borderColor = '#4ec9b0';
                            swipeValue = 50;
                            updateSwipeClip();
                        } else {
                            if (topSwipeLayer && topSwipeLayer.getContainer()) {
                                topSwipeLayer.getContainer().style.clipPath = '';
                                topSwipeLayer.getContainer().style.clip = '';
                            }
                            topSwipeLayer = null;
                            divider.style.display = 'none';
                            btn.style.background = '';
                            btn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        }
                    };

                    const dividerEl = document.getElementById('swipe-divider');
                    dividerEl.addEventListener('mousedown', (e) => {
                        draggingSwipe = true;
                        e.preventDefault(); // prevent text selection
                    });
                    
                    window.addEventListener('mousemove', (e) => {
                        if (!draggingSwipe) return;
                        if (swipeOrientation === 'vertical') {
                            swipeValue = (e.clientX / window.innerWidth) * 100;
                        } else {
                            swipeValue = (e.clientY / window.innerHeight) * 100;
                        }
                        swipeValue = Math.max(0, Math.min(100, swipeValue));
                        updateSwipeClip();
                    });
                    
                    window.addEventListener('mouseup', () => {
                        draggingSwipe = false;
                    });

                    // Add orientation toggle to the global keydown listener
                    document.addEventListener('keydown', (e) => {
                        if (swipeMode && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                            if (swipeOrientation !== 'horizontal') {
                                swipeOrientation = 'horizontal';
                                updateSwipeClip();
                            }
                        }
                    });
                    document.addEventListener('keyup', (e) => {
                        if (swipeMode && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                            if (swipeOrientation !== 'vertical') {
                                swipeOrientation = 'vertical';
                                updateSwipeClip();
                            }
                        }
                    });
                    // --- END SWIPE TOOL ---

                    // Notify extension that webview Leaflet map is fully initialized and ready
                    setTimeout(() => {
                        map.invalidateSize();
                        vscode.postMessage({ command: 'ready' });
                    }, 100);
                </script>
            </body>
            </html>
        `;
    }
}
