import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export function formatFileSize(bytes: number): string {
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

export function formatLocalFileEntry(filename: string, fullPath: string): string {
    try {
        if (!fs.existsSync(fullPath)) {
            return `\x1b[37m${filename}\x1b[0m`;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            return `\x1b[1;34m📁 ${filename}/\x1b[0m`;
        }
        // Executable
        if (stat.mode & 0o111) {
            return `\x1b[1;31m⚙️ ${filename}*\x1b[0m`;
        }
        const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
        // Code scripts
        if (['gee', 'js', 'py', 'r', 'sh', 'bash', 'zsh', 'ts'].includes(ext)) {
            return `\x1b[1;32m📜 ${filename}\x1b[0m`;
        }
        // GIS and project data
        if (['geojson', 'shp', 'kml', 'kmz', 'gpkg', 'geeproj', 'geedata'].includes(ext)) {
            return `\x1b[1;36m🗺️ ${filename}\x1b[0m`;
        }
        // Images and rasters
        if (['tif', 'tiff', 'png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext)) {
            return `\x1b[1;35m🖼️ ${filename}\x1b[0m`;
        }
        // Compressed archives
        if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar'].includes(ext)) {
            return `\x1b[1;33m📦 ${filename}\x1b[0m`;
        }
        // Configuration
        if (['json', 'yaml', 'yml', 'xml', 'toml', 'env'].includes(ext)) {
            return `\x1b[36m⚙️ ${filename}\x1b[0m`;
        }
        // Documentation & logs
        if (['md', 'txt', 'pdf', 'log'].includes(ext)) {
            return `\x1b[37m📄 ${filename}\x1b[0m`;
        }
    } catch (e) {}
    return `\x1b[37m${filename}\x1b[0m`;
}

export function formatToAnsi(text: string): string {
    let clean = text.replace(/\r?\n$/, '');

    // 1. Prompts and script headers
    if (clean.startsWith('Running full script') || clean.startsWith('▶ Running full script')) {
        return `\x1b[1;36m▶ ${clean.replace(/^▶\s*/, '')}\x1b[0m`;
    }
    if (clean.startsWith('> ')) {
        return `\x1b[1;36m>\x1b[0m \x1b[37m${clean.substring(2)}\x1b[0m`;
    }
    if (clean === '----------------------------------------' || clean.startsWith('---')) {
        return '\x1b[90m------------------------------------------------------------\x1b[0m';
    }

    // 2. CLI prompt format: gee:~>
    const cliMatch = clean.match(/^gee:([^>]+)>\s*(.*)$/);
    if (cliMatch) {
        return `\x1b[1;32mgee:\x1b[36m${cliMatch[1]}\x1b[1;32m>\x1b[0m ${cliMatch[2]}`;
    }

    // 3. GEE Asset Listings (Carpetas, Colecciones, Imágenes, Tablas)
    const assetMatch = clean.match(/^\s*(📁|🛰️|📊)\s+([^\s\[]+)\s*\[(FOLDER|IMAGE_COLLECTION|IMAGE|TABLE|ASSET)\](.*)$/);
    if (assetMatch) {
        const icon = assetMatch[1];
        const name = assetMatch[2];
        const type = assetMatch[3];
        const extra = assetMatch[4] || '';

        let color = '\x1b[1;34m'; // FOLDER: Azul Intenso
        if (type === 'IMAGE_COLLECTION') color = '\x1b[1;35m'; // IMAGE_COLLECTION: Magenta Neón
        else if (type === 'IMAGE') color = '\x1b[1;32m'; // IMAGE: Verde Esmeralda
        else if (type === 'TABLE') color = '\x1b[1;33m'; // TABLE: Ámbar / Amarillo

        return `  ${icon} ${color}${name}\x1b[0m \x1b[90m[\x1b[0m${color}${type}\x1b[0m\x1b[90m]\x1b[0m\x1b[90m${extra}\x1b[0m`;
    }

    // 4. Asset Roots Listing: 📁 root_name [TYPE] (id)
    const rootMatch = clean.match(/^\s*📁\s+([^\s\[]+)\s*\[([^\]]+)\]\s*\(([^)]+)\)$/);
    if (rootMatch) {
        const shortName = rootMatch[1];
        const type = rootMatch[2];
        const id = rootMatch[3];
        return `  \x1b[1;34m📁 ${shortName}\x1b[0m \x1b[90m[\x1b[35m${type}\x1b[90m]  (\x1b[36m${id}\x1b[90m)\x1b[0m`;
    }

    // 5. Memory Variables Listing (JS: 🔹 k : type detail)
    const varMatch = clean.match(/^\s*🔹\s+([a-zA-Z0-9_$]+)\s*:\s*([^\s=]+)(.*)$/);
    if (varMatch) {
        const varName = varMatch[1];
        const typeName = varMatch[2];
        const detail = varMatch[3] || '';
        return `  \x1b[1;36m🔹 ${varName}\x1b[0m : \x1b[1;33m${typeName}\x1b[0m \x1b[37m${detail}\x1b[0m`;
    }

    // 6. Memory Variables Listing (Python REPL: k (type) = val)
    const pyVarMatch = clean.match(/^\s*([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*=\s*(.*)$/);
    if (pyVarMatch && !clean.includes('def ') && !clean.includes('class ')) {
        const varName = pyVarMatch[1];
        const typeName = pyVarMatch[2];
        const val = pyVarMatch[3];
        return `  \x1b[1;36m🔹 ${varName}\x1b[0m \x1b[90m(\x1b[1;33m${typeName}\x1b[0m\x1b[90m)\x1b[0m \x1b[90m=\x1b[0m \x1b[37m${val}\x1b[0m`;
    }

    // 7. Storage Quotas: 🔹 [root]: used / limit (pct)
    const quotaMatch = clean.match(/^\s*🔹\s+\[([^\]]+)\]:\s*([^\/]+)\/\s*([^(]+)(.*)$/);
    if (quotaMatch) {
        const root = quotaMatch[1];
        const used = quotaMatch[2].trim();
        const limit = quotaMatch[3].trim();
        const pct = quotaMatch[4].trim();
        return `  \x1b[1;36m🔹 [${root}]\x1b[0m: \x1b[1;32m${used}\x1b[0m / \x1b[37m${limit}\x1b[0m \x1b[33m${pct}\x1b[0m`;
    }

    // 8. [Tag] prefixes: [python], [Error], [stderr], [GEE IDE], [pip], [R], [Routing], [Hint]
    const tagMatch = clean.match(/^\[([-a-zA-Z0-9_ ]+)\](?::)?\s*(.*)$/);
    if (tagMatch) {
        const rawTag = tagMatch[1];
        const rest = tagMatch[2];
        const tagSlug = rawTag.toLowerCase().replace(/[^a-z0-9]/g, '');

        let colorCode = '\x1b[1;37m'; // white
        if (tagSlug.includes('python') || tagSlug === 'py') colorCode = '\x1b[1;33m'; // yellow
        else if (tagSlug.includes('geepro') || tagSlug.includes('gee')) colorCode = '\x1b[1;32m'; // green
        else if (tagSlug.includes('stderr')) colorCode = '\x1b[1;31m'; // bright red
        else if (tagSlug.includes('error')) colorCode = '\x1b[1;31m'; // bright red
        else if (tagSlug.includes('pip')) colorCode = '\x1b[1;36m'; // cyan
        else if (tagSlug.includes('routing')) colorCode = '\x1b[1;35m'; // magenta
        else if (tagSlug.includes('js') || tagSlug.includes('javascript')) colorCode = '\x1b[1;32m'; // green
        else if (tagSlug === 'r') colorCode = '\x1b[1;34m'; // blue
        else if (tagSlug.includes('hint') || tagSlug.includes('aviso') || tagSlug.includes('tip')) colorCode = '\x1b[1;33m'; // yellow

        let restColor = '\x1b[0m';
        if (colorCode.includes('31')) restColor = '\x1b[31m';

        return `${colorCode}[${rawTag}]\x1b[0m ${restColor}${rest}\x1b[0m`;
    }

    // 9. Errors
    if (clean.startsWith('[Error]') || clean.startsWith('[stderr]') || clean.toLowerCase().includes('error:')) {
        return `\x1b[1;31m${clean}\x1b[0m`;
    }

    // 10. Layer additions
    if (clean.startsWith('Adding layer:') || clean.startsWith('Layer added:') || clean.startsWith('[GEE IDE] Layer added:')) {
        return `\x1b[1;35m${clean}\x1b[0m`;
    }

    // 11. Success
    if (clean.includes('Ready') || clean.includes('Successful') || clean.includes('Welcome')) {
        return `\x1b[1;32m${clean}\x1b[0m`;
    }

    return clean;
}

export class GEEPseudoterminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    public readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    private closeEmitter = new vscode.EventEmitter<void | number>();
    public readonly onDidClose: vscode.Event<void | number> = this.closeEmitter.event;

    private lineBuffer: string = '';
    private cursorIndex: number = 0;

    private history: string[] = [];
    private historyIndex: number = -1;
    private savedCurrentLine: string = '';

    private activeProcess: child_process.ChildProcess | null = null;
    private localCwd: string = '';
    private langMode: 'js' | 'py' | 'r' = 'js';
    private geeCwd: string = '~';
    private isPromptActive: boolean = false;

    public onCommandSubmit?: (cmd: string) => Promise<void>;
    public onInterrupt?: () => void;
    public historyLoader?: () => string[];
    public historySaver?: (cmd: string) => void;
    public logFilePathGetter?: () => string;
    public openLogFileFunc?: () => Promise<void>;
    public recentLogsGetter?: () => string[];
    public knownCompletions: Set<string> = new Set();
    private isOpen: boolean = false;
    private earlyBuffer: string[] = [];
    private sessionInfo?: { account?: string; project?: string };

    constructor(private context?: vscode.ExtensionContext) {}

    public setSessionInfo(info: { account?: string; project?: string }): void {
        this.sessionInfo = info;
        if (this.isOpen && this.isPromptActive && this.lineBuffer.length === 0) {
            this.clearScreen(false);
            this.printBanner();
            this.writePrompt();
        }
    }

    public printBanner(): void {
        const plat = `${os.platform()} ${os.arch()}`;

        // Obtener versión dinámicamente desde el contexto de la extensión o package.json
        let ver = '';
        try {
            if (this.context?.extension?.packageJSON?.version) {
                ver = this.context.extension.packageJSON.version;
            } else {
                const ext = vscode.extensions.getExtension('LuisRobles.gee-pro-ide');
                if (ext?.packageJSON?.version) {
                    ver = ext.packageJSON.version;
                }
            }
        } catch (e) {}

        let dateStr = '2026-10-26';
        try {
            const candidatePaths = [
                this.context ? path.join(this.context.extensionPath, 'package.json') : '',
                path.join(__dirname, '..', 'package.json'),
                path.join(__dirname, '..', '..', 'package.json')
            ].filter(Boolean);

            for (const pkgPath of candidatePaths) {
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    if (pkg.version && !ver) {
                        ver = pkg.version;
                    }
                    const stat = fs.statSync(pkgPath);
                    dateStr = stat.mtime.toISOString().split('T')[0];
                    break;
                }
            }
        } catch (e) {}

        if (!ver) {
            ver = '0.1.41';
        }

        const title = 'Scientific Geospatial Workspace';
        const email = this.sessionInfo?.account;
        const proj = this.sessionInfo?.project;
        const accountStr = email ? `\x1b[37mConnected:\x1b[0m \x1b[1;32m${email}\x1b[0m` : '\x1b[90mSession: Standalone / Guest\x1b[0m';
        const projStr = proj ? ` \x1b[90m(Project: \x1b[36m${proj}\x1b[90m)\x1b[0m` : '';

        this.writeEmitter.fire('\r\n');
        this.writeEmitter.fire(`\x1b[1;37mGEE IDE ${ver}\x1b[0m \x1b[90m(${dateStr}) -- "${title}"\x1b[0m\r\n`);
        this.writeEmitter.fire(`\x1b[90mPlatform: ${plat} | Engines: JavaScript, Python 3.11 & R\x1b[0m\r\n`);
        this.writeEmitter.fire(`${accountStr}${projStr}\r\n\r\n`);
        this.writeEmitter.fire(`\x1b[90mType '\x1b[36mhelp\x1b[90m' for GEE documentation, '\x1b[36mvars\x1b[90m' to inspect scope, '\x1b[36mclear\x1b[90m' to wipe screen.\x1b[0m\r\n`);
        this.writeEmitter.fire(`\x1b[90mLocal commands: .ls, .pwd, .pip, .git (or !ls, !git)\x1b[0m\r\n\r\n`);
    }

    public open(_dimensions: vscode.TerminalDimensions | undefined): void {
        this.isOpen = true;
        this.printBanner();

        // Replay any output lines that were sent before open() finished
        if (this.earlyBuffer.length > 0) {
            for (const b of this.earlyBuffer) {
                this.writeEmitter.fire(b + '\r\n');
            }
            this.earlyBuffer = [];
        }

        this.writePrompt();
    }

    public close(): void {
        this.isOpen = false;
        if (this.activeProcess) {
            try { this.activeProcess.kill(); } catch (e) {}
            this.activeProcess = null;
        }
    }

    public setDimensions(_dimensions: vscode.TerminalDimensions): void {
        // Synchronize terminal dimensions with VS Code
    }

    public setLangMode(mode: 'js' | 'py' | 'r') {
        if (this.langMode !== mode) {
            this.langMode = mode;
            if (this.isPromptActive && this.lineBuffer.length === 0) {
                this.writeEmitter.fire('\r\x1b[K');
                this.writePrompt();
            }
        }
    }

    public getLangMode(): 'js' | 'py' | 'r' {
        return this.langMode;
    }

    public setGeeCwd(cwd: string) {
        this.geeCwd = cwd;
        if (this.isPromptActive && this.lineBuffer.length === 0) {
            this.writeEmitter.fire('\r\x1b[K');
            this.writePrompt();
        }
    }

    public setPromptActive(active: boolean): void {
        if (this.isPromptActive && !active && this.lineBuffer.length === 0) {
            this.writeEmitter.fire('\r\x1b[K');
        }
        this.isPromptActive = active;
    }

    public writePrompt(): void {
        this.isPromptActive = true;
        let modeTag = '';
        if (this.langMode === 'py') {
            modeTag = '\x1b[1;33m(py)\x1b[0m ';
        } else if (this.langMode === 'r') {
            modeTag = '\x1b[1;34m(r)\x1b[0m ';
        }

        const cwdDisplay = (this.geeCwd && this.geeCwd !== '~') ? `:\x1b[36m${this.geeCwd}\x1b[0m` : '';
        const promptStr = `\x1b[1;32mgee\x1b[0m${cwdDisplay} ${modeTag}\x1b[1;32m>\x1b[0m `;
        this.writeEmitter.fire(promptStr);
    }

    public writeLine(text: string): void {
        const trimmed = text.trim();
        // Ignore standalone prompt echoes from legacy code
        if (trimmed === 'gee>' || trimmed === 'gee >' || trimmed === 'gee:~>' || trimmed === 'gee:~ >' || trimmed === '>') {
            if (!this.isPromptActive && this.lineBuffer.length === 0) {
                this.writePrompt();
            }
            return;
        }

        const formatted = formatToAnsi(text);

        if (!this.isOpen) {
            this.earlyBuffer.push(formatted);
            return;
        }

        if (this.isPromptActive) {
            // The prompt was on the current line: erase it before writing incoming log output
            this.writeEmitter.fire('\r\x1b[K');
            this.writeEmitter.fire(formatted + '\r\n');
            // Re-render prompt and ongoing typed line
            this.writePrompt();
            if (this.lineBuffer.length > 0) {
                this.writeEmitter.fire(this.lineBuffer);
                const backCount = this.lineBuffer.length - this.cursorIndex;
                if (backCount > 0) {
                    this.writeEmitter.fire(`\x1b[${backCount}D`);
                }
            }
        } else {
            // Command is actively running: write line directly
            this.writeEmitter.fire(formatted + '\r\n');
        }
    }

    public clearScreen(purgeScrollback: boolean = false): void {
        if (purgeScrollback) {
            this.writeEmitter.fire('\x1b[2J\x1b[3J\x1b[H');
        } else {
            // Standard terminal clear: clears screen, preserves scrollback buffer so user can scroll up
            this.writeEmitter.fire('\x1b[2J\x1b[H');
        }
        this.lineBuffer = '';
        this.cursorIndex = 0;
    }

    public interrupt(): void {
        if (this.activeProcess) {
            try { this.activeProcess.kill('SIGINT'); } catch (e) {}
            this.activeProcess = null;
        }
        if (this.onInterrupt) {
            try { this.onInterrupt(); } catch (e) {}
        }
        this.writeEmitter.fire('\r\n\x1b[1;31m🛑 Ejecución cancelada (Stop)\x1b[0m\r\n');
        this.lineBuffer = '';
        this.cursorIndex = 0;
        this.historyIndex = -1;
        this.isPromptActive = true;
        this.writePrompt();
    }

    public handleInput(data: string): void {
        // If an active local child process is taking input
        if (this.activeProcess && this.activeProcess.stdin && !this.activeProcess.stdin.destroyed) {
            if (data === '\x03') { // Ctrl+C
                try { this.activeProcess.kill('SIGINT'); } catch (e) {}
                this.activeProcess = null;
                this.writeEmitter.fire('^C\r\n');
                this.writePrompt();
                return;
            }
            this.activeProcess.stdin.write(data);
            return;
        }

        // Ctrl+C (Interrupt)
        if (data === '\x03') {
            this.writeEmitter.fire('^C\r\n');
            if (this.onInterrupt) {
                try { this.onInterrupt(); } catch (e) {}
            }
            this.lineBuffer = '';
            this.cursorIndex = 0;
            this.historyIndex = -1;
            this.isPromptActive = true;
            this.writePrompt();
            return;
        }

        // Ctrl+L (Clear screen)
        if (data === '\x0c') {
            this.clearScreen();
            this.writePrompt();
            if (this.lineBuffer) {
                this.writeEmitter.fire(this.lineBuffer);
            }
            return;
        }

        // Enter (\r or \n)
        if (data === '\r' || data === '\n') {
            this.writeEmitter.fire('\r\n');
            const submitted = this.lineBuffer;
            this.lineBuffer = '';
            this.cursorIndex = 0;
            this.historyIndex = -1;
            this.processCommand(submitted);
            return;
        }

        // Backspace (\x7f or \x08)
        if (data === '\x7f' || data === '\x08') {
            if (this.cursorIndex > 0) {
                this.lineBuffer = this.lineBuffer.slice(0, this.cursorIndex - 1) + this.lineBuffer.slice(this.cursorIndex);
                this.cursorIndex--;
                this.writeEmitter.fire('\b\x1b[K' + this.lineBuffer.slice(this.cursorIndex));
                const back = this.lineBuffer.length - this.cursorIndex;
                if (back > 0) {
                    this.writeEmitter.fire(`\x1b[${back}D`);
                }
            }
            return;
        }

        // Delete (\x1b[3~)
        if (data === '\x1b[3~') {
            if (this.cursorIndex < this.lineBuffer.length) {
                this.lineBuffer = this.lineBuffer.slice(0, this.cursorIndex) + this.lineBuffer.slice(this.cursorIndex + 1);
                this.writeEmitter.fire('\x1b[K' + this.lineBuffer.slice(this.cursorIndex));
                const back = this.lineBuffer.length - this.cursorIndex;
                if (back > 0) {
                    this.writeEmitter.fire(`\x1b[${back}D`);
                }
            }
            return;
        }

        // Arrow Left (\x1b[D)
        if (data === '\x1b[D') {
            if (this.cursorIndex > 0) {
                this.cursorIndex--;
                this.writeEmitter.fire('\x1b[D');
            }
            return;
        }

        // Arrow Right (\x1b[C)
        if (data === '\x1b[C') {
            if (this.cursorIndex < this.lineBuffer.length) {
                this.cursorIndex++;
                this.writeEmitter.fire('\x1b[C');
            }
            return;
        }

        // Home (\x1b[H or \x1b[1~ or \x01 / Ctrl+A)
        if (data === '\x1b[H' || data === '\x1b[1~' || data === '\x01') {
            if (this.cursorIndex > 0) {
                this.writeEmitter.fire(`\x1b[${this.cursorIndex}D`);
                this.cursorIndex = 0;
            }
            return;
        }

        // End (\x1b[F or \x1b[4~ or \x05 / Ctrl+E)
        if (data === '\x1b[F' || data === '\x1b[4~' || data === '\x05') {
            const diff = this.lineBuffer.length - this.cursorIndex;
            if (diff > 0) {
                this.writeEmitter.fire(`\x1b[${diff}C`);
                this.cursorIndex = this.lineBuffer.length;
            }
            return;
        }

        // Arrow Up (\x1b[A) - Historial anterior
        if (data === '\x1b[A') {
            this.navigateHistory(-1);
            return;
        }

        // Arrow Down (\x1b[B) - Historial siguiente
        if (data === '\x1b[B') {
            this.navigateHistory(1);
            return;
        }

        // Ctrl+U (Borrar hasta inicio de línea)
        if (data === '\x15') {
            if (this.cursorIndex > 0) {
                const remaining = this.lineBuffer.slice(this.cursorIndex);
                this.writeEmitter.fire(`\x1b[${this.cursorIndex}D\x1b[K${remaining}`);
                const back = remaining.length;
                if (back > 0) this.writeEmitter.fire(`\x1b[${back}D`);
                this.lineBuffer = remaining;
                this.cursorIndex = 0;
            }
            return;
        }

        // Ctrl+K (Borrar hasta fin de línea)
        if (data === '\x0b') {
            this.lineBuffer = this.lineBuffer.slice(0, this.cursorIndex);
            this.writeEmitter.fire('\x1b[K');
            return;
        }

        // Tab (\t) - Autocompletado
        if (data === '\t') {
            this.handleTabCompletion();
            return;
        }

        // Ignorar secuencias de escape no reconocidas
        if (data.startsWith('\x1b')) {
            return;
        }

        // Inserción de caracteres normales o texto pegado
        if (this.cursorIndex === this.lineBuffer.length) {
            this.lineBuffer += data;
            this.cursorIndex += data.length;
            this.writeEmitter.fire(data);
        } else {
            const before = this.lineBuffer.slice(0, this.cursorIndex);
            const after = this.lineBuffer.slice(this.cursorIndex);
            this.lineBuffer = before + data + after;
            this.cursorIndex += data.length;
            this.writeEmitter.fire(data + after);
            const back = after.length;
            if (back > 0) {
                this.writeEmitter.fire(`\x1b[${back}D`);
            }
        }
    }

    private navigateHistory(direction: number): void {
        const hist = this.getHistoryList();
        if (hist.length === 0) return;

        if (this.historyIndex === -1) {
            this.savedCurrentLine = this.lineBuffer;
            if (direction === -1) {
                this.historyIndex = hist.length - 1;
            } else {
                return;
            }
        } else {
            const nextIdx = this.historyIndex + direction;
            if (nextIdx >= 0 && nextIdx < hist.length) {
                this.historyIndex = nextIdx;
            } else if (nextIdx >= hist.length) {
                this.historyIndex = -1;
                this.setLine(this.savedCurrentLine);
                return;
            } else {
                return;
            }
        }

        if (this.historyIndex >= 0 && this.historyIndex < hist.length) {
            this.setLine(hist[this.historyIndex]);
        }
    }

    private setLine(newLine: string): void {
        this.writeEmitter.fire('\r\x1b[K');
        this.writePrompt();
        this.lineBuffer = newLine;
        this.cursorIndex = newLine.length;
        this.writeEmitter.fire(newLine);
    }

    private getHistoryList(): string[] {
        if (this.historyLoader) {
            return this.historyLoader();
        }
        return this.history;
    }

    private async processCommand(rawCmd: string): Promise<void> {
        let cmd = rawCmd.trim();

        if (!cmd) {
            this.writePrompt();
            return;
        }

        this.isPromptActive = false;

        try {
            // Guardar comando en historial
            if (this.historySaver) {
                this.historySaver(cmd);
            }
            this.history.push(cmd);

            // 1. Expansión bash de historial: !<número> (ej. !750)
            // REGLA CRÍTICA: Coincidencia estricta /^!\d+$/ para no capturar comandos de shell como !ls
            if (cmd.match(/^!\d+$/)) {
                const targetIdx = parseInt(cmd.substring(1), 10) - 1;
                const historyList = this.getHistoryList();
                if (targetIdx >= 0 && targetIdx < historyList.length) {
                    const expanded = historyList[targetIdx];
                    this.writeEmitter.fire(`\x1b[36m🔄 Expandiendo [${targetIdx + 1}]: ${expanded}\x1b[0m\r\n`);
                    cmd = expanded;
                } else {
                    this.writeEmitter.fire(`\x1b[31m[Error] Evento no encontrado en historial: ${cmd}\x1b[0m\r\n`);
                    return;
                }
            }

            // 2. Comando Clear: clear o cls
            if (cmd === 'clear' || cmd === 'cls') {
                this.clearScreen();
                return;
            }

            // 3. Comando Log: log o .log
            if (cmd === 'log' || cmd === '.log') {
                if (this.openLogFileFunc) {
                    await this.openLogFileFunc();
                    this.writeEmitter.fire(`\x1b[32m📄 Abriendo gee_console.log en el editor...\x1b[0m\r\n`);
                }
                return;
            }

            // 3b. Abrir nuevo terminal independiente: term, .term, new, .new
            if (['new', '.new', 'term', '.term', 'newterm'].includes(cmd.toLowerCase())) {
                vscode.commands.executeCommand('gee-pro.newTerminal');
                this.writeEmitter.fire(`\x1b[32m🖥️ Abriendo nueva pestaña de terminal independiente...\x1b[0m\r\n`);
                return;
            }

            // 4. Cambio de lenguaje: py, python, js, r
            if (cmd === 'python' || cmd === 'py') {
                this.setLangMode('py');
                this.writeEmitter.fire(`\x1b[1;33m🐍 Modo Python activado.\x1b[0m Código y comandos se evaluarán en Python REPL.\r\n`);
                return;
            }
            if (cmd === 'js' || cmd === 'javascript') {
                this.setLangMode('js');
                this.writeEmitter.fire(`\x1b[1;32m🛰️ Modo JavaScript activado.\x1b[0m Código y comandos se evaluarán en Earth Engine JS.\r\n`);
                return;
            }
            if (cmd === 'r') {
                this.setLangMode('r');
                this.writeEmitter.fire(`\x1b[1;34m📊 Modo R activado.\x1b[0m\r\n`);
                return;
            }

            // 5. Menú de ayuda
            if (cmd === 'help' || cmd === '?') {
                this.printHelp();
                return;
            }

            // 6. Comando History: history o history(10)
            if (cmd === 'history' || cmd.startsWith('history(') || cmd.startsWith('history ')) {
                this.printHistory(cmd);
                return;
            }

            // 7. Comando de shell local en el directorio del proyecto:
            // Inicia con '.' (ej. .ls, .pwd, .git status, .cd, .pip)
            // O inicia con '!' seguido de un caracter NO numérico (ej. !ls, !git status, !pip list)
            const isDot = cmd.startsWith('.');
            const isExcl = cmd.startsWith('!') && !cmd.match(/^!\d+/);

            if (isDot || isExcl) {
                const shellCmd = isDot ? cmd.substring(1).trim() : cmd.substring(1).trim();
                await this.runLocalShellCommand(shellCmd);
                return;
            }

            // 8. Despachar a runtime GEE / Python
            if (this.onCommandSubmit) {
                try {
                    await this.onCommandSubmit(cmd);
                } catch (err: any) {
                    this.writeEmitter.fire(`\x1b[31m[Error]: ${err.message || err}\x1b[0m\r\n`);
                }
            }
        } finally {
            this.isPromptActive = true;
            this.writePrompt();
        }
    }

    private printHelp(): void {
        this.writeEmitter.fire('\r\n\x1b[1;32m=== GEE IDE Terminal — Comandos Disponibles ===\x1b[0m\r\n');
        this.writeEmitter.fire('  \x1b[1;36mComandos locales del proyecto (Shell):\x1b[0m\r\n');
        this.writeEmitter.fire('    \x1b[33m.ls\x1b[0m o \x1b[33m!ls\x1b[0m             Listar archivos en el directorio del proyecto con colores\r\n');
        this.writeEmitter.fire('    \x1b[33m.pwd\x1b[0m o \x1b[33m!pwd\x1b[0m           Ver directorio actual de trabajo\r\n');
        this.writeEmitter.fire('    \x1b[33m.cd <dir>\x1b[0m              Cambiar directorio de trabajo local\r\n');
        this.writeEmitter.fire('    \x1b[33m.git <cmd>\x1b[0m o \x1b[33m!git\x1b[0m      Ejecutar git en el proyecto\r\n');
        this.writeEmitter.fire('    \x1b[33m.pip <cmd>\x1b[0m o \x1b[33m!pip\x1b[0m      Instalar o listar paquetes python\r\n\r\n');
        this.writeEmitter.fire('  \x1b[1;36mHistorial & Control:\x1b[0m\r\n');
        this.writeEmitter.fire('    \x1b[33m!<número>\x1b[0m              Ej: \x1b[33m!750\x1b[0m ejecuta el comando 750 del historial\r\n');
        this.writeEmitter.fire('    \x1b[33mhistory\x1b[0m                Ver historial de comandos\r\n');
        this.writeEmitter.fire('    \x1b[33mlog\x1b[0m                    Abrir archivo gee_console.log en el editor\r\n');
        this.writeEmitter.fire('    \x1b[33mclear\x1b[0m o \x1b[33mcls\x1b[0m            Limpiar pantalla (o Ctrl+L)\r\n');
        this.writeEmitter.fire('    \x1b[33mpy\x1b[0m / \x1b[33mjs\x1b[0m / \x1b[33mr\x1b[0m             Cambiar modo de lenguaje activo\r\n\r\n');
        this.writeEmitter.fire('  \x1b[1;36mEarth Engine & Variables:\x1b[0m\r\n');
        this.writeEmitter.fire('    \x1b[33mvars\x1b[0m                   Inspeccionar variables en memoria con colores\r\n');
        this.writeEmitter.fire('    \x1b[33mls ~\x1b[0m                   Listar raíces de assets en Earth Engine\r\n');
        this.writeEmitter.fire('    \x1b[33mtasks\x1b[0m                  Listar tareas de exportación en GEE\r\n');
        this.writeEmitter.fire('    \x1b[33mMap.addLayer(...)\x1b[0m      Añadir capa satelital al mapa\r\n\r\n');
    }

    private printHistory(cmd: string): void {
        const hist = this.getHistoryList();
        if (hist.length === 0) {
            this.writeEmitter.fire('  (no hay comandos en el historial .geehistory)\r\n');
            return;
        }

        let start = Math.max(0, hist.length - 25);
        let end = hist.length;

        const countMatch = cmd.match(/\((\d+)\)/) || cmd.match(/history\s+(\d+)/);
        if (countMatch) {
            const count = parseInt(countMatch[1], 10);
            if (!isNaN(count) && count > 0) {
                start = Math.max(0, hist.length - count);
            }
        }

        this.writeEmitter.fire(`\x1b[1;32m📜 Historial (${end - start} de ${hist.length}):\x1b[0m\r\n`);
        for (let i = start; i < end; i++) {
            const numStr = (i + 1).toString().padStart(4, ' ');
            this.writeEmitter.fire(`  \x1b[33m${numStr}\x1b[0m  ${hist[i]}\r\n`);
        }
        this.writeEmitter.fire('\x1b[90m💡 Tip: Usa !<número> (ej. !' + end + ') para re-ejecutar cualquier comando.\x1b[0m\r\n');
    }

    public getLocalCwd(): string {
        if (this.localCwd && fs.existsSync(this.localCwd)) {
            return this.localCwd;
        }
        try {
            const { ProjectManager } = require('../projectManager');
            const pmPath = ProjectManager?.getInstance()?.getProjectFilePath();
            if (pmPath && fs.existsSync(pmPath)) {
                this.localCwd = path.dirname(pmPath);
                return this.localCwd;
            }
        } catch (e) {}

        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (ws) {
            this.localCwd = ws;
            return this.localCwd;
        }
        this.localCwd = process.cwd();
        return this.localCwd;
    }

    private listLocalDirectory(cwd: string, args: string[]): void {
        try {
            const showAll = args.some(a => a.startsWith('-') && a.includes('a'));
            const isLong = args.some(a => a.startsWith('-') && a.includes('l'));
            const targetArg = args.find(a => !a.startsWith('-'));
            const targetPath = targetArg ? path.resolve(cwd, targetArg) : cwd;

            if (!fs.existsSync(targetPath)) {
                this.writeEmitter.fire(`\x1b[31mls: no se encontró el archivo o carpeta: ${targetArg}\x1b[0m\r\n`);
                return;
            }

            const stat = fs.statSync(targetPath);
            if (!stat.isDirectory()) {
                this.writeEmitter.fire(formatLocalFileEntry(path.basename(targetPath), targetPath) + '\r\n');
                return;
            }

            let entries = fs.readdirSync(targetPath);
            if (!showAll) {
                entries = entries.filter(e => !e.startsWith('.'));
            }

            // Ordenar: directorios primero, luego archivos alfabéticamente
            entries.sort((a, b) => {
                const pathA = path.join(targetPath, a);
                const pathB = path.join(targetPath, b);
                const isDirA = fs.existsSync(pathA) && fs.statSync(pathA).isDirectory();
                const isDirB = fs.existsSync(pathB) && fs.statSync(pathB).isDirectory();
                if (isDirA && !isDirB) return -1;
                if (!isDirA && isDirB) return 1;
                return a.localeCompare(b);
            });

            const folderName = path.basename(targetPath) || targetPath;
            if (isLong) {
                this.writeEmitter.fire(`\x1b[90mtotal ${entries.length} elementos en ${folderName}/\x1b[0m\r\n`);
                for (const item of entries) {
                    const itemPath = path.join(targetPath, item);
                    try {
                        const s = fs.statSync(itemPath);
                        const isDir = s.isDirectory();
                        const perms = (isDir ? 'd' : '-') +
                            ((s.mode & 0o400) ? 'r' : '-') + ((s.mode & 0o200) ? 'w' : '-') + ((s.mode & 0o100) ? 'x' : '-') +
                            ((s.mode & 0o040) ? 'r' : '-') + ((s.mode & 0o020) ? 'w' : '-') + ((s.mode & 0o010) ? 'x' : '-') +
                            ((s.mode & 0o004) ? 'r' : '-') + ((s.mode & 0o002) ? 'w' : '-') + ((s.mode & 0o001) ? 'x' : '-');

                        const sizeStr = isDir ? '       -' : formatFileSize(s.size).padStart(8, ' ');
                        const dateStr = s.mtime.toLocaleDateString('es-ES', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                        const coloredName = formatLocalFileEntry(item, itemPath);

                        this.writeEmitter.fire(`\x1b[90m${perms}\x1b[0m  \x1b[33m${sizeStr}\x1b[0m  \x1b[36m${dateStr}\x1b[0m  ${coloredName}\r\n`);
                    } catch (e) {
                        this.writeEmitter.fire(`  ${item}\r\n`);
                    }
                }
            } else {
                // Formato columna / cuadrícula compacto con colores
                const formatted = entries.map(e => formatLocalFileEntry(e, path.join(targetPath, e)));
                this.writeEmitter.fire(formatted.join('   ') + '\r\n');
            }
        } catch (err: any) {
            this.writeEmitter.fire(`\x1b[31mls error: ${err.message}\x1b[0m\r\n`);
        }
    }

    private async runLocalShellCommand(shellCmd: string): Promise<void> {
        if (!shellCmd) return;

        // cd local integrado
        if (shellCmd.startsWith('cd ') || shellCmd === 'cd') {
            const targetDir = shellCmd.replace(/^cd\s*/, '').trim() || os.homedir();
            const resolved = path.resolve(this.getLocalCwd(), targetDir);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                this.localCwd = resolved;
                this.writeEmitter.fire(`\x1b[34m📂 Directorio local:\x1b[0m ${this.localCwd}\r\n`);
            } else {
                this.writeEmitter.fire(`\x1b[31m[Error] Directorio no encontrado: ${targetDir}\x1b[0m\r\n`);
            }
            return;
        }

        // Reconocimiento inteligente de ls / dir local con colores temáticos
        const parts = shellCmd.trim().split(/\s+/);
        const baseCmd = parts[0];
        const hasPipeOrRedir = shellCmd.includes('|') || shellCmd.includes('>') || shellCmd.includes('<');
        if ((baseCmd === 'ls' || baseCmd === 'dir') && !hasPipeOrRedir) {
            const cwd = this.getLocalCwd();
            this.writeEmitter.fire(`\x1b[90m$ ${shellCmd}\x1b[0m\r\n`);
            this.listLocalDirectory(cwd, parts.slice(1));
            return;
        }

        const cwd = this.getLocalCwd();
        this.writeEmitter.fire(`\x1b[90m$ ${shellCmd}\x1b[0m\r\n`);

        return new Promise<void>((resolve) => {
            try {
                const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
                const proc = child_process.spawn(shellCmd, {
                    cwd,
                    shell: true,
                    env: {
                        ...process.env,
                        FORCE_COLOR: '3',
                        CLICOLOR: '1',
                        CLICOLOR_FORCE: '1',
                        LSCOLORS: 'ExGxFxDxCxEgEdxbxgxcxd',
                        LS_COLORS: 'di=1;34:ln=1;35:so=1;32:pi=33:ex=1;31:*.gee=1;32:*.js=1;32:*.py=1;33:*.r=1;34:*.geojson=1;36:*.geeproj=1;36:*.geedata=1;36:*.tif=1;35:*.tiff=1;35:*.png=1;35:*.json=1;36:*.md=37',
                        TERM: 'xterm-256color'
                    }
                });

                this.activeProcess = proc;

                proc.stdout.on('data', (chunk: Buffer) => {
                    const text = chunk.toString().replace(/\r?\n/g, '\r\n');
                    this.writeEmitter.fire(text);
                    this.logToDisk(chunk.toString());
                });

                proc.stderr.on('data', (chunk: Buffer) => {
                    const text = chunk.toString().replace(/\r?\n/g, '\r\n');
                    this.writeEmitter.fire(`\x1b[31m${text}\x1b[0m`);
                    this.logToDisk(`[stderr] ${chunk.toString()}`);
                });

                proc.on('close', (code: number | null) => {
                    this.activeProcess = null;
                    if (code !== null && code !== 0) {
                        this.writeEmitter.fire(`\x1b[90m[Proceso finalizado con código ${code}]\x1b[0m\r\n`);
                    }
                    resolve();
                });

                proc.on('error', (err: Error) => {
                    this.activeProcess = null;
                    this.writeEmitter.fire(`\x1b[31m[Error al ejecutar comando]: ${err.message}\x1b[0m\r\n`);
                    resolve();
                });
            } catch (e: any) {
                this.activeProcess = null;
                this.writeEmitter.fire(`\x1b[31m[Error]: ${e.message}\x1b[0m\r\n`);
                resolve();
            }
        });
    }

    private logToDisk(text: string): void {
        try {
            let logPath = '';
            if (this.logFilePathGetter) {
                logPath = this.logFilePathGetter();
            } else {
                logPath = path.join(this.getLocalCwd(), 'gee_console.log');
            }
            const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
            fs.appendFileSync(logPath, `[${now}] ${cleanText}\n`, 'utf8');
        } catch (e) {}
    }

    private handleTabCompletion(): void {
        const line = this.lineBuffer.slice(0, this.cursorIndex);
        const parts = line.split(/\s+/);
        const lastWord = parts[parts.length - 1];
        if (!lastWord) return;

        const candidates = new Set<string>([
            'vars', 'history', 'clear', 'cls', 'log', 'help', 'python', 'py', 'js',
            '.ls', '.pwd', '.cd', '.git', '.pip', '!ls', '!pwd', '!git', '!pip',
            'Map.addLayer', 'Map.setCenter', 'Map.centerObject', 'ee.Image', 'ee.ImageCollection',
            ...Array.from(this.knownCompletions)
        ]);

        if (line.startsWith('.') || line.startsWith('!') || line.startsWith('cd ')) {
            try {
                const files = fs.readdirSync(this.getLocalCwd());
                files.forEach(f => candidates.add(f));
            } catch (e) {}
        }

        const matches = Array.from(candidates).filter(c => c.startsWith(lastWord));
        if (matches.length === 1) {
            const completion = matches[0].slice(lastWord.length);
            this.lineBuffer = line + completion + this.lineBuffer.slice(this.cursorIndex);
            this.cursorIndex += completion.length;
            this.writeEmitter.fire(completion);
        } else if (matches.length > 1) {
            this.writeEmitter.fire('\r\n' + matches.join('  ') + '\r\n');
            this.writePrompt();
            this.writeEmitter.fire(this.lineBuffer);
        }
    }
}
