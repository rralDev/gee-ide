import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { LEAFLET_CSS, LEAFLET_DRAW_CSS, LEAFLET_JS, LEAFLET_DRAW_JS } from './leafletBundle';

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
                } else if (message.command === 'saveMeasureGeoJSON') {
                    this.handleSaveMeasureGeoJSON(message);
                } else if (message.command === 'focusQuadrant') {
                    if (message.quadrant === 1) {
                        vscode.commands.executeCommand('gee-pro.focusEditor');
                    } else if (message.quadrant === 2) {
                        vscode.commands.executeCommand('gee-pro.focusConsole');
                    } else if (message.quadrant === 3) {
                        vscode.commands.executeCommand('gee-pro.focusMap');
                    } else if (message.quadrant === 4) {
                        vscode.commands.executeCommand('gee-pro.focusAI');
                    }
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
        }
    }

    public setDrawMode(mode: 'pan' | 'marker' | 'polyline' | 'polygon' | 'rectangle') {
        if (!this.panel) {
            this.show(vscode.ViewColumn.Three);
        }
        this.sendMessage({ command: 'setGeomDrawMode', mode });
    }

    public attachPanel(panel: vscode.WebviewPanel) {
        if (this.panel && this.panel !== panel) {
            this.panel.dispose();
        }
        this.panel = panel;
        this.isReady = false;
        vscode.commands.executeCommand('setContext', 'geeMapFocused', true);
        this.panel.onDidChangeViewState(e => {
            vscode.commands.executeCommand('setContext', 'geeMapFocused', e.webviewPanel.active);
        }, null, this.context.subscriptions);
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
            } else if (message.command === 'saveMeasureGeoJSON') {
                this.handleSaveMeasureGeoJSON(message);
            } else if (message.command === 'focusQuadrant') {
                if (message.quadrant === 1) {
                    vscode.commands.executeCommand('gee-pro.focusEditor');
                } else if (message.quadrant === 2) {
                    vscode.commands.executeCommand('gee-pro.focusConsole');
                } else if (message.quadrant === 3) {
                    vscode.commands.executeCommand('gee-pro.focusMap');
                } else if (message.quadrant === 4) {
                    vscode.commands.executeCommand('gee-pro.focusAI');
                }
            }
            if (this.messageCallback) this.messageCallback(message);
        }, undefined, this.context.subscriptions);

        this.panel.onDidDispose(() => {
            vscode.commands.executeCommand('setContext', 'geeMapFocused', false);
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

    public sendMessage(msg: any) {
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

    public sendElevationProfile(points: Array<{ dist: number; elev: number }>, error?: string) {
        this.sendMessage({ command: 'elevationProfileData', points, error });
    }

    public setCenter(lat: number, lng: number, zoom?: number) {
        this.sendMessage({ command: 'setCenter', lat, lng, zoom });
    }

    public clear() {
        this.sendMessage({ command: 'clear' });
    }

    private async handleSaveMeasureGeoJSON(message: { geojson: string; filename: string }) {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
            const targetUri = await vscode.window.showSaveDialog({
                defaultUri: workspaceFolder ? vscode.Uri.joinPath(workspaceFolder, message.filename) : vscode.Uri.file(message.filename),
                filters: { 'GeoJSON (*.geojson)': ['geojson', 'json'] }
            });
            if (!targetUri) return;
            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(message.geojson, 'utf8'));
            const relPath = vscode.workspace.asRelativePath(targetUri);
            const action = await vscode.window.showInformationMessage(
                `💾 Medición GeoJSON guardada: ${relPath}`,
                'Abrir Archivo',
                'Copiar Ruta'
            );
            if (action === 'Abrir Archivo') {
                vscode.commands.executeCommand('vscode.open', targetUri);
            } else if (action === 'Copiar Ruta') {
                vscode.env.clipboard.writeText(targetUri.fsPath);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage('Error guardando GeoJSON: ' + (err?.message || err));
        }
    }

    private buildPdfFromJpeg(jpegBuffer: Buffer, imgW: number, imgH: number, paperSize: string = 'auto', orientation: string = 'auto'): Buffer {
        // ISO 216 Paper sizes in PDF points (1 pt = 1/72 inch, 1 mm = 2.83464567 pt)
        const isoSizesPt: Record<string, [number, number]> = {
            'A4': [841.89, 595.28],   // 297 x 210 mm
            'A3': [1190.55, 841.89],  // 420 x 297 mm
            'A2': [1683.78, 1190.55], // 594 x 420 mm
            'A1': [2383.94, 1683.78]  // 841 x 594 mm
        };
        const isLandscape = (orientation === 'landscape') ? true : (orientation === 'portrait') ? false : (imgW >= imgH);
        let pageW = imgW * 0.75;
        let pageH = imgH * 0.75;
        let drawX = 0;
        let drawY = 0;
        let drawW = pageW;
        let drawH = pageH;

        if (paperSize && isoSizesPt[paperSize]) {
            const [longSide, shortSide] = isoSizesPt[paperSize];
            pageW = isLandscape ? longSide : shortSide;
            pageH = isLandscape ? shortSide : longSide;
            const margin = 18; // ~6.3 mm printer-safe margin
            const availW = pageW - margin * 2;
            const availH = pageH - margin * 2;
            const scale = Math.min(availW / imgW, availH / imgH);
            drawW = Number((imgW * scale).toFixed(2));
            drawH = Number((imgH * scale).toFixed(2));
            drawX = Number(((pageW - drawW) / 2).toFixed(2));
            drawY = Number(((pageH - drawH) / 2).toFixed(2));
        } else {
            pageW = Number(pageW.toFixed(2));
            pageH = Number(pageH.toFixed(2));
            drawW = pageW;
            drawH = pageH;
        }

        const contentStream = `q\n${drawW} 0 0 ${drawH} ${drawX} ${drawY} cm\n/Im0 Do\nQ\n`;
        const chunks: Buffer[] = [];
        const offsets: number[] = [0];
        let currentOffset = 0;

        const pushStr = (s: string) => {
            const b = Buffer.from(s, 'binary');
            chunks.push(b);
            currentOffset += b.length;
        };
        const pushBuf = (b: Buffer) => {
            chunks.push(b);
            currentOffset += b.length;
        };

        pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

        // 1: Catalog
        offsets[1] = currentOffset;
        pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

        // 2: Pages
        offsets[2] = currentOffset;
        pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

        // 3: Page
        offsets[3] = currentOffset;
        pushStr(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);

        // 4: Image XObject (DCTDecode / JPEG)
        offsets[4] = currentOffset;
        pushStr(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuffer.length} >>\nstream\n`);
        pushBuf(jpegBuffer);
        pushStr('\nendstream\nendobj\n');

        // 5: Content stream
        offsets[5] = currentOffset;
        pushStr(`5 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'binary')} >>\nstream\n${contentStream}endstream\nendobj\n`);

        const xrefOffset = currentOffset;
        pushStr('xref\n0 6\n0000000000 65535 f \n');
        for (let i = 1; i <= 5; i++) {
            pushStr(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
        }
        pushStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

        return Buffer.concat(chunks);
    }

    private async handleSaveSnapshot(message: { data: string; filename: string; promptSaveAs: boolean; format?: string; width?: number; height?: number; paperSize?: string; orientation?: string }) {
        try {
            const fmt = (message.format || 'png').toLowerCase();
            let buffer = Buffer.from(message.data, 'base64');
            if (fmt === 'pdf') {
                buffer = this.buildPdfFromJpeg(buffer, message.width || 1920, message.height || 1080, message.paperSize || 'auto', message.orientation || 'auto');
            }

            let targetUri: vscode.Uri | undefined;
            const filterMap: Record<string, { [name: string]: string[] }> = {
                'png': { 'PNG Image (*.png)': ['png'] },
                'jpg': { 'JPEG Image (*.jpg)': ['jpg', 'jpeg'] },
                'pdf': { 'PDF Document (*.pdf)': ['pdf'] }
            };
            const dialogFilters = filterMap[fmt] || filterMap['png'];

            if (message.promptSaveAs) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
                targetUri = await vscode.window.showSaveDialog({
                    defaultUri: workspaceFolder ? vscode.Uri.joinPath(workspaceFolder, message.filename) : undefined,
                    filters: dialogFilters
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
                        filters: dialogFilters
                    });
                    if (!targetUri) return;
                }
            }

            await vscode.workspace.fs.writeFile(targetUri, buffer);
            const relPath = vscode.workspace.asRelativePath(targetUri);
            const action = await vscode.window.showInformationMessage(
                `📸 Lámina / Captura guardada: ${relPath}`,
                'Abrir Archivo',
                'Copiar Ruta'
            );
            if (action === 'Abrir Archivo') {
                vscode.commands.executeCommand('vscode.open', targetUri);
            } else if (action === 'Copiar Ruta') {
                vscode.env.clipboard.writeText(targetUri.fsPath);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage('Error saving snapshot: ' + (err?.message || err));
        }
    }

    private getHtml() {
        const leafletCss = LEAFLET_CSS;
        const leafletJs = LEAFLET_JS;
        const leafletDrawCss = LEAFLET_DRAW_CSS;
        const leafletDrawJs = LEAFLET_DRAW_JS;
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob: vscode-webview:; script-src * 'unsafe-inline' 'unsafe-eval' vscode-webview:; style-src * 'unsafe-inline' vscode-webview:; img-src * data: blob: https: vscode-webview:; connect-src *;">
                <title>GEE Map Pro</title>
                <style>${leafletCss}</style>
                <style>${leafletDrawCss}</style>
                <script>${leafletJs}</script>
                <script>${leafletDrawJs}</script>
                <style>
                    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
                    #map { position: absolute; top: 0; bottom: 0; left: 0; right: 0; width: 100%; height: 100%; z-index: 1; }
                    /* Custom Leaflet Design */
                    .leaflet-bar { border: none !important; box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important; }
                    .leaflet-bar a { background-color: #252526 !important; color: #cccccc !important; border-bottom: 1px solid #383838 !important; }
                    .leaflet-bar a:hover { background-color: #37373d !important; color: #ffffff !important; }
                    .leaflet-control-layers { background: #252526 !important; color: #cccccc !important; border: none !important; box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important; }
                    
                    /* Offset default zoom control to sit directly underneath the GEE drawing toolbar */
                    .leaflet-top.leaflet-left {
                        top: 48px !important;
                        left: 10px !important;
                    }

                    /* Hide floating tooltip following cursor during drawing */
                    .leaflet-draw-tooltip,
                    .leaflet-error-draw-tooltip,
                    .leaflet-draw-tooltip-single,
                    .leaflet-draw-tooltip-subtext {
                        display: none !important;
                        visibility: hidden !important;
                        opacity: 0 !important;
                        pointer-events: none !important;
                    }

                    /* Google Earth Engine Geometry Toolbar & Imports System */
                    .gee-geom-container {
                        position: absolute;
                        top: 10px;
                        left: 10px;
                        z-index: 1000;
                        display: flex;
                        align-items: flex-start;
                        gap: 8px;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        pointer-events: none;
                    }
                    .gee-geom-container > * {
                        pointer-events: auto;
                    }

                    .gee-draw-toolbar {
                        display: flex;
                        background: #252526;
                        border: 1px solid #3c3c3c;
                        border-radius: 4px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.45);
                        overflow: hidden;
                        height: 30px;
                    }
                    .gee-draw-btn {
                        width: 32px;
                        height: 30px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: transparent;
                        border: none;
                        border-right: 1px solid rgba(255,255,255,0.08);
                        color: #cccccc;
                        cursor: pointer;
                        transition: background 0.12s, color 0.12s;
                        padding: 0;
                    }
                    .gee-draw-btn:last-child {
                        border-right: none;
                    }
                    .gee-draw-btn:hover {
                        background: #37373d;
                        color: #ffffff;
                    }
                    .gee-draw-btn.active {
                        background: #0e639c !important;
                        color: #ffffff !important;
                    }

                    .gee-geom-dock {
                        width: 220px;
                        background: #252526;
                        border: 1px solid #3c3c3c;
                        border-radius: 4px;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                    }
                    .gee-geom-dock.collapsed .gee-geom-body {
                        display: none !important;
                    }
                    .gee-geom-header {
                        background: #1a73e8;
                        color: #ffffff;
                        height: 30px;
                        display: flex;
                        align-items: center;
                        padding: 0 8px;
                        gap: 6px;
                        user-select: none;
                        box-sizing: border-box;
                    }
                    .gee-geom-title {
                        font-size: 12.5px;
                        font-weight: 600;
                        flex: 1;
                        cursor: pointer;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .gee-geom-header-actions {
                        display: flex;
                        align-items: center;
                        gap: 2px;
                    }
                    .gee-geom-header-btn {
                        background: transparent;
                        border: none;
                        color: #ffffff;
                        font-size: 11px;
                        width: 20px;
                        height: 20px;
                        border-radius: 3px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        transition: background 0.15s;
                        padding: 0;
                    }
                    .gee-geom-header-btn:hover {
                        background: rgba(255,255,255,0.22);
                    }
                    .gee-geom-body {
                        display: flex;
                        flex-direction: column;
                        max-height: 240px;
                    }
                    .gee-geom-layers-list {
                        overflow-y: auto;
                        max-height: 195px;
                    }
                    .gee-geom-layer-row {
                        display: flex;
                        align-items: center;
                        gap: 7px;
                        padding: 5px 8px;
                        cursor: pointer;
                        border-bottom: 1px solid rgba(255,255,255,0.05);
                        transition: background 0.12s;
                        font-size: 12px;
                        color: #cccccc;
                        box-sizing: border-box;
                    }
                    .gee-geom-layer-row:hover {
                        background: rgba(255,255,255,0.06);
                    }
                    .gee-geom-layer-row.active {
                        background: rgba(26, 115, 232, 0.18);
                        color: #ffffff;
                        font-weight: 700;
                    }
                    .gee-geom-layer-name {
                        flex: 1;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .gee-geom-layer-swatch {
                        width: 16px;
                        height: 16px;
                        border-radius: 3px;
                        border: 1px solid rgba(255,255,255,0.25);
                        cursor: pointer;
                        flex-shrink: 0;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
                    }
                    .gee-geom-layer-gear {
                        font-size: 11px;
                        opacity: 0.6;
                        cursor: pointer;
                        padding: 0 2px;
                    }
                    .gee-geom-layer-gear:hover {
                        opacity: 1;
                    }
                    .gee-geom-footer {
                        padding: 6px 8px;
                        background: rgba(0,0,0,0.15);
                        border-top: 1px solid rgba(255,255,255,0.08);
                    }
                    .gee-geom-add-link {
                        color: #388bfd;
                        font-size: 11.5px;
                        font-weight: 600;
                        cursor: pointer;
                        text-decoration: none;
                        display: inline-block;
                    }
                    .gee-geom-add-link:hover {
                        text-decoration: underline;
                    }

                    .gee-draw-banner {
                        background: #fef0cd;
                        border: 1px solid #ffd351;
                        color: #202124;
                        border-radius: 4px;
                        padding: 3px 8px;
                        font-size: 12px;
                        font-weight: 500;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                        height: 30px;
                        box-sizing: border-box;
                    }
                    .gee-banner-btn {
                        background: rgba(0,0,0,0.08);
                        border: 1px solid rgba(0,0,0,0.18);
                        border-radius: 3px;
                        font-size: 11px;
                        padding: 2px 6px;
                        cursor: pointer;
                        color: #202124;
                        transition: background 0.12s;
                    }
                    .gee-banner-btn:hover {
                        background: rgba(0,0,0,0.16);
                    }
                    .gee-banner-btn.exit-btn {
                        font-weight: 600;
                        background: #ffffff;
                    }

                    /* Configure Geometry Import Modal */
                    .gee-geom-backdrop {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.55);
                        z-index: 2190;
                        backdrop-filter: blur(2px);
                    }
                    .gee-geom-modal {
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        z-index: 2200;
                        width: 450px;
                        background: #252526;
                        border: 1px solid #3c3c3c;
                        border-radius: 6px;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
                        color: #e0e0e0;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                        display: flex;
                        flex-direction: column;
                        overflow: hidden;
                    }
                    .gee-geom-modal-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 10px 14px;
                        border-bottom: 1px solid rgba(255,255,255,0.1);
                        font-size: 13.5px;
                        font-weight: 600;
                    }
                    .gee-geom-modal-close {
                        background: transparent;
                        border: none;
                        color: #aaa;
                        cursor: pointer;
                        font-size: 14px;
                    }
                    .gee-geom-modal-close:hover {
                        color: #fff;
                    }
                    .gee-geom-modal-body {
                        display: flex;
                        gap: 16px;
                        padding: 14px;
                    }
                    .gee-geom-modal-col.left {
                        flex: 1.2;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                    }
                    .gee-geom-modal-col.right {
                        flex: 0.9;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                    }
                    .gee-geom-field {
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                    }
                    .gee-geom-field label {
                        font-size: 11px;
                        color: #999;
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 0.4px;
                    }
                    .gee-geom-field input[type="text"],
                    .gee-geom-field select {
                        background: #18181b;
                        border: 1px solid rgba(255,255,255,0.18);
                        border-radius: 4px;
                        color: #fff;
                        padding: 5px 8px;
                        font-size: 12px;
                        outline: none;
                    }
                    .gee-geom-field input[type="text"]:focus,
                    .gee-geom-field select:focus {
                        border-color: #1a73e8;
                    }
                    .gee-geom-props-box {
                        background: rgba(0,0,0,0.25);
                        border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 4px;
                        padding: 6px;
                        max-height: 100px;
                        overflow-y: auto;
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                        font-size: 11.5px;
                        color: #aaa;
                    }
                    .gee-geom-prop-row {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    }
                    .gee-geom-prop-input {
                        background: #18181b;
                        border: 1px solid rgba(255,255,255,0.15);
                        border-radius: 3px;
                        color: #fff;
                        font-size: 11px;
                        padding: 3px 5px;
                        width: 45%;
                    }
                    .gee-geom-prop-del {
                        background: transparent;
                        border: none;
                        color: #e51400;
                        cursor: pointer;
                        font-size: 11px;
                        padding: 0 2px;
                    }
                    .gee-geom-prop-add-btn {
                        background: transparent;
                        border: none;
                        color: #388bfd;
                        font-size: 11px;
                        font-weight: 600;
                        cursor: pointer;
                        padding: 0;
                    }
                    .gee-geom-prop-add-btn:hover {
                        text-decoration: underline;
                    }
                    .gee-geom-modal-swatch {
                        width: 30px;
                        height: 30px;
                        border-radius: 4px;
                        border: 1px solid rgba(255,255,255,0.3);
                        flex-shrink: 0;
                    }
                    .gee-geom-spectrum-trigger {
                        cursor: pointer;
                        width: 28px;
                        height: 28px;
                        border-radius: 4px;
                        background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border: 1px solid rgba(255,255,255,0.3);
                        position: relative;
                        overflow: hidden;
                        flex-shrink: 0;
                    }
                    .gee-geom-spectrum-trigger input[type="color"] {
                        opacity: 0;
                        position: absolute;
                        width: 100%;
                        height: 100%;
                        cursor: pointer;
                        top: 0;
                        left: 0;
                        border: none;
                        padding: 0;
                    }
                    .gee-geom-presets-grid {
                        display: grid;
                        grid-template-columns: repeat(5, 1fr);
                        gap: 5px;
                        margin-top: 4px;
                    }
                    .gee-geom-preset-dot {
                        width: 22px;
                        height: 22px;
                        border-radius: 4px;
                        border: 1px solid rgba(255,255,255,0.3);
                        cursor: pointer;
                        transition: transform 0.12s;
                        box-sizing: border-box;
                    }
                    .gee-geom-preset-dot:hover {
                        transform: scale(1.18);
                        box-shadow: 0 0 6px rgba(255,255,255,0.6);
                    }
                    .gee-geom-modal-footer {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 10px 14px;
                        border-top: 1px solid rgba(255,255,255,0.1);
                        background: rgba(0,0,0,0.15);
                    }
                    .gee-geom-btn {
                        padding: 6px 14px;
                        border-radius: 4px;
                        font-size: 12px;
                        font-weight: 600;
                        cursor: pointer;
                        border: none;
                        transition: background 0.15s;
                    }
                    .gee-geom-btn.primary {
                        background: #1a73e8;
                        color: #fff;
                    }
                    .gee-geom-btn.primary:hover {
                        background: #1558b0;
                    }
                    .gee-geom-btn.secondary {
                        background: rgba(255,255,255,0.1);
                        color: #ddd;
                        border: 1px solid rgba(255,255,255,0.15);
                    }
                    .gee-geom-btn.secondary:hover {
                        background: rgba(255,255,255,0.18);
                        color: #fff;
                    }
                    .gee-geom-btn.danger {
                        background: transparent;
                        color: #e51400;
                        border: 1px solid rgba(229,20,0,0.3);
                        padding: 6px 10px;
                        font-size: 13px;
                    }
                    .gee-geom-btn.danger:hover {
                        background: rgba(229,20,0,0.15);
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
                        bottom: 12px;
                        left: 50%;
                        transform: translateX(-50%);
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
                        min-width: 265px;
                        max-width: 320px;
                        max-height: calc(100vh - 140px);
                        display: flex;
                        flex-direction: column;
                        overflow: visible !important;
                        transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
                        user-select: none;
                        position: relative;
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
                        overflow: hidden !important;
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
                    .gee-layer-content {
                        display: flex;
                        flex-direction: column;
                        position: relative;
                        overflow: visible;
                    }
                    .gee-layer-header {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 7px 11px;
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
                    .gee-grid-menu {
                        position: absolute;
                        top: 42px;
                        right: 0px;
                        z-index: 3000;
                        background: rgba(20, 20, 24, 0.97);
                        backdrop-filter: blur(20px);
                        -webkit-backdrop-filter: blur(20px);
                        border: 1px solid rgba(78, 201, 176, 0.45);
                        border-radius: 9px;
                        box-shadow: 0 14px 42px rgba(0,0,0,0.8), 0 0 1px rgba(78, 201, 176, 0.6);
                        padding: 10px 13px;
                        min-width: 260px;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        font-size: 11px;
                        color: #e2e8f0;
                        user-select: none;
                        animation: fadeInDown 0.16s ease;
                    }
                    .gee-grid-opt {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        cursor: pointer;
                        font-size: 11px;
                        color: #cbd5e1;
                        padding: 3px 4px;
                        border-radius: 4px;
                        transition: background 0.15s ease;
                    }
                    .gee-grid-opt:hover {
                        color: #fff;
                        background: rgba(255, 255, 255, 0.08);
                    }
                    .gee-layer-body {
                        padding: 7px 9px;
                        max-height: calc(100vh - 195px);
                        overflow-y: auto;
                        flex: 1;
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
                        transition: all 0.15s ease;
                    }
                    .gee-layer-badge.peek-active {
                        background: #10382b !important;
                        color: #3ef29b !important;
                        border: 1px solid #3ef29b !important;
                        box-shadow: 0 0 8px rgba(62, 242, 155, 0.7) !important;
                    }
                    .gee-bc-badge {
                        font-family: 'JetBrains Mono', 'Consolas', monospace;
                        font-size: 8.5px;
                        font-weight: 700;
                        padding: 1px 4px;
                        border-radius: 3px;
                        margin-left: 2px;
                        line-height: 1.1;
                        display: inline-flex;
                        align-items: center;
                    }
                    .gee-bc-badge-l {
                        background: #094771;
                        color: #4ec9b0;
                        border: 1px solid #4ec9b0;
                    }
                    .gee-bc-badge-r {
                        background: #5c3b12;
                        color: #e5c07b;
                        border: 1px solid #e5c07b;
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

                    /* Sleek Satellite Grid Micro-Popup */
                    .gee-micro-popup-wrapper .leaflet-popup-content-wrapper {
                        background: rgba(18, 18, 22, 0.96) !important;
                        backdrop-filter: blur(12px) !important;
                        -webkit-backdrop-filter: blur(12px) !important;
                        border: 1px solid rgba(255, 255, 255, 0.16) !important;
                        border-radius: 7px !important;
                        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.65) !important;
                        padding: 0 !important;
                    }
                    .gee-micro-popup-wrapper .leaflet-popup-content {
                        margin: 4px 6px !important;
                    }
                    .gee-grid-pill-popup {
                        display: flex;
                        align-items: center;
                        gap: 5px;
                        user-select: none;
                        white-space: nowrap;
                    }
                    .gee-grid-pill-label {
                        font-family: 'JetBrains Mono', 'Consolas', monospace;
                        font-size: 11px;
                        font-weight: 700;
                        padding: 2px 7px;
                        border-radius: 4px;
                        background: rgba(255, 255, 255, 0.08);
                        border: 1px solid rgba(255, 255, 255, 0.18);
                    }
                    .gee-grid-pill-buttons {
                        display: flex;
                        gap: 4px;
                    }
                    .gee-grid-pill-btn {
                        background: rgba(255, 255, 255, 0.09);
                        border: 1px solid rgba(255, 255, 255, 0.18);
                        color: #f1f5f9;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                        font-size: 10px;
                        font-weight: 600;
                        padding: 2px 7px;
                        border-radius: 4px;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        gap: 3px;
                        transition: all 0.15s ease;
                    }
                    .gee-grid-pill-btn:hover {
                        background: rgba(255, 255, 255, 0.2);
                        color: #ffffff;
                    }
                    .gee-grid-pill-btn.primary {
                        background: linear-gradient(135deg, #0284c7, #0ea5e9);
                        border-color: #38bdf8;
                        color: #ffffff;
                    }
                    .gee-grid-pill-btn.primary:hover {
                        background: linear-gradient(135deg, #0369a1, #0284c7);
                    }
                    .gee-utm-header-label {
                        background: rgba(15, 23, 42, 0.88) !important;
                        border: 1px solid rgba(56, 189, 248, 0.6) !important;
                        border-radius: 4px !important;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.6) !important;
                        padding: 1px 7px !important;
                        font-family: 'JetBrains Mono', 'Consolas', monospace !important;
                        letter-spacing: 0.5px !important;
                    }
                    .gee-landsat-tile-label {
                        background: transparent !important;
                        border: none !important;
                        box-shadow: none !important;
                        color: #ffffff !important;
                        font-family: 'JetBrains Mono', 'Consolas', monospace !important;
                        font-size: 11px !important;
                        font-weight: 700 !important;
                        text-shadow: 0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9) !important;
                        pointer-events: none !important;
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
                    /* QGIS Scale Bar & Ruler Styles */
                    .leaflet-control-scale {
                        margin-left: 60px !important;
                        margin-bottom: 22px !important;
                    }
                    .leaflet-control-scale-line {
                        background: rgba(18, 18, 20, 0.85) !important;
                        backdrop-filter: blur(8px);
                        border: 1.5px solid #4ec9b0 !important;
                        border-top: none !important;
                        color: #e0e0e0 !important;
                        font-family: 'JetBrains Mono', 'Consolas', monospace !important;
                        font-size: 10px !important;
                        font-weight: 600 !important;
                        padding: 2px 6px 1px !important;
                        border-radius: 0 0 3px 3px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
                        text-shadow: 0 1px 2px #000;
                    }
                    .gee-ruler-panel {
                        position: absolute;
                        top: 46px;
                        left: 52px;
                        z-index: 1500;
                        width: 310px;
                        background: rgba(22, 22, 25, 0.95);
                        backdrop-filter: blur(16px);
                        -webkit-backdrop-filter: blur(16px);
                        border: 1px solid rgba(78, 201, 176, 0.35);
                        border-radius: 10px;
                        box-shadow: 0 12px 36px rgba(0,0,0,0.7);
                        color: #e0e0e0;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                        font-size: 11.5px;
                        overflow: hidden;
                        user-select: none;
                    }
                    .gee-ruler-tabs {
                        display: flex;
                        background: rgba(0,0,0,0.3);
                        padding: 3px;
                        gap: 3px;
                        border-bottom: 1px solid rgba(255,255,255,0.07);
                    }
                    .gee-ruler-tab {
                        flex: 1;
                        border: none;
                        background: transparent;
                        color: #999;
                        padding: 5px 6px;
                        font-size: 11px;
                        font-weight: 600;
                        border-radius: 6px;
                        cursor: pointer;
                        transition: all 0.15s ease;
                    }
                    .gee-ruler-tab.active {
                        background: rgba(78, 201, 176, 0.2);
                        color: #4ec9b0;
                        border: 1px solid rgba(78, 201, 176, 0.4);
                    }
                    .gee-ruler-seg-label {
                        background: rgba(15, 15, 18, 0.9);
                        color: #ffeb3b;
                        border: 1px solid rgba(255, 235, 59, 0.5);
                        border-radius: 10px;
                        padding: 1px 6px;
                        font-family: 'JetBrains Mono', monospace;
                        font-size: 10px;
                        font-weight: 600;
                        white-space: nowrap;
                        pointer-events: none;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.6);
                    }
                    .gee-ruler-vertex-badge {
                        background: #00e5ff;
                        color: #0b1120;
                        font-family: 'JetBrains Mono', monospace;
                        font-size: 10px;
                        font-weight: 800;
                        width: 17px;
                        height: 17px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border: 1.5px solid #ffffff;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.7);
                        user-select: none;
                        pointer-events: none;
                    }
                    .gee-ruler-vertex-badge.start {
                        background: #00ff88;
                    }
                    .gee-ruler-area-icon-container {
                        background: transparent !important;
                        border: none !important;
                    }
                    .gee-ruler-area-badge {
                        background: rgba(15, 23, 42, 0.94);
                        border: 1.5px solid #ffeb3b;
                        color: #ffffff;
                        font-family: 'JetBrains Mono', monospace;
                        font-size: 10.5px;
                        font-weight: 700;
                        padding: 3px 8px;
                        border-radius: 5px;
                        text-align: center;
                        white-space: nowrap;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: 4px;
                        width: max-content;
                        pointer-events: none;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.75);
                        transform: translate(-50%, -50%);
                    }
                    /* High-Visibility Camera Button in Layers Header */
                    #snapHeaderBtn {
                        background: linear-gradient(135deg, #007acc, #14b8a6) !important;
                        border: 1px solid #4ec9b0 !important;
                        color: #ffffff !important;
                        padding: 2px 7px !important;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        box-shadow: 0 2px 8px rgba(20, 184, 166, 0.38);
                    }
                    #snapHeaderBtn:hover {
                        background: linear-gradient(135deg, #0098ff, #2dd4bf) !important;
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(45, 212, 191, 0.55);
                    }

                    .gee-quad-badge {
                        position: absolute;
                        background: rgba(18, 18, 22, 0.94);
                        border-radius: 6px;
                        padding: 3px 8px;
                        font-size: 12px;
                        font-weight: 800;
                        font-family: monospace;
                        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.75);
                        pointer-events: auto;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: default;
                        user-select: none;
                        transition: transform 0.15s ease, border-color 0.15s ease;
                    }
                    .gee-quad-badge:hover {
                        transform: scale(1.08);
                    }
                    .gee-quad-badge.q1 {
                        top: 25px;
                        left: 56px;
                        border: 2px solid #4ec9b0;
                        color: #4ec9b0;
                    }
                    .gee-quad-badge.q2 {
                        top: 25px;
                        right: 295px;
                        border: 2px solid #569cd6;
                        color: #569cd6;
                    }
                    .gee-quad-badge.q3 {
                        bottom: 45px;
                        left: 56px;
                        border: 2px solid #ce9178;
                        color: #ce9178;
                    }
                    .gee-quad-badge.q4 {
                        bottom: 25px;
                        right: 25px;
                        border: 2px solid #c586c0;
                        color: #c586c0;
                    }
                    .snap-pro-input {
                        background: #141417;
                        color: #ffffff;
                        border: 1px solid rgba(255,255,255,0.16);
                        border-radius: 4px;
                        padding: 4px 7px;
                        font-size: 11px;
                        outline: none;
                        width: 100%;
                        box-sizing: border-box;
                    }
                    .snap-pro-input:focus {
                        border-color: #4ec9b0;
                    }

                    /* --- AUTOMATIC LIGHT THEME ADAPTATION (body.vscode-light) --- */
                    body.vscode-light {
                        background: #f1f5f9;
                    }
                    body.vscode-light .gee-layer-manager,
                    body.vscode-light .gee-snapshot-modal,
                    body.vscode-light .gee-ruler-panel,
                    body.vscode-light .help-popup {
                        background: rgba(255, 255, 255, 0.96) !important;
                        color: #1e293b !important;
                        border: 1px solid rgba(15, 23, 42, 0.16) !important;
                        box-shadow: 0 12px 36px rgba(15, 23, 42, 0.18) !important;
                    }
                    body.vscode-light .gee-layer-manager.collapsed {
                        background: rgba(255, 255, 255, 0.95) !important;
                    }
                    body.vscode-light .gee-layer-header,
                    body.vscode-light .gee-modal-header {
                        background: rgba(241, 245, 249, 0.92) !important;
                        color: #0f172a !important;
                        border-bottom: 1px solid rgba(15, 23, 42, 0.1) !important;
                    }
                    body.vscode-light .gee-btn-icon {
                        background: rgba(15, 23, 42, 0.06);
                        border: 1px solid rgba(15, 23, 42, 0.14);
                        color: #334155;
                    }
                    body.vscode-light .gee-btn-icon:hover {
                        background: rgba(15, 23, 42, 0.12);
                        color: #0f172a;
                    }
                    body.vscode-light .gee-btn-icon.active {
                        background: rgba(13, 148, 136, 0.15);
                        color: #0f766e;
                        border-color: #0d9488;
                    }
                    body.vscode-light .gee-section-title {
                        color: #475569 !important;
                    }
                    body.vscode-light .gee-basemap-select,
                    body.vscode-light #snapScaleSelect,
                    body.vscode-light #snapFormatSelect,
                    body.vscode-light #snapPaperSelect,
                    body.vscode-light #snapThemeSelect,
                    body.vscode-light #rulerUnitSelect,
                    body.vscode-light .snap-pro-input {
                        background-color: #f8fafc !important;
                        color: #0f172a !important;
                        border: 1px solid #cbd5e1 !important;
                    }
                    body.vscode-light .gee-layer-item {
                        background: rgba(15, 23, 42, 0.03) !important;
                        border: 1px solid rgba(15, 23, 42, 0.08) !important;
                    }
                    body.vscode-light .gee-layer-item:hover {
                        background: rgba(15, 23, 42, 0.07) !important;
                    }
                    body.vscode-light .gee-layer-name {
                        color: #1e293b !important;
                    }
                    body.vscode-light .gee-layer-badge {
                        background: #e2e8f0 !important;
                        color: #0f766e !important;
                    }
                    body.vscode-light .gee-layer-group {
                        background: rgba(241, 245, 249, 0.7) !important;
                        border-color: rgba(15, 23, 42, 0.1) !important;
                    }
                    body.vscode-light .gee-group-header {
                        background: rgba(15, 23, 42, 0.05) !important;
                        color: #0f172a !important;
                    }
                    body.vscode-light .gee-modal-opts label {
                        color: #334155 !important;
                    }
                    body.vscode-light .gee-btn-action.secondary {
                        background: #f1f5f9 !important;
                        color: #1e293b !important;
                        border: 1px solid #cbd5e1 !important;
                    }
                    body.vscode-light .gee-btn-action.secondary:hover {
                        background: #e2e8f0 !important;
                        color: #0f172a !important;
                    }
                    body.vscode-light .coords-label,
                    body.vscode-light .leaflet-control-scale-line {
                        background: rgba(255, 255, 255, 0.92) !important;
                        color: #0f172a !important;
                        border-color: #0d9488 !important;
                        text-shadow: none !important;
                        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.15) !important;
                    }
                    body.vscode-light .toolbar-toggle {
                        background: rgba(255, 255, 255, 0.94) !important;
                        color: #1e293b !important;
                        border: 1px solid rgba(15, 23, 42, 0.18) !important;
                        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15) !important;
                    }
                    body.vscode-light .leaflet-bar a {
                        background-color: #ffffff !important;
                        color: #1e293b !important;
                        border-color: #cbd5e1 !important;
                    }
                    body.vscode-light .gee-draw-toolbar { background: #ffffff !important; border-color: #dadce0 !important; }
                    body.vscode-light .gee-draw-btn { color: #3c4043 !important; border-right-color: #e8eaed !important; }
                    body.vscode-light .gee-draw-btn:hover { background: #f1f3f4 !important; color: #202124 !important; }
                    body.vscode-light .gee-draw-btn.active { background: #1a73e8 !important; color: #ffffff !important; }
                    body.vscode-light .gee-geom-dock { background: #ffffff !important; border-color: #dadce0 !important; }
                    body.vscode-light .gee-geom-layer-row { color: #3c4043 !important; border-bottom-color: #f1f3f4 !important; }
                    body.vscode-light .gee-geom-layer-row:hover { background: #f8f9fa !important; }
                    body.vscode-light .gee-geom-layer-row.active { background: #e8f0fe !important; color: #1a73e8 !important; }
                    body.vscode-light .gee-geom-footer { background: #f8f9fa !important; border-top-color: #dadce0 !important; }
                    body.vscode-light .gee-geom-modal { background: #ffffff !important; border-color: #dadce0 !important; color: #202124 !important; }
                    body.vscode-light .gee-geom-modal-header { border-bottom-color: #dadce0 !important; }
                    body.vscode-light .gee-geom-modal-footer { border-top-color: #dadce0 !important; background: #f8f9fa !important; }
                    body.vscode-light .gee-geom-field input[type="text"],
                    body.vscode-light .gee-geom-field select { background: #ffffff !important; border-color: #dadce0 !important; color: #202124 !important; }
                    body.vscode-light .gee-geom-props-box { background: #f8f9fa !important; border-color: #dadce0 !important; color: #5f6368 !important; }
                    body.vscode-light .gee-geom-prop-input { background: #ffffff !important; border-color: #dadce0 !important; color: #202124 !important; }
                    body.vscode-light .gee-geom-btn.secondary { background: #f1f3f4 !important; border-color: #dadce0 !important; color: #3c4043 !important; }
                </style>
            </head>
            <body>
                <div id="map" tabindex="0" style="outline: none;"></div>
                <div id="geeWebviewErrorOverlay" style="display:none; position:fixed; top:20px; left:20px; right:20px; background:rgba(180, 20, 20, 0.95); border: 2px solid #ff4444; color:#fff; padding:14px; border-radius:8px; z-index:99999999; font-family:monospace; font-size:12px; box-shadow:0 8px 30px rgba(0,0,0,0.8);">
                    <div style="font-weight:bold; font-size:13px; margin-bottom:6px;">⚠️ GEE Map Webview Error:</div>
                    <div id="geeWebviewErrorMessage" style="white-space:pre-wrap; max-height: 200px; overflow-y: auto;"></div>
                </div>
                <div id="coords" class="coords-label">Lat: 0.0000, Lng: 0.0000</div>
                <div id="mapHud" class="gee-hud"></div>

                <!-- Google Earth Engine Style Geometry Drawing & Imports System -->
                <div id="geeGeometryContainer" class="gee-geom-container">
                    <!-- 1. Drawing Tools Toolbar (Pan, Point, Line, Polygon, Rectangle, Toggle Dock) -->
                    <div id="geeDrawToolbar" class="gee-draw-toolbar">
                        <button id="btnGeomPan" class="gee-draw-btn active" title="Navegar mapa / Manito (Esc o 0)" onclick="setGeomDrawMode('pan')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>
                        </button>
                        <button id="btnGeomPoint" class="gee-draw-btn" title="Puntos / Marcador (1 / Ctrl+1)" onclick="setGeomDrawMode('marker')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        </button>
                        <button id="btnGeomLine" class="gee-draw-btn" title="Línea / Polilínea (2 / Ctrl+2)" onclick="setGeomDrawMode('polyline')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><circle cx="3" cy="17" r="2"/><circle cx="9" cy="11" r="2"/><circle cx="13" cy="15" r="2"/><circle cx="21" cy="7" r="2"/></svg>
                        </button>
                        <button id="btnGeomPolygon" class="gee-draw-btn" title="Polígono (3 / Ctrl+3)" onclick="setGeomDrawMode('polygon')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 18 20 6 20 2 8.5"/></svg>
                        </button>
                        <button id="btnGeomRect" class="gee-draw-btn" title="Rectángulo (4 / Ctrl+4)" onclick="setGeomDrawMode('rectangle')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                        </button>
                        <button id="btnToggleGeomDock" class="gee-draw-btn" title="Mostrar / Ocultar Geo. Imports" onclick="toggleGeomDockVisibility()">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        </button>
                    </div>

                    <!-- 2. Geometry Imports Dock (Geo. Imports) -->
                    <div id="geeGeometryDock" class="gee-geom-dock" style="display: none;">
                        <div id="geeGeometryDockHeader" class="gee-geom-header">
                            <input type="checkbox" id="chkGeomMaster" checked title="Mostrar/Ocultar todas las capas" onchange="toggleAllGeomLayers(this.checked)" />
                            <span class="gee-geom-title" onclick="toggleGeomDockCollapse()">Geo. Imports</span>
                            <div class="gee-geom-header-actions">
                                <button class="gee-geom-header-btn" onclick="exportGeometriesToGeoJSON()" title="Exportar a GeoJSON (.geojson)">💾</button>
                                <button class="gee-geom-header-btn" onclick="insertGeometryCodeToEditor()" title="Insertar en script activo (Smart Replace)">📥</button>
                                <button class="gee-geom-header-btn" onclick="copyGeometryCode()" title="Copiar código al portapapeles">📋</button>
                                <button class="gee-geom-header-btn" id="btnGeomCollapse" onclick="toggleGeomDockCollapse()" title="Minimizar / Expandir panel">▾</button>
                            </div>
                        </div>
                        <div id="geeGeometryDockBody" class="gee-geom-body">
                            <div id="geeGeomLayersList" class="gee-geom-layers-list">
                                <!-- Layers dynamically rendered here -->
                            </div>
                            <div class="gee-geom-footer">
                                <a class="gee-geom-add-link" onclick="createNewGeomLayer()">+ new layer</a>
                            </div>
                        </div>
                    </div>

                    <!-- 3. Drawing Status Banner -->
                    <div id="geeDrawStatusBanner" class="gee-draw-banner" style="display: none;">
                        <span id="geeDrawStatusLabel">Line drawing.</span>
                        <button id="btnGeomLock" class="gee-banner-btn" onclick="toggleGeomLock()" title="Lock / Unlock shape editing">🔓</button>
                        <button class="gee-banner-btn exit-btn" onclick="exitGeomDrawMode()" title="Exit drawing mode">Exit</button>
                    </div>
                </div>

                <!-- 4. Configure Geometry Import Modal -->
                <div id="geeGeomModalBackdrop" class="gee-geom-backdrop" style="display: none;" onclick="closeGeomConfigModal()"></div>
                <div id="geeGeomModal" class="gee-geom-modal" style="display: none;">
                    <div class="gee-geom-modal-header">
                        <span>Configure geometry import</span>
                        <button class="gee-geom-modal-close" onclick="closeGeomConfigModal()">✕</button>
                    </div>
                    <div class="gee-geom-modal-body">
                        <!-- Left Column: Name, Import As, Properties -->
                        <div class="gee-geom-modal-col left">
                            <div class="gee-geom-field">
                                <label>Name</label>
                                <input type="text" id="geomModalName" placeholder="geometry" />
                            </div>
                            <div class="gee-geom-field">
                                <label>Import as</label>
                                <select id="geomModalType">
                                    <option value="Geometry">Geometry</option>
                                    <option value="Feature">Feature</option>
                                    <option value="FeatureCollection">FeatureCollection</option>
                                </select>
                            </div>
                            <div class="gee-geom-field">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="margin: 0;">Properties</label>
                                    <button class="gee-geom-prop-add-btn" onclick="addGeomModalProperty()">+ Add property</button>
                                </div>
                                <div id="geomModalPropertiesBox" class="gee-geom-props-box">
                                    <!-- Dynamic properties list or 'No properties.' -->
                                </div>
                            </div>
                        </div>
                        <!-- Right Column: Color Picker -->
                        <div class="gee-geom-modal-col right">
                            <div class="gee-geom-field">
                                <label>Color</label>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <div id="geomModalColorSwatch" class="gee-geom-modal-swatch"></div>
                                    <input type="text" id="geomModalColorHex" value="#d63000" maxlength="7" oninput="onGeomModalHexInput(this.value)" />
                                    <!-- Native rainbow color picker trigger -->
                                    <label class="gee-geom-spectrum-trigger" title="Open full spectrum color picker">
                                        <input type="color" id="geomModalNativePicker" oninput="onGeomModalNativePicker(this.value)" />
                                    </label>
                                </div>
                                <!-- 10-Color Preset Palette Grid -->
                                <div class="gee-geom-presets-grid" id="geomModalPresets">
                                    <!-- Swatches rendered here -->
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="gee-geom-modal-footer">
                        <div style="display: flex; gap: 8px;">
                            <button class="gee-geom-btn primary" onclick="saveGeomConfigModal()">OK</button>
                            <button class="gee-geom-btn secondary" onclick="closeGeomConfigModal()">Cancel</button>
                        </div>
                        <button class="gee-geom-btn danger" onclick="confirmDeleteGeomLayer()" title="Delete geometry layer">🗑️</button>
                    </div>
                </div>
                <div class="toolbar-container" style="left: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 8px;">
                    <button class="toolbar-toggle" id="btn-ruler" onclick="toggleRulerMode()" title="Regla de Medición GIS (Distancia, Área, GeoJSON) [Option+M]" style="font-size: 15px;">📏</button>
                    <button class="toolbar-toggle" id="btn-swipe" onclick="toggleSwipeMode()" title="Swipe Tool (Before/After Comparison) - Hold Shift for Horizontal Mode" style="font-size: 15px;">🔀</button>
                    <button class="toolbar-toggle" onclick="showHelp()" title="Help & Shortcuts">❓</button>
                </div>

                <div class="toolbar-container" style="right: 20px; bottom: 20px; left: auto; display: flex; flex-direction: column; gap: 8px;">
                    <button class="toolbar-toggle" style="background: rgba(180, 40, 40, 0.92) !important; color: #fff !important; border: 1px solid rgba(255, 120, 120, 0.4) !important; font-size: 15px;" onclick="promptResetEnv()" title="Reset Environment & Map">🧹</button>
                </div>

                <div id="rulerPanel" class="gee-ruler-panel" style="display: none;">
                    <div class="gee-modal-header" style="background: rgba(78, 201, 176, 0.12); border-bottom: 1px solid rgba(78, 201, 176, 0.25);">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span>📏 Regla GIS</span>
                            
                        </div>
                        <button class="gee-modal-close" onclick="toggleRulerMode(false)" title="Cerrar Regla (Esc)">✕</button>
                    </div>
                    <div class="gee-ruler-tabs">
                        <button id="rulerTabLine" class="gee-ruler-tab active" onclick="setRulerType('line')">📏 Distancia (Línea)</button>
                        <button id="rulerTabArea" class="gee-ruler-tab" onclick="setRulerType('area')">📐 Área (Polígono)</button>
                    </div>
                    <div style="padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                            <span id="rulerMainLabel" style="font-size: 10px; color: #9cdcfe; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Distancia Total</span>
                            <select id="rulerUnitSelect" onchange="updateRulerUI()" style="background: #18181b; color: #ddd; border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; font-size: 10.5px; padding: 2px 5px; outline: none; cursor: pointer;"></select>
                        </div>
                        <div style="background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.1); border-radius: 7px; padding: 7px 10px; display: flex; flex-direction: column; gap: 3px;">
                            <div id="rulerPrimaryValue" style="font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 700; color: #4ec9b0;">0.00 m</div>
                            <div id="rulerSecondaryValue" style="font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: #aaa;">Haz clic en el mapa para medir...</div>
                        </div>
                        <div id="rulerSegmentsBox" style="max-height: 92px; overflow-y: auto; background: rgba(0,0,0,0.25); border-radius: 5px; padding: 4px 6px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #bbb; display: none;"></div>
                        <div id="rulerElevBox" style="display: none; background: rgba(0,0,0,0.4); border: 1px solid rgba(78, 201, 176, 0.25); border-radius: 6px; padding: 6px;"></div>
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px;">
                            <button class="gee-btn-action secondary" style="padding: 5px 4px; font-size: 10.5px;" onclick="rulerUndo()" title="Deshacer último vértice (Backspace)">↩️ Atrás</button>
                            <button class="gee-btn-action secondary" style="padding: 5px 4px; font-size: 10.5px;" onclick="rulerClear()" title="Limpiar medición">🗑️ Limpiar</button>
                            <button class="gee-btn-action secondary" style="padding: 5px 4px; font-size: 10.5px;" onclick="rulerCopy()" title="Copiar resultado al portapapeles">📋 Copiar</button>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px;">
                            <button id="btnRulerProfile" class="gee-btn-action secondary" style="padding: 5px 6px; font-size: 10.5px; opacity: 0.6;" onclick="showHud('⛰️ Perfil DEM disponible en GEE IDE Pro')" title="Función disponible en versión Pro">⛰️ Perfil DEM (Pro)</button>
                            <button class="gee-btn-action primary" style="padding: 5px 6px; font-size: 10.5px;" onclick="exportRulerGeoJSON()" title="Exportar geometría y mediciones a GeoJSON">💾 GeoJSON</button>
                        </div>
                    </div>
                </div>

                <div id="swipe-divider" style="display: none; position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: rgba(255, 255, 255, 0.78); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1000; cursor: col-resize; box-shadow: 0 0 8px rgba(0,0,0,0.45);">
                    <div id="swipe-handle" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 14px; height: 32px; background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 4px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.5);" title="Doble clic para alternar orientación fija • Mantén Control para alternar">
                        <span id="swipe-icon" style="color: #222; font-size: 10px; font-weight: 800; transform: rotate(90deg); user-select: none;">=</span>
                    </div>
                </div>

                

                <!-- Swipe Pro Quad-Swipe Crosshair Overlay -->
                <div id="quad-crosshair" style="display: none; pointer-events: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1000;">
                    <div id="quad-line-v" style="position: absolute; top: 0; bottom: 0; left: 50%; width: 1.5px; background: rgba(255,255,255,0.85); box-shadow: 0 0 6px rgba(0,0,0,0.6);"></div>
                    <div id="quad-line-h" style="position: absolute; left: 0; right: 0; top: 50%; height: 1.5px; background: rgba(255,255,255,0.85); box-shadow: 0 0 6px rgba(0,0,0,0.6);"></div>
                    <div id="quad-handle" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 30px; height: 30px; border-radius: 50%; background: rgba(255,255,255,0.92); border: 2px solid #4ec9b0; box-shadow: 0 2px 10px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; cursor: move; pointer-events: auto;" title="Arrastra para ajustar la comparación de los 4 cuadrantes">
                        <span style="font-size: 16px; color: #18181b; font-weight: 900; line-height: 1; user-select: none;">✥</span>
                    </div>
                    <div id="quad-label-q1" class="gee-quad-badge q1" title="Cuadrante 1: [1]">[1]</div>
                    <div id="quad-label-q2" class="gee-quad-badge q2" title="Cuadrante 2: [2]">[2]</div>
                    <div id="quad-label-q3" class="gee-quad-badge q3" title="Cuadrante 3: [3]">[3]</div>
                    <div id="quad-label-q4" class="gee-quad-badge q4" title="Cuadrante 4: [4]">[4]</div>
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

                <div id="snapshotModal" class="gee-snapshot-modal" style="display: none; width: 350px; max-height: calc(100vh - 90px); overflow-y: auto;">
                    <div class="gee-modal-header" style="background: rgba(78, 201, 176, 0.14); border-bottom: 1px solid rgba(78, 201, 176, 0.28);">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span>📸 Snapshot & Lámina SIG</span>
                            <span style="background: linear-gradient(135deg, #4ec9b0, #007acc); color: #000; font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 4px; letter-spacing: 0.4px;">PRO</span>
                        </div>
                        <button class="gee-modal-close" onclick="toggleSnapshotModal()">✕</button>
                    </div>
                    <div class="gee-modal-body">
                        <div class="gee-modal-opts">
                            <div style="display: flex; gap: 6px;">
                                <div style="flex: 1.15; display: flex; flex-direction: column; gap: 3px;">
                                    <span style="font-size: 10px; color: #9cdcfe; font-weight: 600;">Resolución DPI:</span>
                                    <select id="snapScaleSelect" onchange="syncSnapHdLegacy()" style="background: #18181b; color: #eee; border: 1px solid rgba(255,255,255,0.18); border-radius: 5px; font-size: 10.5px; padding: 4px 5px; outline: none; cursor: pointer;">
                                        <option value="1">1x (96 DPI)</option>
                                        <option value="2" selected>2x Retina (192 DPI)</option>
                                        <option value="4">4x Print (300 DPI) ★</option>
                                    </select>
                                    <input type="checkbox" id="snapOptHd" checked style="display:none;" />
                                </div>
                                <div style="flex: 1; display: flex; flex-direction: column; gap: 3px;">
                                    <span style="font-size: 10px; color: #9cdcfe; font-weight: 600;">Formato:</span>
                                    <select id="snapFormatSelect" onchange="syncSnapFormatChange()" style="background: #18181b; color: #eee; border: 1px solid rgba(255,255,255,0.18); border-radius: 5px; font-size: 10.5px; padding: 4px 5px; outline: none; cursor: pointer;">
                                        <option value="png" selected>🖼️ PNG (Sin pérdida)</option>
                                        <option value="jpg">📷 JPG (Ligero 95%)</option>
                                        <option value="pdf">📄 PDF Documento</option>
                                    </select>
                                </div>
                            </div>

                            <div style="display: flex; gap: 6px; margin-top: 2px;">
                                <div style="flex: 1.15; display: flex; flex-direction: column; gap: 3px;">
                                    <span style="font-size: 10px; color: #9cdcfe; font-weight: 600;">Hoja / Papel:</span>
                                    <select id="snapPaperSelect" style="background: #18181b; color: #eee; border: 1px solid rgba(255,255,255,0.18); border-radius: 5px; font-size: 10.5px; padding: 4px 5px; outline: none; cursor: pointer;">
                                        <option value="auto" selected>📐 Auto (Visor libre)</option>
                                        <option value="A4">📄 A4 (297×210 mm)</option>
                                        <option value="A3">📄 A3 (420×297 mm)</option>
                                        <option value="A2">📜 A2 (594×420 mm)</option>
                                        <option value="A1">🗺️ A1 (841×594 mm)</option>
                                    </select>
                                </div>
                                <div style="flex: 1; display: flex; flex-direction: column; gap: 3px;">
                                    <span style="font-size: 10px; color: #9cdcfe; font-weight: 600;">Orientación:</span>
                                    <select id="snapOrientationSelect" style="background: #18181b; color: #eee; border: 1px solid rgba(255,255,255,0.18); border-radius: 5px; font-size: 10.5px; padding: 4px 5px; outline: none; cursor: pointer;">
                                        <option value="auto" selected>🔄 Auto (Pantalla)</option>
                                        <option value="landscape">↔ Horizontal</option>
                                        <option value="portrait">↕ Vertical</option>
                                    </select>
                                </div>
                            </div>

                            <label><input type="checkbox" id="snapOptCoords" checked /> Incluir coordenadas, UTM y escala</label>
                            <label><input type="checkbox" id="snapOptDrawings" checked /> Incluir dibujos, vectores y regla (📏)</label>
                            <label title="Desmarca para exportar en Marca Blanca sin mostrar el nombre GEE IDE Pro"><input type="checkbox" id="snapOptBrand" onchange="syncSnapBrandOption()" checked /> 🏷️ Mostrar marca "GEE IDE Pro" (Marca Blanca)</label>

                            <div style="border-top: 1px solid rgba(128,128,128,0.2); margin: 2px 0; padding-top: 6px;">
                                <label style="color: #0d9488; font-weight: 700;">
                                    <input type="checkbox" id="snapOptLayout" onchange="toggleSnapProConfig()" />
                                    🗺️ Lámina Cartográfica Pro (Marco + Membrete)
                                </label>
                            </div>

                            <div id="snapProElementsGrid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px 8px; background: rgba(128,128,128,0.1); padding: 7px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.15);">
                                <label style="font-size: 10.5px;"><input type="checkbox" id="snapOptNorth" checked /> 🧭 Flecha Norte</label>
                                <label style="font-size: 10.5px;"><input type="checkbox" id="snapOptScaleBar" checked /> 📏 Escala Gráfica</label>
                                <label style="font-size: 10.5px;"><input type="checkbox" id="snapOptGrid" /> 🌐 Grilla Lat/Lon</label>
                                <label style="font-size: 10.5px;"><input type="checkbox" id="snapOptLegend" checked /> 🎨 Leyenda Capas</label>
                            </div>

                            <div id="snapProConfig" style="display: none; flex-direction: column; gap: 6px; background: rgba(78, 201, 176, 0.06); border: 1px solid rgba(78, 201, 176, 0.25); border-radius: 7px; padding: 8px;">
                                <div style="display: flex; flex-direction: column; gap: 3px;">
                                    <span style="font-size: 10px; opacity: 0.8;">Título Principal del Mapa:</span>
                                    <input type="text" id="snapTitleInput" class="snap-pro-input" placeholder="Ej. Monitoreo Multitemporal de Cobertura" value="Mapa de Análisis Geoespacial" />
                                </div>
                                <div style="display: flex; gap: 6px;">
                                    <div style="flex: 1.2; display: flex; flex-direction: column; gap: 3px;">
                                        <span style="font-size: 10px; opacity: 0.8;">Autor / Especialista:</span>
                                        <input type="text" id="snapAuthorInput" class="snap-pro-input" placeholder="Autor / Lab" value="GEE IDE Pro" />
                                    </div>
                                    <div style="flex: 1; display: flex; flex-direction: column; gap: 3px;">
                                        <span style="font-size: 10px; opacity: 0.8;">Tema de Lámina:</span>
                                        <select id="snapThemeSelect" style="background: #141417; color: #eee; border: 1px solid rgba(255,255,255,0.16); border-radius: 4px; padding: 4px 5px; font-size: 10.5px; outline: none; cursor: pointer;">
                                            <option value="light">📄 Blanco Paper</option>
                                            <option value="dark">🌑 Oscuro GIS</option>
                                        </select>
                                    </div>
                                </div>
                                <div style="display: flex; justify-content: flex-end; margin-top: 2px;">
                                    <button type="button" class="gee-btn-action secondary" style="padding: 4px 8px; font-size: 10px;" onclick="toggleSnapMoreTexts()">✏️ Más Textos ▾</button>
                                </div>
                                <div id="snapMoreTextsBox" style="display: none; flex-direction: column; gap: 5px; border-top: 1px dashed rgba(128,128,128,0.3); padding-top: 6px; margin-top: 2px;">
                                    <div style="display: flex; flex-direction: column; gap: 2px;">
                                        <span style="font-size: 9.5px; opacity: 0.8;">Subtítulo Superior:</span>
                                        <input type="text" id="snapSubtitleInput" class="snap-pro-input" placeholder="Subtítulo del encabezado" value="Sistema de Información Geográfica y Teledetección Espacial" />
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 2px;">
                                        <span style="font-size: 9.5px; opacity: 0.8;">Institución / Nota al Pie (Celda 1):</span>
                                        <input type="text" id="snapInstInput" class="snap-pro-input" placeholder="Ej. UNMSM - UNASAM | SERFOR" value="Procesado en Google Earth Engine • GEE IDE Pro" />
                                    </div>
                                    <div style="display: flex; gap: 5px;">
                                        <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                                            <span style="font-size: 9.5px; opacity: 0.8;">CRS / Proyección:</span>
                                            <input type="text" id="snapCrsInput" class="snap-pro-input" placeholder="Auto (UTM + WGS 84)" value="" />
                                        </div>
                                        <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                                            <span style="font-size: 9.5px; opacity: 0.8;">Título de Leyenda:</span>
                                            <input type="text" id="snapLegendTitleInput" class="snap-pro-input" placeholder="LEYENDA / CAPAS ACTIVAS" value="LEYENDA / CAPAS ACTIVAS" />
                                        </div>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 2px;">
                                        <span style="font-size: 9.5px; opacity: 0.8;">Escala / Fecha Personalizada (Opcional):</span>
                                        <input type="text" id="snapCustomMetaInput" class="snap-pro-input" placeholder="Dejar vacío para cálculo automático" value="" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="gee-modal-actions">
                            <button class="gee-btn-action primary" onclick="takeSnapshot('workspace')">💾 Guardar en Screenshots/</button>
                            <button class="gee-btn-action secondary" onclick="takeSnapshot('saveAs')">📁 Guardar como...</button>
                            <button class="gee-btn-action secondary" onclick="takeSnapshot('clipboard')">📋 Copiar al Portapapeles</button>
                        </div>
                    </div>
                </div>

                <div id="helpPopup" class="help-popup">
                    <h3>GEE IDE Shortcuts</h3>
                    <p><kbd>Cmd</kbd> + <kbd>Enter</kbd> : Run Selection / Smart Block</p>
                    <p><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd> : Run Entire Script</p>
                    <p><kbd>Cmd</kbd> + <kbd>1..4</kbd> : Switch Focus (Editor/Console/Map/AI)</p>
                    <p><kbd>Option</kbd> + <kbd>M</kbd> : QGIS Ruler / Measure Tool (📏)</p>
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
                            const overlay = document.getElementById("geeWebviewErrorOverlay");
                            const msgEl = document.getElementById("geeWebviewErrorMessage");
                            if (overlay && msgEl) {
                                overlay.style.display = "block";
                                msgEl.textContent = String(message) + " (Line " + lineno + ", Col " + colno + ")";
                                if (error && error.stack) {
                                    msgEl.textContent += " - " + error.stack;
                                }
                            }
                        } catch(e) {}
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

                    // Custom SVG Marker Icon Generator (Crisp HD Apple/Figma Precision Pin)
                    function createPinIcon(fillColor = '#2A81CB') {
                        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 32" width="26" height="32">' +
                            '<defs>' +
                            '<filter id="pinShadow" x="-30%" y="-20%" width="160%" height="150%">' +
                            '<feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.35"/>' +
                            '</filter>' +
                            '</defs>' +
                            '<path d="M 13 31 C 12.2 26 3 17.5 3 11 A 10 10 0 1 1 23 11 C 23 17.5 13.8 26 13 31 Z" fill="' + fillColor + '" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round" filter="url(#pinShadow)"/>' +
                            '<circle cx="13" cy="11" r="4.2" fill="#FFFFFF"/>' +
                            '<circle cx="13" cy="11" r="2" fill="' + fillColor + '"/>' +
                            '</svg>';
                        return L.icon({
                            iconUrl: 'data:image/svg+xml;base64,' + btoa(svg),
                            iconSize: [26, 32],
                            iconAnchor: [13, 31],
                            popupAnchor: [0, -32],
                            shadowUrl: ''
                        });
                    }

                    const defaultPinIcon = createPinIcon('#d63000');
                    L.Marker.prototype.options.icon = defaultPinIcon;

                    // Toggle visibility of the Geo. Imports dock
                    function toggleGeomDockVisibility() {
                        const dock = document.getElementById('geeGeometryDock');
                        const toggleBtn = document.getElementById('btnToggleGeomDock');
                        if (!dock) return;
                        const isHidden = dock.style.display === 'none' || getComputedStyle(dock).display === 'none';
                        if (isHidden) {
                            dock.style.display = 'flex';
                            if (toggleBtn) toggleBtn.classList.add('active');
                        } else {
                            dock.style.display = 'none';
                            if (toggleBtn) toggleBtn.classList.remove('active');
                        }
                    }

                    // =========================================================================
                    // GOOGLE EARTH ENGINE GEOMETRY IMPORTS & VECTOR DRAWING SYSTEM
                    // =========================================================================
                    const GEE_PRESET_COLORS = [
                        '#d63000', // GEE Red (Default)
                        '#98ff00', // GEE Lime
                        '#0b4a8b', // GEE Dark Blue
                        '#ffc82d', // GEE Yellow / Orange
                        '#00ffff', // Cyan
                        '#ff00ff', // Magenta
                        '#00e676', // Emerald Green
                        '#ff9800', // Amber Orange
                        '#9c27b0', // Purple
                        '#ffffff'  // White
                    ];

                    let geomColorIndex = 1;
                    function getNextGeomColor() {
                        const col = GEE_PRESET_COLORS[geomColorIndex % GEE_PRESET_COLORS.length];
                        geomColorIndex++;
                        return col;
                    }

                    // Master state of all geometry import layers
                    let geometryLayers = [
                        {
                            id: 'geom_layer_1',
                            name: 'geometry',
                            type: 'Geometry', // 'Geometry' | 'Feature' | 'FeatureCollection'
                            color: '#d63000',
                            visible: true,
                            properties: {},
                            shapes: [], // { id, type, coordinates, layerInstance }
                            featureGroup: new L.FeatureGroup()
                        }
                    ];
                    map.addLayer(geometryLayers[0].featureGroup);

                    let activeGeomLayerId = 'geom_layer_1';
                    let activeDrawer = null;
                    let activeDrawMode = 'pan'; // 'pan' | 'marker' | 'polyline' | 'polygon' | 'rectangle'
                    let isGeometryLocked = false;
                    let modalEditingLayerId = null;

                    function getActiveGeomLayer() {
                        let l = geometryLayers.find(x => x.id === activeGeomLayerId);
                        if (!l && geometryLayers.length > 0) {
                            l = geometryLayers[0];
                            activeGeomLayerId = l.id;
                        }
                        return l;
                    }

                    function setActiveGeomLayer(id) {
                        activeGeomLayerId = id;
                        renderGeometryImportsUI();
                        if (activeDrawMode !== 'pan') {
                            setGeomDrawMode(activeDrawMode);
                        }
                    }

                    function setGeomDrawMode(mode, options) {
                        const isRestart = !!(options && options.isRestart);

                        // Toggle logic: if user triggers active mode again via shortcut/button, toggle it OFF back to pan
                        if (!isRestart && mode !== 'pan' && activeDrawMode === mode) {
                            setGeomDrawMode('pan');
                            showHud('🖐️ Modo Navegación (Manito)');
                            return;
                        }

                        if (activeDrawer) {
                            try { activeDrawer.disable(); } catch (e) {}
                            activeDrawer = null;
                        }

                        activeDrawMode = mode;

                        ['btnGeomPan', 'btnGeomPoint', 'btnGeomLine', 'btnGeomPolygon', 'btnGeomRect'].forEach(id => {
                            const btn = document.getElementById(id);
                            if (btn) btn.classList.remove('active');
                        });

                        const banner = document.getElementById('geeDrawStatusBanner');
                        const label = document.getElementById('geeDrawStatusLabel');
                        const dock = document.getElementById('geeGeometryDock');
                        const toggleBtn = document.getElementById('btnToggleGeomDock');

                        if (mode === 'pan') {
                            if (map && map.doubleClickZoom) map.doubleClickZoom.enable();
                            const btn = document.getElementById('btnGeomPan');
                            if (btn) btn.classList.add('active');
                            if (banner) banner.style.display = 'none';
                            if (dock) dock.style.display = 'none';
                            if (toggleBtn) toggleBtn.classList.remove('active');
                            return;
                        }

                        if (map && map.doubleClickZoom) map.doubleClickZoom.disable();

                        // Activate dock when a drawing tool is selected
                        if (dock) dock.style.display = 'flex';
                        if (toggleBtn) toggleBtn.classList.add('active');

                        const activeLayer = getActiveGeomLayer();
                        if (!activeLayer) return;

                        if (banner) banner.style.display = 'flex';

                        const col = activeLayer.color || '#d63000';
                        const commonOpts = {
                            shapeOptions: {
                                color: col,
                                fillColor: col,
                                fillOpacity: 0.25,
                                weight: 2.5
                            }
                        };

                        if (mode !== 'pan' && (typeof L === 'undefined' || !L.Draw)) {
                            showHud('⚠️ Drawing tools loading, please wait...');
                            return;
                        }

                        if (mode === 'marker') {
                            const btn = document.getElementById('btnGeomPoint');
                            if (btn) btn.classList.add('active');
                            if (label) label.textContent = 'Point placement.';
                            activeDrawer = new L.Draw.Marker(map, { icon: createPinIcon(col) });
                            if (!isRestart) showHud('📍 Marcador / Punto activado (Option+1 / Ctrl+1)');
                        } else if (mode === 'polyline') {
                            const btn = document.getElementById('btnGeomLine');
                            if (btn) btn.classList.add('active');
                            if (label) label.textContent = 'Line drawing.';
                            activeDrawer = new L.Draw.Polyline(map, { shapeOptions: { color: col, weight: 3 } });
                            if (!isRestart) showHud('📈 Línea activada (Option+2 / Ctrl+2)');
                        } else if (mode === 'polygon') {
                            const btn = document.getElementById('btnGeomPolygon');
                            if (btn) btn.classList.add('active');
                            if (label) label.textContent = 'Polygon drawing.';
                            activeDrawer = new L.Draw.Polygon(map, commonOpts);
                            if (!isRestart) showHud('⬡ Polígono activado (Option+3 / Ctrl+3)');
                        } else if (mode === 'rectangle') {
                            const btn = document.getElementById('btnGeomRect');
                            if (btn) btn.classList.add('active');
                            if (label) label.textContent = 'Rectangle drawing.';
                            activeDrawer = new L.Draw.Rectangle(map, commonOpts);
                            if (!isRestart) showHud('▢ Rectángulo activado (Option+4 / Ctrl+4)');
                        }

                        if (activeDrawer) {
                            activeDrawer.enable();
                        }
                    }

                    function exitGeomDrawMode() {
                        setGeomDrawMode('pan');
                    }

                    function toggleGeomLock() {
                        isGeometryLocked = !isGeometryLocked;
                        const btn = document.getElementById('btnGeomLock');
                        if (btn) {
                            btn.innerHTML = isGeometryLocked ? '🔒' : '🔓';
                            btn.title = isGeometryLocked ? 'Locked (shape editing disabled)' : 'Unlocked (click shape to edit vertices)';
                        }
                        showHud(isGeometryLocked ? '🔒 Geometry editing locked' : '🔓 Geometry editing unlocked');
                    }

                    map.on('draw:created', function (event) {
                        const layer = event.layer;
                        const activeLayer = getActiveGeomLayer();
                        if (!activeLayer) return;

                        if (!map.hasLayer(activeLayer.featureGroup)) {
                            map.addLayer(activeLayer.featureGroup);
                            activeLayer.visible = true;
                        }

                        activeLayer.featureGroup.addLayer(layer);
                        layer._customColor = activeLayer.color;
                        layer._layerId = activeLayer.id;

                        let shapeType = 'Polygon';
                        let coords = null;

                        if (event.layerType === 'marker') {
                            shapeType = 'Point';
                            const ll = layer.getLatLng();
                            coords = [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))];
                        } else if (event.layerType === 'polyline') {
                            shapeType = 'LineString';
                            coords = layer.getLatLngs().map(ll => [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))]);
                        } else if (event.layerType === 'rectangle') {
                            shapeType = 'Rectangle';
                            const b = layer.getBounds();
                            coords = [
                                Number(b.getWest().toFixed(6)),
                                Number(b.getSouth().toFixed(6)),
                                Number(b.getEast().toFixed(6)),
                                Number(b.getNorth().toFixed(6))
                            ];
                        } else {
                            shapeType = 'Polygon';
                            const latlngs = layer.getLatLngs();
                            const ring = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs).map(ll => [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))]);
                            if (ring.length > 0) {
                                const f = ring[0];
                                const l = ring[ring.length - 1];
                                if (f[0] !== l[0] || f[1] !== l[1]) {
                                    ring.push([f[0], f[1]]);
                                }
                            }
                            coords = [ring];
                        }

                        const shapeId = 'shape_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                        const shapeObj = {
                            id: shapeId,
                            type: shapeType,
                            coordinates: coords,
                            layerInstance: layer
                        };
                        layer._shapeId = shapeId;
                        activeLayer.shapes.push(shapeObj);

                        attachGeometryPopup(layer, activeLayer, shapeObj);
                        renderGeometryImportsUI();
                        syncGeometriesToExtension();
                        showHud('Added to ' + activeLayer.name);

                        if (activeDrawMode !== 'pan') {
                            const keepMode = activeDrawMode;
                            setTimeout(() => {
                                if (activeDrawMode === keepMode) {
                                    setGeomDrawMode(keepMode, { isRestart: true });
                                }
                            }, 50);
                        }
                    });

                    function attachGeometryPopup(layer, geomLayer, shapeObj) {
                        const isMarker = layer instanceof L.Marker;
                        const popupOffset = isMarker ? [0, -8] : [0, -18];

                        layer.bindPopup(function() {
                            if (isGeometryLocked) {
                                const c = document.createElement('div');
                                c.style.cssText = 'padding: 4px 6px; font-size: 11px; color: #ffcc00; display: flex; align-items: center; gap: 4px;';
                                c.innerHTML = '🔒 Layer locked. Unlock in top banner to edit.';
                                return c;
                            }

                            const container = document.createElement('div');
                            container.style.cssText = 'display: flex; flex-direction: column; gap: 2px; padding: 2px; align-items: center;';

                            const row = document.createElement('div');
                            row.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%;';

                            const isEditing = layer._isEditing || false;
                            const btnEdit = document.createElement('button');
                            btnEdit.title = isEditing ? 'Save changes' : 'Edit / Move vertices';
                            btnEdit.innerHTML = isEditing ? '💾' : '✏️';
                            btnEdit.style.cssText = 'width: 22px; height: 22px; border-radius: 4px; border: ' + (isEditing ? '1px solid rgba(78, 201, 176, 0.5)' : 'none') + '; background: ' + (isEditing ? 'rgba(78, 201, 176, 0.25)' : 'transparent') + '; color: #fff; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; padding: 0;';

                            btnEdit.onclick = function(e) {
                                e.stopPropagation();
                                if (layer._isEditing) {
                                    if (layer instanceof L.Marker && layer.dragging) layer.dragging.disable();
                                    if (layer.editing) layer.editing.disable();
                                    layer._isEditing = false;
                                    btnEdit.innerHTML = '✏️';
                                    btnEdit.title = 'Edit / Move vertices';
                                    btnEdit.style.background = 'transparent';
                                    btnEdit.style.border = 'none';

                                    updateShapeCoordsFromLayer(shapeObj, layer);
                                    syncGeometriesToExtension();
                                    showHud('💾 Geometry updated');
                                } else {
                                    if (layer instanceof L.Marker && layer.dragging) layer.dragging.enable();
                                    if (layer.editing) layer.editing.enable();
                                    layer._isEditing = true;
                                    btnEdit.innerHTML = '💾';
                                    btnEdit.title = 'Save changes';
                                    btnEdit.style.background = 'rgba(78, 201, 176, 0.3)';
                                    btnEdit.style.border = '1px solid rgba(78, 201, 176, 0.6)';
                                    showHud(layer instanceof L.Marker ? '📍 Drag marker to move' : '✏️ Drag vertices to reshape');
                                }
                            };

                            const btnConfig = document.createElement('button');
                            btnConfig.title = 'Configure layer';
                            btnConfig.innerHTML = '⚙️';
                            btnConfig.style.cssText = 'width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: #fff; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;';
                            btnConfig.onclick = function(e) {
                                e.stopPropagation();
                                map.closePopup();
                                openGeomConfigModal(geomLayer.id);
                            };

                            const btnDelete = document.createElement('button');
                            btnDelete.title = 'Delete this shape';
                            btnDelete.innerHTML = '🗑️';
                            btnDelete.style.cssText = 'width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: #fff; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;';
                            btnDelete.onclick = function(e) {
                                e.stopPropagation();
                                if (layer._isEditing) {
                                    if (layer instanceof L.Marker && layer.dragging) layer.dragging.disable();
                                    if (layer.editing) layer.editing.disable();
                                }
                                geomLayer.featureGroup.removeLayer(layer);
                                geomLayer.shapes = geomLayer.shapes.filter(s => s.id !== shapeObj.id);
                                map.closePopup();
                                renderGeometryImportsUI();
                                syncGeometriesToExtension();
                                showHud('🗑️ Shape removed');
                            };

                            row.appendChild(btnEdit);
                            row.appendChild(btnConfig);
                            row.appendChild(btnDelete);
                            container.appendChild(row);

                            return container;
                        }, { closeButton: false, offset: popupOffset, maxWidth: 200, minWidth: 40 });

                        if (layer instanceof L.Marker) {
                            layer.on('dragend', function() {
                                updateShapeCoordsFromLayer(shapeObj, layer);
                                syncGeometriesToExtension();
                                showHud('📍 Marker moved');
                            });
                        }
                    }

                    function updateShapeCoordsFromLayer(shapeObj, layer) {
                        if (shapeObj.type === 'Point') {
                            const ll = layer.getLatLng();
                            shapeObj.coordinates = [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))];
                        } else if (shapeObj.type === 'LineString') {
                            shapeObj.coordinates = layer.getLatLngs().map(ll => [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))]);
                        } else if (shapeObj.type === 'Rectangle') {
                            const b = layer.getBounds();
                            shapeObj.coordinates = [
                                Number(b.getWest().toFixed(6)),
                                Number(b.getSouth().toFixed(6)),
                                Number(b.getEast().toFixed(6)),
                                Number(b.getNorth().toFixed(6))
                            ];
                        } else if (shapeObj.type === 'Polygon') {
                            const latlngs = layer.getLatLngs();
                            const ring = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs).map(ll => [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))]);
                            if (ring.length > 0) {
                                const f = ring[0];
                                const l = ring[ring.length - 1];
                                if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
                            }
                            shapeObj.coordinates = [ring];
                        }
                    }

                    function renderGeometryImportsUI() {
                        const listEl = document.getElementById('geeGeomLayersList');
                        if (!listEl) return;

                        listEl.innerHTML = '';
                        const masterChk = document.getElementById('chkGeomMaster');
                        let allChecked = geometryLayers.length > 0;

                        geometryLayers.forEach(l => {
                            if (!l.visible) allChecked = false;

                            const row = document.createElement('div');
                            row.className = 'gee-geom-layer-row' + (l.id === activeGeomLayerId ? ' active' : '');
                            row.title = 'Click to set ' + l.name + ' as active drawing layer';

                            const chk = document.createElement('input');
                            chk.type = 'checkbox';
                            chk.checked = l.visible;
                            chk.title = 'Toggle layer visibility';
                            chk.onchange = function(e) {
                                e.stopPropagation();
                                l.visible = chk.checked;
                                if (l.visible) {
                                    if (!map.hasLayer(l.featureGroup)) map.addLayer(l.featureGroup);
                                } else {
                                    if (map.hasLayer(l.featureGroup)) map.removeLayer(l.featureGroup);
                                }
                                renderGeometryImportsUI();
                            };

                            const nameSpan = document.createElement('span');
                            nameSpan.className = 'gee-geom-layer-name';
                            nameSpan.textContent = l.name;
                            if (l.shapes && l.shapes.length > 0) {
                                nameSpan.textContent += ' (' + l.shapes.length + ')';
                            }
                            nameSpan.onclick = function() {
                                setActiveGeomLayer(l.id);
                            };

                            const swatch = document.createElement('div');
                            swatch.className = 'gee-geom-layer-swatch';
                            swatch.style.background = l.color || '#d63000';
                            swatch.title = 'Configure ' + l.name + ' (' + l.color + ')';
                            swatch.onclick = function(e) {
                                e.stopPropagation();
                                openGeomConfigModal(l.id);
                            };

                            const gear = document.createElement('span');
                            gear.className = 'gee-geom-layer-gear';
                            gear.innerHTML = '⚙️';
                            gear.title = 'Configure geometry import';
                            gear.onclick = function(e) {
                                e.stopPropagation();
                                openGeomConfigModal(l.id);
                            };

                            row.appendChild(chk);
                            row.appendChild(nameSpan);
                            row.appendChild(swatch);
                            row.appendChild(gear);
                            listEl.appendChild(row);
                        });

                        if (masterChk) {
                            masterChk.checked = allChecked;
                        }
                    }

                    function toggleAllGeomLayers(checked) {
                        geometryLayers.forEach(l => {
                            l.visible = checked;
                            if (checked) {
                                if (!map.hasLayer(l.featureGroup)) map.addLayer(l.featureGroup);
                            } else {
                                if (map.hasLayer(l.featureGroup)) map.removeLayer(l.featureGroup);
                            }
                        });
                        renderGeometryImportsUI();
                    }

                    function toggleGeomDockCollapse() {
                        const dock = document.getElementById('geeGeometryDock');
                        const btn = document.getElementById('btnGeomCollapse');
                        if (dock) {
                            const isCollapsed = dock.classList.toggle('collapsed');
                            if (btn) btn.innerHTML = isCollapsed ? '▸' : '▾';
                        }
                    }

                    function createNewGeomLayer(customName) {
                        let newName = customName;
                        if (!newName) {
                            if (!geometryLayers.some(l => l.name === 'geometry')) {
                                newName = 'geometry';
                            } else {
                                let n = 2;
                                while (geometryLayers.some(l => l.name === 'geometry' + n)) {
                                    n++;
                                }
                                newName = 'geometry' + n;
                            }
                        }

                        const fg = new L.FeatureGroup();
                        map.addLayer(fg);

                        const newLayer = {
                            id: 'geom_layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                            name: newName,
                            type: 'Geometry',
                            color: getNextGeomColor(),
                            visible: true,
                            properties: {},
                            shapes: [],
                            featureGroup: fg
                        };

                        geometryLayers.push(newLayer);
                        setActiveGeomLayer(newLayer.id);
                        showHud('Created layer: ' + newLayer.name);
                        syncGeometriesToExtension();
                    }

                    function openGeomConfigModal(layerId) {
                        const layer = geometryLayers.find(l => l.id === layerId);
                        if (!layer) return;

                        modalEditingLayerId = layerId;

                        const modal = document.getElementById('geeGeomModal');
                        const backdrop = document.getElementById('geeGeomModalBackdrop');
                        const nameInput = document.getElementById('geomModalName');
                        const typeSelect = document.getElementById('geomModalType');
                        const swatch = document.getElementById('geomModalColorSwatch');
                        const hexInput = document.getElementById('geomModalColorHex');
                        const nativePicker = document.getElementById('geomModalNativePicker');
                        const presetsBox = document.getElementById('geomModalPresets');

                        if (nameInput) nameInput.value = layer.name;
                        if (typeSelect) typeSelect.value = layer.type || 'Geometry';
                        if (swatch) swatch.style.background = layer.color;
                        if (hexInput) hexInput.value = layer.color.toUpperCase();
                        if (nativePicker) nativePicker.value = layer.color;

                        renderGeomModalProperties(layer.properties || {});

                        if (presetsBox) {
                            presetsBox.innerHTML = '';
                            GEE_PRESET_COLORS.forEach(c => {
                                const dot = document.createElement('div');
                                dot.className = 'gee-geom-preset-dot';
                                dot.style.background = c;
                                dot.title = c;
                                dot.onclick = function() {
                                    hexInput.value = c.toUpperCase();
                                    swatch.style.background = c;
                                    nativePicker.value = c;
                                };
                                presetsBox.appendChild(dot);
                            });
                        }

                        if (modal) modal.style.display = 'flex';
                        if (backdrop) backdrop.style.display = 'block';
                    }

                    function closeGeomConfigModal() {
                        const modal = document.getElementById('geeGeomModal');
                        const backdrop = document.getElementById('geeGeomModalBackdrop');
                        if (modal) modal.style.display = 'none';
                        if (backdrop) backdrop.style.display = 'none';
                        modalEditingLayerId = null;
                    }

                    function onGeomModalHexInput(val) {
                        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                            const s = document.getElementById('geomModalColorSwatch');
                            const p = document.getElementById('geomModalNativePicker');
                            if (s) s.style.background = val;
                            if (p) p.value = val;
                        }
                    }

                    function onGeomModalNativePicker(val) {
                        const s = document.getElementById('geomModalColorSwatch');
                        const h = document.getElementById('geomModalColorHex');
                        if (s) s.style.background = val;
                        if (h) h.value = val.toUpperCase();
                    }

                    function renderGeomModalProperties(props) {
                        const box = document.getElementById('geomModalPropertiesBox');
                        if (!box) return;

                        box.innerHTML = '';
                        const keys = Object.keys(props);
                        if (keys.length === 0) {
                            box.innerHTML = '<span style="font-style: italic; color: #888;">No properties.</span>';
                            return;
                        }

                        keys.forEach(k => {
                            const row = document.createElement('div');
                            row.className = 'gee-geom-prop-row';

                            const kInput = document.createElement('input');
                            kInput.type = 'text';
                            kInput.className = 'gee-geom-prop-input prop-key';
                            kInput.value = k;
                            kInput.placeholder = 'key';

                            const vInput = document.createElement('input');
                            vInput.type = 'text';
                            vInput.className = 'gee-geom-prop-input prop-val';
                            vInput.value = props[k];
                            vInput.placeholder = 'value';

                            const del = document.createElement('button');
                            del.className = 'gee-geom-prop-del';
                            del.innerHTML = '✕';
                            del.title = 'Remove property';
                            del.onclick = function() {
                                row.remove();
                                if (box.children.length === 0) {
                                    box.innerHTML = '<span style="font-style: italic; color: #888;">No properties.</span>';
                                }
                            };

                            row.appendChild(kInput);
                            row.appendChild(vInput);
                            row.appendChild(del);
                            box.appendChild(row);
                        });
                    }

                    function addGeomModalProperty() {
                        const box = document.getElementById('geomModalPropertiesBox');
                        if (!box) return;
                        if (box.querySelector('span')) {
                            box.innerHTML = '';
                        }

                        const row = document.createElement('div');
                        row.className = 'gee-geom-prop-row';

                        const kInput = document.createElement('input');
                        kInput.type = 'text';
                        kInput.className = 'gee-geom-prop-input prop-key';
                        kInput.placeholder = 'property';

                        const vInput = document.createElement('input');
                        vInput.type = 'text';
                        vInput.className = 'gee-geom-prop-input prop-val';
                        vInput.placeholder = 'value';

                        const del = document.createElement('button');
                        del.className = 'gee-geom-prop-del';
                        del.innerHTML = '✕';
                        del.title = 'Remove property';
                        del.onclick = function() {
                            row.remove();
                            if (box.children.length === 0) {
                                box.innerHTML = '<span style="font-style: italic; color: #888;">No properties.</span>';
                            }
                        };

                        row.appendChild(kInput);
                        row.appendChild(vInput);
                        row.appendChild(del);
                        box.appendChild(row);
                        kInput.focus();
                    }

                    function saveGeomConfigModal() {
                        const layer = geometryLayers.find(l => l.id === modalEditingLayerId);
                        if (!layer) {
                            closeGeomConfigModal();
                            return;
                        }

                        const nameInput = document.getElementById('geomModalName');
                        const typeSelect = document.getElementById('geomModalType');
                        const hexInput = document.getElementById('geomModalColorHex');

                        let newName = (nameInput?.value || '').trim();
                        if (!newName) newName = layer.name;
                        newName = newName.replace(/[^a-zA-Z0-9_]/g, '_');
                        if (/^[0-9]/.test(newName)) newName = '_' + newName;

                        const newType = typeSelect?.value || 'Geometry';
                        let newColor = (hexInput?.value || '').trim();
                        if (!/^#[0-9A-Fa-f]{6}$/.test(newColor)) newColor = layer.color;

                        const newProps = {};
                        const propRows = document.querySelectorAll('#geomModalPropertiesBox .gee-geom-prop-row');
                        propRows.forEach(r => {
                            const k = (r.querySelector('.prop-key')?.value || '').trim();
                            let v = (r.querySelector('.prop-val')?.value || '').trim();
                            if (k) {
                                if (!isNaN(v) && v !== '') v = Number(v);
                                newProps[k] = v;
                            }
                        });

                        layer.name = newName;
                        layer.type = newType;
                        layer.color = newColor;
                        layer.properties = newProps;

                        layer.shapes.forEach(s => {
                            if (s.layerInstance) {
                                if (s.layerInstance instanceof L.Marker) {
                                    s.layerInstance.setIcon(createPinIcon(newColor));
                                } else if (s.layerInstance.setStyle) {
                                    s.layerInstance.setStyle({ color: newColor, fillColor: newColor });
                                }
                            }
                        });

                        closeGeomConfigModal();
                        renderGeometryImportsUI();
                        syncGeometriesToExtension();
                        showHud('Updated ' + layer.name);
                    }

                    function confirmDeleteGeomLayer() {
                        const layer = geometryLayers.find(l => l.id === modalEditingLayerId);
                        if (!layer) return;

                        const layerName = layer.name;
                        if (map.hasLayer(layer.featureGroup)) {
                            map.removeLayer(layer.featureGroup);
                        }
                        geometryLayers = geometryLayers.filter(l => l.id !== layer.id);

                        if (geometryLayers.length === 0) {
                            createNewGeomLayer('geometry');
                        } else {
                            setActiveGeomLayer(geometryLayers[0].id);
                        }

                        closeGeomConfigModal();
                        renderGeometryImportsUI();
                        syncGeometriesToExtension();
                        showHud('🗑️ Capa "' + layerName + '" eliminada');
                    }

                    function shapeToJsConstructor(shape) {
                        if (shape.type === 'Point') {
                            return 'ee.Geometry.Point([' + shape.coordinates[0] + ', ' + shape.coordinates[1] + '])';
                        } else if (shape.type === 'LineString') {
                            return 'ee.Geometry.LineString(' + JSON.stringify(shape.coordinates) + ')';
                        } else if (shape.type === 'Polygon') {
                            return 'ee.Geometry.Polygon(' + JSON.stringify(shape.coordinates) + ')';
                        } else if (shape.type === 'Rectangle') {
                            return 'ee.Geometry.Rectangle([' + shape.coordinates[0] + ', ' + shape.coordinates[1] + ', ' + shape.coordinates[2] + ', ' + shape.coordinates[3] + '])';
                        }
                        return 'ee.Geometry()';
                    }

                    function generateGeeLayerCode(layer) {
                        if (!layer || !layer.shapes || layer.shapes.length === 0) return '';
                        const name = layer.name || 'geometry';
                        const color = layer.color || '#d63000';
                        const type = layer.type || 'Geometry';
                        const props = layer.properties || {};

                        let geomConstructor = '';
                        if (layer.shapes.length === 1) {
                            geomConstructor = shapeToJsConstructor(layer.shapes[0]);
                        } else {
                            const allPolys = layer.shapes.every(s => s.type === 'Polygon' || s.type === 'Rectangle');
                            const allPts = layer.shapes.every(s => s.type === 'Point');
                            const allLines = layer.shapes.every(s => s.type === 'LineString');

                            if (allPolys) {
                                const rings = layer.shapes.map(s => s.type === 'Rectangle' ? [
                                    [s.coordinates[0], s.coordinates[1]],
                                    [s.coordinates[0], s.coordinates[3]],
                                    [s.coordinates[2], s.coordinates[3]],
                                    [s.coordinates[2], s.coordinates[1]],
                                    [s.coordinates[0], s.coordinates[1]]
                                ] : s.coordinates[0]);
                                geomConstructor = 'ee.Geometry.MultiPolygon(' + JSON.stringify(rings) + ')';
                            } else if (allPts) {
                                const pts = layer.shapes.map(s => s.coordinates);
                                geomConstructor = 'ee.Geometry.MultiPoint(' + JSON.stringify(pts) + ')';
                            } else if (allLines) {
                                const lines = layer.shapes.map(s => s.coordinates);
                                geomConstructor = 'ee.Geometry.MultiLineString(' + JSON.stringify(lines) + ')';
                            } else {
                                const collection = layer.shapes.map(s => shapeToJsConstructor(s));
                                geomConstructor = 'ee.Geometry.GeometryCollection([' + collection.join(', ') + '])';
                            }
                        }

                        if (type === 'Geometry') {
                            return 'var ' + name + ' = /* color: ' + color + ' */ ' + geomConstructor + ';';
                        } else if (type === 'Feature') {
                            const propsStr = Object.keys(props).length > 0 ? JSON.stringify(props, null, 2) : '{}';
                            return 'var ' + name + ' = /* color: ' + color + ' */ ee.Feature(\\n    ' + geomConstructor + ',\\n    ' + propsStr + ');';
                        } else if (type === 'FeatureCollection') {
                            const propsStr = Object.keys(props).length > 0 ? JSON.stringify(props) : '{}';
                            const features = layer.shapes.map(s => {
                                const sc = shapeToJsConstructor(s);
                                return '    ee.Feature(' + sc + ', ' + propsStr + ')';
                            }).join(',\\n');
                            return 'var ' + name + ' = /* color: ' + color + ' */ ee.FeatureCollection([\\n' + features + '\\n]);';
                        }
                        return '';
                    }

                    function getGeometryLayersSummary() {
                        return geometryLayers.map(l => ({
                            id: l.id,
                            name: l.name,
                            type: l.type,
                            color: l.color,
                            visible: l.visible,
                            properties: l.properties,
                            shapes: l.shapes.map(s => ({
                                id: s.id,
                                type: s.type,
                                coordinates: s.coordinates
                            }))
                        }));
                    }

                    function syncGeometriesToExtension() {
                        const summary = getGeometryLayersSummary();
                        try {
                            localStorage.setItem('gee_geom_imports_backup', JSON.stringify(summary));
                        } catch (e) {}
                        vscode.postMessage({
                            command: 'syncGeometryImports',
                            layers: summary
                        });
                    }

                    function exportGeometriesToGeoJSON() {
                        const features = [];
                        geometryLayers.forEach(layer => {
                            if (!layer.shapes || layer.shapes.length === 0) return;
                            layer.shapes.forEach(shape => {
                                let geom = null;
                                if (shape.type === 'Point' && shape.coordinates) {
                                    geom = { type: 'Point', coordinates: shape.coordinates };
                                } else if (shape.type === 'LineString' && shape.coordinates) {
                                    geom = { type: 'LineString', coordinates: shape.coordinates };
                                } else if (shape.type === 'Rectangle' && shape.coordinates && shape.coordinates.length === 4) {
                                    const [w, s, e, n] = shape.coordinates;
                                    geom = {
                                        type: 'Polygon',
                                        coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]
                                    };
                                } else if (shape.type === 'Polygon' && shape.coordinates) {
                                    geom = { type: 'Polygon', coordinates: shape.coordinates };
                                }

                                if (geom) {
                                    features.push({
                                        type: 'Feature',
                                        properties: {
                                            id: shape.id,
                                            layer: layer.name,
                                            layerType: layer.type,
                                            color: layer.color,
                                            ...(layer.properties || {})
                                        },
                                        geometry: geom
                                    });
                                }
                            });
                        });

                        if (features.length === 0) {
                            showHud('⚠️ Dibuja al menos una geometría para exportar');
                            return;
                        }

                        const geojson = {
                            type: 'FeatureCollection',
                            features: features
                        };

                        vscode.postMessage({
                            command: 'saveMeasureGeoJSON',
                            geojson: JSON.stringify(geojson, null, 2),
                            filename: 'gee_geometries.geojson'
                        });
                        showHud('💾 Exportando GeoJSON...');
                    }

                    function restoreSavedGeomState(savedLayers) {
                        if (!savedLayers) {
                            try {
                                const raw = localStorage.getItem('gee_geom_imports_backup');
                                if (raw) savedLayers = JSON.parse(raw);
                            } catch (e) {}
                        }
                        if (!Array.isArray(savedLayers) || savedLayers.length === 0) return;

                        // Clear existing geometry feature groups from map
                        geometryLayers.forEach(l => {
                            if (l.featureGroup && map.hasLayer(l.featureGroup)) {
                                map.removeLayer(l.featureGroup);
                            }
                        });

                        const newLayers = [];
                        savedLayers.forEach(l => {
                            const fg = new L.FeatureGroup();
                            const geomLayer = {
                                id: l.id || ('geom_layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
                                name: l.name || 'geometry',
                                type: l.type || 'Geometry',
                                color: l.color || '#d63000',
                                visible: l.visible !== false,
                                properties: l.properties || {},
                                shapes: [],
                                featureGroup: fg
                            };

                            if (Array.isArray(l.shapes)) {
                                l.shapes.forEach(s => {
                                    try {
                                        let leafLayer = null;
                                        const coords = s.coordinates;
                                        if (s.type === 'Point' && coords && coords.length >= 2) {
                                            leafLayer = L.marker([coords[1], coords[0]], { icon: createPinIcon(geomLayer.color) });
                                        } else if (s.type === 'LineString' && Array.isArray(coords)) {
                                            leafLayer = L.polyline(coords.map(c => [c[1], c[0]]), { color: geomLayer.color, weight: 3 });
                                        } else if (s.type === 'Rectangle' && Array.isArray(coords) && coords.length === 4) {
                                            leafLayer = L.rectangle([[coords[1], coords[0]], [coords[3], coords[2]]], {
                                                color: geomLayer.color,
                                                fillColor: geomLayer.color,
                                                fillOpacity: 0.25,
                                                weight: 2.5
                                            });
                                        } else if (s.type === 'Polygon' && Array.isArray(coords)) {
                                            const ring = Array.isArray(coords[0]) ? coords[0] : coords;
                                            leafLayer = L.polygon(ring.map(c => [c[1], c[0]]), {
                                                color: geomLayer.color,
                                                fillColor: geomLayer.color,
                                                fillOpacity: 0.25,
                                                weight: 2.5
                                            });
                                        }

                                        if (leafLayer) {
                                            leafLayer._customColor = geomLayer.color;
                                            leafLayer._layerId = geomLayer.id;
                                            leafLayer._shapeId = s.id;
                                            fg.addLayer(leafLayer);

                                            const shapeObj = {
                                                id: s.id,
                                                type: s.type,
                                                coordinates: s.coordinates,
                                                layerInstance: leafLayer
                                            };
                                            geomLayer.shapes.push(shapeObj);
                                            attachGeometryPopup(leafLayer, geomLayer, shapeObj);
                                        }
                                    } catch (shapeErr) {
                                        console.warn('Error restoring shape:', shapeErr);
                                    }
                                });
                            }

                            if (geomLayer.visible) {
                                map.addLayer(fg);
                            }
                            newLayers.push(geomLayer);
                        });

                        if (newLayers.length > 0) {
                            geometryLayers = newLayers;
                            activeGeomLayerId = newLayers[0].id;
                            renderGeometryImportsUI();
                        }
                    }

                    function insertGeometryCodeToEditor() {
                        const codes = geometryLayers
                            .map(l => generateGeeLayerCode(l))
                            .filter(c => c.length > 0)
                            .join('\\n\\n');

                        if (!codes) {
                            showHud('⚠️ Draw at least one shape first');
                            return;
                        }

                        vscode.postMessage({
                            command: 'insertGeometryCode',
                            code: codes,
                            layers: getGeometryLayersSummary()
                        });
                    }

                    function copyGeometryCode() {
                        const codes = geometryLayers
                            .map(l => generateGeeLayerCode(l))
                            .filter(c => c.length > 0)
                            .join('\\n\\n');

                        if (!codes) {
                            showHud('⚠️ Draw at least one shape first');
                            return;
                        }

                        vscode.postMessage({
                            command: 'copyToClipboard',
                            text: codes
                        });
                        showHud('📋 Code copied to clipboard');
                    }

                    // Attach Geometry functions to window for onclick handlers
                    window.setGeomDrawMode = setGeomDrawMode;
                    window.exitGeomDrawMode = exitGeomDrawMode;
                    window.toggleGeomLock = toggleGeomLock;
                    window.toggleAllGeomLayers = toggleAllGeomLayers;
                    window.toggleGeomDockCollapse = toggleGeomDockCollapse;
                    window.toggleGeomDockVisibility = toggleGeomDockVisibility;
                    window.createNewGeomLayer = createNewGeomLayer;
                    window.openGeomConfigModal = openGeomConfigModal;
                    window.closeGeomConfigModal = closeGeomConfigModal;
                    window.saveGeomConfigModal = saveGeomConfigModal;
                    window.confirmDeleteGeomLayer = confirmDeleteGeomLayer;
                    window.insertGeometryCodeToEditor = insertGeometryCodeToEditor;
                    window.copyGeometryCode = copyGeometryCode;
                    window.exportGeometriesToGeoJSON = exportGeometriesToGeoJSON;
                    window.restoreSavedGeomState = restoreSavedGeomState;
                    window.addGeomModalProperty = addGeomModalProperty;
                    window.onGeomModalHexInput = onGeomModalHexInput;
                    window.onGeomModalNativePicker = onGeomModalNativePicker;

                    // Initial render and restoration of Geometry Imports
                    try {
                        renderGeometryImportsUI();
                        restoreSavedGeomState();
                    } catch (e) {
                        console.error('Geometry Imports UI render/restore error:', e);
                    }

                    const coordsDiv = document.getElementById('coords');

                    map.on('mousemove', (e) => {
                        coordsDiv.innerHTML = 'Lat: ' + e.latlng.lat.toFixed(4) + ', Lng: ' + e.latlng.lng.toFixed(4);
                    });

                    // Pixel Inspector & Keyboard Shortcuts (Quadrant 3 - Map)
                    function handleMapKeydown(e) {
                        const tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
                        const isEditingText = tag === 'input' || tag === 'textarea';

                        if (e.key === 'Escape') {
                            map.closePopup();
                            if (typeof closeGeomConfigModal === 'function') closeGeomConfigModal();
                            if (activeDrawMode !== 'pan') {
                                exitGeomDrawMode();
                                showHud('🖐️ Modo Navegación (Manito)');
                            }
                            if (typeof window.toggleRulerMode === 'function' && typeof rulerMode !== 'undefined' && rulerMode) {
                                window.toggleRulerMode(false);
                            }
                            const snapModal = document.getElementById('snapshotModal');
                            if (snapModal && snapModal.style.display !== 'none') {
                                snapModal.style.display = 'none';
                            }
                            const resetModal = document.getElementById('resetConfirmModal');
                            if (resetModal && resetModal.style.display !== 'none') {
                                resetModal.style.display = 'none';
                            }
                            if (typeof swipeMode !== 'undefined' && swipeMode && typeof toggleSwipeMode === 'function') {
                                toggleSwipeMode(false);
                            }
                            if (typeof clearAllGridSelections === 'function') {
                                clearAllGridSelections(true);
                            }
                            return;
                        }

                        if (isEditingText) return;

                        // 1. Quadrant Navigation (Cmd + 1, 2, 3, 4 on Mac)
                        // Must NEVER trigger geometry tools; delegating to VS Code
                        if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                            const qKey = (e.key === '1' || e.code === 'Digit1' || e.code === 'Numpad1') ? 1 :
                                         (e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2') ? 2 :
                                         (e.key === '3' || e.code === 'Digit3' || e.code === 'Numpad3') ? 3 :
                                         (e.key === '4' || e.code === 'Digit4' || e.code === 'Numpad4') ? 4 : 0;
                            if (qKey > 0) {
                                if (vscode && vscode.postMessage) {
                                    vscode.postMessage({ command: 'focusQuadrant', quadrant: qKey });
                                }
                                return;
                            }
                        }

                        if (e.altKey || e.metaKey || e.ctrlKey) {
                            const mapEl = document.getElementById('map');
                            if (mapEl) mapEl.classList.add('crosshair-mode');
                        }

                        // 2. Geometry Drawing Shortcuts: Control or Option/Alt key (Ctrl + 1..4 / Alt + 1..4)
                        // Rejects Command (metaKey) to prevent quadrant/system collision
                        if ((e.ctrlKey || e.altKey) && !e.metaKey && !e.shiftKey) {
                            const is1 = e.key === '1' || e.code === 'Digit1' || e.code === 'Numpad1';
                            const is2 = e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2';
                            const is3 = e.key === '3' || e.code === 'Digit3' || e.code === 'Numpad3';
                            const is4 = e.key === '4' || e.code === 'Digit4' || e.code === 'Numpad4';
                            const is0 = e.key === '0' || e.code === 'Digit0' || e.key === 'h' || e.key === 'H';

                            if (is1) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                setGeomDrawMode('marker');
                                showHud('📍 Marcador / Punto activado (Ctrl+1 / Option+1)');
                                return;
                            } else if (is2) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                setGeomDrawMode('polyline');
                                showHud('📈 Línea activada (Ctrl+2 / Option+2)');
                                return;
                            } else if (is3) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                setGeomDrawMode('polygon');
                                showHud('⬡ Polígono activado (Ctrl+3 / Option+3)');
                                return;
                            } else if (is4) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                setGeomDrawMode('rectangle');
                                showHud('▢ Rectángulo activado (Ctrl+4 / Option+4)');
                                return;
                            } else if (is0) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                setGeomDrawMode('pan');
                                showHud('🖐️ Modo Navegación / Manito (Esc)');
                                return;
                            }
                        }
                    }

                    window.addEventListener('keydown', handleMapKeydown, true);
                    document.addEventListener('keydown', handleMapKeydown, true);
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
                    let swipeMode = false;
                    let swipeSubMode = 'split'; // 'split' | 'spyglass' | 'quad'
                    let swipeOrientation = 'vertical';
                    let swipeValue = 50;
                    let draggingSwipe = false;
                    let topSwipeLayer = null;
                    let swipeCompareIndices = null; // { left: number, right: number }
                    let currentPeekIdx = -1;
                    // Swipe Pro Spyglass state
                    let spyX = window.innerWidth / 2;
                    let spyY = window.innerHeight / 2;
                    let spyRadius = 140;
                    let spyLatLng = null;
                    let isShiftSpyActive = false;
                    let isSpyMouseDown = false;
                    let draggingSpy = false;
                    let resizingSpy = false;
                    // Swipe Pro Quad state
                    let quadX = window.innerWidth / 2;
                    let quadY = window.innerHeight / 2;
                    let quadLatLng = null;
                    let draggingQuad = false;
                    let isQuadTempActive = false;

                    function reorderLayersHierarchically() {
                        // geeLayers[0] is top layer in panel -> should be at the very front of the Leaflet map
                        // We bring layers to front in reverse order (from bottom to top) so index 0 ends up on top.
                        for (let i = geeLayers.length - 1; i >= 0; i--) {
                            const item = geeLayers[i];
                            if (item && item.layer && map.hasLayer(item.layer)) {
                                if (item.layer.bringToFront) item.layer.bringToFront();
                            }
                        }
                    }

                    function updateSwipeCompareIndices() {
                        const visible = [];
                        geeLayers.forEach((l, idx) => {
                            if (l.shown && map.hasLayer(l.layer)) {
                                visible.push(idx);
                            }
                        });
                        if (visible.length >= 2) {
                            swipeCompareIndices = { left: visible[0], right: visible[1] };
                            topSwipeLayer = geeLayers[visible[0]].layer;
                        } else {
                            swipeCompareIndices = null;
                            topSwipeLayer = null;
                        }
                    }

                    function startPeek(idx) {
                        if (idx < 0 || idx >= geeLayers.length) return;
                        if (currentPeekIdx === idx) return;
                        endPeek();

                        currentPeekIdx = idx;
                        const item = geeLayers[idx];
                        if (!item) return;

                        if (!map.hasLayer(item.layer)) {
                            item.layer.addTo(map);
                            item._peekTemp = true;
                        }
                        if (item.layer.bringToFront) {
                            item.layer.bringToFront();
                        }
                        updateLayerManagerUI();
                        showHud('🔍 Peek: [' + (idx + 1) + '] ' + item.name + ' (suelta Shift para restaurar)');
                    }

                    function endPeek() {
                        if (currentPeekIdx === -1) return;
                        const idx = currentPeekIdx;
                        currentPeekIdx = -1;
                        const item = geeLayers[idx];
                        if (item && item._peekTemp) {
                            if (map.hasLayer(item.layer)) {
                                map.removeLayer(item.layer);
                            }
                            delete item._peekTemp;
                        }
                        reorderLayersHierarchically();
                        if (typeof swipeMode !== 'undefined' && swipeMode) {
                            updateSwipeCompareIndices();
                            if (topSwipeLayer && topSwipeLayer.bringToFront) {
                                topSwipeLayer.bringToFront();
                            }
                            if (typeof updateSwipeClip === 'function') updateSwipeClip();
                        }
                        updateLayerManagerUI();
                    }

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
                                        '<button class="gee-btn-icon" id="gridHeaderBtn" onclick="toggleGridMenu()" title="Grillas Satelitales (Landsat WRS-2, MODIS Sinusoidal, Sentinel-2 MGRS)">🌐 Grid</button>' +
                                        '<button class="gee-btn-icon" id="snapHeaderBtn" title="HD Map Snapshot & Lámina Pro [Option+S]"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg><span>Snap</span></button>' +
                                        '<button class="gee-btn-icon" id="toggleAllBtn" title="Toggle All Layers (Shortcut: 0)">[0] All</button>' +
                                        '<button class="gee-btn-icon ' + (isPinned ? 'active' : '') + '" id="pinBtn" title="' + (isPinned ? 'Unpin panel' : 'Pin panel (📌)') + '">📌</button>' +
                                    '</div>' +
                                '</div>' +
                                '<div id="gridMenuPanel" class="gee-grid-menu" style="display: none;">' +
                                    '<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 2px;">' +
                                        '<span style="font-weight: 700; color: #4ec9b0; font-size: 11.5px; display: flex; align-items: center; gap: 5px;">🌐 Grillas Satelitales Pro</span>' +
                                        '<button onclick="toggleGridMenu(false)" style="background: transparent; border: none; color: #888; cursor: pointer; font-size: 12px; padding: 0 4px;">✕</button>' +
                                    '</div>' +
                                    '<div style="display: flex; flex-direction: column; gap: 6px;">' +
                                        '<label class="gee-grid-opt"><input type="checkbox" id="chkGridLandsat" onchange="toggleLandsatGrid(this.checked)" style="accent-color: #4ec9b0; cursor: pointer;" /> <span>🛰️ <strong>Landsat WRS-2</strong> (Path/Row)</span></label>' +
                                        '<label class="gee-grid-opt"><input type="checkbox" id="chkGridModis" onchange="toggleModisGrid(this.checked)" style="accent-color: #f59e0b; cursor: pointer;" /> <span>🌍 <strong>MODIS Sinusoidal</strong> (h/v)</span></label>' +
                                        '<label class="gee-grid-opt"><input type="checkbox" id="chkGridMgrs" onchange="toggleMgrsGrid(this.checked)" style="accent-color: #38bdf8; cursor: pointer;" /> <span>🌐 <strong>Sentinel-2 / MGRS</strong> (Zonas UTM)</span></label>' +
                                    '</div>' +
                                    '<div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 5px; font-size: 9.5px; color: #94a3b8; line-height: 1.3;">' +
                                        'Haz clic en una celda para ver metadatos y copiar o insertar el filtro en el editor.' +
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
                        
                        let bcBadgeHtml = '';
                        if (typeof swipeMode !== 'undefined' && swipeMode && swipeCompareIndices) {
                            const isHoriz = (swipeOrientation === 'horizontal');
                            const labelL = isHoriz ? 'T' : 'L';
                            const labelR = isHoriz ? 'B' : 'R';
                            const titleL = isHoriz ? 'Barra Comparadora: Arriba (Top)' : 'Barra Comparadora: Lado Izquierdo (Left)';
                            const titleR = isHoriz ? 'Barra Comparadora: Abajo (Bottom)' : 'Barra Comparadora: Lado Derecho (Right)';
                            if (x.idx === swipeCompareIndices.left) {
                                bcBadgeHtml = '<span class="gee-bc-badge gee-bc-badge-l" title="' + titleL + '">' + labelL + '</span>';
                            } else if (x.idx === swipeCompareIndices.right) {
                                bcBadgeHtml = '<span class="gee-bc-badge gee-bc-badge-r" title="' + titleR + '">' + labelR + '</span>';
                            }
                        }
                        const isPeeking = (currentPeekIdx === x.idx);
                        const peekClass = isPeeking ? ' peek-active' : '';
                        const peekPrefix = isPeeking ? '🟢 ' : '';
                        const badge = x.keyShortcut ? ('<span id="badge_layer_' + x.idx + '" class="gee-layer-badge' + peekClass + '" title="Shortcut: ' + x.keyShortcut + ' (Shift+' + x.keyShortcut + ' para Peek)">' + peekPrefix + '[' + x.keyShortcut + ']</span>' + bcBadgeHtml) : bcBadgeHtml;
                        
                        let legendHtml = '';
                        const vp = x.item.visParams;
                        const lname = (x.item.name || '').toLowerCase();
                        if (vp) {
                            const bandsList = Array.isArray(vp.bands) ? vp.bands : (typeof vp.bands === 'string' ? vp.bands.split(',').map(s => s.trim()) : null);
                            const isRgb = (bandsList && bandsList.length >= 3) || lname.includes('rgb') || lname.includes('color') || lname.includes('compósito') || lname.includes('composite');

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
                            } else if (bandsList && bandsList.length >= 3) {
                                const minVal = vp.min !== undefined ? vp.min : '';
                                const maxVal = vp.max !== undefined ? vp.max : '';
                                legendHtml = 
                                    '<div class="gee-layer-legend" style="margin-top: 4px; padding-left: 20px; display: flex; align-items: center; justify-content: space-between; font-size: 8.5px; color: #aaa; font-family: monospace;">' +
                                        '<span style="display: flex; align-items: center; gap: 6px;">' +
                                            '<span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color:#ff5555;">●</span>R:' + bandsList[0] + '</span>' +
                                            '<span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color:#55ff55;">●</span>G:' + bandsList[1] + '</span>' +
                                            '<span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color:#5588ff;">●</span>B:' + bandsList[2] + '</span>' +
                                        '</span>' +
                                        (minVal !== '' ? ('<span style="color: #777;">[' + minVal + ' - ' + maxVal + ']</span>') : '') +
                                    '</div>';
                            } else if (isRgb) {
                                const minVal = vp.min !== undefined ? vp.min : '';
                                const maxVal = vp.max !== undefined ? vp.max : '';
                                legendHtml = 
                                    '<div class="gee-layer-legend" style="margin-top: 4px; padding-left: 20px; display: flex; align-items: center; justify-content: space-between; font-size: 8.5px; color: #aaa; font-family: monospace;">' +
                                        '<span style="display: flex; align-items: center; gap: 6px;">' +
                                            '<span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color:#ff5555;">●</span>R</span>' +
                                            '<span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color:#55ff55;">●</span>G</span>' +
                                            '<span style="display: inline-flex; align-items: center; gap: 2px;"><span style="color:#5588ff;">●</span>B</span>' +
                                        '</span>' +
                                        (minVal !== '' ? ('<span style="color: #777;">[' + minVal + ' - ' + maxVal + ']</span>') : '') +
                                    '</div>';
                            } else if (vp.min !== undefined && vp.max !== undefined) {
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
                            }
                        }
                        
                        return '<div class="gee-layer-item" style="flex-direction: column; align-items: stretch;">' +
                            '<div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">' +
                                '<div class="gee-layer-left">' +
                                    '<input type="checkbox" id="chk_layer_' + x.idx + '" ' + (isVisible ? 'checked' : '') + ' />' +
                                    badge +
                                    '<span class="gee-layer-name" title="' + x.item.name + '">' + x.subName + '</span>' +
                                '</div>' +
                                '<div style="display: flex; align-items: center; gap: 4px;">' +
                                    '<button class="gee-btn-icon" style="padding: 1px 4px; font-size: 10px;" onclick="openLayerTableByIndex(' + x.idx + ')" title="Abrir Tabla de Atributos en Cuadrante 4">📋</button>' +
                                    '<input type="range" class="gee-layer-opacity" id="op_layer_' + x.idx + '" min="0" max="1" step="0.05" value="' + (x.item.opacity !== undefined ? x.item.opacity : 1) + '" title="Opacity" />' +
                                '</div>' +
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
                            item.shown = true;
                            showHud('👁️ [' + (idx + 1) + '] ' + item.name + ': Visible');
                        } else {
                            if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
                            item.shown = false;
                            showHud('🚫 [' + (idx + 1) + '] ' + item.name + ': Hidden');
                        }
                        reorderLayersHierarchically();
                        if (typeof swipeMode !== 'undefined' && swipeMode) {
                            updateSwipeCompareIndices();
                            if (topSwipeLayer && topSwipeLayer.bringToFront) {
                                topSwipeLayer.bringToFront();
                            }
                            if (typeof updateSwipeClip === 'function') updateSwipeClip();
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
                            } else {
                                if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
                            }
                        });
                        reorderLayersHierarchically();
                        if (typeof swipeMode !== 'undefined' && swipeMode) {
                            updateSwipeCompareIndices();
                            if (topSwipeLayer && topSwipeLayer.bringToFront) {
                                topSwipeLayer.bringToFront();
                            }
                            if (typeof updateSwipeClip === 'function') updateSwipeClip();
                        }
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
                                reorderLayersHierarchically();
                                if (typeof swipeMode !== 'undefined' && swipeMode) {
                                    updateSwipeCompareIndices();
                                    if (topSwipeLayer && topSwipeLayer.bringToFront) {
                                        topSwipeLayer.bringToFront();
                                    }
                                    if (typeof updateSwipeClip === 'function') updateSwipeClip();
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
                            case 'elevationProfileData':
                                if (typeof window.renderRulerElevationProfile === 'function') {
                                    window.renderRulerElevationProfile(message.points || [], message.error);
                                }
                                break;
                            case 'highlightFeature': {
                                if (!message.geometry) break;
                                if (window.highlightLayerGroup) {
                                    map.removeLayer(window.highlightLayerGroup);
                                }
                                window.highlightLayerGroup = L.geoJSON(message.geometry, {
                                    style: {
                                        color: '#38bdf8',
                                        weight: 3.5,
                                        fillColor: '#00ffff',
                                        fillOpacity: 0.35,
                                        dashArray: '5, 5'
                                    },
                                    pointToLayer: (feature, latlng) => {
                                        return L.circleMarker(latlng, {
                                            radius: 8,
                                            color: '#ffffff',
                                            weight: 2,
                                            fillColor: '#38bdf8',
                                            fillOpacity: 0.9
                                        });
                                    }
                                }).addTo(map);
                                try {
                                    const b = window.highlightLayerGroup.getBounds();
                                    if (b.isValid()) {
                                        map.flyToBounds(b, { maxZoom: 16, padding: [40, 40], duration: 0.8 });
                                    }
                                } catch (e) {}
                                break;
                            }
                            case 'toggleSatelliteGrid': {
                                if (message.grid === 'landsat') toggleLandsatGrid(message.active);
                                else if (message.grid === 'modis') toggleModisGrid(message.active);
                                else if (message.grid === 'mgrs') toggleMgrsGrid(message.active);
                                break;
                            }
                            case 'restoreGeometries': {
                                if (message.layers && Array.isArray(message.layers) && message.layers.length > 0) {
                                    restoreSavedGeomState(message.layers);
                                }
                                break;
                            }
                            case 'setGeomDrawMode': {
                                if (message.mode) {
                                    setGeomDrawMode(message.mode);
                                    if (message.mode === 'marker') showHud('📍 Marcador / Punto activado (1)');
                                    else if (message.mode === 'polyline') showHud('📈 Línea activada (2)');
                                    else if (message.mode === 'polygon') showHud('⬡ Polígono activado (3)');
                                    else if (message.mode === 'rectangle') showHud('▢ Rectángulo activado (4)');
                                    else if (message.mode === 'pan') showHud('🖐️ Modo Navegación (Manito)');
                                }
                                break;
                            }
                        }
                    });

                    // --- SATELLITE GRIDS IMPLEMENTATION (Landsat WRS-2, MODIS Sinusoidal, Sentinel-2 MGRS) ---
                    let landsatGridGroup = L.featureGroup();
                    let modisGridGroup = L.featureGroup();
                    let mgrsGridGroup = L.featureGroup();
                    let isLandsatGridActive = false;
                    let isModisGridActive = false;
                    let isMgrsGridActive = false;

                    window.toggleGridMenu = function(force) {
                        const panel = document.getElementById('gridMenuPanel');
                        const btn = document.getElementById('gridHeaderBtn');
                        if (!panel) return;
                        const target = force !== undefined ? force : (panel.style.display === 'none');
                        panel.style.display = target ? 'flex' : 'none';
                        if (btn) {
                            if (target) btn.classList.add('active');
                            else if (!isLandsatGridActive && !isModisGridActive && !isMgrsGridActive) btn.classList.remove('active');
                        }
                    };

                    window.copyFilterCode = function(code) {
                        vscode.postMessage({ command: 'copyToClipboard', text: code });
                        showHud('📋 Filtro copiado al portapapeles');
                    };

                    window.insertFilterCode = function(code) {
                        vscode.postMessage({ command: 'insertCode', text: code, code: code });
                        showHud('✏️ Filtro insertado en el editor');
                    };

                    window.copyFilterSnippet = function(btn) {
                        if (btn) {
                            const snippet = btn.getAttribute('data-snippet') || '';
                            copyFilterCode(snippet);
                        }
                    };

                    window.insertFilterSnippet = function(btn) {
                        if (btn) {
                            const snippet = btn.getAttribute('data-snippet') || '';
                            insertFilterCode(snippet);
                        }
                    };

                    window.openLayerTable = function(layerName) {
                        vscode.postMessage({ command: 'openAttributeTable', layerName: layerName });
                        showHud('📋 Abriendo Tabla de Atributos: ' + layerName);
                    };

                    window.openLayerTableByIndex = function(idx) {
                        const item = geeLayers[idx];
                        if (item && item.name) {
                            openLayerTable(item.name);
                        }
                    };

                    // --- SATELLITE GRIDS MULTI-SELECTION STATE & HELPERS ---
                    const selectedGridCells = new Map();
                    const gridRegistry = new Map();

                    function getGridDefaultStyle(type) {
                        if (type === 'landsat') {
                            return { color: '#ef4444', weight: 1.4, dashArray: null, fillColor: '#ef4444', fillOpacity: 0.08 };
                        } else if (type === 'modis') {
                            return { color: '#f59e0b', weight: 1.2, dashArray: '3, 3', fillColor: '#f59e0b', fillOpacity: 0.04 };
                        } else {
                            return { color: '#38bdf8', weight: 1.2, dashArray: '3, 3', fillColor: '#38bdf8', fillOpacity: 0.04 };
                        }
                    }

                    function getGridSelectedStyle(type) {
                        const col = type === 'landsat' ? '#ef4444' : (type === 'modis' ? '#f59e0b' : '#38bdf8');
                        return {
                            color: col,
                            weight: 2.8,
                            dashArray: null,
                            fillColor: col,
                            fillOpacity: 0.38
                        };
                    }

                    let lastClickedGridCell = null;

                    function toggleGridCellSelection(cellData, poly) {
                        if (selectedGridCells.has(cellData.id)) {
                            selectedGridCells.delete(cellData.id);
                            if (poly) poly.setStyle(getGridDefaultStyle(cellData.type));
                        } else {
                            selectedGridCells.set(cellData.id, cellData);
                            if (poly) poly.setStyle(getGridSelectedStyle(cellData.type));
                        }
                    }

                    function selectSingleGridCell(cellData, poly) {
                        selectedGridCells.forEach(c => {
                            if (c.poly && c.id !== cellData.id) c.poly.setStyle(getGridDefaultStyle(c.type));
                        });
                        selectedGridCells.clear();
                        selectedGridCells.set(cellData.id, cellData);
                        if (poly) poly.setStyle(getGridSelectedStyle(cellData.type));
                    }

                    function clearAllGridSelections(reRender) {
                        selectedGridCells.forEach(c => {
                            if (c.poly) c.poly.setStyle(getGridDefaultStyle(c.type));
                        });
                        selectedGridCells.clear();
                        if (reRender) {
                            if (isLandsatGridActive) renderLandsatGrid();
                            if (isModisGridActive) renderModisGrid();
                            if (isMgrsGridActive) renderMgrsGrid();
                        }
                    }

                    function getGridCodeToUse() {
                        if (selectedGridCells.size > 1) {
                            return generateCompositeGridFilter();
                        }
                        if (selectedGridCells.size === 1) {
                            const single = Array.from(selectedGridCells.values())[0];
                            return single.snippet || '';
                        }
                        if (lastClickedGridCell) {
                            return lastClickedGridCell.snippet || '';
                        }
                        return '';
                    }

                    window.copyGridActiveFilter = function() {
                        const code = getGridCodeToUse();
                        if (!code) return;
                        copyFilterCode(code);
                        const count = selectedGridCells.size > 1 ? selectedGridCells.size + ' celdas' : '1 celda';
                        showHud('📋 Filtro (' + count + ') copiado');
                    };

                    window.insertGridActiveFilter = function() {
                        const code = getGridCodeToUse();
                        if (!code) return;
                        insertFilterCode(code);
                        const count = selectedGridCells.size > 1 ? selectedGridCells.size + ' celdas' : '1 celda';
                        showHud('✏️ Filtro (' + count + ') insertado en el editor');
                    };

                    function getGridPopupHtml(cellData) {
                        const count = selectedGridCells.size;
                        const isMulti = count > 1;
                        const badgeText = isMulti ? ('⚡ ' + count + ' celdas') : (cellData.shortLabel || cellData.label);
                        const accentColor = cellData.type === 'landsat' ? '#ef4444' : (cellData.type === 'modis' ? '#f59e0b' : '#38bdf8');

                        return '<div class="gee-grid-pill-popup">' +
                            '<span class="gee-grid-pill-label" style="border-color: ' + accentColor + '60; color: ' + accentColor + ';">' + badgeText + '</span>' +
                            '<div class="gee-grid-pill-buttons">' +
                                '<button class="gee-grid-pill-btn" onclick="copyGridActiveFilter()" title="Copiar filtro al portapapeles">📋 Copiar</button>' +
                                '<button class="gee-grid-pill-btn primary" onclick="insertGridActiveFilter()" title="Insertar filtro en el editor">✏️ Insertar</button>' +
                            '</div>' +
                        '</div>';
                    }

                    function openGridMicroPopup(cellData, latlng, poly) {
                        lastClickedGridCell = cellData;
                        const html = getGridPopupHtml(cellData);
                        if (poly) {
                            poly.bindPopup(html, { closeButton: false, offset: [0, -4], className: 'gee-micro-popup-wrapper' });
                            poly.openPopup(latlng);
                        }
                    }

                    function generateCompositeGridFilter() {
                        if (selectedGridCells.size === 0) return '';
                        const cells = Array.from(selectedGridCells.values());
                        const landsatCells = cells.filter(c => c.type === 'landsat');
                        const modisCells = cells.filter(c => c.type === 'modis');
                        const mgrsCells = cells.filter(c => c.type === 'mgrs');
                        const filters = [];
                        const NL = String.fromCharCode(10);

                        if (landsatCells.length === 1) {
                            filters.push("ee.Filter.and(ee.Filter.eq('WRS_PATH', " + landsatCells[0].path + "), ee.Filter.eq('WRS_ROW', " + landsatCells[0].row + "))");
                        } else if (landsatCells.length > 1) {
                            const subFilters = landsatCells.map(c => "ee.Filter.and(ee.Filter.eq('WRS_PATH', " + c.path + "), ee.Filter.eq('WRS_ROW', " + c.row + "))");
                            filters.push("ee.Filter.or([" + NL + "  " + subFilters.join("," + NL + "  ") + NL + "])");
                        }

                        if (modisCells.length === 1) {
                            filters.push("ee.Filter.stringContains('system:index', '" + modisCells[0].tileId + "')");
                        } else if (modisCells.length > 1) {
                            const subFilters = modisCells.map(c => "ee.Filter.stringContains('system:index', '" + c.tileId + "')");
                            filters.push("ee.Filter.or([ " + subFilters.join(", ") + " ])");
                        }

                        if (mgrsCells.length === 1) {
                            filters.push("ee.Filter.stringStartsWith('MGRS_TILE', '" + mgrsCells[0].mgrs + "')");
                        } else if (mgrsCells.length > 1) {
                            const subFilters = mgrsCells.map(c => "ee.Filter.stringStartsWith('MGRS_TILE', '" + c.mgrs + "')");
                            filters.push("ee.Filter.or([ " + subFilters.join(", ") + " ])");
                        }

                        if (filters.length === 1) {
                            return filters[0];
                        } else {
                            return "ee.Filter.or([" + NL + "  " + filters.join("," + NL + "  ") + NL + "])";
                        }
                    }

                    function normLon(lon) {
                        return ((lon + 180) % 360 + 360) % 360 - 180;
                    }

                    function pad2(n) {
                        return String(n).padStart(2, '0');
                    }
                    function pad3(n) {
                        return String(n).padStart(3, '0');
                    }

                    function getVisibleLandsatPaths(latCenter, minLon, maxLon) {
                        const dLon = 1.5450643777;
                        const paths = new Set();
                        const span = Math.max(0.1, maxLon - minLon);
                        const step = Math.max(0.4, span / 30);
                        for (let lon = minLon - 2; lon <= maxLon + 2; lon += step) {
                            let lonEq = normLon(lon - latCenter * 0.185);
                            let diff = ((-64.60 - lonEq) % 360 + 360) % 360;
                            let p = Math.round(1 + diff / dLon);
                            p = ((p - 1) % 233 + 233) % 233 + 1;
                            paths.add(p);
                        }
                        return Array.from(paths);
                    }

                    function renderLandsatGrid() {
                        landsatGridGroup.clearLayers();
                        if (!isLandsatGridActive) return;

                        const b = map.getBounds();
                        const minLat = Math.max(-80, b.getSouth() - 0.5);
                        const maxLat = Math.min(80, b.getNorth() + 0.5);
                        const minLon = b.getWest() - 0.5;
                        const maxLon = b.getEast() + 0.5;
                        const zoom = map.getZoom();

                        // 1. Always Render UTM Zone Boundaries and Header Badges (ZONA 17, 18, 19, etc.)
                        const minZ = Math.max(1, Math.floor((minLon + 180) / 6));
                        const maxZ = Math.min(60, Math.ceil((maxLon + 180) / 6));
                        for (let z = minZ; z <= maxZ; z++) {
                            const lonBoundary = -180 + (z - 1) * 6;
                            const lonCenter = lonBoundary + 3;

                            const utmLine = L.polyline([[minLat - 5, lonBoundary], [maxLat + 5, lonBoundary]], {
                                color: '#2563eb',
                                weight: 1.5,
                                dashArray: '5, 5',
                                opacity: 0.65,
                                interactive: false
                            });
                            landsatGridGroup.addLayer(utmLine);

                            if (lonCenter >= minLon && lonCenter <= maxLon) {
                                const utmMarker = L.circleMarker([maxLat - 0.35, lonCenter], {
                                    radius: 0.1,
                                    opacity: 0,
                                    fillOpacity: 0,
                                    interactive: false
                                });
                                utmMarker.bindTooltip('<span style="font-weight:800; color:#38bdf8; font-size:11px;">ZONA ' + z + '</span>', {
                                    permanent: true,
                                    direction: 'center',
                                    className: 'gee-utm-header-label'
                                });
                                landsatGridGroup.addLayer(utmMarker);
                            }
                        }

                        // 2. Progressive Level of Detail:
                        // Below zoom 5, avoid looping over full scenes to guarantee 60fps instant performance
                        if (zoom < 5) {
                            showHud('🔍 Haz zoom a tu región (zoom ≥ 5) para ver las baldosas Landsat WRS-2');
                            return;
                        }

                        // 3. Render Official Tilted Descending Landsat WRS-2 Scenes
                        const minRow = Math.max(1, Math.floor(60 - maxLat / 1.428) - 1);
                        const maxRow = Math.min(120, Math.ceil(60 - minLat / 1.428) + 1);

                        // NASA WRS-2 Orbit Geometry:
                        // Inclination 98.2° gives a ground track heading of ~8.5° to 9.0° at mid-latitudes
                        const theta = 9.0 * Math.PI / 180;
                        const u = 0.82; // Along-track half-height (~180 km nominal height with ~21 km overlap)
                        const v = 0.85; // Across-track half-width (~185 km nominal swath width)

                        for (let r = minRow; r <= maxRow; r++) {
                            const latCenter = (60 - r) * 1.428;
                            const cosLat = Math.max(0.1, Math.cos(latCenter * Math.PI / 180));

                            // Along-track vector A (descending orbit towards South-Southwest):
                            const a_lat = u * Math.cos(theta);
                            const a_lon = (u * Math.sin(theta)) / cosLat;

                            // Across-track vector C (perpendicular to A, pointing East-Southeast):
                            const c_lat = -v * Math.sin(theta);
                            const c_lon = (v * Math.cos(theta)) / cosLat;

                            const visiblePaths = getVisibleLandsatPaths(latCenter, minLon, maxLon);

                            for (const p of visiblePaths) {
                                const lonEq = normLon(-64.60 - (p - 1) * 1.5450643777);
                                const lonCenter = normLon(lonEq + latCenter * 0.185);

                                if (lonCenter < minLon - 2 || lonCenter > maxLon + 2) {
                                    continue;
                                }

                                // 4 corners of standard NASA WRS-2 rotated rectangle:
                                // NW: Center + A - C
                                const p1 = [latCenter + a_lat - c_lat, lonCenter + a_lon - c_lon];
                                // NE: Center + A + C
                                const p2 = [latCenter + a_lat + c_lat, lonCenter + a_lon + c_lon];
                                // SE: Center - A + C
                                const p3 = [latCenter - a_lat + c_lat, lonCenter - a_lon + c_lon];
                                // SW: Center - A - C
                                const p4 = [latCenter - a_lat - c_lat, lonCenter - a_lon - c_lon];

                                const cellId = 'landsat_p' + p + '_r' + r;
                                const cellLabel = p + ' / ' + r;
                                const isSel = selectedGridCells.has(cellId);
                                const filterSnippet = "ee.Filter.and(ee.Filter.eq('WRS_PATH', " + p + "), ee.Filter.eq('WRS_ROW', " + r + "))";

                                const poly = L.polygon([p1, p2, p3, p4], isSel ? getGridSelectedStyle('landsat') : getGridDefaultStyle('landsat'));

                                const cellData = { id: cellId, type: 'landsat', label: 'Landsat ' + cellLabel, shortLabel: cellLabel, path: p, row: r, snippet: filterSnippet, poly: poly };
                                gridRegistry.set(cellId, cellData);

                                poly.on('click', function(e) {
                                    if (e.originalEvent && e.originalEvent.shiftKey) {
                                        L.DomEvent.stop(e);
                                        toggleGridCellSelection(cellData, this);
                                    } else {
                                        selectSingleGridCell(cellData, this);
                                    }
                                    openGridMicroPopup(cellData, e.latlng, this);
                                });

                                if (zoom >= 6) {
                                    poly.bindTooltip('<span style="font-weight:700; font-size:11px;">' + cellLabel + '</span>', {
                                        permanent: true,
                                        direction: 'center',
                                        className: 'gee-landsat-tile-label'
                                    });
                                } else {
                                    poly.bindTooltip('Landsat ' + cellLabel, { sticky: true, className: 'gee-ruler-tooltip' });
                                }

                                poly.on('mouseover', function() {
                                    if (!selectedGridCells.has(cellId)) this.setStyle({ fillOpacity: 0.25, weight: 2.2 });
                                });
                                poly.on('mouseout', function() {
                                    if (!selectedGridCells.has(cellId)) this.setStyle({ fillOpacity: 0.08, weight: 1.4 });
                                });

                                landsatGridGroup.addLayer(poly);
                            }
                        }
                    }

                    function renderModisGrid() {
                        modisGridGroup.clearLayers();
                        if (!isModisGridActive) return;
                        const R_MODIS = 6371007.181;
                        const T_W = 40030173.6 / 36;
                        const T_H = 20015086.8 / 18;
                        const X_MIN_GLOBAL = -20015086.8;
                        const Y_MAX_GLOBAL = 10007543.4;

                        for (let v = 0; v < 18; v++) {
                            const latTop = 90 - v * 10;
                            const latBot = 90 - (v + 1) * 10;

                            for (let h = 0; h < 36; h++) {
                                const xL = X_MIN_GLOBAL + h * T_W;
                                const xR = xL + T_W;

                                const toLon = (x, lat) => {
                                    const cosL = Math.cos(lat * Math.PI / 180);
                                    if (cosL < 0.001) return x >= 0 ? 180 : -180;
                                    const lon = (x / (R_MODIS * cosL)) * (180 / Math.PI);
                                    return Math.max(-180, Math.min(180, lon));
                                };

                                const pts = [
                                    [latTop, toLon(xL, latTop)],
                                    [latTop, toLon(xR, latTop)],
                                    [latBot, toLon(xR, latBot)],
                                    [latBot, toLon(xL, latBot)]
                                ];

                                const tileId = 'h' + pad2(h) + 'v' + pad2(v);
                                const cellId = 'modis_' + tileId;
                                const cellLabel = 'MODIS ' + tileId;
                                const isSel = selectedGridCells.has(cellId);
                                const filterSnippet = "ee.Filter.stringContains('system:index', '" + tileId + "')";

                                const poly = L.polygon(pts, isSel ? getGridSelectedStyle('modis') : getGridDefaultStyle('modis'));
                                const cellData = { id: cellId, type: 'modis', label: cellLabel, shortLabel: tileId, h: h, v: v, tileId: tileId, snippet: filterSnippet, poly: poly };
                                gridRegistry.set(cellId, cellData);

                                poly.on('click', function(e) {
                                    if (e.originalEvent && e.originalEvent.shiftKey) {
                                        L.DomEvent.stop(e);
                                        toggleGridCellSelection(cellData, this);
                                    } else {
                                        selectSingleGridCell(cellData, this);
                                    }
                                    openGridMicroPopup(cellData, e.latlng, this);
                                });

                                poly.bindTooltip('MODIS ' + tileId, { sticky: true, className: 'gee-ruler-tooltip' });
                                poly.on('mouseover', function() {
                                    if (!selectedGridCells.has(cellId)) this.setStyle({ fillOpacity: 0.22, weight: 2 });
                                });
                                poly.on('mouseout', function() {
                                    if (!selectedGridCells.has(cellId)) this.setStyle({ fillOpacity: 0.04, weight: 1.2 });
                                });
                                modisGridGroup.addLayer(poly);
                            }
                        }
                    }

                    function renderMgrsGrid() {
                        mgrsGridGroup.clearLayers();
                        if (!isMgrsGridActive) return;
                        const bands = [
                            { letter: 'C', minLat: -80, maxLat: -72 },
                            { letter: 'D', minLat: -72, maxLat: -64 },
                            { letter: 'E', minLat: -64, maxLat: -56 },
                            { letter: 'F', minLat: -56, maxLat: -48 },
                            { letter: 'G', minLat: -48, maxLat: -40 },
                            { letter: 'H', minLat: -40, maxLat: -32 },
                            { letter: 'J', minLat: -32, maxLat: -24 },
                            { letter: 'K', minLat: -24, maxLat: -16 },
                            { letter: 'L', minLat: -16, maxLat: -8 },
                            { letter: 'M', minLat: -8, maxLat: 0 },
                            { letter: 'N', minLat: 0, maxLat: 8 },
                            { letter: 'P', minLat: 8, maxLat: 16 },
                            { letter: 'Q', minLat: 16, maxLat: 24 },
                            { letter: 'R', minLat: 24, maxLat: 32 },
                            { letter: 'S', minLat: 32, maxLat: 40 },
                            { letter: 'T', minLat: 40, maxLat: 48 },
                            { letter: 'U', minLat: 48, maxLat: 56 },
                            { letter: 'V', minLat: 56, maxLat: 64 },
                            { letter: 'W', minLat: 64, maxLat: 72 },
                            { letter: 'X', minLat: 72, maxLat: 84 }
                        ];

                        for (let z = 1; z <= 60; z++) {
                            const minLon = -180 + (z - 1) * 6;
                            const maxLon = minLon + 6;

                            bands.forEach(b => {
                                const pts = [
                                    [b.minLat, minLon],
                                    [b.maxLat, minLon],
                                    [b.maxLat, maxLon],
                                    [b.minLat, maxLon]
                                ];
                                const mgrsCode = z + b.letter;
                                const cellId = 'mgrs_' + mgrsCode;
                                const cellLabel = 'MGRS ' + mgrsCode;
                                const isSel = selectedGridCells.has(cellId);
                                const filterSnippet = "ee.Filter.stringStartsWith('MGRS_TILE', '" + mgrsCode + "')";

                                const poly = L.polygon(pts, isSel ? getGridSelectedStyle('mgrs') : getGridDefaultStyle('mgrs'));
                                const cellData = { id: cellId, type: 'mgrs', label: cellLabel, shortLabel: mgrsCode, mgrs: mgrsCode, snippet: filterSnippet, poly: poly };
                                gridRegistry.set(cellId, cellData);

                                poly.on('click', function(e) {
                                    if (e.originalEvent && e.originalEvent.shiftKey) {
                                        L.DomEvent.stop(e);
                                        toggleGridCellSelection(cellData, this);
                                    } else {
                                        selectSingleGridCell(cellData, this);
                                    }
                                    openGridMicroPopup(cellData, e.latlng, this);
                                });

                                poly.bindTooltip('MGRS Zona ' + mgrsCode, { sticky: true, className: 'gee-ruler-tooltip' });
                                poly.on('mouseover', function() {
                                    if (!selectedGridCells.has(cellId)) this.setStyle({ fillOpacity: 0.22, weight: 2 });
                                });
                                poly.on('mouseout', function() {
                                    if (!selectedGridCells.has(cellId)) this.setStyle({ fillOpacity: 0.04, weight: 1.2 });
                                });
                                mgrsGridGroup.addLayer(poly);
                            });
                        }
                    }

                    window.toggleLandsatGrid = function(active) {
                        isLandsatGridActive = active !== undefined ? active : !isLandsatGridActive;
                        const chk = document.getElementById('chkGridLandsat');
                        if (chk) chk.checked = isLandsatGridActive;
                        if (isLandsatGridActive) {
                            if (!map.hasLayer(landsatGridGroup)) landsatGridGroup.addTo(map);
                            renderLandsatGrid();
                            showHud('🛰️ Grilla Landsat WRS-2: Activada');
                        } else {
                            if (map.hasLayer(landsatGridGroup)) map.removeLayer(landsatGridGroup);
                            showHud('🛰️ Grilla Landsat WRS-2: Desactivada');
                        }
                        syncGridBtnState();
                    };

                    window.toggleModisGrid = function(active) {
                        isModisGridActive = active !== undefined ? active : !isModisGridActive;
                        const chk = document.getElementById('chkGridModis');
                        if (chk) chk.checked = isModisGridActive;
                        if (isModisGridActive) {
                            if (!map.hasLayer(modisGridGroup)) modisGridGroup.addTo(map);
                            renderModisGrid();
                            showHud('🌍 Grilla MODIS Sinusoidal: Activada');
                        } else {
                            if (map.hasLayer(modisGridGroup)) map.removeLayer(modisGridGroup);
                            showHud('🌍 Grilla MODIS Sinusoidal: Desactivada');
                        }
                        syncGridBtnState();
                    };

                    window.toggleMgrsGrid = function(active) {
                        isMgrsGridActive = active !== undefined ? active : !isMgrsGridActive;
                        const chk = document.getElementById('chkGridMgrs');
                        if (chk) chk.checked = isMgrsGridActive;
                        if (isMgrsGridActive) {
                            if (!map.hasLayer(mgrsGridGroup)) mgrsGridGroup.addTo(map);
                            renderMgrsGrid();
                            showHud('🌐 Grilla Sentinel-2 MGRS: Activada');
                        } else {
                            if (map.hasLayer(mgrsGridGroup)) map.removeLayer(mgrsGridGroup);
                            showHud('🌐 Grilla Sentinel-2 MGRS: Desactivada');
                        }
                        syncGridBtnState();
                    };

                    function syncGridBtnState() {
                        const btn = document.getElementById('gridHeaderBtn');
                        if (!btn) return;
                        if (isLandsatGridActive || isModisGridActive || isMgrsGridActive) {
                            btn.classList.add('active');
                        } else {
                            btn.classList.remove('active');
                        }
                    }

                    let landsatRenderTimer = null;
                    map.on('moveend zoomend', function() {
                        if (isLandsatGridActive) {
                            if (landsatRenderTimer) clearTimeout(landsatRenderTimer);
                            landsatRenderTimer = setTimeout(renderLandsatGrid, 120);
                        }
                    });

                    window.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            map.closePopup();
                            clearAllGridSelections(true);
                            return;
                        }

                        const isCmdOrCtrl = e.metaKey || e.ctrlKey;

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

                        // QGIS Ruler shortcut: Option/Alt + M
                        if (isAlt && !isCmdOrCtrl && (e.code === 'KeyM' || e.key === 'm' || e.key === 'M' || e.key === 'µ')) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (typeof window.toggleRulerMode === 'function') window.toggleRulerMode();
                            return;
                        }

                        if (e.key === 'Backspace' && typeof rulerMode !== 'undefined' && rulerMode) {
                            e.preventDefault();
                            if (typeof window.rulerUndo === 'function') window.rulerUndo();
                            return;
                        }

                        if (e.key === 'Escape') {
                            if (typeof rulerMode !== 'undefined' && rulerMode) {
                                window.toggleRulerMode(false);
                                return;
                            }
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

                        let pressedDigit = -1;
                        if (/^[0-9]$/.test(e.key)) {
                            pressedDigit = parseInt(e.key, 10);
                        } else if (e.code && /^Digit([0-9])$/.test(e.code)) {
                            pressedDigit = parseInt(e.code.replace('Digit', ''), 10);
                        }

                        if (!isCmdOrCtrl && !isAlt && pressedDigit >= 1 && pressedDigit <= 9) {
                            if (e.shiftKey) {
                                // Peek Mode: Hold Shift + Digit to peek at layer
                                e.preventDefault();
                                e.stopPropagation();
                                startPeek(pressedDigit - 1);
                                return;
                            }
                        }

                        // Layer toggles: strictly DIRECT numbers 1..9, 0 (no Ctrl, no Alt/Option, no Cmd, no Shift)
                        const isDirectNum = !isCmdOrCtrl && !isAlt && !e.shiftKey && pressedDigit !== -1;

                        if (isDirectNum) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (pressedDigit === 0) {
                                toggleAllLayers();
                            } else {
                                toggleLayerByIndex(pressedDigit - 1);
                            }
                            return;
                        }
                    }, true);

                    // Snapshot HD Pro & Cartographic Composer Implementation
                    window.syncSnapHdLegacy = function() {
                        const sel = document.getElementById('snapScaleSelect');
                        const optHd = document.getElementById('snapOptHd');
                        if (sel && optHd) {
                            optHd.checked = parseInt(sel.value, 10) >= 2;
                        }
                    };

                    window.syncSnapFormatChange = function() {
                        const fmt = document.getElementById('snapFormatSelect')?.value;
                        const paperSel = document.getElementById('snapPaperSelect');
                        if (fmt === 'pdf' && paperSel && paperSel.value === 'auto') {
                            paperSel.value = 'A4';
                        }
                    };

                    window.toggleSnapProConfig = function() {
                        const optLayout = document.getElementById('snapOptLayout');
                        const cfg = document.getElementById('snapProConfig');
                        const optGrid = document.getElementById('snapOptGrid');
                        if (cfg && optLayout) {
                            cfg.style.display = optLayout.checked ? 'flex' : 'none';
                            if (optLayout.checked && optGrid) {
                                optGrid.checked = true;
                            }
                        }
                    };

                    window.toggleSnapMoreTexts = function() {
                        const box = document.getElementById('snapMoreTextsBox');
                        const btn = document.getElementById('snapToggleMoreBtn');
                        if (!box) return;
                        const open = box.style.display === 'none' || !box.style.display;
                        box.style.display = open ? 'flex' : 'none';
                        if (btn) {
                            btn.textContent = open
                                ? '🔼 Ocultar textos adicionales'
                                : '✏️ Personalizar todos los textos de la lámina (Subtítulo, CRS, Leyenda, Pie...)';
                        }
                    };

                    window.syncSnapBrandOption = function() {
                        const optBrand = document.getElementById('snapOptBrand');
                        const authorIn = document.getElementById('snapAuthorInput');
                        const instIn = document.getElementById('snapInstInput');
                        if (!optBrand) return;
                        if (!optBrand.checked) {
                            if (authorIn && (authorIn.value.trim() === 'GEE IDE Pro' || authorIn.value.trim() === 'GEE IDE')) {
                                authorIn.value = 'Elaboración Propia';
                            }
                            if (instIn && instIn.value.includes('GEE IDE')) {
                                instIn.value = instIn.value.replace(/\s*•\s*GEE IDE(\s*Pro)?/gi, '').replace(/GEE IDE(\s*Pro)?/gi, '').trim() || 'Procesado en Google Earth Engine';
                            }
                        } else {
                            if (authorIn && authorIn.value.trim() === 'Elaboración Propia') {
                                authorIn.value = 'GEE IDE Pro';
                            }
                            if (instIn && instIn.value.trim() === 'Procesado en Google Earth Engine') {
                                instIn.value = 'Procesado en Google Earth Engine • GEE IDE Pro';
                            }
                        }
                    };

                    window.toggleSnapshotModal = function() {
                        const m = document.getElementById('snapshotModal');
                        if (!m) return;
                        const isVisible = m.style.display === 'block';
                        m.style.display = isVisible ? 'none' : 'block';
                        if (!isVisible) {
                            const selScale = document.getElementById('snapScaleSelect');
                            const selFormat = document.getElementById('snapFormatSelect');
                            const selPaper = document.getElementById('snapPaperSelect');
                            const optHd = document.getElementById('snapOptHd');
                            const optCoords = document.getElementById('snapOptCoords');
                            const optDraw = document.getElementById('snapOptDrawings');
                            const optBrand = document.getElementById('snapOptBrand');
                            const optLayout = document.getElementById('snapOptLayout');
                            const optNorth = document.getElementById('snapOptNorth');
                            const optScaleBar = document.getElementById('snapOptScaleBar');
                            const optGrid = document.getElementById('snapOptGrid');
                            const optLegend = document.getElementById('snapOptLegend');
                            const titleIn = document.getElementById('snapTitleInput');
                            const authorIn = document.getElementById('snapAuthorInput');
                            const themeSel = document.getElementById('snapThemeSelect');
                            const subtitleIn = document.getElementById('snapSubtitleInput');
                            const instIn = document.getElementById('snapInstInput');
                            const crsIn = document.getElementById('snapCrsInput');
                            const legendTitleIn = document.getElementById('snapLegendTitleInput');
                            const customMetaIn = document.getElementById('snapCustomMetaInput');

                            const savedScale = String(getSetting('snap_scale', '2'));
                            if (selScale) selScale.value = ['1', '2', '4'].includes(savedScale) ? savedScale : '2';
                            if (selFormat) selFormat.value = getSetting('snap_format', 'png') || 'png';
                            if (selPaper) selPaper.value = getSetting('snap_paper', 'auto') || 'auto';
                            if (optHd) optHd.checked = getSetting('snap_hd', true) !== false;
                            if (optCoords) optCoords.checked = getSetting('snap_coords', true) !== false;
                            if (optDraw) optDraw.checked = getSetting('snap_drawings', true) !== false;
                            if (optBrand) optBrand.checked = getSetting('snap_brand', true) !== false && getSetting('snap_brand', 'true') !== 'false';
                            if (optLayout) optLayout.checked = getSetting('snap_layout', false) === true || getSetting('snap_layout', false) === 'true';
                            if (optNorth) optNorth.checked = getSetting('snap_north', true) !== false && getSetting('snap_north', 'true') !== 'false';
                            if (optScaleBar) optScaleBar.checked = getSetting('snap_scalebar', true) !== false && getSetting('snap_scalebar', 'true') !== 'false';
                            if (optGrid) optGrid.checked = getSetting('snap_grid', false) === true || getSetting('snap_grid', false) === 'true';
                            if (optLegend) optLegend.checked = getSetting('snap_legend', true) !== false && getSetting('snap_legend', 'true') !== 'false';
                            if (titleIn) titleIn.value = getSetting('snap_title', 'Mapa de Análisis Geoespacial');
                            if (authorIn) authorIn.value = getSetting('snap_author', 'GEE IDE Pro');
                            if (themeSel) themeSel.value = getSetting('snap_theme', 'light');
                            if (subtitleIn) subtitleIn.value = getSetting('snap_subtitle', '');
                            if (instIn) instIn.value = getSetting('snap_inst', 'Procesado en Google Earth Engine • GEE IDE Pro');
                            if (crsIn) crsIn.value = getSetting('snap_crs', '');
                            if (legendTitleIn) legendTitleIn.value = getSetting('snap_legend_title', 'LEYENDA / CAPA ACTIVA');
                            if (customMetaIn) customMetaIn.value = getSetting('snap_custom_meta', '');
                            window.syncSnapBrandOption();
                            window.toggleSnapProConfig();
                        }
                    };

                    function formatDMS(deg, isLat) {
                        const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
                        const abs = Math.abs(deg);
                        const d = Math.floor(abs);
                        const mFloat = (abs - d) * 60;
                        const m = Math.floor(mFloat);
                        const s = Math.round((mFloat - m) * 60);
                        if (s === 60) {
                            return d + '°' + String(m + 1).padStart(2, '0') + '′00″' + dir;
                        }
                        if (s === 0) {
                            return d + '°' + String(m).padStart(2, '0') + '′' + dir;
                        }
                        return d + '°' + String(m).padStart(2, '0') + '′' + String(s).padStart(2, '0') + '″' + dir;
                    }

                    function getUtmZoneLabel(lat, lng) {
                        const zone = Math.floor((lng + 180) / 6) + 1;
                        const hemi = lat >= 0 ? 'N' : 'S';
                        return 'UTM ' + zone + hemi;
                    }

                    function computeNiceGridStep(spanDeg) {
                        const raw = spanDeg / 4;
                        const steps = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30];
                        for (const s of steps) {
                            if (s >= raw) return s;
                        }
                        return 30;
                    }

                    function computeScaleBarMetrics(width) {
                        const center = map.getCenter();
                        const p1 = map.containerPointToLatLng([width * 0.35, map.getSize().y / 2]);
                        const p2 = map.containerPointToLatLng([width * 0.35 + 100, map.getSize().y / 2]);
                        const metersPer100Px = Math.max(1, map.distance(p1, p2));
                        const metersPerPx = metersPer100Px / 100;
                        const targetPx = Math.min(180, Math.max(90, width * 0.22));
                        const rawMeters = metersPerPx * targetPx;
                        const niceSteps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
                        let bestMeters = niceSteps[0];
                        for (const s of niceSteps) {
                            if (s <= rawMeters * 1.35) bestMeters = s;
                        }
                        const barPx = Math.round(bestMeters / metersPerPx);
                        const label = bestMeters >= 1000 ? (bestMeters / 1000) + ' km' : bestMeters + ' m';
                        const midLabel = bestMeters >= 1000 ? ((bestMeters / 2000).toFixed(bestMeters === 1000 ? 1 : 0)) : String(bestMeters / 2);
                        // Approximate numeric scale at 96 DPI (1 px = 0.000264583 m)
                        const scaleRatio = Math.max(100, Math.round((metersPerPx / 0.000264583) / 100) * 100);
                        return { bestMeters, barPx, label, midLabel, scaleRatio, metersPerPx };
                    }

                    function buildLegendEntryForGeeLayer(l, idx, prefix) {
                        const vp = l.visParams || {};
                        const lname = (prefix || '') + (l.name || ('Capa ' + (idx + 1)));
                        const lower = lname.toLowerCase();
                        let palette = null;
                        if (vp.palette) {
                            palette = Array.isArray(vp.palette) ? vp.palette.map(toValidCssColor) : String(vp.palette).split(',').map(toValidCssColor);
                        } else if (vp.min !== undefined && vp.max !== undefined && !vp.bands) {
                            if (lower.includes('elevation') || lower.includes('dem') || lower.includes('srtm') || lower.includes('topo')) {
                                palette = ['#006600', '#002200', '#fff700', '#ab7634', '#c4d0ff', '#ffffff'];
                            } else if (lower.includes('ndvi') || lower.includes('evi') || lower.includes('savi')) {
                                palette = ['#CE7E45', '#FCD163', '#66A000', '#056201', '#004C00'];
                            } else if (lower.includes('ndwi') || lower.includes('water')) {
                                palette = ['#ffffff', '#ffff00', '#00ffff', '#0000ff'];
                            } else {
                                palette = ['#000000', '#ffffff'];
                            }
                        }
                        const bandsList = Array.isArray(vp.bands) ? vp.bands : (typeof vp.bands === 'string' ? vp.bands.split(',').map(s => s.trim()) : null);
                        return {
                            name: lname,
                            palette: palette && palette.length > 0 ? palette : null,
                            min: vp.min !== undefined ? vp.min : 0,
                            max: vp.max !== undefined ? vp.max : 1,
                            bands: bandsList && bandsList.length >= 3 ? bandsList.slice(0, 3) : null,
                            color: vp.color ? toValidCssColor(vp.color) : null
                        };
                    }

                    function collectActiveLegends(includeDrawings) {
                        const items = [];
                        // Static Map Rule: Only include layers that are actually visible in the static image!
                        // 1. If Peek Mode is active, only the peeked layer is on top.
                        if (typeof currentPeekIdx !== 'undefined' && currentPeekIdx !== -1 && geeLayers[currentPeekIdx]) {
                            items.push(buildLegendEntryForGeeLayer(geeLayers[currentPeekIdx], currentPeekIdx, ''));
                        } else if (typeof swipeMode !== 'undefined' && swipeMode) {
                            const sub = (typeof swipeSubMode !== 'undefined') ? swipeSubMode : 'split';
                            if (sub === 'spyglass' && swipeCompareIndices) {
                                if (geeLayers[swipeCompareIndices.left]) {
                                    items.push(buildLegendEntryForGeeLayer(geeLayers[swipeCompareIndices.left], swipeCompareIndices.left, '[🔍 Lupa] '));
                                }
                                if (geeLayers[swipeCompareIndices.right]) {
                                    items.push(buildLegendEntryForGeeLayer(geeLayers[swipeCompareIndices.right], swipeCompareIndices.right, '[Fondo] '));
                                }
                            } else if (sub === 'quad') {
                                const vis = geeLayers.filter(l => l.shown && map.hasLayer(l.layer));
                                const quadPrefixes = ['[Q1 ↖] ', '[Q2 ↗] ', '[Q3 ↙] ', '[Q4 ↘] '];
                                for (let k = 0; k < Math.min(4, vis.length); k++) {
                                    const origIdx = geeLayers.indexOf(vis[k]);
                                    items.push(buildLegendEntryForGeeLayer(vis[k], origIdx, quadPrefixes[k]));
                                }
                            } else if (swipeCompareIndices) {
                                const isHoriz = (swipeOrientation === 'horizontal');
                                const p1 = isHoriz ? '[Arr] ' : '[Izq] ';
                                const p2 = isHoriz ? '[Abj] ' : '[Der] ';
                                if (geeLayers[swipeCompareIndices.left]) {
                                    items.push(buildLegendEntryForGeeLayer(geeLayers[swipeCompareIndices.left], swipeCompareIndices.left, p1));
                                }
                                if (geeLayers[swipeCompareIndices.right]) {
                                    items.push(buildLegendEntryForGeeLayer(geeLayers[swipeCompareIndices.right], swipeCompareIndices.right, p2));
                                }
                            }
                        } else {
                            // 3. Normal Mode: geeLayers[0] is top of the stack. Only include the topmost active layer
                            // (plus any underlying active layer ONLY if the top layer is semi-transparent opacity < 0.95).
                            for (let i = 0; i < geeLayers.length; i++) {
                                const l = geeLayers[i];
                                if (!map.hasLayer(l.layer)) continue;
                                items.push(buildLegendEntryForGeeLayer(l, i, ''));
                                const op = l.opacity !== undefined ? parseFloat(l.opacity) : 1.0;
                                if (op >= 0.95) {
                                    // This active layer is opaque, so any layers underneath it are occluded in the static image
                                    break;
                                }
                            }
                        }
                        if (includeDrawings && typeof drawnItems !== 'undefined' && drawnItems.getLayers().length > 0) {
                            items.push({
                                name: 'Geometrías Digitalizadas (' + drawnItems.getLayers().length + ')',
                                palette: null,
                                bands: null,
                                color: '#3388ff'
                            });
                        }
                        if (includeDrawings && typeof rulerPoints !== 'undefined' && rulerPoints.length >= 2) {
                            const rLabel = document.getElementById('rulerPrimaryValue')?.textContent || '';
                            items.push({
                                name: 'Medición Regla GIS (' + rLabel + ')',
                                palette: null,
                                bands: null,
                                color: '#4ec9b0'
                            });
                        }
                        return items;
                    }

                    function drawNorthArrow(ctx, x, y, size, isLightBg) {
                        ctx.save();
                        ctx.translate(x, y);
                        // Subtle circular backing
                        ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.9)' : 'rgba(18, 18, 22, 0.86)';
                        ctx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.22)';
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.arc(0, 0, size * 0.72, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                        // Outer compass ring
                        ctx.strokeStyle = isLightBg ? 'rgba(0,0,0,0.35)' : 'rgba(78, 201, 176, 0.45)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.arc(0, 2, size * 0.44, 0, Math.PI * 2);
                        ctx.stroke();

                        // 'N' label
                        ctx.fillStyle = isLightBg ? '#111111' : '#4ec9b0';
                        ctx.font = '800 ' + Math.round(size * 0.32) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText('N', 0, -size * 0.26);

                        // Left half of needle (Dark / Primary)
                        const topY = -size * 0.25;
                        const botY = size * 0.48;
                        const midY = size * 0.28;
                        const halfW = size * 0.22;

                        ctx.fillStyle = isLightBg ? '#18181b' : '#4ec9b0';
                        ctx.beginPath();
                        ctx.moveTo(0, topY);
                        ctx.lineTo(-halfW, botY);
                        ctx.lineTo(0, midY);
                        ctx.closePath();
                        ctx.fill();

                        // Right half of needle (Light / Contrast)
                        ctx.fillStyle = isLightBg ? '#ffffff' : '#1e293b';
                        ctx.strokeStyle = isLightBg ? '#18181b' : '#4ec9b0';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(0, topY);
                        ctx.lineTo(halfW, botY);
                        ctx.lineTo(0, midY);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                        ctx.restore();
                    }

                    function drawCartographicScaleBar(ctx, x, y, metrics, isLightBg) {
                        ctx.save();
                        const barW = metrics.barPx;
                        const segW = barW / 4;
                        const barH = 6;
                        const padX = 12;
                        const boxW = barW + padX * 2 + 18;
                        const boxH = 38;

                        ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.92)' : 'rgba(18, 18, 22, 0.88)';
                        ctx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.18)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, 6);
                        else ctx.rect(x, y, boxW, boxH);
                        ctx.fill();
                        ctx.stroke();

                        const startX = x + padX;
                        const startY = y + 20;

                        for (let i = 0; i < 4; i++) {
                            ctx.fillStyle = (i % 2 === 0) ? (isLightBg ? '#18181b' : '#4ec9b0') : (isLightBg ? '#ffffff' : '#27272a');
                            ctx.strokeStyle = isLightBg ? '#18181b' : '#e4e4e7';
                            ctx.lineWidth = 1;
                            ctx.fillRect(startX + i * segW, startY, segW, barH);
                            ctx.strokeRect(startX + i * segW, startY, segW, barH);
                        }

                        ctx.fillStyle = isLightBg ? '#18181b' : '#e4e4e7';
                        ctx.font = '600 9.5px "JetBrains Mono", Consolas, monospace';
                        ctx.textBaseline = 'bottom';
                        ctx.textAlign = 'left';
                        ctx.fillText('0', startX, startY - 3);
                        ctx.textAlign = 'center';
                        ctx.fillText(metrics.midLabel, startX + barW / 2, startY - 3);
                        ctx.textAlign = 'right';
                        ctx.fillText(metrics.label, startX + barW + 14, startY - 3);

                        ctx.restore();
                    }

                    function drawLegendOverlay(ctx, x, y, legends, isLightBg, customLegendTitle) {
                        if (!legends || legends.length === 0) return;
                        ctx.save();
                        const boxW = 238;
                        let totalH = 28;
                        for (const item of legends) {
                            totalH += item.palette ? 34 : (item.bands ? 28 : 22);
                        }
                        const drawY = Math.max(12, y - totalH);

                        ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.94)' : 'rgba(18, 18, 22, 0.92)';
                        ctx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.18)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        if (ctx.roundRect) ctx.roundRect(x, drawY, boxW, totalH, 7);
                        else ctx.rect(x, drawY, boxW, totalH);
                        ctx.fill();
                        ctx.stroke();

                        const defaultHdr = legends.length === 1 ? 'LEYENDA / CAPA ACTIVA' : 'LEYENDA / CAPAS VISIBLES';
                        const isDefaultSetting = !customLegendTitle || customLegendTitle.trim() === 'LEYENDA / CAPAS ACTIVAS' || customLegendTitle.trim() === 'LEYENDA / CAPA ACTIVA';
                        const hdrText = isDefaultSetting ? defaultHdr : customLegendTitle.trim();
                        ctx.fillStyle = isLightBg ? '#0f766e' : '#4ec9b0';
                        ctx.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'top';
                        ctx.fillText(hdrText.length > 34 ? hdrText.slice(0, 32) + '…' : hdrText, x + 10, drawY + 8);

                        ctx.strokeStyle = isLightBg ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
                        ctx.beginPath();
                        ctx.moveTo(x + 10, drawY + 22);
                        ctx.lineTo(x + boxW - 10, drawY + 22);
                        ctx.stroke();

                        let curY = drawY + 27;
                        for (const item of legends) {
                            const cleanName = item.name.length > 34 ? item.name.slice(0, 32) + '…' : item.name;
                            ctx.fillStyle = isLightBg ? '#1f2937' : '#e5e7eb';
                            ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                            if (item.palette) {
                                ctx.fillText(cleanName, x + 10, curY);
                                const gradX = x + 10;
                                const gradY = curY + 13;
                                const gradW = boxW - 20;
                                const gradH = 6;
                                const grad = ctx.createLinearGradient(gradX, 0, gradX + gradW, 0);
                                item.palette.forEach((c, idx) => {
                                    grad.addColorStop(item.palette.length === 1 ? 0.5 : idx / (item.palette.length - 1), c);
                                });
                                ctx.fillStyle = grad;
                                ctx.fillRect(gradX, gradY, gradW, gradH);
                                ctx.strokeStyle = isLightBg ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.2)';
                                ctx.strokeRect(gradX, gradY, gradW, gradH);

                                ctx.fillStyle = isLightBg ? '#4b5563' : '#9ca3af';
                                ctx.font = '500 8.5px "JetBrains Mono", Consolas, monospace';
                                ctx.textAlign = 'left';
                                ctx.fillText(String(item.min), gradX, gradY + 8);
                                ctx.textAlign = 'right';
                                ctx.fillText(String(item.max), gradX + gradW, gradY + 8);
                                ctx.textAlign = 'left';
                                curY += 34;
                            } else if (item.bands) {
                                // RGB composite swatch + full-width title on row 1, bands on row 2 (zero text overlap)
                                const swX = x + 10;
                                const swY = curY + 2;
                                ctx.fillStyle = '#ef4444';
                                ctx.fillRect(swX, swY, 4, 8);
                                ctx.fillStyle = '#22c55e';
                                ctx.fillRect(swX + 4, swY, 4, 8);
                                ctx.fillStyle = '#3b82f6';
                                ctx.fillRect(swX + 8, swY, 4, 8);
                                ctx.strokeStyle = isLightBg ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
                                ctx.lineWidth = 0.6;
                                ctx.strokeRect(swX, swY, 12, 8);

                                ctx.fillStyle = isLightBg ? '#1f2937' : '#e5e7eb';
                                ctx.fillText(cleanName, x + 26, curY);
                                ctx.fillStyle = isLightBg ? '#4b5563' : '#9ca3af';
                                ctx.font = '500 8px "JetBrains Mono", Consolas, monospace';
                                ctx.fillText('RGB: ' + item.bands.join(' / '), x + 26, curY + 12);
                                curY += 28;
                            } else {
                                ctx.fillStyle = item.color || '#4ec9b0';
                                ctx.fillRect(x + 10, curY + 2, 12, 8);
                                ctx.strokeStyle = isLightBg ? '#111' : '#fff';
                                ctx.lineWidth = 0.8;
                                ctx.strokeRect(x + 10, curY + 2, 12, 8);
                                ctx.fillStyle = isLightBg ? '#1f2937' : '#e5e7eb';
                                ctx.fillText(cleanName, x + 27, curY);
                                curY += 22;
                            }
                        }
                        ctx.restore();
                    }

                    async function captureMapToCanvas() {
                        const mapEl = document.getElementById('map');
                        if (!mapEl) throw new Error('Mapa no encontrado');

                        const selScale = document.getElementById('snapScaleSelect');
                        const selFormat = document.getElementById('snapFormatSelect');
                        const selPaper = document.getElementById('snapPaperSelect');
                        const optHd = document.getElementById('snapOptHd');
                        const optCoords = document.getElementById('snapOptCoords');
                        const optDraw = document.getElementById('snapOptDrawings');
                        const optBrand = document.getElementById('snapOptBrand');
                        const optLayout = document.getElementById('snapOptLayout');
                        const optNorth = document.getElementById('snapOptNorth');
                        const optScaleBar = document.getElementById('snapOptScaleBar');
                        const optGrid = document.getElementById('snapOptGrid');
                        const optLegend = document.getElementById('snapOptLegend');
                        const titleIn = document.getElementById('snapTitleInput');
                        const authorIn = document.getElementById('snapAuthorInput');
                        const themeSel = document.getElementById('snapThemeSelect');
                        const subtitleIn = document.getElementById('snapSubtitleInput');
                        const instIn = document.getElementById('snapInstInput');
                        const crsIn = document.getElementById('snapCrsInput');
                        const legendTitleIn = document.getElementById('snapLegendTitleInput');
                        const customMetaIn = document.getElementById('snapCustomMetaInput');

                        let requestedScale = selScale ? parseInt(selScale.value, 10) : (optHd && !optHd.checked ? 1 : 2);
                        if (![1, 2, 4].includes(requestedScale)) requestedScale = 2;
                        const snapFormat = (selFormat && selFormat.value) ? selFormat.value : 'png';
                        const paperSize = (selPaper && selPaper.value) ? selPaper.value : 'auto';
                        const selOrientation = document.getElementById('snapOrientationSelect');
                        const orientation = (selOrientation && selOrientation.value) ? selOrientation.value : 'auto';
                        const isHd = requestedScale >= 2;
                        const includeCoords = optCoords ? optCoords.checked : true;
                        const includeDrawings = optDraw ? optDraw.checked : true;
                        const includeBrand = optBrand ? optBrand.checked : true;
                        const includeLayout = optLayout ? optLayout.checked : false;
                        const includeNorth = optNorth ? optNorth.checked : true;
                        const includeScaleBar = optScaleBar ? optScaleBar.checked : true;
                        const includeGrid = optGrid ? optGrid.checked : false;
                        const includeLegend = optLegend ? optLegend.checked : true;
                        const mapTitle = (titleIn && titleIn.value.trim()) ? titleIn.value.trim() : 'Mapa de Análisis Geoespacial';
                        let mapAuthor = (authorIn && authorIn.value.trim()) ? authorIn.value.trim() : (includeBrand ? 'GEE IDE Pro' : 'Elaboración Propia');
                        const mapTheme = (themeSel && themeSel.value) ? themeSel.value : 'light';
                        const customSubtitle = (subtitleIn && subtitleIn.value.trim()) ? subtitleIn.value.trim() : '';
                        let customInst = (instIn && instIn.value.trim()) ? instIn.value.trim() : (includeBrand ? 'Procesado en Google Earth Engine • GEE IDE Pro' : 'Procesado en Google Earth Engine');
                        const customCrs = (crsIn && crsIn.value.trim()) ? crsIn.value.trim() : '';
                        const customLegendTitle = (legendTitleIn && legendTitleIn.value.trim()) ? legendTitleIn.value.trim() : 'LEYENDA / CAPA ACTIVA';
                        const customMeta = (customMetaIn && customMetaIn.value.trim()) ? customMetaIn.value.trim() : '';

                        if (!includeBrand) {
                            if (mapAuthor === 'GEE IDE Pro' || mapAuthor === 'GEE IDE') {
                                mapAuthor = 'Elaboración Propia';
                            }
                            customInst = customInst.replace(/\s*•\s*GEE IDE(\s*Pro)?/gi, '').replace(/GEE IDE(\s*Pro)?/gi, '').trim() || 'Procesado en Google Earth Engine';
                        }

                        setSetting('snap_scale', requestedScale);
                        setSetting('snap_format', snapFormat);
                        setSetting('snap_paper', paperSize);
                        setSetting('snap_orientation', orientation);
                        setSetting('snap_hd', isHd);
                        setSetting('snap_coords', includeCoords);
                        setSetting('snap_drawings', includeDrawings);
                        setSetting('snap_brand', includeBrand);
                        setSetting('snap_layout', includeLayout);
                        setSetting('snap_north', includeNorth);
                        setSetting('snap_scalebar', includeScaleBar);
                        setSetting('snap_grid', includeGrid);
                        setSetting('snap_legend', includeLegend);
                        setSetting('snap_title', mapTitle);
                        setSetting('snap_author', mapAuthor);
                        setSetting('snap_theme', mapTheme);
                        setSetting('snap_subtitle', customSubtitle);
                        setSetting('snap_inst', customInst);
                        setSetting('snap_crs', customCrs);
                        setSetting('snap_legend_title', customLegendTitle);
                        setSetting('snap_custom_meta', customMeta);

                        const width = mapEl.clientWidth;
                        const height = mapEl.clientHeight;
                        // Safeguard browser max canvas dimension (7680px 8K limit)
                        const maxDim = Math.max(width + 240, height + 260);
                        const scale = (maxDim * requestedScale > 7680) ? Math.max(1, Math.floor(7680 / maxDim)) : requestedScale;

                        const canvas = document.createElement('canvas');
                        canvas.width = width * scale;
                        canvas.height = height * scale;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) throw new Error('No se pudo inicializar Canvas 2D');
                        ctx.scale(scale, scale);

                        ctx.fillStyle = '#1e1e1e';
                        ctx.fillRect(0, 0, width, height);

                        const mapRect = mapEl.getBoundingClientRect();
                        // Sort .leaflet-layer containers by their CSS z-index so the top layer in the Layers panel is ALWAYS painted on top
                        const layerContainers = Array.from(mapEl.querySelectorAll('.leaflet-tile-pane .leaflet-layer'));
                        layerContainers.sort((a, b) => {
                            const za = parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
                            const zb = parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
                            return za - zb;
                        });
                        const tiles = [];
                        if (layerContainers.length > 0) {
                            for (const lc of layerContainers) {
                                const lcStyle = window.getComputedStyle(lc);
                                if (lcStyle.display === 'none' || lcStyle.visibility === 'hidden' || parseFloat(lcStyle.opacity || '1') <= 0) continue;
                                const lcTiles = Array.from(lc.querySelectorAll('img.leaflet-tile'));
                                for (const t of lcTiles) tiles.push(t);
                            }
                        } else {
                            tiles.push(...Array.from(mapEl.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')));
                        }
                        const isSwipeActive = (typeof swipeMode !== 'undefined' && swipeMode);
                        const subMode = (typeof swipeSubMode !== 'undefined') ? swipeSubMode : 'split';
                        const topSwipeContainer = (isSwipeActive && topSwipeLayer && topSwipeLayer.getContainer) ? topSwipeLayer.getContainer() : null;

                        let cQ1 = null, cQ2 = null, cQ3 = null, cQ4 = null;
                        if (isSwipeActive && subMode === 'quad') {
                            const vis = geeLayers.filter(l => l.shown && map.hasLayer(l.layer));
                            if (vis[0] && vis[0].layer.getContainer) cQ1 = vis[0].layer.getContainer();
                            if (vis[1] && vis[1].layer.getContainer) cQ2 = vis[1].layer.getContainer();
                            if (vis[2] && vis[2].layer.getContainer) cQ3 = vis[2].layer.getContainer();
                            if (vis[3] && vis[3].layer.getContainer) cQ4 = vis[3].layer.getContainer();
                        }

                        for (const img of tiles) {
                            if (!img.complete || img.naturalWidth === 0) continue;
                            const style = window.getComputedStyle(img);
                            if (style.display === 'none' || style.visibility === 'hidden') continue;
                            const parentLayer = img.closest ? img.closest('.leaflet-layer') : null;
                            const parentOp = parentLayer ? parseFloat(window.getComputedStyle(parentLayer).opacity || '1') : 1;
                            const opacity = parseFloat(style.opacity || '1') * parentOp;
                            if (opacity <= 0) continue;

                            const rect = img.getBoundingClientRect();
                            const x = rect.left - mapRect.left;
                            const y = rect.top - mapRect.top;
                            const w = rect.width;
                            const h = rect.height;

                            if (x + w < 0 || x > width || y + h < 0 || y > height) continue;

                            ctx.save();
                            if (isSwipeActive) {
                                if (subMode === 'split' && topSwipeContainer && topSwipeContainer.contains(img)) {
                                    ctx.beginPath();
                                    if (swipeOrientation === 'vertical') {
                                        ctx.rect(0, 0, width * (swipeValue / 100), height);
                                    } else {
                                        ctx.rect(0, 0, width, height * (swipeValue / 100));
                                    }
                                    ctx.clip();
                                } else if (subMode === 'spyglass' && topSwipeContainer && topSwipeContainer.contains(img)) {
                                    ctx.beginPath();
                                    ctx.arc(spyX, spyY, spyRadius, 0, 2 * Math.PI);
                                    ctx.clip();
                                } else if (subMode === 'quad') {
                                    const qX = Math.max(10, Math.min(width - 10, quadX));
                                    const qY = Math.max(10, Math.min(height - 10, quadY));
                                    if (cQ1 && cQ1.contains(img)) {
                                        ctx.beginPath();
                                        ctx.rect(0, 0, qX, qY);
                                        ctx.clip();
                                    } else if (cQ2 && cQ2.contains(img)) {
                                        ctx.beginPath();
                                        ctx.rect(qX, 0, width - qX, qY);
                                        ctx.clip();
                                    } else if (cQ3 && cQ3.contains(img)) {
                                        ctx.beginPath();
                                        ctx.rect(0, qY, qX, height - qY);
                                        ctx.clip();
                                    } else if (cQ4 && cQ4.contains(img)) {
                                        ctx.beginPath();
                                        ctx.rect(qX, qY, width - qX, height - qY);
                                        ctx.clip();
                                    }
                                }
                            }
                            ctx.globalAlpha = opacity;
                            try {
                                ctx.drawImage(img, x, y, w, h);
                            } catch (e) {
                                console.warn('Tile capture warning:', e);
                            }
                            ctx.restore();
                        }

                        // If Swipe Mode is active, render the divider / spyglass / quad overlay on the snapshot
                        if (isSwipeActive) {
                            if (subMode === 'split' && topSwipeContainer) {
                                ctx.save();
                                ctx.strokeStyle = '#ffffff';
                                ctx.lineWidth = 2.5;
                                ctx.shadowColor = 'rgba(0,0,0,0.6)';
                                ctx.shadowBlur = 6;
                                ctx.beginPath();
                                if (swipeOrientation === 'vertical') {
                                    const sx = width * (swipeValue / 100);
                                    ctx.moveTo(sx, 0);
                                    ctx.lineTo(sx, height);
                                } else {
                                    const sy = height * (swipeValue / 100);
                                    ctx.moveTo(0, sy);
                                    ctx.lineTo(width, sy);
                                }
                                ctx.stroke();
                                ctx.restore();
                            } else if (subMode === 'spyglass' && topSwipeContainer) {
                                ctx.save();
                                ctx.strokeStyle = '#4ec9b0';
                                ctx.lineWidth = 3;
                                ctx.shadowColor = 'rgba(0,0,0,0.7)';
                                ctx.shadowBlur = 8;
                                ctx.beginPath();
                                ctx.arc(spyX, spyY, spyRadius, 0, 2 * Math.PI);
                                ctx.stroke();
                                ctx.restore();
                            } else if (subMode === 'quad') {
                                const qX = Math.max(10, Math.min(width - 10, quadX));
                                const qY = Math.max(10, Math.min(height - 10, quadY));
                                ctx.save();
                                ctx.strokeStyle = '#ffffff';
                                ctx.lineWidth = 2.5;
                                ctx.shadowColor = 'rgba(0,0,0,0.6)';
                                ctx.shadowBlur = 6;
                                ctx.beginPath();
                                ctx.moveTo(qX, 0); ctx.lineTo(qX, height);
                                ctx.moveTo(0, qY); ctx.lineTo(width, qY);
                                ctx.stroke();
                                // Central handle indicator
                                ctx.fillStyle = '#4ec9b0';
                                ctx.beginPath();
                                ctx.arc(qX, qY, 6, 0, 2 * Math.PI);
                                ctx.fill();
                                ctx.restore();
                            }
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

                            // 3. Markers & Pins (leaflet-marker-pane) + Ruler Segment Labels
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

                                const segBadge = marker.querySelector ? marker.querySelector('.gee-ruler-seg-label') : null;
                                if (segBadge && segBadge.textContent) {
                                    const bRect = segBadge.getBoundingClientRect();
                                    const bx = bRect.left - mapRect.left;
                                    const by = bRect.top - mapRect.top;
                                    ctx.save();
                                    ctx.font = '600 10px "JetBrains Mono", Consolas, monospace';
                                    const txt = segBadge.textContent;
                                    const tw = ctx.measureText(txt).width + 12;
                                    const th = 16;
                                    ctx.fillStyle = 'rgba(15, 15, 18, 0.9)';
                                    ctx.strokeStyle = 'rgba(255, 235, 59, 0.6)';
                                    ctx.lineWidth = 1;
                                    ctx.beginPath();
                                    if (ctx.roundRect) ctx.roundRect(bx, by, tw, th, 8);
                                    else ctx.rect(bx, by, tw, th);
                                    ctx.fill();
                                    ctx.stroke();
                                    ctx.fillStyle = '#ffeb3b';
                                    ctx.textBaseline = 'middle';
                                    ctx.fillText(txt, bx + 6, by + th / 2);
                                    ctx.restore();
                                    continue;
                                }

                                ctx.save();
                                ctx.globalAlpha = opacity;
                                try {
                                    if (marker instanceof HTMLImageElement && marker.src && marker.src.startsWith('data:')) {
                                        ctx.drawImage(marker, x, y, rect.width, rect.height);
                                    } else if (marker instanceof HTMLImageElement) {
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

                        // Compute Graticule Grid lines (Lat/Lon)
                        const bounds = map.getBounds();
                        const south = bounds.getSouth();
                        const north = bounds.getNorth();
                        const west = bounds.getWest();
                        const east = bounds.getEast();
                        const latStep = computeNiceGridStep(Math.abs(north - south));
                        const lngStep = computeNiceGridStep(Math.abs(east - west));
                        const latTicks = [];
                        const lngTicks = [];

                        const firstLat = Math.ceil(south / latStep) * latStep;
                        for (let lat = firstLat; lat <= north; lat += latStep) {
                            const pt = map.latLngToContainerPoint([lat, (west + east) / 2]);
                            if (pt.y >= 24 && pt.y <= height - 24) {
                                latTicks.push({ deg: lat, y: pt.y, label: formatDMS(lat, true) });
                            }
                        }
                        const firstLng = Math.ceil(west / lngStep) * lngStep;
                        for (let lng = firstLng; lng <= east; lng += lngStep) {
                            const pt = map.latLngToContainerPoint([(south + north) / 2, lng]);
                            if (pt.x >= 32 && pt.x <= width - 32) {
                                lngTicks.push({ deg: lng, x: pt.x, label: formatDMS(lng, false) });
                            }
                        }

                        if (includeGrid) {
                            ctx.save();
                            ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
                            ctx.lineWidth = 0.8;
                            ctx.setLineDash([4, 4]);
                            for (const lt of latTicks) {
                                ctx.beginPath();
                                ctx.moveTo(0, lt.y);
                                ctx.lineTo(width, lt.y);
                                ctx.stroke();
                            }
                            for (const lnt of lngTicks) {
                                ctx.beginPath();
                                ctx.moveTo(lnt.x, 0);
                                ctx.lineTo(lnt.x, height);
                                ctx.stroke();
                            }
                            ctx.setLineDash([]);
                            // If not in full plate layout mode, draw compact coordinate labels along inside edges
                            if (!includeLayout) {
                                ctx.font = '600 9px "JetBrains Mono", Consolas, monospace';
                                for (const lt of latTicks) {
                                    const tw = ctx.measureText(lt.label).width + 8;
                                    ctx.fillStyle = 'rgba(15, 15, 18, 0.78)';
                                    ctx.fillRect(4, lt.y - 7, tw, 14);
                                    ctx.fillStyle = '#e4e4e7';
                                    ctx.textBaseline = 'middle';
                                    ctx.textAlign = 'left';
                                    ctx.fillText(lt.label, 8, lt.y);
                                }
                                for (const lnt of lngTicks) {
                                    const tw = ctx.measureText(lnt.label).width + 8;
                                    ctx.fillStyle = 'rgba(15, 15, 18, 0.78)';
                                    ctx.fillRect(lnt.x - tw / 2, 4, tw, 14);
                                    ctx.fillStyle = '#e4e4e7';
                                    ctx.textBaseline = 'middle';
                                    ctx.textAlign = 'center';
                                    ctx.fillText(lnt.label, lnt.x, 11);
                                }
                            }
                            ctx.restore();
                        }

                        const scaleMetrics = computeScaleBarMetrics(width);
                        const activeLegends = includeLegend ? collectActiveLegends(includeDrawings) : [];
                        const isLightPlate = includeLayout && mapTheme === 'light';

                        const center = map.getCenter();
                        const zoom = map.getZoom();
                        const utmStr = getUtmZoneLabel(center.lat, center.lng);

                        if (!includeLayout) {
                            // Standard Screenshot Export (No Frame) -> Stamp overlays directly on canvas
                            if (includeNorth) {
                                drawNorthArrow(ctx, width - 38, 42, 34, false);
                            }
                            if (includeLegend && activeLegends.length > 0) {
                                drawLegendOverlay(ctx, width - 252, height - 14, activeLegends, false, customLegendTitle);
                            }
                            if (includeScaleBar) {
                                const sbY = includeCoords ? (height - 14 - 24 - 44) : (height - 14 - 38);
                                drawCartographicScaleBar(ctx, 14, sbY, scaleMetrics, false);
                            }
                            if (includeCoords) {
                                const crsBadge = customCrs ? customCrs : utmStr;
                                const metaSuffix = customMeta ? (' | ' + customMeta) : (' | 1:' + scaleMetrics.scaleRatio.toLocaleString());
                                const brandPrefix = includeBrand ? 'GEE IDE Pro | ' : ((mapAuthor && mapAuthor !== 'Elaboración Propia') ? (mapAuthor + ' | ') : '');
                                const text = brandPrefix + 'Lat: ' + center.lat.toFixed(4) + ', Lng: ' + center.lng.toFixed(4) + ' (' + crsBadge + ') | Zoom: ' + zoom + metaSuffix;

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
                                if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
                                else ctx.rect(badgeX, badgeY, badgeW, badgeH);
                                ctx.fill();
                                ctx.stroke();

                                ctx.fillStyle = '#4ec9b0';
                                ctx.fillText(text, badgeX + 12, badgeY + 16);
                                ctx.restore();
                            }
                            return canvas;
                        }

                        // --- PRO CARTOGRAPHIC PLATE COMPOSER (LÁMINA CARTOGRÁFICA 300 DPI) ---
                        // Dedicated margins: 82px top (for header title & subtitle) and 82px bottom (for title block & footer)
                        const padTop = 82;
                        const padSide = 48;
                        const tbH = 46;
                        const tbMargin = 18;
                        const padBottom = tbH + tbMargin + 16; // 80px total bottom area

                        let mapFrameW = width;
                        let mapFrameH = height;
                        let plateW = mapFrameW + padSide * 2;
                        let plateH = mapFrameH + padTop + padBottom;

                        // If user selected an ISO Paper Format (A4, A3, A2, A1) or explicit Orientation (Landscape/Portrait),
                        // calculate plateW and plateH to match the target aspect ratio
                        const wantsIso = (paperSize && paperSize !== 'auto') || (orientation !== 'auto');
                        if (wantsIso) {
                            const isLandscape = (orientation === 'landscape') ? true : (orientation === 'portrait') ? false : (plateW >= plateH);
                            const targetRatio = isLandscape ? (297 / 210) : (210 / 297);
                            if (isLandscape) {
                                plateH = Math.round(plateW / targetRatio);
                                if (plateH < 540) {
                                    plateH = 540;
                                    plateW = Math.round(plateH * targetRatio);
                                }
                            } else {
                                plateH = Math.round(plateW / targetRatio);
                                if (plateH < 720) {
                                    plateH = 720;
                                    plateW = Math.round(plateH * targetRatio);
                                }
                            }
                        }

                        // Fit map frame inside sheet margins preserving exact map canvas aspect ratio (ZERO extent cropping!)
                        const maxMapW = plateW - padSide * 2;
                        const maxMapH = plateH - padTop - padBottom;
                        const mapRatio = canvas.width / canvas.height;
                        mapFrameW = maxMapW;
                        mapFrameH = Math.round(mapFrameW / mapRatio);
                        if (mapFrameH > maxMapH) {
                            mapFrameH = maxMapH;
                            mapFrameW = Math.round(mapFrameH * mapRatio);
                        }
                        const mapX = padSide + Math.round((maxMapW - mapFrameW) / 2);
                        const mapY = padTop + Math.round((maxMapH - mapFrameH) / 2);

                        const plateCanvas = document.createElement('canvas');
                        plateCanvas.width = plateW * scale;
                        plateCanvas.height = plateH * scale;
                        const pctx = plateCanvas.getContext('2d');
                        if (!pctx) return canvas;
                        pctx.scale(scale, scale);

                        const bgCol = isLightPlate ? '#ffffff' : '#121316';
                        const fgCol = isLightPlate ? '#111827' : '#f3f4f6';
                        const subCol = isLightPlate ? '#4b5563' : '#9ca3af';
                        const borderCol = isLightPlate ? '#18181b' : '#4ec9b0';
                        const zebraAltCol = isLightPlate ? '#ffffff' : '#1e2028';
                        const cardBgCol = isLightPlate ? '#f8fafc' : '#1a1b20';

                        // 1. Plate Background & Outer Technical Border
                        pctx.fillStyle = bgCol;
                        pctx.fillRect(0, 0, plateW, plateH);
                        pctx.strokeStyle = borderCol;
                        pctx.lineWidth = 2;
                        pctx.strokeRect(10, 10, plateW - 20, plateH - 20);
                        pctx.lineWidth = 0.7;
                        pctx.strokeRect(13, 13, plateW - 26, plateH - 26);

                        // 2. Top Header Banner (positioned inside top header zone, cleanly above the DMS coordinate band)
                        const headerTopY = Math.max(18, padTop - 64);
                        pctx.fillStyle = fgCol;
                        pctx.font = '800 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        pctx.textAlign = 'left';
                        pctx.textBaseline = 'top';
                        pctx.fillText(mapTitle.toUpperCase(), padSide, headerTopY);

                        const baseName = (baseMaps[currentBaseKey] && baseMaps[currentBaseKey].name) ? baseMaps[currentBaseKey].name.split(' (')[0] : 'Satellite';
                        const subtitleStr = customSubtitle || ('Sistema de Información Geográfica y Teledetección Espacial • Mapa Base: ' + baseName);
                        pctx.fillStyle = subCol;
                        pctx.font = '500 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        pctx.fillText(subtitleStr, padSide, headerTopY + 22);

                        const crsHeaderStr = customCrs || (utmStr + ' • WGS 84 (EPSG:4326)');
                        pctx.fillStyle = isLightPlate ? '#0f766e' : '#4ec9b0';
                        pctx.font = '700 10.5px "JetBrains Mono", Consolas, monospace';
                        pctx.textAlign = 'right';
                        pctx.fillText(crsHeaderStr, plateW - padSide, headerTopY + 3);

                        const scaleHeaderStr = customMeta || ('Escala aprox. 1 : ' + scaleMetrics.scaleRatio.toLocaleString() + (paperSize !== 'auto' ? ' • Formato ' + paperSize : ''));
                        pctx.fillStyle = subCol;
                        pctx.font = '500 10px "JetBrains Mono", Consolas, monospace';
                        pctx.fillText(scaleHeaderStr, plateW - padSide, headerTopY + 22);

                        // Clean horizontal divider between Top Header Banner and DMS Coordinate Band
                        const dividerY = padTop - 26;
                        pctx.strokeStyle = isLightPlate ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)';
                        pctx.lineWidth = 0.8;
                        pctx.beginPath();
                        pctx.moveTo(padSide - 6, dividerY);
                        pctx.lineTo(plateW - padSide + 6, dividerY);
                        pctx.stroke();

                        // 3. Draw Captured Map Canvas inside Frame (Contain-Fit: ZERO extent cropping, 100% study area preserved!)
                        pctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, mapX, mapY, mapFrameW, mapFrameH);

                        // 3.1 Draw Map Overlays directly on pctx inside frame bounds (never cropped or sliced!)
                        if (includeNorth) {
                            drawNorthArrow(pctx, mapX + mapFrameW - 38, mapY + 42, 34, isLightPlate);
                        }
                        if (includeScaleBar) {
                            drawCartographicScaleBar(pctx, mapX + 16, mapY + mapFrameH - 16 - 38, scaleMetrics, isLightPlate);
                        }
                        if (includeLegend && activeLegends.length > 0) {
                            drawLegendOverlay(pctx, mapX + mapFrameW - 252, mapY + mapFrameH - 16, activeLegends, isLightPlate, customLegendTitle);
                        }

                        // 4. Zebra Cartographic Neatline Frame & Graduated DMS Coordinate Ticks
                        const frameThick = 6;
                        pctx.strokeStyle = borderCol;
                        pctx.lineWidth = 1.5;
                        pctx.strokeRect(mapX, mapY, mapFrameW, mapFrameH);
                        pctx.strokeRect(mapX - frameThick, mapY - frameThick, mapFrameW + frameThick * 2, mapFrameH + frameThick * 2);

                        // Zebra segments along horizontal edges
                        const xStops = [0, ...lngTicks.map(t => Math.round((t.x / width) * mapFrameW)), mapFrameW];
                        for (let i = 0; i < xStops.length - 1; i++) {
                            const sx = mapX + xStops[i];
                            const sw = xStops[i + 1] - xStops[i];
                            pctx.fillStyle = (i % 2 === 0) ? borderCol : zebraAltCol;
                            pctx.fillRect(sx, mapY - frameThick, sw, frameThick);
                            pctx.strokeRect(sx, mapY - frameThick, sw, frameThick);
                            pctx.fillRect(sx, mapY + mapFrameH, sw, frameThick);
                            pctx.strokeRect(sx, mapY + mapFrameH, sw, frameThick);
                        }
                        // Zebra segments along vertical edges
                        const yStops = [0, ...latTicks.map(t => Math.round((t.y / height) * mapFrameH)), mapFrameH];
                        for (let i = 0; i < yStops.length - 1; i++) {
                            const sy = mapY + yStops[i];
                            const sh = yStops[i + 1] - yStops[i];
                            pctx.fillStyle = (i % 2 === 0) ? borderCol : zebraAltCol;
                            pctx.fillRect(mapX - frameThick, sy, frameThick, sh);
                            pctx.strokeRect(mapX - frameThick, sy, frameThick, sh);
                            pctx.fillRect(mapX + mapFrameW, sy, frameThick, sh);
                            pctx.strokeRect(mapX + mapFrameW, sy, frameThick, sh);
                        }

                        // Exterior DMS Labels (Top, Bottom, Left, Right)
                        pctx.fillStyle = fgCol;
                        pctx.font = '600 9px "JetBrains Mono", Consolas, monospace';
                        for (const lnt of lngTicks) {
                            const gx = mapX + Math.round((lnt.x / width) * mapFrameW);
                            pctx.textAlign = 'center';
                            pctx.textBaseline = 'bottom';
                            pctx.fillText(lnt.label, gx, mapY - frameThick - 4);
                            pctx.textBaseline = 'top';
                            pctx.fillText(lnt.label, gx, mapY + mapFrameH + frameThick + 4);
                        }
                        for (const lt of latTicks) {
                            const gy = mapY + Math.round((lt.y / height) * mapFrameH);
                            // Left rotated label
                            pctx.save();
                            pctx.translate(mapX - frameThick - 5, gy);
                            pctx.rotate(-Math.PI / 2);
                            pctx.textAlign = 'center';
                            pctx.textBaseline = 'bottom';
                            pctx.fillText(lt.label, 0, 0);
                            pctx.restore();
                            // Right rotated label
                            pctx.save();
                            pctx.translate(mapX + mapFrameW + frameThick + 5, gy);
                            pctx.rotate(Math.PI / 2);
                            pctx.textAlign = 'center';
                            pctx.textBaseline = 'bottom';
                            pctx.fillText(lt.label, 0, 0);
                            pctx.restore();
                        }

                        // 5. Bottom Technical Title Block (Membrete Oficial SIG) — docked right below the map frame
                        const tbY = mapY + mapFrameH + tbMargin;
                        pctx.fillStyle = cardBgCol;
                        pctx.strokeStyle = isLightPlate ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.2)';
                        pctx.lineWidth = 1;
                        pctx.fillRect(mapX, tbY, mapFrameW, tbH);
                        pctx.strokeRect(mapX, tbY, mapFrameW, tbH);

                        const col1W = mapFrameW * 0.34;
                        const col2W = mapFrameW * 0.36;
                        pctx.beginPath();
                        pctx.moveTo(mapX + col1W, tbY);
                        pctx.lineTo(mapX + col1W, tbY + tbH);
                        pctx.moveTo(mapX + col1W + col2W, tbY);
                        pctx.lineTo(mapX + col1W + col2W, tbY + tbH);
                        pctx.stroke();

                        // Cell 1: Author / Institution & Software
                        pctx.textAlign = 'left';
                        pctx.textBaseline = 'top';
                        pctx.fillStyle = subCol;
                        pctx.font = '700 8.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        pctx.fillText('AUTOR / INSTITUCIÓN', mapX + 10, tbY + 6);
                        pctx.fillStyle = fgCol;
                        pctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        pctx.fillText(mapAuthor, mapX + 10, tbY + 18);
                        pctx.fillStyle = subCol;
                        pctx.font = '500 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        pctx.fillText(customInst, mapX + 10, tbY + 32);

                        // Cell 2: Spatial Parameters & Bounding Box (Extent)
                        const c2X = mapX + col1W + 10;
                        pctx.fillStyle = subCol;
                        pctx.font = '700 8.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        pctx.fillText('EXTENSIÓN Y PARÁMETROS CARTOGRÁFICOS', c2X, tbY + 6);
                        pctx.fillStyle = fgCol;
                        pctx.font = '600 9px "JetBrains Mono", Consolas, monospace';
                        pctx.fillText('N: ' + formatDMS(north, true) + ' | S: ' + formatDMS(south, true) + ' (Z:' + zoom + ')', c2X, tbY + 19);
                        pctx.fillStyle = subCol;
                        pctx.font = '500 8.5px "JetBrains Mono", Consolas, monospace';
                        pctx.fillText('W: ' + formatDMS(west, false) + ' | E: ' + formatDMS(east, false) + ' • ' + (customCrs || (utmStr + ' / WGS 84')), c2X, tbY + 32);

                        // Cell 3: Date, Paper Format, Resolution & Active Layers Count
                        const c3X = mapX + col1W + col2W + 10;
                        const now = new Date();
                        const dateIso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
                        pctx.fillStyle = subCol;
                        pctx.font = '700 8.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                        pctx.fillText('METADATOS DE EDICIÓN', c3X, tbY + 6);
                        pctx.fillStyle = fgCol;
                        pctx.font = '600 9.5px "JetBrains Mono", Consolas, monospace';
                        pctx.fillText(customMeta ? customMeta : ('Fecha: ' + dateIso), c3X, tbY + 19);
                        pctx.fillStyle = subCol;
                        pctx.font = '500 9px "JetBrains Mono", Consolas, monospace';
                        const orientLabel = (orientation === 'landscape') ? 'Horiz' : (orientation === 'portrait') ? 'Vert' : '';
                        const orientTag = orientLabel ? (orientLabel + ' • ') : '';
                        const paperTag = (paperSize && paperSize !== 'auto') ? (paperSize + ' • ') : '';
                        pctx.fillText(paperTag + orientTag + scale + 'x (' + (scale >= 4 ? '300 DPI Print' : (scale * 96) + ' DPI') + ') • Capas: ' + activeLegends.length, c3X, tbY + 32);

                        return plateCanvas;
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
                            showHud('📸 Generating Cartographic HD image...');
                            const canvas = await captureMapToCanvas();
                            const now = new Date();
                            const pad = (n) => String(n).padStart(2, '0');
                            const isPlate = document.getElementById('snapOptLayout')?.checked;
                            const snapFormat = document.getElementById('snapFormatSelect')?.value || 'png';
                            const paperSize = document.getElementById('snapPaperSelect')?.value || 'auto';
                            const orientation = document.getElementById('snapOrientationSelect')?.value || 'auto';
                            const ext = (snapFormat === 'jpg' || snapFormat === 'pdf') ? snapFormat : 'png';
                            const prefix = isPlate ? 'gee_lamina_pro_' : 'gee_snapshot_';
                            const paperSlug = (paperSize !== 'auto') ? (paperSize + '_') : '';
                            const orientSlug = (orientation !== 'auto') ? (orientation + '_') : '';
                            const filename = prefix + paperSlug + orientSlug + now.getFullYear() + 
                                             pad(now.getMonth() + 1) + 
                                             pad(now.getDate()) + '_' + 
                                             pad(now.getHours()) + 
                                             pad(now.getMinutes()) + 
                                             pad(now.getSeconds()) + '.' + ext;

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
                                            filename: filename.replace(/\.(jpg|pdf)$/i, '.png'),
                                            format: 'png',
                                            paperSize: paperSize,
                                            orientation: orientation,
                                            width: canvas.width,
                                            height: canvas.height,
                                            promptSaveAs: false
                                        });
                                        showHud('💾 Saved to Screenshots/ (clipboard restricted)');
                                    }
                                }, 'image/png');
                            } else {
                                const useJpeg = (ext === 'jpg' || ext === 'pdf');
                                const dataUrl = useJpeg ? canvas.toDataURL('image/jpeg', 0.95) : canvas.toDataURL('image/png');
                                const base64 = dataUrl.split(',')[1];
                                vscode.postMessage({
                                    command: 'saveSnapshot',
                                    data: base64,
                                    filename: filename,
                                    format: ext,
                                    paperSize: paperSize,
                                    orientation: orientation,
                                    width: canvas.width,
                                    height: canvas.height,
                                    promptSaveAs: target === 'saveAs'
                                });
                                showHud(target === 'saveAs' ? ('📁 Opening save dialog (' + ext.toUpperCase() + ')...') : ('💾 Saving ' + ext.toUpperCase() + ' to Screenshots/...'));
                            }
                        } catch (err) {
                            console.error('Error capturing map:', err);
                            showHud('❌ Error capturing map: ' + (err.message || err));
                        }
                    };

                    // --- SWIPE PRO TOOL LOGIC (CORTINA 1v1, LUPA RAYOS-X SHIFT, QUAD 2x2) ---
                    let lastMouseX = window.innerWidth / 2;
                    let lastMouseY = window.innerHeight / 2;

                    window.setSwipeSubMode = function(mode) {
                        if (mode === 'quad') {
                            showHud('🔒 Quad-Swipe 2x2 disponible en GEE IDE Pro');
                            return;
                        }
                        if (!['split'].includes(mode)) return;
                        swipeSubMode = mode;

                        // Clean all layer clip and mask styles before switching
                        geeLayers.forEach(l => {
                            if (l && l.layer && l.layer.getContainer && l.layer.getContainer()) {
                                const c = l.layer.getContainer();
                                c.style.clip = '';
                                c.style.clipPath = '';
                                c.style.webkitMask = '';
                                c.style.mask = '';
                            }
                        });

                        updateSwipeClip();
                        updateLayerManagerUI();
                        if (mode === 'split') {
                            showHud('🔀 Cortina 1v1: Mantén Control para Swipe horizontal');
                        }
                    };

                    function updateSwipeClip() {
                        if (!swipeMode) return;
                        const divider = document.getElementById('swipe-divider');
                        const spyLens = document.getElementById('spyglass-lens');
                        const quadBox = document.getElementById('quad-crosshair');
                        const icon = document.getElementById('swipe-icon');

                        const visible = [];
                        geeLayers.forEach((l, idx) => {
                            if (l.shown && map.hasLayer(l.layer)) {
                                visible.push({ item: l, idx: idx, layerNum: idx + 1 });
                            }
                        });
                        if (visible.length === 0) return;

                        // 1. Dynamic Shift X-Ray Spyglass Mode (Peek into background layer)
                        if (isShiftSpyActive && swipeSubMode === 'split') {
                            if (divider) divider.style.display = 'none';
                            if (quadBox) quadBox.style.display = 'none';
                            if (spyLens) {
                                spyLens.style.display = 'block';
                                spyLens.style.left = spyX + 'px';
                                spyLens.style.top = spyY + 'px';
                                spyLens.style.width = (spyRadius * 2) + 'px';
                                spyLens.style.height = (spyRadius * 2) + 'px';
                                const badge = document.getElementById('spyglass-lens-badge');
                                if (badge) {
                                    if (isSpyMouseDown) {
                                        badge.textContent = '⚡ Rayos-X (Capa Inferior)';
                                        badge.style.borderColor = '#ff4d4f';
                                        badge.style.color = '#ff4d4f';
                                        spyLens.style.borderColor = '#ff4d4f';
                                    } else {
                                        badge.textContent = '🔍 Lupa (Mantén Clic para Rayos-X)';
                                        badge.style.borderColor = '#4ec9b0';
                                        badge.style.color = '#4ec9b0';
                                        spyLens.style.borderColor = '#4ec9b0';
                                    }
                                }
                            }

                            if (topSwipeLayer && topSwipeLayer.getContainer && topSwipeLayer.getContainer()) {
                                const container = topSwipeLayer.getContainer();
                                container.style.clip = '';
                                container.style.webkitMask = '';
                                container.style.mask = '';
                                if (isSpyMouseDown) {
                                    const mapSize = map.getSize();
                                    const nw = map.containerPointToLayerPoint([-800, -800]);
                                    const se = map.containerPointToLayerPoint([mapSize.x + 800, mapSize.y + 800]);
                                    const lp = map.containerPointToLayerPoint([spyX, spyY]);

                                    const pts = [
                                        'evenodd',
                                        nw.x + 'px ' + nw.y + 'px',
                                        se.x + 'px ' + nw.y + 'px',
                                        se.x + 'px ' + se.y + 'px',
                                        nw.x + 'px ' + se.y + 'px',
                                        nw.x + 'px ' + nw.y + 'px'
                                    ];
                                    for (let i = 0; i <= 32; i++) {
                                        const angle = (i / 32) * Math.PI * 2;
                                        const cx = Math.round((lp.x + spyRadius * Math.cos(angle)) * 10) / 10;
                                        const cy = Math.round((lp.y + spyRadius * Math.sin(angle)) * 10) / 10;
                                        pts.push(cx + 'px ' + cy + 'px');
                                    }
                                    pts.push(nw.x + 'px ' + nw.y + 'px');
                                    container.style.clipPath = 'polygon(' + pts.join(', ') + ')';

                                    document.body.style.cursor = 'none';
                                    const mapEl = document.getElementById('map');
                                    if (mapEl) mapEl.style.cursor = 'none';
                                } else {
                                    container.style.clipPath = '';
                                    document.body.style.cursor = '';
                                    const mapEl = document.getElementById('map');
                                    if (mapEl) mapEl.style.cursor = '';
                                }
                            }
                            return;
                        }

                        // 2. Standard Split Mode (1v1 Divider)
                        if (swipeSubMode === 'split') {
                            if (divider) divider.style.display = 'block';
                            if (spyLens) spyLens.style.display = 'none';
                            if (quadBox) quadBox.style.display = 'none';
                            document.body.style.cursor = '';
                            const mapEl = document.getElementById('map');
                            if (mapEl) mapEl.style.cursor = '';

                            // Ensure any residual clipPath from quad mode on secondary layers is cleanly wiped
                            geeLayers.forEach(l => {
                                if (l && l.layer !== topSwipeLayer && l.layer.getContainer && l.layer.getContainer()) {
                                    const c = l.layer.getContainer();
                                    c.style.clip = '';
                                    c.style.clipPath = '';
                                    c.style.webkitMask = '';
                                    c.style.mask = '';
                                }
                            });

                            if (!topSwipeLayer || !topSwipeLayer.getContainer()) return;
                            const container = topSwipeLayer.getContainer();
                            container.style.webkitMask = '';
                            container.style.mask = '';

                            const mapSize = map.getSize();
                            const nw = map.containerPointToLayerPoint([0, 0]);
                            const se = map.containerPointToLayerPoint([mapSize.x, mapSize.y]);
                            
                            let clipX = mapSize.x * (swipeValue / 100);
                            let clipY = mapSize.y * (swipeValue / 100);
                            
                            let layerClipX = map.containerPointToLayerPoint([clipX, 0]).x;
                            let layerClipY = map.containerPointToLayerPoint([0, clipY]).y;

                            if (swipeOrientation === 'vertical') {
                                container.style.clip = 'rect(' + nw.y + 'px, ' + layerClipX + 'px, ' + se.y + 'px, ' + nw.x + 'px)';
                                container.style.clipPath = '';
                                if (divider) {
                                    divider.style.left = swipeValue + '%';
                                    divider.style.top = '0';
                                    divider.style.bottom = '0';
                                    divider.style.width = '2px';
                                    divider.style.height = 'auto';
                                    divider.style.cursor = 'col-resize';
                                }
                                if (icon) icon.style.transform = 'rotate(90deg)';
                            } else {
                                container.style.clip = 'rect(' + nw.y + 'px, ' + se.x + 'px, ' + layerClipY + 'px, ' + nw.x + 'px)';
                                container.style.clipPath = '';
                                if (divider) {
                                    divider.style.top = swipeValue + '%';
                                    divider.style.left = '0';
                                    divider.style.right = '0';
                                    divider.style.height = '2px';
                                    divider.style.width = 'auto';
                                    divider.style.cursor = 'row-resize';
                                }
                                if (icon) icon.style.transform = 'rotate(0deg)';
                            }
                        } else if (swipeSubMode === 'quad') {
                            // 3. Quad-Swipe 2x2 Mode (4 Quadrants)
                            if (divider) divider.style.display = 'none';
                            if (spyLens) spyLens.style.display = 'none';
                            if (quadBox) quadBox.style.display = 'block';
                            document.body.style.cursor = '';
                            const mapEl = document.getElementById('map');
                            if (mapEl) mapEl.style.cursor = '';

                            const lineV = document.getElementById('quad-line-v');
                            const lineH = document.getElementById('quad-line-h');
                            const handle = document.getElementById('quad-handle');
                            if (lineV) lineV.style.left = quadX + 'px';
                            if (lineH) lineH.style.top = quadY + 'px';
                            if (handle) {
                                handle.style.left = quadX + 'px';
                                handle.style.top = quadY + 'px';
                            }

                            const mapSize = map.getSize();
                            const nw = map.containerPointToLayerPoint([0, 0]);
                            const se = map.containerPointToLayerPoint([mapSize.x, mapSize.y]);
                            const lp = map.containerPointToLayerPoint([quadX, quadY]);

                            const polyQ1 = 'polygon(' + nw.x + 'px ' + nw.y + 'px, ' + lp.x + 'px ' + nw.y + 'px, ' + lp.x + 'px ' + lp.y + 'px, ' + nw.x + 'px ' + lp.y + 'px)';
                            const polyQ2 = 'polygon(' + lp.x + 'px ' + nw.y + 'px, ' + se.x + 'px ' + nw.y + 'px, ' + se.x + 'px ' + lp.y + 'px, ' + lp.x + 'px ' + lp.y + 'px)';
                            const polyQ3 = 'polygon(' + nw.x + 'px ' + lp.y + 'px, ' + lp.x + 'px ' + lp.y + 'px, ' + lp.x + 'px ' + se.y + 'px, ' + nw.x + 'px ' + se.y + 'px)';
                            const polyQ4 = 'polygon(' + lp.x + 'px ' + lp.y + 'px, ' + se.x + 'px ' + lp.y + 'px, ' + se.x + 'px ' + se.y + 'px, ' + lp.x + 'px ' + se.y + 'px)';

                            const lQ1 = visible[0] || null;
                            const lQ2 = visible[1] || null;
                            const lQ3 = visible[2] || null;
                            const lQ4 = visible[3] || null;

                            const lbl1 = document.getElementById('quad-label-q1');
                            const lbl2 = document.getElementById('quad-label-q2');
                            const lbl3 = document.getElementById('quad-label-q3');
                            const lbl4 = document.getElementById('quad-label-q4');

                            if (lbl1) {
                                lbl1.textContent = lQ1 ? '[' + lQ1.layerNum + ']' : '[-]';
                                lbl1.title = lQ1 ? 'Cuadrante 1 (Top-Left): Capa [' + lQ1.layerNum + '] ' + lQ1.item.name : 'Cuadrante 1: Sin capa';
                            }
                            if (lbl2) {
                                lbl2.textContent = lQ2 ? '[' + lQ2.layerNum + ']' : '[-]';
                                lbl2.title = lQ2 ? 'Cuadrante 2 (Top-Right): Capa [' + lQ2.layerNum + '] ' + lQ2.item.name : 'Cuadrante 2: Sin capa';
                            }
                            if (lbl3) {
                                lbl3.textContent = lQ3 ? '[' + lQ3.layerNum + ']' : '[-]';
                                lbl3.title = lQ3 ? 'Cuadrante 3 (Bottom-Left): Capa [' + lQ3.layerNum + '] ' + lQ3.item.name : 'Cuadrante 3: Sin capa';
                            }
                            if (lbl4) {
                                if (lQ4) {
                                    lbl4.textContent = '[' + lQ4.layerNum + ']';
                                    lbl4.title = 'Cuadrante 4 (Bottom-Right): Capa [' + lQ4.layerNum + '] ' + lQ4.item.name;
                                    lbl4.style.borderColor = '#c586c0';
                                    lbl4.style.color = '#c586c0';
                                } else {
                                    lbl4.textContent = '[Base]';
                                    lbl4.title = 'Cuadrante 4 (Bottom-Right): Mapa Base de Referencia (Sin 4ta capa)';
                                    lbl4.style.borderColor = 'rgba(255, 255, 255, 0.4)';
                                    lbl4.style.color = '#bbb';
                                }
                            }

                            visible.forEach(v => {
                                if (v.item.layer.getContainer && v.item.layer.getContainer()) {
                                    const c = v.item.layer.getContainer();
                                    c.style.clip = '';
                                    c.style.clipPath = '';
                                    c.style.webkitMask = '';
                                    c.style.mask = '';
                                }
                            });

                            if (visible.length >= 4) {
                                if (visible[0].item.layer.getContainer()) visible[0].item.layer.getContainer().style.clipPath = polyQ1;
                                if (visible[1].item.layer.getContainer()) visible[1].item.layer.getContainer().style.clipPath = polyQ2;
                                if (visible[2].item.layer.getContainer()) visible[2].item.layer.getContainer().style.clipPath = polyQ3;
                                if (visible[3].item.layer.getContainer()) visible[3].item.layer.getContainer().style.clipPath = polyQ4;
                            } else if (visible.length === 3) {
                                if (visible[0].item.layer.getContainer()) visible[0].item.layer.getContainer().style.clipPath = polyQ1;
                                if (visible[1].item.layer.getContainer()) visible[1].item.layer.getContainer().style.clipPath = polyQ2;
                                if (visible[2].item.layer.getContainer()) visible[2].item.layer.getContainer().style.clipPath = polyQ3;
                                // Quadrant 4 reveals raw high-res satellite/vector Basemap!
                            } else if (visible.length === 2) {
                                if (visible[0].item.layer.getContainer()) visible[0].item.layer.getContainer().style.clipPath = polyQ1;
                                if (visible[1].item.layer.getContainer()) visible[1].item.layer.getContainer().style.clipPath = polyQ2;
                            }
                        }
                    }

                    // Map pan & zoom listener: keep geographic anchors locked seamlessly without desync
                    map.on('move', () => {
                        if (swipeMode) {
                            if (quadLatLng && swipeSubMode === 'quad') {
                                const qpt = map.latLngToContainerPoint(quadLatLng);
                                quadX = qpt.x;
                                quadY = qpt.y;
                            }
                            if (spyLatLng && isShiftSpyActive) {
                                const spt = map.latLngToContainerPoint(spyLatLng);
                                spyX = spt.x;
                                spyY = spt.y;
                            }
                            updateSwipeClip();
                        }
                    });
                    map.on('zoom', updateSwipeClip);
                    map.on('resize', updateSwipeClip);

                    window.toggleSwipeMode = function(forceState) {
                        if (typeof forceState === 'boolean') {
                            swipeMode = forceState;
                        } else {
                            swipeMode = !swipeMode;
                        }
                        const divider = document.getElementById('swipe-divider');
                        const spyLens = document.getElementById('spyglass-lens');
                        const quadBox = document.getElementById('quad-crosshair');
                        const btn = document.getElementById('btn-swipe');

                        // Full reset: every activation or deactivation of Swipe Pro starts 100% clean in vertical cortina
                        swipeSubMode = 'split';
                        swipeOrientation = 'vertical';
                        isOrientationLocked = false;
                        isShiftSpyActive = false;
                        isSpyMouseDown = false;
                        isQuadTempActive = false;
                        draggingSwipe = false;
                        draggingQuad = false;

                        if (swipeMode) {
                            updateSwipeCompareIndices();
                            if (!swipeCompareIndices) {
                                swipeMode = false;
                                vscode.postMessage({command: 'webviewError', message: 'Swipe Pro requiere al menos 2 capas GEE visibles en el mapa.'});
                                return;
                            }
                            if (map.doubleClickZoom) {
                                map.doubleClickZoom.disable();
                            }
                            if (btn) {
                                btn.style.background = 'rgba(78, 201, 176, 0.4)';
                                btn.style.borderColor = '#4ec9b0';
                            }
                            swipeValue = 50;
                            spyX = lastMouseX;
                            spyY = lastMouseY;
                            spyLatLng = map.containerPointToLatLng([spyX, spyY]);
                            quadX = window.innerWidth / 2;
                            quadY = window.innerHeight / 2;
                            quadLatLng = map.containerPointToLatLng([quadX, quadY]);

                            if (spyLens) spyLens.style.display = 'none';
                            if (quadBox) quadBox.style.display = 'none';

                            geeLayers.forEach(l => {
                                if (l && l.layer && l.layer.getContainer && l.layer.getContainer()) {
                                    const c = l.layer.getContainer();
                                    c.style.clip = '';
                                    c.style.clipPath = '';
                                    c.style.webkitMask = '';
                                    c.style.mask = '';
                                }
                            });

                            reorderLayersHierarchically();
                            if (topSwipeLayer && topSwipeLayer.bringToFront) {
                                topSwipeLayer.bringToFront();
                            }
                            updateSwipeClip();
                            updateLayerManagerUI();
                            showHud('🔀 Cortina: Control = Horizontal • Arrastra para comparar');
                        } else {
                            if (map.doubleClickZoom) {
                                map.doubleClickZoom.enable();
                            }
                            if (map.dragging && !map.dragging.enabled()) {
                                map.dragging.enable();
                            }
                            document.body.style.cursor = '';
                            const mapEl = document.getElementById('map');
                            if (mapEl) mapEl.style.cursor = '';

                            geeLayers.forEach(l => {
                                if (l && l.layer && l.layer.getContainer && l.layer.getContainer()) {
                                    const c = l.layer.getContainer();
                                    c.style.clip = '';
                                    c.style.clipPath = '';
                                    c.style.webkitMask = '';
                                    c.style.mask = '';
                                }
                            });
                            swipeCompareIndices = null;
                            topSwipeLayer = null;
                            if (divider) divider.style.display = 'none';
                            if (spyLens) spyLens.style.display = 'none';
                            if (quadBox) quadBox.style.display = 'none';
                            if (btn) {
                                btn.style.background = '';
                                btn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                            }
                            reorderLayersHierarchically();
                            updateLayerManagerUI();
                        }
                    };

                    let isOrientationLocked = false;
                    const dividerEl = document.getElementById('swipe-divider');
                    if (dividerEl) {
                        dividerEl.addEventListener('mousedown', (e) => {
                            draggingSwipe = true;
                            e.preventDefault();
                        });

                        dividerEl.addEventListener('dblclick', (e) => {
                            e.stopPropagation();
                            isOrientationLocked = true;
                            swipeOrientation = swipeOrientation === 'vertical' ? 'horizontal' : 'vertical';
                            updateSwipeClip();
                            updateLayerManagerUI();
                            if (swipeOrientation === 'horizontal') {
                                showHud('⇅ Swipe Fijo: Arriba [Arr] vs Abajo [Abj]');
                            } else {
                                showHud('⇄ Swipe Fijo: Izquierda [Izq] vs Derecha [Der]');
                            }
                        });
                    }

                    // Quad-Swipe Crosshair Event Listeners
                    const quadHandleEl = document.getElementById('quad-handle');
                    if (quadHandleEl) {
                        quadHandleEl.addEventListener('mousedown', (e) => {
                            draggingQuad = true;
                            e.preventDefault();
                        });
                    }

                    // Window mousedown for Lupa Rayos-X (Click & Hold reveals layer underneath and hides mouse)
                    window.addEventListener('mousedown', (e) => {
                        if (swipeMode && isShiftSpyActive && e.button === 0) {
                            isSpyMouseDown = true;
                            if (map.dragging && map.dragging.enabled()) {
                                map.dragging.disable();
                            }
                            updateSwipeClip();
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    }, true);

                    // Prevent double-click zooming while in Swipe mode
                    window.addEventListener('dblclick', (e) => {
                        if (swipeMode) {
                            if (e.target && e.target.closest && e.target.closest('#swipe-divider')) {
                                return; // Allow divider double-click to lock orientation
                            }
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    }, true);

                    window.addEventListener('mousemove', (e) => {
                        lastMouseX = e.clientX;
                        lastMouseY = e.clientY;

                        // Auto-recovery if modifier keys were released without triggering keyup (e.g. lost focus or OS drop)
                        if (swipeMode) {
                            if (isShiftSpyActive && !e.shiftKey) {
                                isShiftSpyActive = false;
                                isSpyMouseDown = false;
                                if (map.dragging && !map.dragging.enabled()) map.dragging.enable();
                                document.body.style.cursor = '';
                                const mapEl = document.getElementById('map');
                                if (mapEl) mapEl.style.cursor = '';
                                updateSwipeClip();
                            }
                            if (isQuadTempActive && (!e.shiftKey || !e.ctrlKey) && !draggingQuad) {
                                isQuadTempActive = false;
                                setSwipeSubMode('split');
                                return;
                            }
                        }

                        if (swipeMode && isShiftSpyActive) {
                            spyX = e.clientX;
                            spyY = e.clientY;
                            spyLatLng = map.containerPointToLatLng([spyX, spyY]);
                            updateSwipeClip();
                            return;
                        }
                        if (swipeMode && (isQuadTempActive || draggingQuad)) {
                            quadX = e.clientX;
                            quadY = e.clientY;
                            quadLatLng = map.containerPointToLatLng([quadX, quadY]);
                            updateSwipeClip();
                            return;
                        }
                        if (draggingSwipe) {
                            if (swipeOrientation === 'vertical') {
                                swipeValue = (e.clientX / window.innerWidth) * 100;
                            } else {
                                swipeValue = (e.clientY / window.innerHeight) * 100;
                            }
                            swipeValue = Math.max(0, Math.min(100, swipeValue));
                            updateSwipeClip();
                        }
                    });

                    window.addEventListener('mouseup', (e) => {
                        draggingSwipe = false;
                        draggingQuad = false;
                        if (isSpyMouseDown) {
                            isSpyMouseDown = false;
                            if (map.dragging && !map.dragging.enabled()) {
                                map.dragging.enable();
                            }
                            document.body.style.cursor = '';
                            const mapEl = document.getElementById('map');
                            if (mapEl) mapEl.style.cursor = '';
                            updateSwipeClip();
                            if (e) {
                                e.preventDefault();
                                e.stopPropagation();
                            }
                        }
                    }, true);

                    // Mouse wheel resizing for Lupa Rayos-X
                    window.addEventListener('wheel', (e) => {
                        if (swipeMode && isShiftSpyActive) {
                            e.preventDefault();
                            e.stopPropagation();
                            const delta = Math.sign(e.deltaY) * -15;
                            spyRadius = Math.max(40, Math.min(420, spyRadius + delta));
                            updateSwipeClip();
                        }
                    }, { passive: false });

                    // Strict Keyboard Handlers:
                    // 1. Control Key ONLY toggles horizontal orientation while held (Command/Meta strictly ignored)
                    // 2. Shift Key activates dynamic Lupa (and click activates Rayos-X)
                    // 3. Shift + Control ONLY activates Quad-Swipe 2x2 following cursor (Command/Meta strictly ignored)
                    // 4. Escape Key closes Swipe Pro mode
                    document.addEventListener('keydown', (e) => {
                        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

                        if (swipeMode && e.key === 'Escape') {
                            toggleSwipeMode(false);
                            return;
                        }

                        if (swipeMode) {
                            // Strict requirement: Command / Meta key must NEVER trigger horizontal swipe or Quad mode
                            if (e.metaKey || e.key === 'Meta') return;

                            const isCtrl = e.key === 'Control' || (e.ctrlKey && !e.metaKey);
                            const isShift = e.key === 'Shift' || e.shiftKey;

                            // Shift + Control -> Quad-Swipe 2x2 (Función Pro)
                            if (isShift && isCtrl) {
                                showHud('🔒 Quad-Swipe 2x2 disponible en GEE IDE Pro');
                                return;
                            }

                            if (swipeSubMode === 'split') {
                                if (isCtrl && !isShift) {
                                    if (swipeOrientation !== 'horizontal') {
                                        isOrientationLocked = false;
                                        swipeOrientation = 'horizontal';
                                        updateSwipeClip();
                                        updateLayerManagerUI();
                                        showHud('⇅ Swipe Horizontal (Control presionado)');
                                    }
                                } else if (isShift && !isCtrl) {
                                    // Lupa Rayos-X es función Pro en GEE IDE Free
                                    showHud('🔒 Lupa Rayos-X disponible en GEE IDE Pro');
                                    return;
                                }
                            }
                        }
                    });

                    document.addEventListener('keyup', (e) => {
                        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

                        if (currentPeekIdx !== -1) {
                            if (e.key === 'Shift' || !e.shiftKey) {
                                endPeek();
                            }
                        }

                        if (swipeMode) {
                            const controlReleased = (e.key === 'Control') || !e.ctrlKey;
                            const shiftReleased = (e.key === 'Shift') || !e.shiftKey;

                            // If temp Quad (Shift+Ctrl) is active and ANY of the modifier keys is released
                            if (isQuadTempActive && (controlReleased || shiftReleased)) {
                                isQuadTempActive = false;
                                if (e.shiftKey && e.key !== 'Shift') {
                                    showHud('🔒 Lupa Rayos-X disponible en GEE IDE Pro');
                                    return;
                                } else if (e.ctrlKey && e.key !== 'Control') {
                                    setSwipeSubMode('split');
                                    swipeOrientation = 'horizontal';
                                    updateSwipeClip();
                                    updateLayerManagerUI();
                                    showHud('⇅ Swipe Horizontal');
                                    return;
                                } else {
                                    setSwipeSubMode('split');
                                    swipeOrientation = 'vertical';
                                    updateSwipeClip();
                                    updateLayerManagerUI();
                                    showHud('⇄ Swipe Vertical');
                                    return;
                                }
                            }

                            // Releasing Shift (exit Lupa)
                            if (shiftReleased) {
                                if (isShiftSpyActive) {
                                    isShiftSpyActive = false;
                                    isSpyMouseDown = false;
                                    if (map.dragging && !map.dragging.enabled()) {
                                        map.dragging.enable();
                                    }
                                    document.body.style.cursor = '';
                                    const mapEl = document.getElementById('map');
                                    if (mapEl) mapEl.style.cursor = '';
                                    if (topSwipeLayer && topSwipeLayer.getContainer && topSwipeLayer.getContainer()) {
                                        const c = topSwipeLayer.getContainer();
                                        c.style.clip = '';
                                        c.style.clipPath = '';
                                        c.style.webkitMask = '';
                                        c.style.mask = '';
                                    }
                                    updateSwipeClip();
                                }
                            }

                            // Releasing Control ONLY (revert orientation if not locked, Command strictly ignored)
                            if (controlReleased && !isQuadTempActive && !isShiftSpyActive && swipeSubMode === 'split') {
                                if (swipeOrientation !== 'vertical' && !isOrientationLocked) {
                                    swipeOrientation = 'vertical';
                                    updateSwipeClip();
                                    updateLayerManagerUI();
                                    showHud('⇄ Swipe Vertical');
                                }
                            }
                        }
                    });

                    // Window blur handler to cleanly reset any modifier-held state if user clicks out
                    window.addEventListener('blur', () => {
                        if (swipeMode) {
                            isShiftSpyActive = false;
                            isSpyMouseDown = false;
                            isQuadTempActive = false;
                            draggingSwipe = false;
                            draggingQuad = false;
                            if (map.dragging && !map.dragging.enabled()) map.dragging.enable();
                            document.body.style.cursor = '';
                            const mapEl = document.getElementById('map');
                            if (mapEl) mapEl.style.cursor = '';
                            if (swipeSubMode !== 'split') {
                                setSwipeSubMode('split');
                            } else {
                                updateSwipeClip();
                            }
                        }
                    });
                    // --- END SWIPE PRO TOOL ---

                    // --- QGIS SCALE BAR & RULER PRO TOOL ---
                    L.control.scale({ metric: true, imperial: false, maxWidth: 120, position: 'bottomleft' }).addTo(map);

                    let rulerMode = false;
                    let rulerType = 'line'; // 'line' | 'area'
                    let rulerLines = [[]]; // Array of polylines: Array<Array<L.LatLng>>
                    let isRulerLineFinished = false; // true when current line segment was ended by double-click
                    let rulerPolygons = [[]]; // Array of polygons: Array<Array<L.LatLng>>
                    let isRulerAreaFinished = false; // true when current polygon was closed
                    let lastRulerClickTime = 0;
                    let lastRulerClickLatLng = null;
                    let rulerPoints = []; // Flattened points for compatibility
                    const rulerLayerGroup = L.layerGroup().addTo(map);
                    let rulerMainShape = null;
                    let rulerRubberLine = null;
                    let rulerCursorMarker = null;

                    const DIST_UNITS = [
                        { id: 'auto', label: 'Auto (m / km)' },
                        { id: 'm', label: 'Metros (m)' },
                        { id: 'km', label: 'Kilómetros (km)' },
                        { id: 'mi', label: 'Millas (mi)' },
                        { id: 'ft', label: 'Pies (ft)' },
                        { id: 'nmi', label: 'Millas náuticas (nmi)' }
                    ];
                    const AREA_UNITS = [
                        { id: 'auto', label: 'Auto (m² / ha / km²)' },
                        { id: 'ha', label: 'Hectáreas (ha)' },
                        { id: 'm2', label: 'Metros² (m²)' },
                        { id: 'km2', label: 'Kilómetros² (km²)' },
                        { id: 'ac', label: 'Acres (ac)' }
                    ];

                    function populateRulerUnits() {
                        const sel = document.getElementById('rulerUnitSelect');
                        if (!sel) return;
                        const list = rulerType === 'line' ? DIST_UNITS : AREA_UNITS;
                        sel.innerHTML = list.map(u => '<option value="' + u.id + '">' + u.label + '</option>').join('');
                    }
                    populateRulerUnits();

                    function formatRulerDist(meters, unitOverride) {
                        const sel = document.getElementById('rulerUnitSelect');
                        const u = unitOverride || (sel ? sel.value : 'auto');
                        if (u === 'm') return meters.toFixed(2) + ' m';
                        if (u === 'km') return (meters / 1000).toFixed(2) + ' km';
                        if (u === 'mi') return (meters / 1609.344).toFixed(2) + ' mi';
                        if (u === 'ft') return (meters * 3.28084).toFixed(2) + ' ft';
                        if (u === 'nmi') return (meters / 1852).toFixed(2) + ' nmi';
                        return meters >= 1000
                            ? (meters / 1000).toFixed(2) + ' km'
                            : meters.toFixed(2) + ' m';
                    }

                    function formatRulerArea(sqMeters) {
                        const sel = document.getElementById('rulerUnitSelect');
                        const u = sel ? sel.value : 'auto';
                        if (u === 'm2') return sqMeters.toFixed(2) + ' m²';
                        if (u === 'ha') return (sqMeters / 10000).toFixed(2) + ' ha';
                        if (u === 'km2') return (sqMeters / 1e6).toFixed(2) + ' km²';
                        if (u === 'ac') return (sqMeters / 4046.8564).toFixed(2) + ' ac';
                        if (sqMeters >= 1e6) return (sqMeters / 1e6).toFixed(2) + ' km²';
                        if (sqMeters >= 10000) return (sqMeters / 10000).toFixed(2) + ' ha';
                        return sqMeters.toFixed(2) + ' m²';
                    }

                    function computeBearing(p1, p2) {
                        const toRad = Math.PI / 180;
                        const lat1 = p1.lat * toRad, lat2 = p2.lat * toRad;
                        const dLon = (p2.lng - p1.lng) * toRad;
                        const y = Math.sin(dLon) * Math.cos(lat2);
                        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
                        return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
                    }

                    function compassDir(deg) {
                        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
                        return dirs[Math.round(deg / 45) % 8];
                    }

                    function getRulerVertexLetter(globalIdx) {
                        let letter = '';
                        let n = globalIdx;
                        while (n >= 0) {
                            letter = String.fromCharCode(65 + (n % 26)) + letter;
                            n = Math.floor(n / 26) - 1;
                        }
                        return letter;
                    }

                    // Spherical excess / WGS84 geodesic polygon area (m²)
                    function computeGeodesicArea(latlngs) {
                        const n = latlngs.length;
                        if (n < 3) return 0;
                        const R = 6378137;
                        const toRad = Math.PI / 180;
                        let area = 0;
                        for (let i = 0; i < n; i++) {
                            const p1 = latlngs[i];
                            const p2 = latlngs[(i + 1) % n];
                            area += ((p2.lng - p1.lng) * toRad) * (2 + Math.sin(p1.lat * toRad) + Math.sin(p2.lat * toRad));
                        }
                        return Math.abs(area * R * R / 2.0);
                    }

                    function computeRulerAllLinesData(previewLatLng) {
                        let globalVertexIdx = 0;
                        let totalAllDist = 0;
                        const linesData = [];

                        rulerLines.forEach((linePts, lineIdx) => {
                            let pts = linePts.slice();
                            const isCurrentActiveLine = lineIdx === rulerLines.length - 1 && !isRulerLineFinished;
                            if (isCurrentActiveLine && previewLatLng && rulerMode) {
                                pts = pts.concat([previewLatLng]);
                            }
                            if (pts.length === 0) return;

                            const startLabel = getRulerVertexLetter(globalVertexIdx);
                            const segments = [];
                            let lineDist = 0;

                            for (let i = 1; i < pts.length; i++) {
                                const d = map.distance(pts[i - 1], pts[i]);
                                const brg = computeBearing(pts[i - 1], pts[i]);
                                lineDist += d;
                                const fromLabel = getRulerVertexLetter(globalVertexIdx + i - 1);
                                const toLabel = getRulerVertexLetter(globalVertexIdx + i);
                                segments.push({
                                    idx: i,
                                    from: fromLabel,
                                    to: toLabel,
                                    dist: d,
                                    bearing: brg,
                                    p1: pts[i - 1],
                                    p2: pts[i]
                                });
                            }

                            const endLabel = getRulerVertexLetter(globalVertexIdx + pts.length - 1);
                            totalAllDist += lineDist;

                            linesData.push({
                                lineIdx,
                                pts,
                                startLabel,
                                endLabel,
                                totalDist: lineDist,
                                segments,
                                baseVertexIdx: globalVertexIdx
                            });

                            globalVertexIdx += linePts.length;
                        });

                        return { linesData, totalAllDist, totalVertices: globalVertexIdx };
                    }

                    function computeRulerAreaMetrics(pts) {
                        let totalDist = 0;
                        const segments = [];
                        for (let i = 1; i < pts.length; i++) {
                            const d = map.distance(pts[i - 1], pts[i]);
                            const brg = computeBearing(pts[i - 1], pts[i]);
                            totalDist += d;
                            segments.push({ idx: i, dist: d, total: totalDist, bearing: brg, p1: pts[i - 1], p2: pts[i] });
                        }
                        let perimeter = totalDist;
                        if (rulerType === 'area' && pts.length >= 3) {
                            perimeter += map.distance(pts[pts.length - 1], pts[0]);
                        }
                        const area = rulerType === 'area' && pts.length >= 3 ? computeGeodesicArea(pts) : 0;
                        return { totalDist, perimeter, area, segments };
                    }

                    function computeRulerAllAreasData(previewLatLng) {
                        let globalVertexIdx = 0;
                        let totalAllArea = 0;
                        const polygonsData = [];

                        rulerPolygons.forEach((polyPts, polyIdx) => {
                            let pts = polyPts.slice();
                            const isCurrentActivePoly = polyIdx === rulerPolygons.length - 1 && !isRulerAreaFinished;
                            if (isCurrentActivePoly && previewLatLng && rulerMode) {
                                pts = pts.concat([previewLatLng]);
                            }
                            if (pts.length === 0) return;

                            const startLabel = getRulerVertexLetter(globalVertexIdx);
                            const segments = [];
                            let perimeter = 0;

                            for (let i = 1; i < pts.length; i++) {
                                const d = map.distance(pts[i - 1], pts[i]);
                                const brg = computeBearing(pts[i - 1], pts[i]);
                                perimeter += d;
                                const fromLabel = getRulerVertexLetter(globalVertexIdx + i - 1);
                                const toLabel = getRulerVertexLetter(globalVertexIdx + i);
                                segments.push({
                                    idx: i,
                                    from: fromLabel,
                                    to: toLabel,
                                    dist: d,
                                    bearing: brg,
                                    p1: pts[i - 1],
                                    p2: pts[i]
                                });
                            }
                            if (pts.length >= 3) {
                                const closeDist = map.distance(pts[pts.length - 1], pts[0]);
                                const closeBrg = computeBearing(pts[pts.length - 1], pts[0]);
                                perimeter += closeDist;
                                segments.push({
                                    idx: pts.length,
                                    from: getRulerVertexLetter(globalVertexIdx + pts.length - 1),
                                    to: startLabel,
                                    dist: closeDist,
                                    bearing: closeBrg,
                                    p1: pts[pts.length - 1],
                                    p2: pts[0]
                                });
                            }

                            const area = pts.length >= 3 ? computeGeodesicArea(pts) : 0;
                            const endLabel = getRulerVertexLetter(globalVertexIdx + pts.length - 1);
                            totalAllArea += area;

                            let sumLat = 0, sumLng = 0;
                            pts.forEach(p => { sumLat += p.lat; sumLng += p.lng; });
                            const centerLatLng = [sumLat / pts.length, sumLng / pts.length];

                            polygonsData.push({
                                polyIdx,
                                pts,
                                startLabel,
                                endLabel,
                                area,
                                perimeter,
                                segments,
                                centerLatLng,
                                baseVertexIdx: globalVertexIdx
                            });

                            globalVertexIdx += polyPts.length;
                        });

                        return { polygonsData, totalAllArea, totalVertices: globalVertexIdx };
                    }

                    window.finishRulerSegment = function() {
                        if (rulerType !== 'line') return;
                        if (rulerLines.length === 0) return;
                        const currentLine = rulerLines[rulerLines.length - 1];
                        if (currentLine && currentLine.length >= 2) {
                            // Clean duplicate vertex if double-click registered extra point
                            const pLast = currentLine[currentLine.length - 1];
                            const pPrev = currentLine[currentLine.length - 2];
                            if (map.distance(pLast, pPrev) < 15) {
                                currentLine.pop();
                                rulerPoints = rulerLines.flat();
                            }
                            isRulerLineFinished = true;
                            updateRulerUI();
                            const { linesData } = computeRulerAllLinesData();
                            const lastLd = linesData[linesData.length - 1];
                            showHud('✅ Tramo ' + (lastLd ? lastLd.startLabel + '-' + lastLd.endLabel : '') + ' cerrado. Clic en mapa para iniciar otro.');
                        }
                    };

                    window.finishRulerArea = function() {
                        if (rulerType !== 'area') return;
                        if (rulerPolygons.length === 0) return;
                        const currPoly = rulerPolygons[rulerPolygons.length - 1];
                        if (currPoly && currPoly.length >= 3) {
                            const pLast = currPoly[currPoly.length - 1];
                            const pPrev = currPoly[currPoly.length - 2];
                            if (map.distance(pLast, pPrev) < 15) {
                                currPoly.pop();
                                rulerPoints = rulerPolygons.flat();
                            }
                            isRulerAreaFinished = true;
                            updateRulerUI();
                            const { polygonsData } = computeRulerAllAreasData();
                            const lastPd = polygonsData[polygonsData.length - 1];
                            showHud('✅ Polígono #' + (lastPd ? (lastPd.polyIdx + 1) : '') + ' cerrado (' + formatRulerArea(lastPd ? lastPd.area : 0) + '). Clic para iniciar otra área.');
                        } else {
                            showHud('⚠️ Un polígono requiere al menos 3 vértices para cerrarse');
                        }
                    };

                    window.updateRulerUI = function(hoverLatLng) {
                        rulerLayerGroup.clearLayers();

                        if (rulerType === 'line') {
                            const { linesData, totalAllDist } = computeRulerAllLinesData(hoverLatLng);
                            let globalMarkerIdx = 0;

                            linesData.forEach(ld => {
                                const pts = ld.pts;
                                if (pts.length >= 2) {
                                    L.polyline(pts, { color: '#00e5ff', weight: 3, opacity: 0.95 }).addTo(rulerLayerGroup);
                                }

                                // Segment midpoint distance labels on map (only distance value, no A-B prefix)
                                for (let i = 1; i < pts.length; i++) {
                                    const d = map.distance(pts[i - 1], pts[i]);
                                    const midLat = (pts[i - 1].lat + pts[i].lat) / 2;
                                    const midLng = (pts[i - 1].lng + pts[i].lng) / 2;
                                    L.marker([midLat, midLng], {
                                        interactive: false,
                                        icon: L.divIcon({
                                            className: '',
                                            html: '<span class="gee-ruler-seg-label">' + formatRulerDist(d) + '</span>'
                                        })
                                    }).addTo(rulerLayerGroup);
                                }
                            });

                            // Render letter badges on vertices (only for committed points)
                            rulerLines.forEach((linePts, lineIdx) => {
                                linePts.forEach((pt, pIdx) => {
                                    const letter = getRulerVertexLetter(globalMarkerIdx);
                                    const isStart = pIdx === 0;
                                    L.marker(pt, {
                                        interactive: false,
                                        icon: L.divIcon({
                                            className: '',
                                            iconSize: [17, 17],
                                            iconAnchor: [8.5, 8.5],
                                            html: '<div class="gee-ruler-vertex-badge' + (isStart ? ' start' : '') + '">' + letter + '</div>'
                                        })
                                    }).addTo(rulerLayerGroup);
                                    globalMarkerIdx++;
                                });
                            });

                            // Rubber line preview for active segment
                            if (hoverLatLng && rulerLines.length > 0 && !isRulerLineFinished) {
                                const currLine = rulerLines[rulerLines.length - 1];
                                if (currLine && currLine.length >= 1) {
                                    rulerRubberLine = L.polyline([currLine[currLine.length - 1], hoverLatLng], {
                                        color: '#ffeb3b',
                                        weight: 2,
                                        dashArray: '5, 5',
                                        opacity: 0.9
                                    }).addTo(rulerLayerGroup);
                                }
                            }

                            // Update Panel UI Values
                            const primEl = document.getElementById('rulerPrimaryValue');
                            const secEl = document.getElementById('rulerSecondaryValue');
                            const segBox = document.getElementById('rulerSegmentsBox');

                            if (primEl) primEl.textContent = formatRulerDist(totalAllDist);
                            if (secEl) {
                                const activeLine = rulerLines.length > 0 ? rulerLines[rulerLines.length - 1] : [];
                                if (isRulerLineFinished) {
                                    secEl.textContent = '✅ Tramo finalizado. Clic en mapa para iniciar nueva línea.';
                                } else if (activeLine.length >= 1) {
                                    secEl.textContent = 'Mueve y haz clic (o doble clic para cerrar este segmento)...';
                                } else {
                                    secEl.textContent = 'Haz clic en el mapa para iniciar medición...';
                                }
                            }

                            if (segBox) {
                                const committedData = computeRulerAllLinesData(null);
                                const validLines = committedData.linesData.filter(ld => ld.segments.length > 0);
                                if (validLines.length > 0) {
                                    segBox.style.display = 'block';
                                    let html = '';
                                    validLines.forEach((ld, idx) => {
                                        html += '<div style="margin-bottom: 4px; padding-bottom: 3px; border-bottom: 1px solid rgba(255,255,255,0.08);">';
                                        html += '<div style="display:flex; justify-content:space-between; color:#4ec9b0; font-weight:700; font-size:10px;">';
                                        html += '<span>Línea #' + (idx + 1) + ' (' + ld.startLabel + ' ➔ ' + ld.endLabel + ')</span>';
                                        html += '<span>' + formatRulerDist(ld.totalDist) + '</span>';
                                        html += '</div>';
                                        ld.segments.forEach(s => {
                                            html += '<div style="display:flex; justify-content:space-between; padding:1px 0 1px 6px; color:#bbb; font-size:9.5px;">';
                                            html += '<span>' + s.from + ' ➔ ' + s.to + ' (' + s.bearing.toFixed(0) + '° ' + compassDir(s.bearing) + ')</span>';
                                            html += '<span style="color:#eee;">' + formatRulerDist(s.dist) + '</span>';
                                            html += '</div>';
                                        });
                                        html += '</div>';
                                    });
                                    segBox.innerHTML = html;
                                    segBox.scrollTop = segBox.scrollHeight;
                                } else {
                                    segBox.style.display = 'none';
                                }
                            }
                        } else {
                            // AREA MODE - MULTIPLE INDEPENDENT POLYGONS
                            const { polygonsData, totalAllArea } = computeRulerAllAreasData(hoverLatLng);
                            let globalMarkerIdx = 0;

                            polygonsData.forEach(pd => {
                                const pts = pd.pts;
                                if (pts.length >= 3) {
                                    L.polygon(pts, {
                                        color: '#ffeb3b',
                                        weight: 2.5,
                                        fillColor: '#ffeb3b',
                                        fillOpacity: 0.22
                                    }).addTo(rulerLayerGroup);

                                    // Centroid badge on map for closed/valid polygons
                                    const polyCode = 'A' + String(pd.polyIdx + 1).padStart(2, '0');
                                    L.marker(pd.centerLatLng, {
                                        interactive: false,
                                        icon: L.divIcon({
                                            className: 'gee-ruler-area-icon-container',
                                            iconSize: [0, 0],
                                            iconAnchor: [0, 0],
                                            html: '<div class="gee-ruler-area-badge"><span style="color:#4ec9b0; font-weight:700;">' + polyCode + ':</span> <span style="color:#ffeb3b; font-weight:700;">' + formatRulerArea(pd.area) + '</span></div>'
                                        })
                                    }).addTo(rulerLayerGroup);
                                } else if (pts.length === 2) {
                                    L.polyline(pts, { color: '#ffeb3b', weight: 2.5, opacity: 0.85 }).addTo(rulerLayerGroup);
                                }

                                // Segment midpoint distance labels on polygon edges
                                for (let i = 1; i < pts.length; i++) {
                                    const d = map.distance(pts[i - 1], pts[i]);
                                    const midLat = (pts[i - 1].lat + pts[i].lat) / 2;
                                    const midLng = (pts[i - 1].lng + pts[i].lng) / 2;
                                    L.marker([midLat, midLng], {
                                        interactive: false,
                                        icon: L.divIcon({
                                            className: '',
                                            html: '<span class="gee-ruler-seg-label">' + formatRulerDist(d) + '</span>'
                                        })
                                    }).addTo(rulerLayerGroup);
                                }
                                if (pts.length >= 3) {
                                    const closeD = map.distance(pts[pts.length - 1], pts[0]);
                                    const cMidLat = (pts[pts.length - 1].lat + pts[0].lat) / 2;
                                    const cMidLng = (pts[pts.length - 1].lng + pts[0].lng) / 2;
                                    L.marker([cMidLat, cMidLng], {
                                        interactive: false,
                                        icon: L.divIcon({
                                            className: '',
                                            html: '<span class="gee-ruler-seg-label">' + formatRulerDist(closeD) + '</span>'
                                        })
                                    }).addTo(rulerLayerGroup);
                                }
                            });

                            // Render letter badges on vertices (only committed points)
                            rulerPolygons.forEach((polyPts, polyIdx) => {
                                polyPts.forEach((pt, pIdx) => {
                                    const letter = getRulerVertexLetter(globalMarkerIdx);
                                    const isStart = pIdx === 0;
                                    L.marker(pt, {
                                        interactive: false,
                                        icon: L.divIcon({
                                            className: '',
                                            iconSize: [17, 17],
                                            iconAnchor: [8.5, 8.5],
                                            html: '<div class="gee-ruler-vertex-badge' + (isStart ? ' start' : '') + '">' + letter + '</div>'
                                        })
                                    }).addTo(rulerLayerGroup);
                                    globalMarkerIdx++;
                                });
                            });

                            // Rubber line preview for active polygon
                            if (hoverLatLng && rulerPolygons.length > 0 && !isRulerAreaFinished) {
                                const currPoly = rulerPolygons[rulerPolygons.length - 1];
                                if (currPoly && currPoly.length >= 1) {
                                    const rubberPts = [currPoly[currPoly.length - 1], hoverLatLng];
                                    if (currPoly.length >= 2) {
                                        rubberPts.push(currPoly[0]); // rubber polygon preview back to origin
                                    }
                                    rulerRubberLine = L.polyline(rubberPts, {
                                        color: '#ffeb3b',
                                        weight: 2,
                                        dashArray: '5, 5',
                                        opacity: 0.9
                                    }).addTo(rulerLayerGroup);
                                }
                            }

                            // Update Panel UI Values
                            const primEl = document.getElementById('rulerPrimaryValue');
                            const secEl = document.getElementById('rulerSecondaryValue');
                            const segBox = document.getElementById('rulerSegmentsBox');

                            if (primEl) primEl.textContent = formatRulerArea(totalAllArea);
                            if (secEl) {
                                const activePoly = rulerPolygons.length > 0 ? rulerPolygons[rulerPolygons.length - 1] : [];
                                if (isRulerAreaFinished) {
                                    secEl.textContent = '';
                                } else if (activePoly.length >= 3) {
                                    secEl.textContent = 'Mueve y haz clic (o clic en vértice inicial A / doble clic para cerrar)...';
                                } else if (activePoly.length >= 1) {
                                    secEl.textContent = 'Agrega más vértices para formar el polígono...';
                                } else {
                                    secEl.textContent = 'Haz clic en el mapa para iniciar área...';
                                }
                            }

                            if (segBox) {
                                const committedData = computeRulerAllAreasData(null);
                                const validPolys = committedData.polygonsData.filter(pd => pd.pts.length >= 3);
                                if (validPolys.length > 0) {
                                    segBox.style.display = 'block';
                                    let html = '';
                                    validPolys.forEach((pd, idx) => {
                                        html += '<div style="margin-bottom: 4px; padding-bottom: 3px; border-bottom: 1px solid rgba(255,255,255,0.08);">';
                                        html += '<div style="display:flex; justify-content:space-between; color:#ffeb3b; font-weight:700; font-size:10px;">';
                                        html += '<span>Polígono #' + (idx + 1) + ' (' + pd.startLabel + ' ➔ ' + pd.endLabel + ')</span>';
                                        html += '<span>' + formatRulerArea(pd.area) + '</span>';
                                        html += '</div>';
                                        html += '<div style="display:flex; justify-content:space-between; color:#888; font-size:9px; padding:1px 0 2px 4px;">';
                                        html += '<span>Perímetro: ' + formatRulerDist(pd.perimeter) + '</span>';
                                        html += '<span>' + (pd.area / 10000).toFixed(4) + ' ha</span>';
                                        html += '</div>';
                                        html += '</div>';
                                    });
                                    segBox.innerHTML = html;
                                    segBox.scrollTop = segBox.scrollHeight;
                                } else {
                                    segBox.style.display = 'none';
                                }
                            }
                        }
                    };

                    window.setRulerType = function(type) {
                        rulerType = type;
                        rulerLines = [[]];
                        isRulerLineFinished = false;
                        rulerPolygons = [[]];
                        isRulerAreaFinished = false;
                        rulerPoints = [];
                        document.getElementById('rulerTabLine')?.classList.toggle('active', type === 'line');
                        document.getElementById('rulerTabArea')?.classList.toggle('active', type === 'area');
                        const lbl = document.getElementById('rulerMainLabel');
                        if (lbl) lbl.textContent = type === 'line' ? 'Distancia Total' : 'Área Geodésica Total';
                        const profBtn = document.getElementById('btnRulerProfile');
                        if (profBtn) profBtn.style.display = type === 'line' ? 'flex' : 'none';
                        populateRulerUnits();
                        updateRulerUI();
                    };

                    window.toggleRulerMode = function(forceState) {
                        rulerMode = typeof forceState === 'boolean' ? forceState : !rulerMode;
                        const panel = document.getElementById('rulerPanel');
                        const btn = document.getElementById('btn-ruler');
                        const mapEl = document.getElementById('map');

                        if (rulerMode) {
                            if (map && map.doubleClickZoom) map.doubleClickZoom.disable();
                            if (panel) panel.style.display = 'block';
                            if (btn) {
                                btn.style.background = 'rgba(78, 201, 176, 0.4)';
                                btn.style.borderColor = '#4ec9b0';
                            }
                            if (mapEl) mapEl.classList.add('crosshair-mode');
                            updateRulerUI();
                            showHud('📏 Regla GIS activa (Clic para medir, doble clic fin tramo, Backspace deshacer)');
                        } else {
                            if (map && map.doubleClickZoom) map.doubleClickZoom.enable();
                            if (panel) panel.style.display = 'none';
                            if (btn) {
                                btn.style.background = '';
                                btn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                            }
                            if (mapEl) mapEl.classList.remove('crosshair-mode');
                            rulerClear(true);
                        }
                    };

                    window.rulerUndo = function() {
                        if (rulerType === 'line') {
                            if (rulerLines.length === 0) return;
                            const lastLine = rulerLines[rulerLines.length - 1];
                            if (lastLine.length > 0) {
                                lastLine.pop();
                                isRulerLineFinished = false;
                            } else if (rulerLines.length > 1) {
                                rulerLines.pop();
                                isRulerLineFinished = true;
                            }
                            rulerPoints = rulerLines.flat();
                        } else {
                            if (rulerPolygons.length === 0) return;
                            const lastPoly = rulerPolygons[rulerPolygons.length - 1];
                            if (lastPoly.length > 0) {
                                lastPoly.pop();
                                isRulerAreaFinished = false;
                            } else if (rulerPolygons.length > 1) {
                                rulerPolygons.pop();
                                isRulerAreaFinished = true;
                            }
                            rulerPoints = rulerPolygons.flat();
                        }
                        const elevBox = document.getElementById('rulerElevBox');
                        if (elevBox) elevBox.style.display = 'none';
                        updateRulerUI();
                    };

                    window.rulerClear = function(silent) {
                        rulerLines = [[]];
                        isRulerLineFinished = false;
                        rulerPolygons = [[]];
                        isRulerAreaFinished = false;
                        rulerPoints = [];
                        rulerLayerGroup.clearLayers();
                        const elevBox = document.getElementById('rulerElevBox');
                        if (elevBox) elevBox.style.display = 'none';
                        updateRulerUI();
                        if (!silent) showHud('🗑️ Medición reiniciada');
                    };

                    window.rulerCopy = function() {
                        if (rulerType === 'line') {
                            const { linesData, totalAllDist } = computeRulerAllLinesData();
                            const validLines = linesData.filter(ld => ld.segments.length > 0);
                            if (validLines.length === 0) return;
                            const nl = String.fromCharCode(10);
                            let txt = '=== Medición Regla GIS ===' + nl;
                            validLines.forEach((ld, idx) => {
                                txt += 'Línea #' + (idx + 1) + ' (' + ld.startLabel + ' ➔ ' + ld.endLabel + '): ' + formatRulerDist(ld.totalDist) + nl;
                                ld.segments.forEach(s => {
                                    txt += '  • ' + s.from + ' ➔ ' + s.to + ' (' + s.bearing.toFixed(1) + '° ' + compassDir(s.bearing) + '): ' + formatRulerDist(s.dist) + nl;
                                });
                            });
                            txt += 'Distancia Total: ' + formatRulerDist(totalAllDist) + (validLines.length > 1 ? ' (' + validLines.length + ' líneas)' : '');
                            vscode.postMessage({ command: 'copyToClipboard', text: txt });
                            showHud('📋 Mediciones copiadas al portapapeles');
                        } else {
                            const { polygonsData, totalAllArea } = computeRulerAllAreasData();
                            const validPolys = polygonsData.filter(pd => pd.pts.length >= 3);
                            if (validPolys.length === 0) return;
                            const nl = String.fromCharCode(10);
                            let txt = '=== Medición Áreas GIS ===' + nl;
                            validPolys.forEach((pd, idx) => {
                                txt += 'Polígono #' + (idx + 1) + ' (' + pd.startLabel + ' ➔ ' + pd.endLabel + '): Área ' + formatRulerArea(pd.area) + ' (' + (pd.area / 10000).toFixed(4) + ' ha) | Perímetro: ' + formatRulerDist(pd.perimeter) + nl;
                            });
                            txt += 'Área Total: ' + formatRulerArea(totalAllArea) + (validPolys.length > 1 ? ' (' + validPolys.length + ' polígonos)' : '');
                            vscode.postMessage({ command: 'copyToClipboard', text: txt });
                            showHud('📋 Áreas copiadas al portapapeles');
                        }
                    };

                    window.exportRulerGeoJSON = function() {
                        if (rulerType === 'line') {
                            const { linesData, totalAllDist } = computeRulerAllLinesData();
                            const validLines = linesData.filter(ld => ld.pts.length >= 2);
                            if (validLines.length === 0) {
                                showHud('⚠️ Traza primero una medición en el mapa');
                                return;
                            }
                            const features = validLines.map((ld, idx) => ({
                                type: 'Feature',
                                properties: {
                                    line_index: idx + 1,
                                    name: 'Línea #' + (idx + 1),
                                    start_vertex: ld.startLabel,
                                    end_vertex: ld.endLabel,
                                    distance_m: Number(ld.totalDist.toFixed(2)),
                                    distance_km: Number((ld.totalDist / 1000).toFixed(4)),
                                    segments_count: ld.segments.length,
                                    segments: ld.segments.map(s => ({
                                        from: s.from,
                                        to: s.to,
                                        distance_m: Number(s.dist.toFixed(2)),
                                        bearing_deg: Number(s.bearing.toFixed(1))
                                    }))
                                },
                                geometry: {
                                    type: 'LineString',
                                    coordinates: ld.pts.map(p => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))])
                                }
                            }));
                            const fc = {
                                type: 'FeatureCollection',
                                properties: {
                                    tool: 'GEE IDE Ruler',
                                    total_distance_m: Number(totalAllDist.toFixed(2)),
                                    total_lines: features.length
                                },
                                features: features
                            };
                            vscode.postMessage({
                                command: 'saveMeasureGeoJSON',
                                geojson: JSON.stringify(fc, null, 2),
                                filename: 'medicion_lineas_' + Date.now() + '.geojson'
                            });
                        } else {
                            const { polygonsData, totalAllArea } = computeRulerAllAreasData();
                            const validPolys = polygonsData.filter(pd => pd.pts.length >= 3);
                            if (validPolys.length === 0) {
                                showHud('⚠️ Traza al menos un polígono con 3 o más vértices');
                                return;
                            }
                            const features = validPolys.map((pd, idx) => {
                                const coords = pd.pts.map(p => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
                                return {
                                    type: 'Feature',
                                    properties: {
                                        polygon_index: idx + 1,
                                        name: 'Polígono #' + (idx + 1),
                                        start_vertex: pd.startLabel,
                                        end_vertex: pd.endLabel,
                                        area_m2: Number(pd.area.toFixed(2)),
                                        area_ha: Number((pd.area / 10000).toFixed(4)),
                                        perimeter_m: Number(pd.perimeter.toFixed(2)),
                                        vertices_count: pd.pts.length
                                    },
                                    geometry: { type: 'Polygon', coordinates: [coords.concat([coords[0]])] }
                                };
                            });
                            const fc = {
                                type: 'FeatureCollection',
                                properties: {
                                    tool: 'GEE IDE Ruler',
                                    total_area_m2: Number(totalAllArea.toFixed(2)),
                                    total_area_ha: Number((totalAllArea / 10000).toFixed(4)),
                                    total_polygons: features.length
                                },
                                features: features
                            };
                            vscode.postMessage({
                                command: 'saveMeasureGeoJSON',
                                geojson: JSON.stringify(fc, null, 2),
                                filename: 'medicion_areas_' + Date.now() + '.geojson'
                            });
                        }
                    };

                    let rulerHoverElevMarker = null;
                    let lastRulerElevSamples = [];

                    window.requestRulerElevationProfile = function() {
                        const pts = rulerLines.length > 0 ? (isRulerLineFinished ? rulerLines[rulerLines.length - 1] : rulerLines.flat()) : [];
                        if (pts.length < 2) {
                            showHud('⚠️ Traza al menos 2 puntos en modo Línea para ver el perfil DEM');
                            return;
                        }
                        const m = computeRulerAreaMetrics(pts);
                        const total = m.totalDist;
                        const numSamples = Math.max(40, Math.min(100, Math.round(total / 30)));

                        const elevBox = document.getElementById('rulerElevBox');
                        if (elevBox) {
                            elevBox.style.display = 'block';
                            elevBox.innerHTML = '<div style="text-align:center; color:#4ec9b0; font-size:10.5px; padding:8px;">⏳ Muestreando ' + (numSamples + 1) + ' puntos DEM (FABDEM/SRTM 30m)...</div>';
                        }

                        const samples = [];
                        for (let i = 0; i <= numSamples; i++) {
                            const targetDist = (total * i) / numSamples;
                            let acc = 0;
                            let chosen = pts[pts.length - 1];
                            for (let s = 1; s < pts.length; s++) {
                                const segD = map.distance(pts[s - 1], pts[s]);
                                if (acc + segD >= targetDist || s === pts.length - 1) {
                                    const t = segD > 0 ? Math.max(0, Math.min(1, (targetDist - acc) / segD)) : 0;
                                    const lat = pts[s - 1].lat + (pts[s].lat - pts[s - 1].lat) * t;
                                    const lng = pts[s - 1].lng + (pts[s].lng - pts[s - 1].lng) * t;
                                    chosen = { lat, lng };
                                    break;
                                }
                                acc += segD;
                            }
                            samples.push({ lon: chosen.lng, lat: chosen.lat, dist: Math.round(targetDist) });
                        }
                        lastRulerElevSamples = samples;
                        vscode.postMessage({ command: 'requestElevationProfile', samples });
                    };

                    window.renderRulerElevationProfile = function(points, error) {
                        const elevBox = document.getElementById('rulerElevBox');
                        if (!elevBox) return;
                        elevBox.style.display = 'block';
                        if (error || !points || points.length < 2) {
                            elevBox.innerHTML = '<div style="color:#ff6b6b; font-size:10px;">⚠️ ' + (error || 'Sin datos DEM') + '</div>';
                            return;
                        }
                        const enriched = points.map((p, i) => {
                            const s = lastRulerElevSamples[p.idx !== undefined ? p.idx : i] || {};
                            return { dist: p.dist, elev: p.elev, lat: s.lat, lon: s.lon };
                        });
                        const elevs = enriched.map(p => p.elev);
                        const minE = Math.min(...elevs);
                        const maxE = Math.max(...elevs);
                        const spanE = Math.max(1, maxE - minE);
                        const totalD = Math.max(1, enriched[enriched.length - 1].dist);
                        const deltaH = elevs[elevs.length - 1] - elevs[0];
                        const slopePct = ((Math.abs(deltaH) / totalD) * 100).toFixed(1);

                        const W = 272, H = 74;
                        const ptsSvg = enriched.map(p => {
                            const x = 6 + ((p.dist / totalD) * (W - 12));
                            const y = H - 8 - (((p.elev - minE) / spanE) * (H - 18));
                            return { x, y, ...p };
                        });
                        const coordsSvg = ptsSvg.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1));
                        const polyFill = '6,' + (H - 6) + ' ' + coordsSvg.join(' ') + ' ' + (W - 6) + ',' + (H - 6);
                        const defaultHeader = '⛰️ Min: ' + minE.toFixed(0) + 'm | Max: ' + maxE.toFixed(0) + 'm (' + enriched.length + ' pts)';

                        elevBox.innerHTML =
                            '<div style="display:flex; justify-content:space-between; font-size:9.5px; color:#9cdcfe; font-family:monospace; margin-bottom:3px;">' +
                                '<span id="rulerElevReadout">' + defaultHeader + '</span>' +
                                '<span>Δh: ' + (deltaH >= 0 ? '+' : '') + deltaH.toFixed(0) + 'm (' + slopePct + '%)</span>' +
                            '</div>' +
                            '<svg id="rulerElevSvg" width="' + W + '" height="' + H + '" style="display:block; width:100%; background:rgba(0,0,0,0.35); border-radius:4px; cursor:crosshair;">' +
                                '<polygon points="' + polyFill + '" fill="rgba(78, 201, 176, 0.25)" />' +
                                '<polyline points="' + coordsSvg.join(' ') + '" fill="none" stroke="#4ec9b0" stroke-width="1.8" />' +
                                '<line id="rulerElevHoverLine" x1="0" y1="4" x2="0" y2="' + (H - 4) + '" stroke="#ffeb3b" stroke-width="1" stroke-dasharray="2,2" style="display:none;" />' +
                                '<circle id="rulerElevHoverDot" cx="0" cy="0" r="3.5" fill="#ff9800" stroke="#fff" stroke-width="1.2" style="display:none;" />' +
                            '</svg>';

                        const svgEl = document.getElementById('rulerElevSvg');
                        const hLine = document.getElementById('rulerElevHoverLine');
                        const hDot = document.getElementById('rulerElevHoverDot');
                        const rOut = document.getElementById('rulerElevReadout');

                        if (svgEl) {
                            svgEl.addEventListener('mousemove', (ev) => {
                                const rect = svgEl.getBoundingClientRect();
                                const relX = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                                const idx = Math.min(ptsSvg.length - 1, Math.max(0, Math.round(relX * (ptsSvg.length - 1))));
                                const pt = ptsSvg[idx];
                                if (!pt) return;
                                if (hLine) { hLine.setAttribute('x1', String(pt.x)); hLine.setAttribute('x2', String(pt.x)); hLine.style.display = 'block'; }
                                if (hDot) { hDot.setAttribute('cx', String(pt.x)); hDot.setAttribute('cy', String(pt.y)); hDot.style.display = 'block'; }
                                if (rOut) rOut.textContent = '📍 ' + formatRulerDist(pt.dist) + ' → ' + pt.elev.toFixed(0) + ' m.s.n.m.';
                                if (pt.lat !== undefined && pt.lon !== undefined) {
                                    if (!rulerHoverElevMarker) {
                                        rulerHoverElevMarker = L.circleMarker([pt.lat, pt.lon], {
                                            radius: 6, color: '#fff', weight: 2, fillColor: '#ff9800', fillOpacity: 1
                                        }).addTo(rulerLayerGroup);
                                    } else {
                                        rulerHoverElevMarker.setLatLng([pt.lat, pt.lon]);
                                    }
                                }
                            });
                            svgEl.addEventListener('mouseleave', () => {
                                if (hLine) hLine.style.display = 'none';
                                if (hDot) hDot.style.display = 'none';
                                if (rOut) rOut.textContent = defaultHeader;
                                if (rulerHoverElevMarker) {
                                    rulerLayerGroup.removeLayer(rulerHoverElevMarker);
                                    rulerHoverElevMarker = null;
                                }
                            });
                        }
                    };

                    map.on('click', (e) => {
                        if (!rulerMode) return;

                        const now = Date.now();
                        // Double-click detector on click: if 2nd click within 320ms on similar spot
                        if (now - lastRulerClickTime < 320 && lastRulerClickLatLng && map.distance(lastRulerClickLatLng, e.latlng) < 15) {
                            lastRulerClickTime = 0;
                            lastRulerClickLatLng = null;
                            if (rulerType === 'line') {
                                window.finishRulerSegment();
                            } else {
                                window.finishRulerArea();
                            }
                            return;
                        }
                        lastRulerClickTime = now;
                        lastRulerClickLatLng = e.latlng;

                        if (rulerType === 'line') {
                            if (isRulerLineFinished) {
                                rulerLines.push([]);
                                isRulerLineFinished = false;
                            }
                            const currLine = rulerLines[rulerLines.length - 1];
                            currLine.push(e.latlng);
                            rulerPoints = rulerLines.flat();
                            updateRulerUI();
                        } else {
                            if (isRulerAreaFinished) {
                                rulerPolygons.push([]);
                                isRulerAreaFinished = false;
                            }
                            if (rulerPolygons.length === 0) rulerPolygons = [[]];
                            const currPoly = rulerPolygons[rulerPolygons.length - 1];

                            // Click on start vertex (first point) closes polygon if >= 3 points
                            if (currPoly.length >= 3) {
                                const distToStart = map.distance(currPoly[0], e.latlng);
                                if (distToStart < 25) {
                                    window.finishRulerArea();
                                    return;
                                }
                            }

                            currPoly.push(e.latlng);
                            rulerPoints = rulerPolygons.flat();
                            updateRulerUI();
                        }
                    });

                    map.on('dblclick', (e) => {
                        if (!rulerMode) return;
                        if (e.originalEvent) {
                            e.originalEvent.preventDefault();
                            e.originalEvent.stopPropagation();
                        }
                        if (rulerType === 'line') {
                            window.finishRulerSegment();
                        } else {
                            window.finishRulerArea();
                        }
                    });

                    map.on('mousemove', (e) => {
                        if (!rulerMode || rulerPoints.length === 0 || (rulerType === 'line' ? isRulerLineFinished : isRulerAreaFinished)) return;
                        updateRulerUI(e.latlng);
                    });
                    // --- END QGIS SCALE BAR & RULER PRO TOOL ---

                    // Notify extension that webview Leaflet map is fully initialized and ready
                    setTimeout(() => {
                        map.invalidateSize();
                        if (vscode && vscode.postMessage) {
                            vscode.postMessage({ command: 'ready' });
                        }
                    }, 100);

                    // Robust auto-resize observer to guarantee Leaflet map expands when tab/quadrant renders
                    try {
                        const mapContainer = document.getElementById('map');
                        if (mapContainer && typeof ResizeObserver !== 'undefined') {
                            const ro = new ResizeObserver(() => {
                                map.invalidateSize();
                            });
                            ro.observe(mapContainer);
                        }
                    } catch (e) {}

                    window.addEventListener('resize', () => {
                        map.invalidateSize();
                    });

                    // Multi-phase safety triggers for slower layout passes
                    setTimeout(() => { map.invalidateSize(); }, 300);
                    setTimeout(() => { map.invalidateSize(); }, 800);
                </script>
            </body>
            </html>
        `;
    }
}
