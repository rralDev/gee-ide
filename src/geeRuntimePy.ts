import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * GEE IDE — Python Runtime
 * 
 * Executes .gee Python scripts by:
 * 1. Writing the user script to a temp file
 * 2. Prepending the gee_pro_shim.py so Map.addLayer() etc. work
 * 3. Spawning a Python subprocess with the GEE credentials injected
 * 4. Streaming stdout/stderr back to the GEE Console
 *
 * The Map.addLayer() calls in the script are intercepted by the shim
 * and sent to PythonBridgeServer (port 31415) → Leaflet WebView.
 */
export class GEERuntimePy {
    private shimPath: string;
    private currentProcess: cp.ChildProcess | null = null;

    private customPython: string | null = null;

    constructor(
        private consoleView: any,
        private accessToken: string,
        private projectId: string = '',
        private storagePath: string = '',
        private bridgePort: number = 31415
    ) {
        // Check out/shims/ first (for packaged/built extension), then src/shims/ (dev)
        const bundledShim = path.join(__dirname, 'shims', 'gee_pro_shim.py');
        const devShim = path.join(__dirname, '..', 'src', 'shims', 'gee_pro_shim.py');
        this.shimPath = fs.existsSync(bundledShim) ? bundledShim : devShim;
    }

    public setBridgePort(port: number) {
        this.bridgePort = port;
    }

    private getVenvPython(): string | null {
        const paths = [
            this.storagePath ? path.join(this.storagePath, 'venv', 'bin', 'python') : '',
            this.storagePath ? path.join(this.storagePath, 'venv', 'Scripts', 'python.exe') : '',
            path.join(os.homedir(), '.config', 'earthengine', 'venv', 'bin', 'python'),
            path.join(os.homedir(), '.config', 'earthengine', 'venv', 'Scripts', 'python.exe'),
            path.join(os.homedir(), '.gee-pro-ide', 'venv', 'bin', 'python')
        ].filter(Boolean);

        for (const p of paths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        return null;
    }

    /**
     * Execute a Python GEE script. The script content has access to:
     * - `ee` (initialized with the current credentials)
     * - `Map` (sends layers/center to VS Code Leaflet map)
     * - All standard Python + earthengine-api functions
     */
    async execute(scriptContent: string): Promise<void> {
        // Kill any running process
        if (this.currentProcess) {
            this.currentProcess.kill();
            this.currentProcess = null;
        }

        // Find the Python executable
        const python = await this.findPython();
        if (!python) {
            this.consoleView.append('[Error] Python not found. Install Python 3 and the earthengine-api package.');
            return;
        }

        // Earth Engine in Python requires a Google Cloud Project ID
        if (!this.projectId || this.projectId === 'PeruREDD' || this.projectId === 'gee-pro-default') {
            const entered = await vscode.window.showInputBox({
                prompt: 'Earth Engine en Python requiere tu Cloud Project ID (ej: ee-tu-usuario o tu proyecto GCP).',
                placeHolder: 'ejemplo: ee-mi-usuario',
                ignoreFocusOut: true
            });
            if (entered && entered.trim()) {
                this.projectId = entered.trim();
                const config = vscode.workspace.getConfiguration('gee-pro');
                await config.update('projectId', this.projectId, vscode.ConfigurationTarget.Global);
                this.consoleView.append(`🚀 Cloud Project configurado: ${this.projectId}`);
            } else {
                this.consoleView.append('[GEE IDE] Error: Se requiere un Cloud Project ID para inicializar Earth Engine en Python.');
                this.consoleView.append('💡 Tip: Puedes ver tu Project ID arriba a la derecha en https://code.earthengine.google.com');
                this.consoleView.append('gee> ');
                return;
            }
        }

        // Build the shim preamble that initializes EE + injects Map
        const preamble = this.buildPreamble();

        // Write the full script to a temp file
        const tmpDir = path.join(os.tmpdir(), 'gee-pro-ide');
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpScript = path.join(tmpDir, `gee_script_${Date.now()}.py`);

        // Strip the shebang line from the user's script if present
        const userCode = scriptContent.replace(/^#\s*(py|python|js|r|R)\s*\n/, '');

        fs.writeFileSync(tmpScript, preamble + '\n\n# --- User Script ---\n' + userCode, 'utf8');

        this.consoleView.append(`[python] Running script...`);

        return new Promise((resolve) => {
            this.currentProcess = cp.spawn(python, [tmpScript], {
                env: {
                    ...process.env,
                    // Pass the access token so EE can be initialized in the subprocess
                    GEE_PRO_ACCESS_TOKEN: this.accessToken,
                    GEE_PRO_PROJECT: this.projectId,
                    GEE_PRO_BRIDGE_PORT: String(this.bridgePort),
                    PYTHONUNBUFFERED: '1', // Ensures output is not buffered
                }
            });

            this.currentProcess.stdout?.on('data', (data: Buffer) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                    if (line.trim()) this.consoleView.append(line);
                });
            });

            this.currentProcess.stderr?.on('data', async (data: Buffer) => {
                const text = data.toString();
                const lines = text.split('\n');
                lines.forEach(line => {
                    if (line.includes('*** Earth Engine ***') || line.includes('google.qualtrics.com') || line.includes('Developer Satisfaction Survey')) {
                        return; // Omitir el anuncio de encuesta de Google
                    }
                    if (line.trim()) this.consoleView.append(`[stderr] ${line}`);
                });
                if (text.includes("No module named 'ee'")) {
                    this.consoleView.append("💡 Tip: The Python 'earthengine-api' package is required for Python execution.");
                    // Offer 1-click install dialog
                    this.promptAndInstallEE(python);
                } else if (text.includes("not found or deleted") || text.includes("not registered") || text.includes("no project found") || text.includes("USER_PROJECT_DENIED")) {
                    this.consoleView.append(`⚠️ Error de Cloud Project: El proyecto '${this.projectId}' no existe en Google Cloud o no tiene Earth Engine habilitado.`);
                    this.consoleView.append(`👉 Para corregirlo: Cmd+Shift+P -> 'GEE IDE: Set Active Cloud Project'.`);
                    this.consoleView.append(`💡 Puedes ver el ID exacto arriba a la derecha en https://code.earthengine.google.com`);
                }
            });

            this.currentProcess.on('close', (code: number) => {
                fs.unlink(tmpScript, () => {}); // Cleanup temp file
                if (code === 0) {
                    this.consoleView.append('gee> ');
                } else {
                    this.consoleView.append(`[python] Process exited with code ${code}`);
                    this.consoleView.append('gee> ');
                }
                this.currentProcess = null;
                resolve();
            });

            this.currentProcess.on('error', (err: Error) => {
                this.consoleView.append(`[Error] Could not start Python: ${err.message}`);
                this.consoleView.append('gee> ');
                resolve();
            });
        });
    }

    /**
     * Execute a single line or selected block of Python code.
     * Wraps the code in an async context for convenience.
     */
    async executeLine(line: string): Promise<void> {
        return this.execute(line);
    }

    stop(): void {
        if (this.currentProcess) {
            this.currentProcess.kill();
            this.currentProcess = null;
            this.consoleView.append('[python] Execution stopped.');
        }
    }

    public setProject(project: string) {
        this.projectId = project;
    }

    /**
     * Build the Python preamble that initializes EE + injects Map shim.
     * The credentials are passed via environment variables for security.
     */
    private buildPreamble(): string {
        const shimDir = path.dirname(this.shimPath).replace(/\\/g, '/');
        return `
import sys
import os

# Inject the GEE IDE shim directory into the path
sys.path.insert(0, r"${shimDir}")

import ee

# Initialize EE with the access token from the VS Code extension
_access_token = os.environ.get('GEE_PRO_ACCESS_TOKEN', '')
_project = os.environ.get('GEE_PRO_PROJECT', '')

if _access_token:
    from google.oauth2.credentials import Credentials
    credentials = Credentials(_access_token)
    if _project:
        ee.Initialize(credentials, project=_project)
    else:
        ee.Initialize(credentials)
else:
    if _project:
        ee.Initialize(project=_project)
    else:
        try:
            ee.Initialize()
        except Exception as e:
            print(f"[GEE IDE] Warning: could not initialize EE: {e}")

# Import the Map shim and CLI helpers
from gee_pro_shim import Map, cli, mkdir, rm, ls, touch, cd, pwd, find, du
`.trim();
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

    /**
     * Find the Python 3 executable on the system.
     * Checks: user setting → isolated venv → conda/venv → Homebrew/system paths
     */
    private async findPython(): Promise<string | null> {
        if (this.customPython && fs.existsSync(this.customPython)) {
            return this.customPython;
        }

        const config = vscode.workspace.getConfiguration('gee-pro');
        const configPython = config.get<string>('pythonPath');
        if (configPython && fs.existsSync(configPython)) {
            return configPython;
        }

        // Check our dedicated isolated venv first
        const venvPy = this.getVenvPython();
        if (venvPy) {
            return venvPy;
        }

        const candidates: string[] = [];

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

    /** Get the detected Python executable path */
    public async getPythonExecutable(): Promise<string | null> {
        return this.findPython();
    }

    /** Update the access token (called after a token refresh) */
    updateToken(newToken: string): void {
        this.accessToken = newToken;
    }
}
