import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';

/**
 * GEE IDE — Python Runtime Manager (Hermetic Python 3.11 Environment)
 * 
 * Solves the Python version dilemma by providing a completely isolated,
 * hermetic Python 3.11 runtime:
 * 1. Rejects incompatible or bleeding-edge versions (e.g. Python >= 3.13 like 3.15)
 *    that break typing, geospatial libraries and formatters (autopep8).
 * 2. If a compatible Python (3.9 - 3.12) with Earth Engine is already present, uses it.
 * 3. If no compatible Python exists, downloads and provisions an official
 *    Standalone Portable Python 3.11 (~24 MB) without requiring admin rights.
 * 4. Automatically configures VS Code settings (python.defaultInterpreterPath,
 *    autopep8.interpreter, and cSpell Spanish support) to eliminate errors.
 */

const STANDALONE_RELEASES: Record<string, string> = {
    'darwin-arm64': 'https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-aarch64-apple-darwin-install_only.tar.gz',
    'darwin-x64': 'https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-x86_64-apple-darwin-install_only.tar.gz',
    'win32-x64': 'https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-x86_64-pc-windows-msvc-install_only.tar.gz',
    'linux-x64': 'https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-x86_64-unknown-linux-gnu-install_only.tar.gz'
};

export class PythonRuntimeManager {
    private static instance: PythonRuntimeManager;
    private cachedPython: string | null = null;
    private isProvisioning: boolean = false;

    private constructor() {}

    public static getInstance(): PythonRuntimeManager {
        if (!PythonRuntimeManager.instance) {
            PythonRuntimeManager.instance = new PythonRuntimeManager();
        }
        return PythonRuntimeManager.instance;
    }

    public getStandaloneDir(): string {
        return path.join(os.homedir(), '.gee-pro-ide', 'python311');
    }

    public getStandaloneExecutable(): string | null {
        const base = this.getStandaloneDir();
        const isWin = process.platform === 'win32';
        const bin = isWin 
            ? path.join(base, 'python', 'python.exe')
            : path.join(base, 'python', 'bin', 'python3');
            
        if (fs.existsSync(bin)) {
            return bin;
        }
        return null;
    }

    /**
     * Checks if a Python binary is compatible (version >= 3.9 and < 3.13)
     */
    public checkCompatibility(pythonPath: string): { compatible: boolean; versionStr: string; reason?: string } {
        try {
            const out = cp.execSync(`"${pythonPath}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"`, {
                encoding: 'utf8',
                timeout: 3000,
                stdio: ['ignore', 'pipe', 'pipe']
            }).trim();

            const parts = out.split('.').map(Number);
            const major = parts[0] || 0;
            const minor = parts[1] || 0;

            if (major !== 3) {
                return { compatible: false, versionStr: out, reason: `Versión no compatible: Python ${major}` };
            }

            if (minor >= 13) {
                return { 
                    compatible: false, 
                    versionStr: out, 
                    reason: `Python ${out} es una versión experimental / inestable (>= 3.13). Rompe librerías geoespaciales, formatters (autopep8) y tipado.` 
                };
            }

            if (minor < 8) {
                return { 
                    compatible: false, 
                    versionStr: out, 
                    reason: `Python ${out} es obsoleto (< 3.8). Earth Engine requiere Python 3.8+.` 
                };
            }

            return { compatible: true, versionStr: out };
        } catch (e: any) {
            return { compatible: false, versionStr: '', reason: e.message || String(e) };
        }
    }

    /**
     * Checks if earthengine-api can be imported
     */
    public hasEarthEngine(pythonPath: string): boolean {
        try {
            cp.execSync(`"${pythonPath}" -c "import ee"`, {
                timeout: 3000,
                stdio: ['ignore', 'ignore', 'ignore']
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Resolves the best available Python executable or provisions Python 3.11 standalone if needed.
     */
    public async resolvePython(consoleView?: any, autoProvision: boolean = true): Promise<string | null> {
        if (this.cachedPython && fs.existsSync(this.cachedPython)) {
            return this.cachedPython;
        }

        // 1. Check GEE IDE Dedicated Standalone Python 3.11
        const standalone = this.getStandaloneExecutable();
        if (standalone) {
            const comp = this.checkCompatibility(standalone);
            if (comp.compatible) {
                if (!this.hasEarthEngine(standalone)) {
                    await this.installPackages(standalone, ['earthengine-api', 'certifi'], consoleView);
                }
                this.cachedPython = standalone;
                await this.applyRecommendedVsCodeSettings(standalone);
                return standalone;
            }
        }

        // 2. Check user configured setting
        const config = vscode.workspace.getConfiguration('gee-pro');
        const customPath = config.get<string>('pythonPath');
        if (customPath && fs.existsSync(customPath)) {
            const comp = this.checkCompatibility(customPath);
            if (comp.compatible) {
                this.cachedPython = customPath;
                return customPath;
            } else if (consoleView && comp.reason) {
                consoleView.append(`⚠️ [Python] Intérprete configurado '${customPath}' descartado: ${comp.reason}`);
            }
        }

        // 3. Check known compatible virtualenvs with Earth Engine installed
        const isWin = process.platform === 'win32';
        const pySub = isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
        const candidateVenvs = [
            path.join(os.homedir(), '.virtualenvs', 'rgee', pySub),
            path.join(os.homedir(), '.gee-pro-ide', 'venv', pySub),
            path.join(os.homedir(), '.config', 'earthengine', 'venv', pySub),
            path.join(os.homedir(), '.venv', pySub)
        ];

        for (const venvPy of candidateVenvs) {
            if (fs.existsSync(venvPy)) {
                const comp = this.checkCompatibility(venvPy);
                if (comp.compatible && this.hasEarthEngine(venvPy)) {
                    this.cachedPython = venvPy;
                    await this.applyRecommendedVsCodeSettings(venvPy);
                    return venvPy;
                }
            }
        }

        // 4. Check system interpreters
        const systemCandidates = [
            '/opt/homebrew/bin/python3.11',
            '/usr/local/bin/python3.11',
            'python3.11',
            '/opt/homebrew/bin/python3.10',
            '/usr/local/bin/python3.10',
            'python3.10',
            '/opt/homebrew/bin/python3',
            '/usr/bin/python3',
            'python3'
        ];

        let bestCompatibleSystemPy: string | null = null;

        for (const cand of systemCandidates) {
            try {
                const resolved = cand.startsWith('/') ? cand : this.which(cand);
                if (resolved && fs.existsSync(resolved)) {
                    const comp = this.checkCompatibility(resolved);
                    if (comp.compatible) {
                        if (this.hasEarthEngine(resolved)) {
                            this.cachedPython = resolved;
                            await this.applyRecommendedVsCodeSettings(resolved);
                            return resolved;
                        }
                        if (!bestCompatibleSystemPy) {
                            bestCompatibleSystemPy = resolved;
                        }
                    } else if (comp.versionStr.startsWith('3.15') || comp.versionStr.startsWith('3.14') || comp.versionStr.startsWith('3.13')) {
                        // Incompatible bleeding edge detected (like Python 3.15)
                        if (consoleView) {
                            consoleView.append(`⚠️ [Python] Detectado ${resolved} (${comp.versionStr}): Descartado por ser versión inestable/incompatible.`);
                        }
                    }
                }
            } catch {}
        }

        // 5. If we have a compatible system Python (e.g. 3.11) but missing ee, install ee in user venv or use it
        if (bestCompatibleSystemPy && !autoProvision) {
            this.cachedPython = bestCompatibleSystemPy;
            return bestCompatibleSystemPy;
        }

        // 6. No compatible Python or missing Earth Engine: Provision Hermetic Python 3.11!
        if (autoProvision) {
            if (bestCompatibleSystemPy) {
                // If the user already has python3.11 binary, create a clean dedicated venv in ~/.gee-pro-ide/venv
                try {
                    const venvDir = path.join(os.homedir(), '.gee-pro-ide', 'venv');
                    fs.mkdirSync(path.dirname(venvDir), { recursive: true });
                    if (consoleView) consoleView.append('⏳ Creando entorno dedicado Python 3.11 en ~/.gee-pro-ide/venv...');
                    cp.execSync(`"${bestCompatibleSystemPy}" -m venv "${venvDir}"`, { timeout: 30000 });
                    const newVenvPy = isWin ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
                    if (fs.existsSync(newVenvPy)) {
                        await this.installPackages(newVenvPy, ['earthengine-api', 'certifi'], consoleView);
                        this.cachedPython = newVenvPy;
                        await this.applyRecommendedVsCodeSettings(newVenvPy);
                        return newVenvPy;
                    }
                } catch (e: any) {
                    if (consoleView) consoleView.append(`⚠️ No se pudo crear venv local: ${e.message}. Descargando Python 3.11 Standalone...`);
                }
            }

            // Standalone Hermetic Download
            const downloaded = await this.provisionStandalonePython(consoleView);
            if (downloaded) {
                this.cachedPython = downloaded;
                await this.applyRecommendedVsCodeSettings(downloaded);
                return downloaded;
            }
        }

        return null;
    }

    /**
     * Downloads and provisions Astral python-build-standalone Python 3.11 (~24 MB)
     */
    public async provisionStandalonePython(consoleView?: any): Promise<string | null> {
        if (this.isProvisioning) {
            return null;
        }
        this.isProvisioning = true;

        const platformKey = `${process.platform}-${process.arch}`;
        const downloadUrl = STANDALONE_RELEASES[platformKey];

        if (!downloadUrl) {
            if (consoleView) consoleView.append(`[Error] Plataforma no soportada para Python Standalone: ${platformKey}`);
            this.isProvisioning = false;
            return null;
        }

        const targetDir = this.getStandaloneDir();
        const tarPath = path.join(targetDir, 'python_standalone.tar.gz');

        try {
            fs.mkdirSync(targetDir, { recursive: true });

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'GEE IDE: Descargando entorno hermético Python 3.11...',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Conectando con repositorio oficial (~24 MB)...', increment: 10 });
                if (consoleView) consoleView.append('⬇️ Descargando Python 3.11 Standalone oficial (~24 MB)...');

                await this.downloadFile(downloadUrl, tarPath, (pct) => {
                    progress.report({ message: `Descargando: ${pct}%`, increment: pct * 0.6 });
                });

                progress.report({ message: 'Extrayendo binarios aislados...', increment: 75 });
                if (consoleView) consoleView.append('📦 Extrayendo entorno Python 3.11...');

                // Extract with native tar (fast and available on macOS, Linux, and Windows 10+)
                cp.execSync(`tar -xzf "${tarPath}" -C "${targetDir}"`, { timeout: 30000 });
                try { fs.unlinkSync(tarPath); } catch {}

                progress.report({ message: 'Instalando biblioteca Earth Engine (earthengine-api)...', increment: 85 });
                const pythonBin = this.getStandaloneExecutable();
                if (pythonBin) {
                    await this.installPackages(pythonBin, ['earthengine-api', 'certifi'], consoleView);
                    progress.report({ message: '✅ Entorno Python 3.11 listo.', increment: 100 });
                }
            });

            const finalBin = this.getStandaloneExecutable();
            if (finalBin) {
                if (consoleView) consoleView.append(`✅ Entorno hermético Python 3.11 configurado con éxito: ${finalBin}`);
                vscode.window.showInformationMessage('✅ GEE IDE: Entorno científico Python 3.11 hermético configurado.');
                return finalBin;
            }
        } catch (err: any) {
            if (consoleView) consoleView.append(`[Error en instalación de Python Standalone]: ${err.message || err}`);
            vscode.window.showErrorMessage(`Error configurando Python hermético: ${err.message}`);
        } finally {
            this.isProvisioning = false;
        }

        return null;
    }

    /**
     * Installs required packages into the target Python environment
     */
    public async installPackages(pythonPath: string, packages: string[], consoleView?: any): Promise<boolean> {
        try {
            if (consoleView) {
                consoleView.append(`📦 Instalando paquetes en Python: ${packages.join(', ')}...`);
            }
            cp.execSync(`"${pythonPath}" -m pip install --quiet --upgrade ${packages.join(' ')}`, {
                timeout: 120000,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            if (consoleView) {
                consoleView.append(`✅ Paquetes listos: ${packages.join(', ')}`);
            }
            return true;
        } catch (e: any) {
            if (consoleView) {
                consoleView.append(`⚠️ Error instalando paquetes: ${e.message || e}`);
            }
            return false;
        }
    }

    /**
     * Silences autopep8 crashes and Pylance errors by configuring VS Code workspace settings
     */
    public async applyRecommendedVsCodeSettings(pythonPath: string): Promise<void> {
        try {
            // 1. Point VS Code Python interpreter to the safe Python 3.11
            const pyConfig = vscode.workspace.getConfiguration('python');
            await pyConfig.update('defaultInterpreterPath', pythonPath, vscode.ConfigurationTarget.Global);

            // 2. Point autopep8 to safe Python 3.11 so it stops crashing on Python 3.15!
            const autopep8Config = vscode.workspace.getConfiguration('autopep8');
            await autopep8Config.update('interpreter', [pythonPath], vscode.ConfigurationTarget.Global);

            // 3. Fix cSpell Spanish language support
            const cSpellConfig = vscode.workspace.getConfiguration('cSpell');
            const curLangs = cSpellConfig.get<string>('language') || 'en';
            if (!curLangs.includes('es')) {
                const updated = curLangs ? `${curLangs},es` : 'en,es';
                await cSpellConfig.update('language', updated, vscode.ConfigurationTarget.Global);
            }
        } catch {}
    }

    private which(cmd: string): string | null {
        try {
            const isWin = process.platform === 'win32';
            const checkCmd = isWin ? `where ${cmd}` : `which ${cmd}`;
            const out = cp.execSync(checkCmd, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
            const firstLine = out.split('\n')[0].trim();
            return firstLine && fs.existsSync(firstLine) ? firstLine : null;
        } catch {
            return null;
        }
    }

    private downloadFile(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);

            const makeRequest = (currentUrl: string) => {
                https.get(currentUrl, (response) => {
                    // Follow redirects (301, 302, 307, 308)
                    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                        makeRequest(response.headers.location);
                        return;
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`Servidor devolvió código HTTP ${response.statusCode}`));
                        return;
                    }

                    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
                    let downloaded = 0;

                    response.on('data', (chunk) => {
                        downloaded += chunk.length;
                        if (totalBytes > 0 && onProgress) {
                            const pct = Math.round((downloaded / totalBytes) * 100);
                            onProgress(pct);
                        }
                    });

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }).on('error', (err) => {
                    try { fs.unlinkSync(dest); } catch {}
                    reject(err);
                });
            };

            makeRequest(url);
        });
    }
}
