import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PythonRuntimeManager } from './pythonRuntimeManager';

/**
 * GEE IDE — Python Runtime (Interactive Persistent REPL)
 * 
 * Provides an interactive, persistent Python session inside the unified GEE Console:
 * - Variables persist across lines and selections (Cmd+Enter)
 * - Full scripts execute seamlessly in the same session (Cmd+Shift+Enter)
 * - Evaluates expressions like R/IPython and prints results (e.g. `EJECUCION_DESDE_CAPA` prints `True`)
 * - Map.addLayer(), Map.centerObject() communicate with Leaflet map
 * - Automatically finds Python with Earth Engine installed (in venvs/system)
 */
export class GEERuntimePy {
    private pyProcess: cp.ChildProcess | null = null;
    private replPath: string;
    private shimPath: string;
    private isBusy: boolean = false;
    private pendingResolve: (() => void) | null = null;
    private sentinel = '___GEE_PRO_PY_DONE___';
    private stdoutBuffer = '';
    private customPython: string | null = null;
    private isSessionReady: boolean = false;
    private sessionReadyPromise: Promise<void> | null = null;
    private refreshToken: string = '';
    private pendingInspectResolve: ((res: Record<string, any>) => void) | null = null;

    constructor(
        private consoleView: any,
        private accessToken: string,
        private projectId: string = '',
        private storagePath: string = '',
        private bridgePort: number = 31415,
        refreshToken: string = ''
    ) {
        this.refreshToken = refreshToken;
        // Locate repl runner: out/shims/ (built) or src/shims/ (dev)
        const bundledRepl = path.join(__dirname, 'shims', 'gee_pro_repl.py');
        const devRepl = path.join(__dirname, '..', 'src', 'shims', 'gee_pro_repl.py');
        this.replPath = fs.existsSync(bundledRepl) ? bundledRepl : devRepl;

        const bundledShim = path.join(__dirname, 'shims', 'gee_pro_shim.py');
        const devShim = path.join(__dirname, '..', 'src', 'shims', 'gee_pro_shim.py');
        this.shimPath = fs.existsSync(bundledShim) ? bundledShim : devShim;
    }

    public setBridgePort(port: number) {
        this.bridgePort = port;
    }

    public updateToken(newToken: string): void {
        this.accessToken = newToken;
    }

    public setRefreshToken(token: string): void {
        this.refreshToken = token;
    }

    public setProject(project: string) {
        this.projectId = project;
    }

    private getVenvPython(): string | null {
        const isWin = process.platform === 'win32';
        const pyBin = isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');

        const paths: string[] = [];

        // 1. Extension's storagePath and sibling extension folders
        if (this.storagePath) {
            paths.push(path.join(this.storagePath, 'venv', pyBin));
            const parent = path.dirname(this.storagePath);
            paths.push(path.join(parent, 'luisrobles.gee-pro-ide', 'venv', pyBin));
            paths.push(path.join(parent, 'geepro-official.gee-pro', 'venv', pyBin));
        }

        // 2. Standard VS Code globalStorage locations across platforms
        if (process.platform === 'darwin') {
            const codeStorage = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
            paths.push(path.join(codeStorage, 'luisrobles.gee-pro-ide', 'venv', pyBin));
            paths.push(path.join(codeStorage, 'geepro-official.gee-pro', 'venv', pyBin));
        } else if (process.platform === 'win32') {
            const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
            const codeStorage = path.join(appData, 'Code', 'User', 'globalStorage');
            paths.push(path.join(codeStorage, 'luisrobles.gee-pro-ide', 'venv', pyBin));
            paths.push(path.join(codeStorage, 'geepro-official.gee-pro', 'venv', pyBin));
        } else {
            const codeStorage = path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage');
            paths.push(path.join(codeStorage, 'luisrobles.gee-pro-ide', 'venv', pyBin));
            paths.push(path.join(codeStorage, 'geepro-official.gee-pro', 'venv', pyBin));
        }

        // 3. User home dotdirs
        paths.push(
            path.join(os.homedir(), '.virtualenvs', 'rgee', pyBin),
            path.join(os.homedir(), '.config', 'earthengine', 'venv', pyBin),
            path.join(os.homedir(), '.gee-pro-ide', 'venv', pyBin),
            path.join(os.homedir(), '.venv', pyBin)
        );

        for (const p of paths) {
            if (p && fs.existsSync(p)) {
                return p;
            }
        }
        return null;
    }

    public async getPythonExecutable(): Promise<string | null> {
        return this.findPython();
    }

    private async findPython(): Promise<string | null> {
        if (this.customPython && fs.existsSync(this.customPython)) {
            return this.customPython;
        }

        try {
            const manager = PythonRuntimeManager.getInstance();
            const resolved = await manager.resolvePython(this.consoleView, true);
            if (resolved) {
                return resolved;
            }
        } catch (e: any) {
            if (this.consoleView) {
                this.consoleView.append(`⚠️ [PythonManager]: ${e.message || e}`);
            }
        }

        const config = vscode.workspace.getConfiguration('gee-pro');
        const configPython = config.get<string>('pythonPath');
        if (configPython && fs.existsSync(configPython)) {
            return configPython;
        }

        const candidates: string[] = [];

        // Check dedicated isolated venv first
        const venvPy = this.getVenvPython();
        if (venvPy) {
            candidates.push(venvPy);
        }

        // Check VS Code default interpreter setting
        const msPythonConfig = vscode.workspace.getConfiguration('python');
        const defaultInterpreter = msPythonConfig.get<string>('defaultInterpreterPath');
        if (defaultInterpreter && defaultInterpreter !== 'python' && fs.existsSync(defaultInterpreter)) {
            candidates.push(defaultInterpreter);
        }

        // 1. Check active virtualenv / conda
        if (process.env.VIRTUAL_ENV) {
            candidates.push(path.join(process.env.VIRTUAL_ENV, 'bin', 'python3'));
            candidates.push(path.join(process.env.VIRTUAL_ENV, 'bin', 'python'));
        }
        if (process.env.CONDA_PREFIX) {
            candidates.push(path.join(process.env.CONDA_PREFIX, 'bin', 'python3'));
            candidates.push(path.join(process.env.CONDA_PREFIX, 'bin', 'python'));
        }

        // 2. Standard system & package manager paths
        candidates.push(
            path.join(os.homedir(), '.virtualenvs', 'rgee', 'bin', 'python'),
            '/opt/homebrew/bin/python3.11',
            'python3',
            'python',
            '/opt/homebrew/bin/python3',
            '/usr/local/bin/python3',
            path.join(os.homedir(), '.pyenv', 'shims', 'python3'),
            path.join(os.homedir(), 'miniconda3', 'bin', 'python3'),
            path.join(os.homedir(), 'miniforge3', 'bin', 'python3'),
            path.join(os.homedir(), 'anaconda3', 'bin', 'python3')
        );

        let fallbackPython3: string | null = null;

        for (const candidate of candidates) {
            try {
                if (candidate.startsWith('/') && !fs.existsSync(candidate)) {
                    continue;
                }
                const ver = cp.execSync(`${candidate} --version`, { 
                    encoding: 'utf8', 
                    timeout: 2000,
                    stdio: ['ignore', 'pipe', 'pipe']
                });
                if (ver.includes('Python 3')) {
                    if (!fallbackPython3) fallbackPython3 = candidate;
                    try {
                        cp.execSync(`${candidate} -c "import ee"`, {
                            timeout: 2000,
                            stdio: ['ignore', 'ignore', 'ignore']
                        });
                        return candidate; // Found Python with Earth Engine installed!
                    } catch {
                        // Interpreter doesn't have ee
                    }
                }
            } catch { /* try next */ }
        }

        return fallbackPython3;
    }

    private async ensurePythonSession(): Promise<cp.ChildProcess | null> {
        if (this.pyProcess && !this.pyProcess.killed) {
            if (this.sessionReadyPromise) {
                await this.sessionReadyPromise;
            }
            return this.pyProcess;
        }

        const python = await this.findPython();
        if (!python) {
            this.consoleView.append('[Error] Python no encontrado en el sistema. Instala Python 3.');
            return null;
        }

        // Auto-detect project ID and refresh_token from credentials on disk if not configured
        let diskRefreshToken = '';
        try {
            const credPath = path.join(os.homedir(), '.config', 'earthengine', 'credentials');
            if (fs.existsSync(credPath)) {
                const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
                if (parsed.project && (!this.projectId || this.projectId === 'PeruREDD' || this.projectId === 'gee-pro-default')) {
                    this.projectId = parsed.project;
                }
                if (parsed.refresh_token) {
                    diskRefreshToken = parsed.refresh_token;
                }
            }
        } catch (e) {}

        let clientId = '';
        let clientSecret = '';
        try {
            const config = require('./config');
            clientId = config.CLIENT_ID || '';
            clientSecret = config.CLIENT_SECRET || '';
        } catch (e) {}

        const env = {
            ...process.env,
            GEE_PRO_ACCESS_TOKEN: this.accessToken,
            GEE_PRO_REFRESH_TOKEN: this.refreshToken || diskRefreshToken,
            GEE_PRO_CLIENT_ID: clientId,
            GEE_PRO_CLIENT_SECRET: clientSecret,
            GEE_PRO_PROJECT: this.projectId,
            GEE_PRO_BRIDGE_PORT: String(this.bridgePort),
            PYTHONUNBUFFERED: '1',
        };

        let resolveReady: () => void = () => {};
        this.sessionReadyPromise = new Promise<void>((resolve) => {
            resolveReady = resolve;
        });

        try {
            this.pyProcess = cp.spawn(python, ['-u', this.replPath], {
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.stdoutBuffer = '';

            this.pyProcess.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                this.stdoutBuffer += text;

                while (this.stdoutBuffer.includes(this.sentinel)) {
                    const parts = this.stdoutBuffer.split(this.sentinel);
                    const outputPart = parts[0];
                    this.stdoutBuffer = parts.slice(1).join(this.sentinel);

                    if (!this.isSessionReady) {
                        this.isSessionReady = true;
                        resolveReady();
                    }

                    let cleanOutputPart = outputPart;
                    if (outputPart.includes('___INSPECT_RESULT___')) {
                        const lines = outputPart.split('\n');
                        const normalLines: string[] = [];
                        for (const l of lines) {
                            if (l.includes('___INSPECT_RESULT___')) {
                                try {
                                    const jsonStr = l.split('___INSPECT_RESULT___')[1].trim();
                                    const parsed = JSON.parse(jsonStr);
                                    if (this.pendingInspectResolve) {
                                        this.pendingInspectResolve(parsed);
                                        this.pendingInspectResolve = null;
                                    }
                                } catch (e) {
                                    if (this.pendingInspectResolve) {
                                        this.pendingInspectResolve({});
                                        this.pendingInspectResolve = null;
                                    }
                                }
                            } else {
                                normalLines.push(l);
                            }
                        }
                        cleanOutputPart = normalLines.join('\n');
                    }

                    if (cleanOutputPart.trim()) {
                        this.flushLines(cleanOutputPart);
                    }

                    if (this.pendingResolve) {
                        const res = this.pendingResolve;
                        this.pendingResolve = null;
                        this.isBusy = false;
                        res();
                    }
                }
            });

            this.pyProcess.stderr?.on('data', async (data: Buffer) => {
                const text = data.toString();
                const lines = text.split('\n');
                lines.forEach(line => {
                    const clean = line.trim();
                    if (!clean) return;
                    if (clean.includes('*** Earth Engine ***') || clean.includes('google.qualtrics.com') || clean.includes('Developer Satisfaction Survey')) {
                        return; // Omitir el anuncio de encuesta de Google
                    }
                    if (clean.startsWith('[GEE IDE]') || clean.startsWith('Layer added:') || clean.startsWith('Adding layer:') || clean.startsWith('[python]')) {
                        this.consoleView.append(clean);
                    } else {
                        this.consoleView.append(`[stderr] ${clean}`);
                    }
                });

                if (text.includes("No module named 'ee'")) {
                    this.consoleView.append("💡 Tip: The Python 'earthengine-api' package is required for Earth Engine execution.");
                    this.promptAndInstallEE(python);
                } else if (text.includes("not found or deleted") || text.includes("not registered") || text.includes("no project found") || text.includes("USER_PROJECT_DENIED")) {
                    this.consoleView.append(`⚠️ Error de Cloud Project: El proyecto '${this.projectId}' no existe en Google Cloud o no tiene Earth Engine habilitado.`);
                    this.consoleView.append(`👉 Para corregirlo: Cmd+Shift+P -> 'GEE IDE: Set Active Cloud Project'.`);
                    this.consoleView.append(`💡 Puedes ver el ID exacto arriba a la derecha en https://code.earthengine.google.com`);
                }
            });

            this.pyProcess.on('close', (code: number | null) => {
                this.pyProcess = null;
                this.isSessionReady = false;
                this.isBusy = false;
                if (this.pendingResolve) {
                    this.pendingResolve();
                    this.pendingResolve = null;
                }
            });

            this.pyProcess.on('error', (err: Error) => {
                this.consoleView.append(`[Error] Error en proceso de Python: ${err.message}`);
                this.pyProcess = null;
                this.isSessionReady = false;
                this.isBusy = false;
                if (this.pendingResolve) {
                    this.pendingResolve();
                    this.pendingResolve = null;
                }
            });

            await this.sessionReadyPromise;
            return this.pyProcess;
        } catch (e: any) {
            this.consoleView.append(`[Error] No se pudo iniciar la sesión interactiva de Python: ${e.message}`);
            return null;
        }
    }

    private flushLines(output: string) {
        const lines = output.split('\n');
        lines.forEach(line => {
            const clean = line.trim();
            if (!clean) return;
            if (clean.includes('*** Earth Engine ***') || clean.includes('google.qualtrics.com') || clean.includes('Developer Satisfaction Survey')) return;
            if (clean.startsWith('[GEE IDE]') || clean.startsWith('Layer added:') || clean.startsWith('Adding layer:') || clean.startsWith('[python]')) {
                this.consoleView.append(clean);
            } else {
                this.consoleView.append(line);
            }
        });
    }

    /**
     * Execute a line or selection in the persistent interactive Python session.
     */
    async executeLine(line: string, filePath?: string): Promise<void> {
        const session = await this.ensurePythonSession();
        if (!session || !session.stdin) return;

        const clean = line.trim();
        if (!clean) return;

        return new Promise<void>((resolve) => {
            this.pendingResolve = resolve;
            this.isBusy = true;
            const payload = JSON.stringify({ action: 'exec', code: clean, file: filePath }) + '\n';
            session.stdin?.write(payload);
        });
    }

    /**
     * Execute a full Python script in the persistent interactive Python session.
     */
    async execute(scriptContent: string, filePath?: string): Promise<void> {
        return this.executeLine(scriptContent, filePath);
    }

    /**
     * Reset the interactive session (kills the process so memory is completely freed).
     */
    public reset(silent: boolean = false): void {
        if (this.pyProcess) {
            try {
                this.pyProcess.kill();
            } catch (e) {}
            this.pyProcess = null;
        }
        this.stdoutBuffer = '';
        this.isBusy = false;
        this.isSessionReady = false;
        this.sessionReadyPromise = null;
        this.pendingResolve = null;
        if (!silent) {
            this.consoleView.append('[python] Sesión de Python reiniciada. Memoria liberada.');
        }
    }

    public stop(): void {
        this.reset(true);
        this.consoleView.append('[python] Execution stopped.');
    }

    public async listVars(): Promise<void> {
        const session = await this.ensurePythonSession();
        if (!session || !session.stdin) return;
        return new Promise<void>((resolve) => {
            this.pendingResolve = resolve;
            this.isBusy = true;
            session.stdin?.write(JSON.stringify({ action: 'vars' }) + '\n');
        });
    }

    /**
     * Prompt user and automatically install earthengine-api package via pip.
     * Creates an isolated virtual environment to bypass PEP 668 and system permissions.
     */
    public async promptAndInstallEE(basePythonPath: string): Promise<boolean> {
        const action = await vscode.window.showWarningMessage(
            "El paquete 'earthengine-api' no está instalado en tu Python.",
            "Instalar automáticamente con pip",
            "Cancelar"
        );

        if (action === "Instalar automáticamente con pip") {
            this.consoleView.append("⏳ Configurando entorno de Python para Google Earth Engine...");

            const targetDir = this.storagePath 
                ? path.join(this.storagePath, 'venv') 
                : path.join(os.homedir(), '.config', 'earthengine', 'venv');

            const isWin = process.platform === 'win32';
            const venvPip = isWin ? path.join(targetDir, 'Scripts', 'pip.exe') : path.join(targetDir, 'bin', 'pip');
            const venvPython = isWin ? path.join(targetDir, 'Scripts', 'python.exe') : path.join(targetDir, 'bin', 'python');

            // 1. Create venv if not exists
            if (!fs.existsSync(venvPython)) {
                this.consoleView.append(`⏳ Creando entorno aislado en: ${targetDir}...`);
                try {
                    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
                    cp.execSync(`"${basePythonPath}" -m venv "${targetDir}"`, {
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
                } catch (e: any) {
                    this.consoleView.append(`[Aviso] No se pudo crear venv: ${e.message}. Probando instalación directa...`);
                }
            }

            const useVenv = fs.existsSync(venvPip);
            const installerCmd = useVenv ? venvPip : basePythonPath;
            const installerArgs = useVenv 
                ? ['install', 'earthengine-api'] 
                : ['-m', 'pip', 'install', '--break-system-packages', '--user', 'earthengine-api'];

            this.consoleView.append("⏳ Descargando e instalando 'earthengine-api'...");

            return new Promise((resolve) => {
                const pipProcess = cp.spawn(installerCmd, installerArgs, {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                pipProcess.stdout?.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.forEach((l: string) => { if (l.trim()) this.consoleView.append(`[pip] ${l.trim()}`); });
                });

                pipProcess.stderr?.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.forEach((l: string) => { if (l.trim()) this.consoleView.append(`[pip] ${l.trim()}`); });
                });

                pipProcess.on('close', (code) => {
                    if (code === 0) {
                        if (useVenv) {
                            this.customPython = venvPython;
                        }
                        this.consoleView.append("✅ 'earthengine-api' instalado con éxito. Ya puedes ejecutar tu código Python.");
                        vscode.window.showInformationMessage("✅ GEE IDE: 'earthengine-api' instalado con éxito.");
                        resolve(true);
                    } else {
                        this.consoleView.append(`[Error] Falló la instalación de pip (código ${code}).`);
                        vscode.window.showErrorMessage("Error al instalar 'earthengine-api'. Revisa la consola.");
                        resolve(false);
                    }
                });

                pipProcess.on('error', (err) => {
                    this.consoleView.append(`[Error] No se pudo ejecutar pip: ${err.message}`);
                    resolve(false);
                });
            });
        }
        return false;
    }

    public async inspectPixel(lat: number, lon: number): Promise<Record<string, any>> {
        if (!this.pyProcess) return {};
        const session = await this.ensurePythonSession();
        if (!session || !session.stdin) return {};

        return new Promise<Record<string, any>>((resolve) => {
            const timeout = setTimeout(() => {
                if (this.pendingInspectResolve) {
                    this.pendingInspectResolve = null;
                }
                resolve({});
            }, 6000);

            this.pendingInspectResolve = (res: Record<string, any>) => {
                clearTimeout(timeout);
                resolve(res);
            };

            try {
                session.stdin?.write(JSON.stringify({ action: 'inspect', lat, lon }) + '\n');
            } catch (e) {
                clearTimeout(timeout);
                this.pendingInspectResolve = null;
                resolve({});
            }
        });
    }
}
