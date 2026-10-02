import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * GEE Pro IDE — R Runtime
 * 
 * Provides an interactive, persistent R session inside the unified GEE Console.
 * - Variables persist in memory line-by-line (Cmd+Enter)
 * - Full scripts execute seamlessly (Cmd+Shift+Enter)
 * - Map$addLayer, Map$setCenter, Map$centerObject communicate with Leaflet map
 * - Automatically detects missing 'rgee' and offers 1-click installation
 */
export class GEERuntimeR {
    private rProcess: cp.ChildProcess | null = null;
    private shimPath: string;
    private isBusy: boolean = false;
    private pendingResolve: (() => void) | null = null;
    private sentinel = '___GEE_PRO_R_DONE___';
    private stdoutBuffer = '';

    constructor(
        private consoleView: any,
        private accessToken: string = '',
        private projectId: string = '',
        private bridgePort: number = 31415,
        private pythonPath: string = ''
    ) {
        const bundledShim = path.join(__dirname, 'shims', 'gee_pro_shim.R');
        const devShim = path.join(__dirname, '..', 'src', 'shims', 'gee_pro_shim.R');
        this.shimPath = fs.existsSync(bundledShim) ? bundledShim : devShim;
    }

    public setBridgePort(port: number) {
        this.bridgePort = port;
    }

    public setPythonPath(pyPath: string) {
        this.pythonPath = pyPath;
    }

    public updateCredentials(accessToken: string, projectId: string) {
        this.accessToken = accessToken;
        this.projectId = projectId;
    }

    /**
     * Start or return the persistent interactive R session.
     */
    private ensureRSession(): cp.ChildProcess | null {
        if (this.rProcess && !this.rProcess.killed) {
            return this.rProcess;
        }

        const rBin = this.findR();
        if (!rBin) {
            this.consoleView.append('[Error] R no encontrado. Asegúrate de tener R instalado en tu sistema.');
            return null;
        }

        const env = {
            ...process.env,
            GEE_PRO_ACCESS_TOKEN: this.accessToken,
            GEE_PRO_PROJECT: this.projectId,
            GEE_PRO_BRIDGE_PORT: String(this.bridgePort),
            ...(this.pythonPath ? { RETICULATE_PYTHON: this.pythonPath } : {})
        };

        try {
            this.rProcess = cp.spawn(rBin, ['--vanilla', '--quiet', '--interactive', '--no-readline'], {
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.stdoutBuffer = '';

            // Silence interactive prompts and continuation marks at R session start
            this.rProcess.stdin?.write('options(prompt = " ", continue = " ")\n');

            this.rProcess.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                this.stdoutBuffer += text;

                if (this.stdoutBuffer.includes(this.sentinel)) {
                    const parts = this.stdoutBuffer.split(this.sentinel);
                    const outputPart = parts[0];
                    this.stdoutBuffer = parts.slice(1).join(this.sentinel);

                    this.flushLines(outputPart);
                    if (this.pendingResolve) {
                        const res = this.pendingResolve;
                        this.pendingResolve = null;
                        this.isBusy = false;
                        res();
                    }
                }
            });

            this.rProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                const lines = text.split('\n');
                lines.forEach(line => {
                    const clean = line.trim();
                    if (!clean || /^[>+\s]*$/.test(clean)) return;
                    if (clean.includes('*** Earth Engine ***') || clean.includes('google.qualtrics.com') || clean.includes('Developer Satisfaction Survey')) return;
                    if (clean.includes("invalid value for 'prompt'")) return;
                    if (clean.includes("The following objects are masked _by_") || clean.includes("Attaching package:")) return;

                    const isRgeeMissing = /there is no package called [‘'"]?rgee[’'"]?/i.test(clean) ||
                                          (clean.toLowerCase().includes("there is no package called") && clean.toLowerCase().includes("rgee"));

                    if (isRgeeMissing) {
                        this.consoleView.append(`[R] ${clean}`);
                        this.consoleView.append(`[Hint] El paquete 'rgee' (Google Earth Engine para R) no está instalado en tu sistema.`);
                        this.consoleView.append(`👉 Haz clic en 'Instalar automáticamente en R' en la notificación o escribe: install.packages('rgee')`);
                        this.promptAndInstallRgee();
                    } else if (clean.startsWith('Error') || clean.startsWith('Execution halted')) {
                        this.consoleView.append(`[Error] ${clean}`);
                    } else if (clean.startsWith('Warning')) {
                        this.consoleView.append(`[stderr] ${clean}`);
                    } else {
                        this.consoleView.append(`[R] ${clean}`);
                    }
                });
            });

            this.rProcess.on('close', (code) => {
                this.consoleView.append(`[R] Sesión interactiva de R finalizada (código ${code}).`);
                this.rProcess = null;
                this.isBusy = false;
                if (this.pendingResolve) {
                    this.pendingResolve();
                    this.pendingResolve = null;
                }
            });

            this.rProcess.on('error', (err) => {
                this.consoleView.append(`[Error] Error en proceso de R: ${err.message}`);
                this.rProcess = null;
                this.isBusy = false;
            });

            // Inject the Map shim on session start
            if (fs.existsSync(this.shimPath)) {
                const shimContent = fs.readFileSync(this.shimPath, 'utf8');
                this.rProcess.stdin?.write(shimContent + '\n');
            }

            return this.rProcess;
        } catch (e: any) {
            this.consoleView.append(`[Error] No se pudo iniciar R: ${e.message}`);
            return null;
        }
    }

    private flushLines(output: string) {
        const lines = output.split('\n');
        lines.forEach(line => {
            const clean = line.trim();
            // Skip interactive R prompts, empty echoes, and startup banners
            if (!clean || /^[>+\s]*$/.test(clean)) return;
            if (clean.startsWith('R version') || clean.includes('Copyright (C)') || clean.includes('Platform:')) return;
            if (clean.includes('Natural Language Support') || clean.includes('Type \'license()\'') || clean.includes('Type \'q()\' to quit R.')) return;
            if (clean.includes('citation()') || clean.includes('collaborative project with many contributors')) return;
            if (clean.includes('ABSOLUTELY NO WARRANTY') || clean.includes('redistribute it under certain conditions')) return;
            if (clean.includes("Type 'demo()'") || clean.includes("help.start()")) return;
            if (clean.includes('*** Earth Engine ***') || clean.includes('google.qualtrics.com') || clean.includes('Developer Satisfaction Survey')) return;
            if (clean.includes("The following objects are masked _by_") || clean.includes("Attaching package:")) return;
            if (clean.includes("invalid value for 'prompt'")) return;

            if (clean.startsWith('[GEE Pro]') || clean.startsWith('Layer added:') || clean.startsWith('Adding layer:')) {
                this.consoleView.append(clean);
            } else {
                this.consoleView.append(`[R] ${line}`);
            }
        });
    }

    /**
     * Execute a block or line of R code in the persistent session.
     */
    async executeLine(code: string): Promise<void> {
        const session = this.ensureRSession();
        if (!session || !session.stdin) return;

        return new Promise<void>((resolve) => {
            this.pendingResolve = resolve;
            this.isBusy = true;

            const clean = code.replace(/^[#\s]*(r|R)\s*\n/, '').trim();
            if (!clean) {
                resolve();
                return;
            }

            session.stdin?.write(clean + '\n');
            session.stdin?.write(`cat("${this.sentinel}\\n")\n`);
        });
    }

    /**
     * Execute a full R script.
     */
    async execute(scriptContent: string): Promise<void> {
        return this.executeLine(scriptContent);
    }

    /**
     * Reset the interactive session (clears all R variables).
     */
    public reset() {
        if (this.rProcess) {
            this.rProcess.kill();
            this.rProcess = null;
        }
        this.stdoutBuffer = '';
        this.isBusy = false;
        this.pendingResolve = null;
        this.consoleView.append('[R] Entorno de R reiniciado. Variables limpias.');
    }

    /**
     * Find the R binary on macOS / Linux / Windows.
     */
    private findR(): string | null {
        const candidates = [
            'R',
            '/usr/local/bin/R',
            '/opt/homebrew/bin/R',
            '/usr/bin/R',
            'C:\\Program Files\\R\\R-4.3.0\\bin\\R.exe'
        ];

        for (const c of candidates) {
            try {
                if (c.startsWith('/') && !fs.existsSync(c)) continue;
                const out = cp.execSync(`${c} --version`, {
                    timeout: 2000,
                    stdio: ['ignore', 'pipe', 'pipe']
                }).toString();
                if (out.includes('R version') || out.includes('R framework')) {
                    return c;
                }
            } catch {}
        }
        return null;
    }

    /**
     * 1-Click automatic installation of 'rgee' into the user's R environment.
     */
    public async promptAndInstallRgee(): Promise<boolean> {
        const action = await vscode.window.showWarningMessage(
            "El paquete 'rgee' (Google Earth Engine para R) no está instalado en tu sistema.",
            "Instalar automáticamente en R",
            "Cancelar"
        );

        if (action === "Instalar automáticamente en R") {
            this.consoleView.append("⏳ [R] Iniciando instalación automática de 'rgee' desde CRAN...");
            const rscriptBin = this.findRscript();
            if (!rscriptBin) {
                this.consoleView.append("[Error] Rscript no encontrado para realizar la instalación.");
                return false;
            }

            return new Promise((resolve) => {
                const installProc = cp.spawn(rscriptBin, [
                    '-e',
                    "install.packages('rgee', repos='https://cloud.r-project.org')"
                ]);

                installProc.stdout?.on('data', (d: Buffer) => {
                    const lines = d.toString().split('\n');
                    lines.forEach(l => { if (l.trim()) this.consoleView.append(`[R] ${l.trim()}`); });
                });

                installProc.stderr?.on('data', (d: Buffer) => {
                    const lines = d.toString().split('\n');
                    lines.forEach(l => { if (l.trim()) this.consoleView.append(`[R] ${l.trim()}`); });
                });

                installProc.on('close', (code) => {
                    if (code === 0) {
                        this.consoleView.append("✅ [R] 'rgee' instalado con éxito. Ya puedes ejecutar tus scripts de Earth Engine en R.");
                        vscode.window.showInformationMessage("✅ GEE Pro: 'rgee' instalado con éxito en R.");
                        resolve(true);
                    } else {
                        this.consoleView.append(`[Error] Falló la instalación de rgee (código ${code}).`);
                        resolve(false);
                    }
                });
            });
        }
        return false;
    }

    private findRscript(): string | null {
        const candidates = [
            'Rscript',
            '/usr/local/bin/Rscript',
            '/opt/homebrew/bin/Rscript',
            '/usr/bin/Rscript'
        ];
        for (const c of candidates) {
            try {
                if (c.startsWith('/') && !fs.existsSync(c)) continue;
                const out = cp.execSync(`${c} --version`, {
                    timeout: 2000,
                    stdio: ['ignore', 'pipe', 'pipe']
                }).toString();
                if (out.includes('Rscript') || out.includes('R version')) return c;
            } catch {}
        }
        return null;
    }
}
