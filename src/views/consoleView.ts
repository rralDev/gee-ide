import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GEEPseudoterminal, formatToAnsi } from './geeTerminal';

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatLogEntry(text: string): { className: string; innerHtml: string } {
    if (text.startsWith('>')) {
        const codePart = text.startsWith('> ') ? text.substring(2) : text.substring(1);
        return {
            className: 'log-entry log-code',
            innerHtml: '<span class="prompt">&gt;</span>' + escapeHtml(codePart)
        };
    }

    if (text.startsWith('  ') && !text.startsWith('  📁') && !text.startsWith('  🛰️') && !text.startsWith('  📊') && !text.startsWith('  (empty') && !text.startsWith('  (no assets') && !text.startsWith('  Found')) {
        return {
            className: 'log-entry log-code',
            innerHtml: '<span class="prompt-indent">&nbsp;&nbsp;</span>' + escapeHtml(text.substring(2))
        };
    }

    if (text === '----------------------------------------' || text.startsWith('---')) {
        return {
            className: 'log-entry log-divider',
            innerHtml: ''
        };
    }

    const cliMatch = text.match(/^gee:([^>]+)>\s*(.*)$/);
    if (cliMatch) {
        return {
            className: 'log-entry log-cli-cmd',
            innerHtml: `<span class="cli-prompt">gee:<span class="cli-path">${escapeHtml(cliMatch[1])}</span>&gt;</span> <span class="cli-text">${escapeHtml(cliMatch[2])}</span>`
        };
    }

    // Check for [Tag] prefix: e.g. [python], [GEE IDE], [stderr], [Error], [pip], [Routing], [JS], [R], etc.
    const tagMatch = text.match(/^\[([-a-zA-Z0-9_ ]+)\](?::)?\s*(.*)$/);
    if (tagMatch) {
        const rawTag = tagMatch[1];
        const rest = tagMatch[2];
        const tagSlug = rawTag.toLowerCase().replace(/[^a-z0-9]/g, '');

        let badgeClass = 'badge';
        if (tagSlug.includes('python') || tagSlug === 'py') badgeClass += ' badge-python';
        else if (tagSlug.includes('geepro') || tagSlug.includes('gee')) badgeClass += ' badge-geepro';
        else if (tagSlug.includes('stderr')) badgeClass += ' badge-stderr';
        else if (tagSlug.includes('error')) badgeClass += ' badge-error';
        else if (tagSlug.includes('pip')) badgeClass += ' badge-pip';
        else if (tagSlug.includes('routing')) badgeClass += ' badge-routing';
        else if (tagSlug.includes('js') || tagSlug.includes('javascript')) badgeClass += ' badge-js';
        else if (tagSlug === 'r') badgeClass += ' badge-r';
        else if (tagSlug.includes('hint') || tagSlug.includes('aviso') || tagSlug.includes('tip')) badgeClass += ' badge-hint';
        else badgeClass += ' badge-default';

        let extraClass = 'log-tagged';
        if (badgeClass.includes('badge-error') || rest.toLowerCase().includes('error:')) extraClass += ' log-error';
        else if (badgeClass.includes('badge-stderr')) extraClass += ' log-stderr';
        else if (rest.startsWith('Adding layer:') || rest.startsWith('Layer added:') || rest.startsWith('[GEE IDE] Layer added:')) extraClass += ' log-layer';

        return {
            className: 'log-entry ' + extraClass,
            innerHtml: `<span class="${badgeClass}">[${escapeHtml(rawTag)}]</span><span class="tagged-text">${escapeHtml(rest)}</span>`
        };
    }

    if (text.startsWith('Running full script')) {
        const langMatch = text.match(/\[([A-Z]+)\]/);
        const lang = langMatch ? langMatch[1] : '';
        const langSlug = lang.toLowerCase();
        let badgeClass = 'badge';
        if (langSlug.includes('py')) badgeClass += ' badge-python';
        else if (langSlug.includes('js')) badgeClass += ' badge-js';
        else if (langSlug.includes('r')) badgeClass += ' badge-r';
        else badgeClass += ' badge-default';

        return {
            className: 'log-entry log-script-header',
            innerHtml: `▶ <span class="${badgeClass}">[${escapeHtml(lang)}]</span> <span class="script-title">Running full script...</span>`
        };
    }

    if (text.startsWith('[Error]') || text.startsWith('[stderr]') || text.toLowerCase().includes('error:')) {
        return {
            className: 'log-entry log-error',
            innerHtml: escapeHtml(text)
        };
    }

    if (text.includes('Ready') || text.includes('Successful') || text.includes('Welcome')) {
        return {
            className: 'log-entry log-success',
            innerHtml: escapeHtml(text)
        };
    }

    if (text.startsWith('Adding layer:') || text.startsWith('Layer added:') || text.startsWith('[GEE IDE] Layer added:')) {
        return {
            className: 'log-entry log-layer',
            innerHtml: escapeHtml(text)
        };
    }

    return {
        className: 'log-entry log-output',
        innerHtml: escapeHtml(text)
    };
}

export class ConsoleView {
    private terminal: vscode.Terminal | undefined;
    private terminals: vscode.Terminal[] = [];
    private activePtyList: GEEPseudoterminal[] = [];
    private terminalCounter = 1;
    private pty: GEEPseudoterminal;
    private panel: vscode.WebviewPanel | undefined;
    public get isCreated(): boolean { return this.terminal !== undefined || this.panel !== undefined; }
    private messageCallback: ((message: any) => void) | undefined;
    private logs: string[] = [];
    private knownCompletions: Set<string> = new Set([
        'find', 'catalog', 'search', 'ls', 'dir', 'vars', 'objects', 'whos', 'cd', 'pwd', 'mkdir', 'rm', 'rmdir', 'cp', 'mv', 'clear', 'cls', 'history', 'help',
        '-name', '-type', '-maxdepth', '-catalog', '-c', '-r', '-rf',
        'Map.addLayer', 'Map.setCenter', 'Map.centerObject', 'Map.clear',
        'ee.Image', 'ee.ImageCollection', 'ee.FeatureCollection', 'ee.Geometry',
        'print', 'Export'
    ]);

    constructor(private context: vscode.ExtensionContext) {
        this.pty = new GEEPseudoterminal(this.context);
        this.pty.historyLoader = () => this.loadHistory();
        this.pty.historySaver = (cmd: string) => this.appendHistory(cmd);
        this.pty.logFilePathGetter = () => this.getLogFilePath();
        this.pty.openLogFileFunc = () => this.openLogFile();
        this.pty.recentLogsGetter = () => this.getRecentLogs(200);
        this.pty.knownCompletions = this.knownCompletions;
        this.pty.onCommandSubmit = async (cmd: string) => {
            if (this.messageCallback) {
                this.messageCallback({ command: 'geeCommand', text: cmd });
            }
        };
        this.pty.onInterrupt = () => {
            if (this.interruptCallback) {
                this.interruptCallback();
            }
        };

        vscode.window.onDidCloseTerminal((term) => {
            if (term === this.terminal) {
                this.terminal = undefined;
            }
            const idx = this.terminals.indexOf(term);
            if (idx !== -1) {
                this.terminals.splice(idx, 1);
                this.activePtyList.splice(idx, 1);
            }
        }, null, this.context.subscriptions);
    }

    public onMessage(callback: (message: any) => void) {
        this.messageCallback = callback;
    }

    private interruptCallback?: () => void;
    public onInterrupt(callback: () => void) {
        this.interruptCallback = callback;
    }

    public setLangMode(mode: 'js' | 'py' | 'r') {
        this.pty.setLangMode(mode);
        for (const p of this.activePtyList) {
            try { p.setLangMode(mode); } catch (e) {}
        }
    }

    public getLangMode(): 'js' | 'py' | 'r' {
        return this.pty.getLangMode();
    }

    public findExistingTab(): { tab: vscode.Tab; group: vscode.TabGroup } | undefined {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputWebview) {
                    const vt = tab.input.viewType || '';
                    const label = tab.label || '';
                    if (vt.includes('geeConsole') || label.includes('GEE Console') || label.includes('geeConsole')) {
                        return { tab, group };
                    }
                }
            }
        }
        return undefined;
    }

    public async show(column?: vscode.ViewColumn, preserveFocus: boolean = true) {
        const targetColumn = column || vscode.ViewColumn.Two;

        // Dispose any obsolete webview panel so Cuadrante 2 becomes the native terminal
        if (this.panel) {
            try { this.panel.dispose(); } catch (e) {}
            this.panel = undefined;
        }
        await this.closeExistingTabs();

        if (this.terminal) {
            this.terminal.show(preserveFocus);
            return;
        }

        this.terminal = vscode.window.createTerminal({
            name: 'GEE Terminal',
            pty: this.pty,
            iconPath: new vscode.ThemeIcon('terminal'),
            location: {
                viewColumn: targetColumn,
                preserveFocus: preserveFocus
            },
            isTransient: true
        });

        this.terminal.show(preserveFocus);
    }

    public stopActiveExecution(): void {
        this.pty.interrupt();
        for (const p of this.activePtyList) {
            try { p.interrupt(); } catch (e) {}
        }
    }

    public createNewTerminal(column?: vscode.ViewColumn): vscode.Terminal {
        const targetColumn = column || vscode.ViewColumn.Two;
        this.terminalCounter++;
        const newPty = new GEEPseudoterminal(this.context);
        newPty.historyLoader = () => this.loadHistory();
        newPty.historySaver = (cmd: string) => this.appendHistory(cmd);
        newPty.logFilePathGetter = () => this.getLogFilePath();
        newPty.openLogFileFunc = () => this.openLogFile();
        // Las terminales nuevas empiezan limpias desde cero
        newPty.knownCompletions = this.knownCompletions;
        newPty.setLangMode(this.getLangMode());
        newPty.onCommandSubmit = async (cmd: string) => {
            if (this.messageCallback) {
                this.messageCallback({ command: 'geeCommand', text: cmd });
            }
        };
        newPty.onInterrupt = () => {
            if (this.interruptCallback) {
                this.interruptCallback();
            }
        };

        const newTerm = vscode.window.createTerminal({
            name: `GEE Terminal ${this.terminalCounter}`,
            pty: newPty,
            iconPath: new vscode.ThemeIcon('terminal'),
            location: {
                viewColumn: targetColumn,
                preserveFocus: false
            },
            isTransient: true
        });

        this.terminals.push(newTerm);
        this.activePtyList.push(newPty);
        newTerm.show(false);
        return newTerm;
    }

    public createTerminalProfile(): vscode.TerminalProfile {
        this.terminalCounter++;
        const newPty = new GEEPseudoterminal(this.context);
        newPty.historyLoader = () => this.loadHistory();
        newPty.historySaver = (cmd: string) => this.appendHistory(cmd);
        newPty.logFilePathGetter = () => this.getLogFilePath();
        newPty.openLogFileFunc = () => this.openLogFile();
        // Las terminales nuevas empiezan limpias desde cero
        newPty.knownCompletions = this.knownCompletions;
        newPty.setLangMode(this.getLangMode());
        newPty.onCommandSubmit = async (cmd: string) => {
            if (this.messageCallback) {
                this.messageCallback({ command: 'geeCommand', text: cmd });
            }
        };
        newPty.onInterrupt = () => {
            if (this.interruptCallback) {
                this.interruptCallback();
            }
        };
        this.activePtyList.push(newPty);
        return new vscode.TerminalProfile({
            name: `GEE Terminal ${this.terminalCounter}`,
            pty: newPty,
            iconPath: new vscode.ThemeIcon('terminal')
        });
    }

    public dispose() {
        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = undefined;
        }
        for (const t of this.terminals) {
            try { t.dispose(); } catch (e) {}
        }
        this.terminals = [];
        this.activePtyList = [];
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }

    public async closeExistingTabs() {
        try {
            const tabsToClose: vscode.Tab[] = [];
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputWebview) {
                        const vt = tab.input.viewType || '';
                        const label = tab.label || '';
                        if (vt.includes('geeConsole') || label.includes('GEE Console') || label.includes('geeConsole')) {
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

    public focus() {
        if (this.panel) {
            try { this.panel.dispose(); } catch (e) {}
            this.panel = undefined;
        }
        if (this.terminal) {
            this.terminal.show(false);
        } else {
            this.show(vscode.ViewColumn.Two, false);
        }
    }

    public attachPanel(panel: vscode.WebviewPanel) {
        // Upgrade any deserialized webview panel to the native terminal
        const col = panel.viewColumn || vscode.ViewColumn.Two;
        try {
            panel.dispose();
        } catch (e) {}
        this.panel = undefined;
        this.show(col, false);
    }

    public getHistoryFilePath(): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const root = workspaceFolders[0].uri.fsPath;
            const geehistory = path.join(root, '.geehistory');
            if (fs.existsSync(geehistory)) return geehistory;
            const geeOldHistory = path.join(root, '.gee_history');
            if (fs.existsSync(geeOldHistory)) return geeOldHistory;
            return geehistory;
        }
        return null;
    }

    public loadHistory(): string[] {
        const hFile = this.getHistoryFilePath();
        if (hFile && fs.existsSync(hFile)) {
            try {
                const content = fs.readFileSync(hFile, 'utf8');
                return content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            } catch (e) {}
        }
        return [];
    }

    public appendHistory(cmd: string) {
        if (!cmd || !cmd.trim()) return;
        const clean = cmd.trim();
        const hFile = this.getHistoryFilePath();
        if (hFile) {
            try {
                fs.appendFileSync(hFile, clean + '\n', 'utf8');
            } catch (e) {}
        }
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'addHistory', text: clean });
        }
    }

    public getLogFilePath(): string {
        try {
            const { ProjectManager } = require('../projectManager');
            const pmPath = ProjectManager?.getInstance()?.getProjectFilePath();
            if (pmPath && fs.existsSync(pmPath)) {
                return path.join(path.dirname(pmPath), 'gee_console.log');
            }
        } catch (e) {}
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (ws) {
            return path.join(ws, 'gee_console.log');
        }
        return path.join(os.homedir(), 'gee_console.log');
    }

    public async openLogFile() {
        const logPath = this.getLogFilePath();
        if (!fs.existsSync(logPath)) {
            try {
                fs.writeFileSync(logPath, `=== GEE IDE Console Log ===\nIniciado: ${new Date().toISOString()}\n\n`, 'utf8');
            } catch (e) {}
        }
        const uri = vscode.Uri.file(logPath);
        await vscode.commands.executeCommand('vscode.open', uri);
    }

    public append(text: string) {
        this.logs.push(text);
        if (this.logs.length > 500) this.logs.shift();
        this.extractTokens(text);

        // Append to persistent log file on disk
        try {
            const logPath = this.getLogFilePath();
            const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
            fs.appendFileSync(logPath, `[${now}] ${cleanText}\n`, 'utf8');
        } catch (e) {}

        // Send to native PTY and all active terminals
        this.pty.writeLine(text);
        for (const p of this.activePtyList) {
            try { p.writeLine(text); } catch (e) {}
        }

        if (this.panel) {
            this.panel.webview.postMessage({ command: 'append', text });
        } else if (!this.terminal) {
            this.show(vscode.ViewColumn.Two, true);
        }
    }

    public setSessionInfo(info: { account?: string; project?: string }) {
        this.pty.setSessionInfo(info);
        for (const p of this.activePtyList) {
            try { p.setSessionInfo(info); } catch (e) {}
        }
    }

    public setGeeCwd(cwd: string) {
        this.pty.setGeeCwd(cwd);
        for (const p of this.activePtyList) {
            try { p.setGeeCwd(cwd); } catch (e) {}
        }
    }

    public setPromptActive(active: boolean) {
        if (this.pty && (this.pty as any).setPromptActive) {
            (this.pty as any).setPromptActive(active);
        }
        for (const p of this.activePtyList) {
            try { p.setPromptActive(active); } catch (e) {}
        }
    }

    public getRecentLogs(limit: number = 30): string[] {
        return this.logs.slice(-limit);
    }

    public clear() {
        this.logs = [];
        this.pty.clearScreen();
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'clear' });
        }
    }

    public addCompletions(items: string[]) {
        items.forEach(item => {
            this.knownCompletions.add(item);
            this.pty.knownCompletions.add(item);
        });
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'setCompletions', items });
        }
    }

    private extractTokens(text: string) {
        const matches = text.match(/(?:📁|🛰️|📊)\s+([a-zA-Z0-9_\-\.\/]+)/g);
        if (matches) {
            matches.forEach(m => {
                const clean = m.replace(/^(?:📁|🛰️|📊)\s+/, '').trim();
                if (clean) this.knownCompletions.add(clean);
            });
        }
    }

    private renderInitialLogsHtml(): string {
        return this.logs.map(text => {
            const formatted = formatLogEntry(text);
            return `<div class="${formatted.className}">${formatted.innerHtml}</div>`;
        }).join('');
    }

    private getHtml() {
        const initialLogs = this.renderInitialLogsHtml();
        const initialCompletions = JSON.stringify(Array.from(this.knownCompletions));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GEE Console</title>
    <style>
        * { box-sizing: border-box; }
        body { 
            background-color: var(--vscode-editor-background, #1e1e1e); 
            color: var(--vscode-editor-foreground, #d4d4d4); 
            font-family: var(--vscode-editor-font-family, 'JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', monospace); 
            font-size: var(--vscode-editor-font-size, 12.5px);
            line-height: 1.5;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
            user-select: text !important;
            -webkit-user-select: text !important;
        }
        .console-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 5px 12px;
            background: var(--vscode-editorWidget-background, #181818);
            border-bottom: 1px solid var(--vscode-editorWidget-border, #2d2d2d);
            font-size: 11px;
            user-select: none;
            z-index: 10;
        }
        .console-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground, #888);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .console-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #2ecc71;
            box-shadow: 0 0 5px #2ecc71;
        }
        .console-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .console-btn {
            background: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
            border: 1px solid var(--vscode-button-border, rgba(255, 255, 255, 0.15));
            color: var(--vscode-button-secondaryForeground, #ccc);
            padding: 2px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s ease;
        }
        .console-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.16));
            color: #fff;
        }
        #console { 
            flex: 1; 
            overflow-y: auto; 
            padding: 12px 14px;
            padding-bottom: 50px;
            scroll-behavior: smooth;
            user-select: text !important;
            -webkit-user-select: text !important;
            cursor: text;
        }
        .log-entry, .log-output, .log-error, .log-code, pre, code { 
            user-select: text !important; 
            -webkit-user-select: text !important;
        }
        .log-entry { 
            margin-bottom: 2px; 
            word-break: break-word;
            white-space: pre-wrap;
        }
        .log-code {
            color: var(--vscode-charts-blue, #007acc);
            font-weight: 500;
            white-space: pre-wrap;
        }
        .log-code .prompt {
            display: inline-block;
            width: 2ch;
            color: var(--vscode-charts-green, #4ec9b0);
            font-weight: bold;
            user-select: none;
        }
        .log-code .prompt-indent {
            display: inline-block;
            width: 2ch;
            user-select: none;
        }
        .log-output {
            color: var(--vscode-editor-foreground, #d4d4d4);
            padding-left: 14px;
        }
        .log-success {
            color: var(--vscode-charts-green, #4ec9b0);
            font-weight: 500;
        }
        .log-layer {
            color: var(--vscode-charts-yellow, #dcdcaa);
        }
        .log-error {
            color: var(--vscode-charts-red, #f48771);
            background: rgba(244, 135, 113, 0.08);
            border-left: 2px solid #f48771;
            padding-left: 8px;
        }
        .badge {
            display: inline-block;
            padding: 1px 7px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.3px;
            margin-right: 6px;
            vertical-align: baseline;
            line-height: 1.4;
            user-select: none;
        }
        .badge-python {
            background: rgba(53, 114, 165, 0.28);
            color: #4daafc;
            border: 1px solid rgba(77, 170, 252, 0.4);
            box-shadow: 0 0 6px rgba(77, 170, 252, 0.15);
        }
        .badge-geepro {
            background: rgba(46, 204, 113, 0.22);
            color: #2ecc71;
            border: 1px solid rgba(46, 204, 113, 0.4);
            box-shadow: 0 0 6px rgba(46, 204, 113, 0.15);
        }
        .badge-stderr {
            background: rgba(229, 192, 123, 0.22);
            color: #e5c07b;
            border: 1px solid rgba(229, 192, 123, 0.4);
        }
        .badge-error {
            background: rgba(244, 135, 113, 0.25);
            color: #ff6b6b;
            border: 1px solid rgba(255, 107, 107, 0.45);
        }
        .badge-pip {
            background: rgba(155, 89, 182, 0.22);
            color: #c792ea;
            border: 1px solid rgba(199, 146, 234, 0.35);
        }
        .badge-routing {
            background: rgba(198, 120, 221, 0.22);
            color: #c678dd;
            border: 1px solid rgba(198, 120, 221, 0.35);
        }
        .badge-js, .badge-javascript {
            background: rgba(247, 223, 30, 0.22);
            color: #f7df1e;
            border: 1px solid rgba(247, 223, 30, 0.4);
        }
        .badge-r {
            background: rgba(39, 109, 195, 0.25);
            color: #5dade2;
            border: 1px solid rgba(93, 173, 226, 0.4);
        }
        .badge-hint, .badge-aviso, .badge-tip {
            background: rgba(0, 180, 216, 0.2);
            color: #48cae4;
            border: 1px solid rgba(72, 202, 228, 0.35);
        }
        .badge-default {
            background: rgba(120, 120, 120, 0.2);
            color: #b0b0b0;
            border: 1px solid rgba(150, 150, 150, 0.3);
        }
        .log-divider {
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            margin: 6px 0;
        }
        .log-script-header {
            color: #61afef;
            font-weight: 600;
            margin: 6px 0 3px 0;
        }
        .script-title {
            color: var(--vscode-editor-foreground, #d4d4d4);
            font-weight: normal;
        }
        .log-cli-cmd {
            margin: 5px 0 2px 0;
        }
        .cli-prompt {
            color: var(--vscode-charts-green, #4ec9b0);
            font-weight: bold;
        }
        .cli-path {
            color: var(--vscode-charts-blue, #007acc);
        }
        .cli-text {
            color: #ffffff;
            font-weight: 500;
        }
        .log-stderr {
            color: var(--vscode-charts-yellow, #dcdcaa);
        }
        .tagged-text {
            vertical-align: baseline;
        }
        .input-container {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: #1f1f1f;
            display: flex;
            align-items: center;
            padding: 6px 14px;
            border-top: 1px solid #2d2d2d;
            box-shadow: 0 -3px 10px rgba(0,0,0,0.25);
        }
        .input-prompt { 
            color: var(--vscode-charts-green, #4ec9b0); 
            font-weight: bold; 
            margin-right: 8px;
            user-select: none;
            font-size: 13px;
        }
        #cmd-input {
            background: transparent;
            border: none;
            color: #ffffff;
            flex: 1;
            outline: none;
            font-family: inherit;
            font-size: 13px;
        }
        #cmd-input::placeholder {
            color: #555;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="console-header">
        <div class="console-title">
            <span class="console-dot"></span>
            <span>GEE Console</span>
        </div>
        <div class="console-actions">
            <button id="btn-copy-selection" class="console-btn" title="Copiar selección o todo al portapapeles (Cmd+C)">📋 Copiar</button>
            <button id="btn-open-log" class="console-btn" title="Abrir archivo log detallado (gee_console.log) en el editor">📄 Abrir Log</button>
            <button id="btn-clear" class="console-btn" title="Limpiar pantalla (Ctrl+L)">🧹 Limpiar</button>
        </div>
    </div>
    <div id="console">${initialLogs}</div>
    <div class="input-container">
        <span class="input-prompt">gee&gt;</span>
        <input type="text" id="cmd-input" placeholder="Ejecuta comandos CLI o código (Tab autocompleta)..." autofocus />
    </div>

    <script>
        let vscode;
        try {
            vscode = acquireVsCodeApi();
        } catch (e) {
            vscode = window.__vscodeApi;
        }
        window.__vscodeApi = vscode;

        // Toolbar buttons
        document.getElementById('btn-copy-selection')?.addEventListener('click', () => {
            const sel = window.getSelection().toString();
            const textToCopy = sel || consoleDiv.innerText;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textToCopy).catch(() => {});
            }
            if (vscode) {
                vscode.postMessage({ command: 'copyText', text: textToCopy });
            }
        });

        document.getElementById('btn-open-log')?.addEventListener('click', () => {
            if (vscode) {
                vscode.postMessage({ command: 'openLog' });
            }
        });

        document.getElementById('btn-clear')?.addEventListener('click', () => {
            consoleDiv.innerHTML = '';
            if (vscode) vscode.postMessage({ command: 'clearLogs' });
        });

        // Keydown listener for Cmd+C / Ctrl+C to guarantee copying in webviews
        window.addEventListener('keydown', (e) => {
            const isCmdOrCtrl = e.metaKey || e.ctrlKey;
            if (isCmdOrCtrl && e.key.toLowerCase() === 'c') {
                const sel = window.getSelection().toString();
                if (sel) {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(sel).catch(() => {});
                    }
                    if (vscode) {
                        vscode.postMessage({ command: 'copyText', text: sel });
                    }
                }
            }
        });

        window.onerror = function(message, source, lineno, colno, error) {
            try {
                if (vscode) {
                    vscode.postMessage({
                        command: 'webviewError',
                        message: String(message),
                        stack: error ? error.stack : (source + ':' + lineno + ':' + colno)
                    });
                }
            } catch (e) {}
        };

        const consoleDiv = document.getElementById('console');
        const cmdInput = document.getElementById('cmd-input');

        // Scroll to bottom immediately on load
        if (consoleDiv) {
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }

        let commandHistory = [];
        let historyIndex = -1;
        const knownCompletions = new Set(${initialCompletions});

        function escapeHtmlText(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatLogEntryText(text) {
            try {
                if (typeof text !== 'string') text = String(text || '');
                if (text.startsWith('>')) {
                    const codePart = text.startsWith('> ') ? text.substring(2) : text.substring(1);
                    return {
                        className: 'log-entry log-code',
                        innerHtml: '<span class="prompt">&gt;</span>' + escapeHtmlText(codePart)
                    };
                }

                if (text.startsWith('  ') && !text.startsWith('  📁') && !text.startsWith('  🛰️') && !text.startsWith('  📊') && !text.startsWith('  (empty') && !text.startsWith('  (no assets') && !text.startsWith('  Found')) {
                    return {
                        className: 'log-entry log-code',
                        innerHtml: '<span class="prompt-indent">&nbsp;&nbsp;</span>' + escapeHtmlText(text.substring(2))
                    };
                }

                if (text === '----------------------------------------' || text.startsWith('---')) {
                    return {
                        className: 'log-entry log-divider',
                        innerHtml: ''
                    };
                }

                const cliMatch = text.match(/^gee:([^>]+)>\\s*(.*)$/);
                if (cliMatch) {
                    return {
                        className: 'log-entry log-cli-cmd',
                        innerHtml: '<span class="cli-prompt">gee:<span class="cli-path">' + escapeHtmlText(cliMatch[1]) + '</span>&gt;</span> <span class="cli-text">' + escapeHtmlText(cliMatch[2]) + '</span>'
                    };
                }

                const tagMatch = text.match(/^\\[([-a-zA-Z0-9_ ]+)\\](?::)?\\s*(.*)$/);
                if (tagMatch) {
                    const rawTag = tagMatch[1];
                    const rest = tagMatch[2];
                    const tagSlug = rawTag.toLowerCase().replace(/[^a-z0-9]/g, '');

                    let badgeClass = 'badge';
                    if (tagSlug.includes('python') || tagSlug === 'py') badgeClass += ' badge-python';
                    else if (tagSlug.includes('geepro') || tagSlug.includes('gee')) badgeClass += ' badge-geepro';
                    else if (tagSlug.includes('stderr')) badgeClass += ' badge-stderr';
                    else if (tagSlug.includes('error')) badgeClass += ' badge-error';
                    else if (tagSlug.includes('pip')) badgeClass += ' badge-pip';
                    else if (tagSlug.includes('routing')) badgeClass += ' badge-routing';
                    else if (tagSlug.includes('js') || tagSlug.includes('javascript')) badgeClass += ' badge-js';
                    else if (tagSlug === 'r') badgeClass += ' badge-r';
                    else if (tagSlug.includes('hint') || tagSlug.includes('aviso') || tagSlug.includes('tip')) badgeClass += ' badge-hint';
                    else badgeClass += ' badge-default';

                    let extraClass = 'log-tagged';
                    if (badgeClass.includes('badge-error') || rest.toLowerCase().includes('error:')) extraClass += ' log-error';
                    else if (badgeClass.includes('badge-stderr')) extraClass += ' log-stderr';
                    else if (rest.startsWith('Adding layer:') || rest.startsWith('Layer added:') || rest.startsWith('[GEE IDE] Layer added:')) extraClass += ' log-layer';

                    return {
                        className: 'log-entry ' + extraClass,
                        innerHtml: '<span class="' + badgeClass + '">[' + escapeHtmlText(rawTag) + ']</span><span class="tagged-text">' + escapeHtmlText(rest) + '</span>'
                    };
                }

                if (text.startsWith('Running full script')) {
                    const langMatch = text.match(/\\[([A-Z]+)\\]/);
                    const lang = langMatch ? langMatch[1] : '';
                    const langSlug = lang.toLowerCase();
                    let badgeClass = 'badge';
                    if (langSlug.includes('py')) badgeClass += ' badge-python';
                    else if (langSlug.includes('js')) badgeClass += ' badge-js';
                    else if (langSlug.includes('r')) badgeClass += ' badge-r';
                    else badgeClass += ' badge-default';

                    return {
                        className: 'log-entry log-script-header',
                        innerHtml: '▶ <span class="' + badgeClass + '">[' + escapeHtmlText(lang) + ']</span> <span class="script-title">Running full script...</span>'
                    };
                }

                if (text.startsWith('[Error]') || text.startsWith('[stderr]') || text.toLowerCase().includes('error:')) {
                    return {
                        className: 'log-entry log-error',
                        innerHtml: escapeHtmlText(text)
                    };
                }

                if (text.includes('Ready') || text.includes('Successful') || text.includes('Welcome')) {
                    return {
                        className: 'log-entry log-success',
                        innerHtml: escapeHtmlText(text)
                    };
                }

                if (text.startsWith('Adding layer:') || text.startsWith('[GEE IDE] Layer added:')) {
                    return {
                        className: 'log-entry log-layer',
                        innerHtml: escapeHtmlText(text)
                    };
                }

                return {
                    className: 'log-entry log-output',
                    innerHtml: escapeHtmlText(text)
                };
            } catch (err) {
                return {
                    className: 'log-entry log-output',
                    innerHtml: escapeHtmlText(String(text || ''))
                };
            }
        }

        function appendSingleEntry(text) {
            if (!text || text === 'gee>' || text === 'gee> ') return;
            const formatted = formatLogEntryText(text);
            const entry = document.createElement('div');
            entry.className = formatted.className;
            entry.innerHTML = formatted.innerHtml;
            consoleDiv.appendChild(entry);
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }

        function requestFreshCompletions() {
            if (vscode) vscode.postMessage({ command: 'requestCompletions' });
        }

        cmdInput.addEventListener('focus', requestFreshCompletions);

        // Click anywhere in console pane to focus input automatically
        document.body.addEventListener('click', (e) => {
            const sel = window.getSelection();
            if (!sel || sel.toString().length === 0) {
                cmdInput.focus();
            }
        });

        cmdInput.addEventListener('keydown', (e) => {
            const isCmdOrCtrl = e.metaKey || e.ctrlKey;
            if (isCmdOrCtrl && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                consoleDiv.innerHTML = '';
                if (vscode) vscode.postMessage({ command: 'clearLogs' });
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = cmdInput.value.trim();
                if (cmd) {
                    commandHistory.push(cmd);
                    historyIndex = -1;
                    cmdInput.value = '';
                    if (cmd === 'clear' || cmd === 'cls') {
                        consoleDiv.innerHTML = '';
                        if (vscode) vscode.postMessage({ command: 'clearLogs' });
                    } else if (vscode) {
                        vscode.postMessage({ command: 'geeCommand', text: cmd });
                    }
                }
                return;
            }

            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                if (vscode) vscode.postMessage({ command: 'requestCompletions' });

                const val = cmdInput.value;
                const cursorPos = cmdInput.selectionStart;
                const leftPart = val.substring(0, cursorPos);
                const rightPart = val.substring(cursorPos);
                
                // Extract current token/word before cursor
                const match = leftPart.match(/[a-zA-Z0-9_./-]+$/);
                const word = match ? match[0] : '';
                const wordStart = match ? leftPart.length - word.length : cursorPos;
                const prefix = word.toLowerCase();

                const allItems = Array.from(knownCompletions);
                if (prefix) {
                    const matches = allItems.filter(c => c.toLowerCase().startsWith(prefix));
                    if (matches.length === 1) {
                        const matchStr = matches[0];
                        const trailing = matchStr.endsWith('/') ? '' : ' ';
                        cmdInput.value = val.substring(0, wordStart) + matchStr + trailing + rightPart;
                        const newPos = wordStart + matchStr.length + trailing.length;
                        cmdInput.selectionStart = cmdInput.selectionEnd = newPos;
                    } else if (matches.length > 1) {
                        appendSingleEntry('🔹 ' + matches.join('   '));
                        let common = matches[0];
                        for (let i = 1; i < matches.length; i++) {
                            while (!matches[i].toLowerCase().startsWith(common.toLowerCase()) && common.length > 0) {
                                common = common.substring(0, common.length - 1);
                            }
                        }
                        if (common.length > word.length) {
                            cmdInput.value = val.substring(0, wordStart) + common + rightPart;
                            const newPos = wordStart + common.length;
                            cmdInput.selectionStart = cmdInput.selectionEnd = newPos;
                        }
                    } else {
                        appendSingleEntry('ℹ️ No hay coincidencias para: ' + word);
                    }
                } else {
                    appendSingleEntry('💡 Sugerencias: ' + allItems.slice(0, 16).join('  ') + (allItems.length > 16 ? ' ...' : ''));
                }
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (commandHistory.length > 0) {
                    if (historyIndex === -1) historyIndex = commandHistory.length - 1;
                    else if (historyIndex > 0) historyIndex--;
                    cmdInput.value = commandHistory[historyIndex];
                    cmdInput.selectionStart = cmdInput.selectionEnd = cmdInput.value.length;
                }
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex !== -1) {
                    if (historyIndex < commandHistory.length - 1) {
                        historyIndex++;
                        cmdInput.value = commandHistory[historyIndex];
                    } else {
                        historyIndex = -1;
                        cmdInput.value = '';
                    }
                    cmdInput.selectionStart = cmdInput.selectionEnd = cmdInput.value.length;
                }
                return;
            }
        });

        window.addEventListener('keydown', e => {
            const isCmdOrCtrl = e.metaKey || e.ctrlKey;
            if (isCmdOrCtrl && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                e.stopPropagation();
                consoleDiv.innerHTML = '';
                if (vscode) vscode.postMessage({ command: 'clearLogs' });
                return;
            }
            if (isCmdOrCtrl && ['1', '2', '3', '4'].includes(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                if (vscode) vscode.postMessage({ command: 'focusQuadrant', quadrant: Number(e.key) });
            }
        }, true);

        window.addEventListener('message', event => {
            const message = event.data;
            if (!message) return;
            if (message.command === 'focus') {
                cmdInput.focus();
                cmdInput.selectionStart = cmdInput.selectionEnd = cmdInput.value.length;
            } else if (message.command === 'append') {
                appendSingleEntry(message.text);
            } else if (message.command === 'syncLogs') {
                consoleDiv.innerHTML = '';
                if (Array.isArray(message.logs)) {
                    message.logs.forEach(appendSingleEntry);
                }
            } else if (message.command === 'clear') {
                consoleDiv.innerHTML = '';
            } else if (message.command === 'setCompletions') {
                if (Array.isArray(message.items)) {
                    message.items.forEach(item => knownCompletions.add(item));
                }
            } else if (message.command === 'setHistory') {
                if (Array.isArray(message.history)) {
                    commandHistory = message.history;
                    historyIndex = -1;
                }
            } else if (message.command === 'addHistory') {
                if (message.text && (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== message.text)) {
                    commandHistory.push(message.text);
                    historyIndex = -1;
                }
            }
        });

        // Notify extension that console webview DOM & JS are fully loaded
        try {
            if (vscode) {
                vscode.postMessage({ command: 'consoleReady' });
            }
        } catch (e) {}
    </script>
</body>
</html>`;
    }
}
