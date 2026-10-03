import * as vscode from 'vscode';
import * as vm from 'vm';
import * as os from 'os';

// Ensure working directory is always writable (fixes EROFS on macOS/Linux for synchronous XMLHttpRequests)
try {
    process.chdir(os.tmpdir());
} catch (e) {}

let ee: any = null;
function getEE(): any {
    if (!ee) {
        ee = require('@google/earthengine');
    }
    return ee;
}

export class GEERuntime {
    public isInitialized = false;
    private context: vm.Context | undefined;
    private cwd: string = ''; // Current working directory in GEE
    private projectId: string = '';
    private snippetsManager: any;

    public setSnippetsManager(sm: any) {
        this.snippetsManager = sm;
    }

    constructor(
        private consoleView: any,
        private mapView: any
    ) {
        try {
            process.chdir(os.tmpdir());
        } catch (e) {}
        this.resetContext();
    }

    private resetContext() {
        const eeInstance = getEE();
        const ctx = {
            ee: eeInstance,
            print: (...args: any[]) => {
                try {
                    process.chdir(os.tmpdir());
                } catch (e) {}
                this.consoleView.append(args.map(a => {
                    if (a === null) return 'null';
                    if (a === undefined) return 'undefined';
                    // Auto-resolve Earth Engine server-side objects via getInfo() if available (like official Code Editor)
                    if (a && typeof a.getInfo === 'function') {
                        try {
                            const val = a.getInfo();
                            return typeof val === 'object' ? JSON.stringify(val, null, 2) : val;
                        } catch (e: any) {
                            return `[EE Object: ${e.message || e}]`;
                        }
                    }
                    return typeof a === 'object' ? JSON.stringify(a, null, 2) : a;
                }).join(' '));
            },
            Map: {
                addLayer: async (element: any, visParams?: any, name?: string) => {
                    this.consoleView.append(`Adding layer: ${name || 'unnamed'}...`);
                    try {
                        const mapId = await new Promise((resolve, reject) => {
                            element.getMapId(visParams || {}, (res: any, err: any) => {
                                if (err) reject(err);
                                else resolve(res);
                            });
                        });
                        this.mapView.addLayer(mapId, name);
                    } catch (err: any) {
                        this.consoleView.append(`Error adding layer: ${err.message}`);
                    }
                },
                setCenter: (lon: number, lat: number, zoom?: number) => {
                    this.mapView.setCenter(lat, lon, zoom);
                },
                centerObject: async (eeObject: any, zoom?: number) => {
                    try {
                        if (!eeObject) return;
                        let geom = eeObject;
                        if (typeof eeObject.geometry === 'function') {
                            geom = eeObject.geometry();
                        } else if (eeInstance && eeInstance.Feature && typeof eeObject.getMapId === 'function' && typeof eeObject.bounds !== 'function') {
                            geom = eeInstance.Feature(eeObject).geometry();
                        }

                        const targetZoom = typeof zoom === 'number' ? zoom : 12;

                        const geoInfo: any = await new Promise((resolve, reject) => {
                            try {
                                if (typeof geom.centroid === 'function') {
                                    geom.centroid(1).getInfo((res: any, err: any) => {
                                        if (err) reject(err);
                                        else resolve(res);
                                    });
                                } else if (typeof geom.bounds === 'function') {
                                    geom.bounds().getInfo((res: any, err: any) => {
                                        if (err) reject(err);
                                        else resolve(res);
                                    });
                                } else {
                                    resolve(null);
                                }
                            } catch (e) {
                                reject(e);
                            }
                        });

                        if (geoInfo && geoInfo.type === 'Point' && Array.isArray(geoInfo.coordinates)) {
                            const lon = geoInfo.coordinates[0];
                            const lat = geoInfo.coordinates[1];
                            this.mapView.setCenter(lat, lon, targetZoom);
                        } else if (geoInfo && geoInfo.coordinates && geoInfo.coordinates[0]) {
                            const coords = geoInfo.coordinates[0];
                            const lons = coords.map((c: any) => c[0]);
                            const lats = coords.map((c: any) => c[1]);
                            const lon = (Math.min(...lons) + Math.max(...lons)) / 2;
                            const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
                            this.mapView.setCenter(lat, lon, targetZoom);
                        }
                    } catch (err: any) {
                        this.consoleView.append(`[Map Error] centerObject: ${err.message || err}`);
                    }
                },
                clear: () => {
                    this.mapView.clear();
                },
                add_layer: function(this: any, ...args: any[]) { return this.addLayer(...args); },
                set_center: function(this: any, ...args: any[]) { return this.setCenter(...args); },
                center_object: function(this: any, ...args: any[]) { return this.centerObject(...args); }
            },
            ui: {
                Label: (text: string) => { this.consoleView.append(`[UI Label]: ${text}`); return {}; },
                Button: (label: string) => { this.consoleView.append(`[UI Button]: ${label}`); return {}; },
                Select: (items: any) => { return {}; },
                Panel: () => { return {}; }
            },
            Export: {
                image: {
                    toDrive: (params: any) => { this.consoleView.append(`[Export]: Task created for Drive export - ${params.description || 'unnamed'}`); }
                },
                table: {
                    toDrive: (params: any) => { this.consoleView.append(`[Export]: Task created for Drive table export`); }
                }
            }
        };
        this.context = vm.createContext(ctx);
    }

    public async initialize(credentials: any) {
        if (!(global as any).XMLHttpRequest) {
            const { XMLHttpRequest } = require('xmlhttprequest');
            (global as any).XMLHttpRequest = XMLHttpRequest;
        }

        return new Promise((resolve, reject) => {
            const ee = getEE();
            let projectId = credentials.project_id || credentials.project || '';
            if (projectId === 'gee-pro-default' || projectId === 'PeruREDD') {
                projectId = '';
            }
            
            const onInitSuccess = async () => {
                this.isInitialized = true;
                this.projectId = projectId;
                await this.loadAssetRoots(credentials.email || credentials.client_email);
                resolve(true);
            };

            const onInitError = (err: any) => {
                reject(err);
            };

            if (credentials.private_key) {
                // Service Account Flow
                ee.data.authenticateViaPrivateKey(
                    credentials,
                    () => {
                        ee.initialize(null, null, () => {
                            this.consoleView.append(`GEE Session initialized (Service Account): ${projectId}`);
                            onInitSuccess();
                        }, onInitError, projectId);
                    },
                    onInitError
                );
            } else if (credentials.access_token || credentials.refresh_token) {
                // Real OAuth Flow
                ee.data.setAuthToken(
                    credentials.client_id,
                    'Bearer',
                    credentials.access_token,
                    3600,
                    [],
                    () => {
                        ee.initialize(null, null, () => {
                            this.consoleView.append(`GEE Session initialized (Google Account)`);
                            onInitSuccess();
                        }, onInitError, null, projectId);
                    },
                    false // Crucial: false means don't try to use browser popup
                );
            } else {
                this.isInitialized = true;
                this.consoleView.append(`GEE Session initialized (Guest)`);
                resolve(true);
            }
        });
    }

    public reset(silent: boolean = false) {
        this.resetContext();
        if (!silent) {
            this.consoleView.append('🧹 Environment reset. All variables cleared.');
        }
    }

    public getUserVariables(): string[] {
        if (!this.context) return [];
        const builtins = new Set(['ee', 'Map', 'ui', 'Export', 'print', 'require', 'global', 'console', 'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Buffer', 'process']);
        return Object.keys(this.context).filter(k => !builtins.has(k) && !k.startsWith('_'));
    }

    public async execute(code: string, resetContext: boolean = false) {
        if (!this.isInitialized) {
            vscode.window.showErrorMessage('GEE not initialized. Please authenticate first.');
            return;
        }

        if (resetContext) {
            this.resetContext();
        }

        try {
            try {
                process.chdir(os.tmpdir());
            } catch (e) {}
            if (this.context) {
                let cleanCode = code.trim();
                // If code starts with shebang like # js or #! /usr/bin/env, convert to comment so JS engine accepts it
                if (cleanCode.startsWith('# js') || cleanCode.startsWith('#js') || cleanCode.startsWith('#!')) {
                    cleanCode = '//' + cleanCode.substring(1);
                }
                if (cleanCode) {
                    const result = vm.runInContext(cleanCode, this.context);
                    // RStudio UX: If the executed line/selection is an expression that yields a value, print it
                    if (!resetContext && result !== undefined && !(result instanceof Promise)) {
                        let outputVal = result;
                        if (result && typeof result.getInfo === 'function') {
                            try {
                                outputVal = result.getInfo();
                            } catch (e: any) {
                                outputVal = `[EE Object: ${e.message || e}]`;
                            }
                        }
                        if (typeof outputVal === 'object' && outputVal !== null) {
                            this.consoleView.append(JSON.stringify(outputVal, null, 2));
                        } else {
                            this.consoleView.append(String(outputVal));
                        }
                    }

                    // Sincronizar variables vivas al autocompletado de la consola
                    const userVars = this.getUserVariables();
                    if (userVars.length > 0) {
                        this.consoleView.addCompletions(userVars);
                    }
                }
            }
        } catch (err: any) {
            const msg = err.message || 'Unknown Runtime Error';
            this.consoleView.append(`Runtime Error: ${msg}`);
            if (msg.includes('EROFS')) {
                try {
                    process.chdir(os.tmpdir());
                } catch (e) {}
                this.consoleView.append('Tip: Fixed working directory to writable temp folder. Please re-run the line.');
            }
        }
    }

    private assetRoots: Array<{ id: string; shortName: string; type: string }> = [];

    public async loadAssetRoots(userEmail?: string): Promise<Array<{ id: string; shortName: string; type: string }>> {
        const ee = getEE();
        return new Promise((resolve) => {
            try {
                ee.data.getAssetRoots(async (roots: any, err: any) => {
                    const rootMap = new Map<string, { id: string; shortName: string; type: string }>();
                    const assetCompletions: string[] = [];

                    if (!err && Array.isArray(roots)) {
                        for (const r of roots) {
                            const id: string = r.id || r.name;
                            if (!id) continue;

                            const parts = id.split('/');
                            const assetName = parts[parts.length - 1];
                            assetCompletions.push(id);
                            if (assetName) assetCompletions.push(assetName);

                            if (id.startsWith('projects/')) {
                                const match = id.match(/^projects\/([^\/]+)(?:\/assets)?(?:\/.*)?$/);
                                if (match) {
                                    const projName = match[1];
                                    const rootId = `projects/${projName}/assets`;
                                    if (!rootMap.has(rootId)) {
                                        rootMap.set(rootId, {
                                            id: rootId,
                                            shortName: projName,
                                            type: 'FOLDER'
                                        });
                                    }
                                }
                            } else if (id.startsWith('users/')) {
                                const userParts = id.split('/');
                                const username = userParts[1];
                                if (username) {
                                    const rootId = `users/${username}`;
                                    if (!rootMap.has(rootId)) {
                                        rootMap.set(rootId, {
                                            id: rootId,
                                            shortName: username,
                                            type: 'FOLDER'
                                        });
                                    }
                                }
                            } else {
                                if (!rootMap.has(id)) {
                                    rootMap.set(id, {
                                        id,
                                        shortName: parts[parts.length - 1] || id,
                                        type: r.type || 'FOLDER'
                                    });
                                }
                            }
                        }
                    }

                    // Always ensure active Cloud Project root is present
                    const activeProj = this.getProjectId();
                    if (activeProj && activeProj !== 'gee-pro-default' && activeProj !== 'PeruREDD') {
                        const projRootId = `projects/${activeProj}/assets`;
                        if (!rootMap.has(projRootId)) {
                            rootMap.set(projRootId, {
                                id: projRootId,
                                shortName: activeProj,
                                type: 'FOLDER'
                            });
                        }
                    }

                    // Check for legacy roots (users/robles, projects/PeruREDD, or from email)
                    const legacyCandidates = ['users/robles', 'projects/PeruREDD'];
                    if (userEmail) {
                        const clean = userEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
                        if (clean && !legacyCandidates.includes(`users/${clean}`)) {
                            legacyCandidates.push(`users/${clean}`);
                        }
                    }

                    for (const candidate of legacyCandidates) {
                        if (!rootMap.has(candidate)) {
                            try {
                                const exists = await new Promise<boolean>((res) => {
                                    ee.data.listAssets(candidate, {}, (_: any, listErr: any) => {
                                        res(!listErr);
                                    });
                                });
                                if (exists) {
                                    const parts = candidate.split('/');
                                    const shortName = parts[parts.length - 1];
                                    rootMap.set(candidate, {
                                        id: candidate,
                                        shortName: shortName,
                                        type: 'FOLDER'
                                    });
                                }
                            } catch (e) {}
                        }
                    }

                    this.assetRoots = Array.from(rootMap.values());
                    if (this.consoleView && assetCompletions.length > 0) {
                        this.consoleView.addCompletions(assetCompletions);
                    }
                    resolve(this.assetRoots);
                });
            } catch (e) {
                resolve([]);
            }
        });
    }

    public getAssetRootsList(): Array<{ id: string; shortName: string; type: string }> {
        return this.assetRoots;
    }

    public getProjectId(): string {
        if (this.projectId === 'gee-pro-default' || this.projectId === 'PeruREDD') {
            this.projectId = '';
        }
        return this.projectId || '';
    }

    public setProjectId(id: string) {
        if (id && id !== 'gee-pro-default' && id !== 'PeruREDD') {
            this.projectId = id;
        } else {
            this.projectId = '';
        }
    }

    private getRootPath(): string {
        const ee = getEE();
        let proj = this.getProjectId();
        if (!proj) {
            try { proj = ee.data.getProject(); } catch(e) {}
        }
        return proj ? `projects/${proj}/assets` : 'projects/earthengine-legacy/assets';
    }

    private getDefaultRoot(): string {
        const proj = this.getProjectId();
        if (proj && proj !== 'gee-pro-default' && proj !== 'PeruREDD') {
            return `projects/${proj}/assets`;
        }
        const projRoot = this.assetRoots.find(r => r.id.startsWith('projects/'));
        if (projRoot) return projRoot.id;

        const userRoot = this.assetRoots.find(r => r.id.startsWith('users/'));
        if (userRoot) return userRoot.id;

        return this.getRootPath();
    }

    private resolvePath(targetPath: string): string {
        if (!targetPath || targetPath === '.' || targetPath === '~') {
            return '~';
        }
        if (targetPath.startsWith('projects/') || targetPath.startsWith('users/')) {
            return targetPath;
        }

        // If currently at root '~' or cwd is empty
        if (!this.cwd || this.cwd === '~') {
            // 1. Check if whole targetPath matches a known asset root shortName or id
            const matchedRoot = this.assetRoots.find(r => 
                r.shortName.toLowerCase() === targetPath.toLowerCase() || 
                r.id.toLowerCase() === targetPath.toLowerCase() ||
                r.id.toLowerCase().endsWith('/' + targetPath.toLowerCase())
            );
            if (matchedRoot) {
                return matchedRoot.id;
            }

            // 2. Check if the first segment matches a known root
            const firstSlash = targetPath.indexOf('/');
            if (firstSlash !== -1) {
                const firstPart = targetPath.substring(0, firstSlash);
                const rest = targetPath.substring(firstSlash + 1);
                const matchedPrefix = this.assetRoots.find(r => 
                    r.shortName.toLowerCase() === firstPart.toLowerCase() || 
                    r.id.toLowerCase() === firstPart.toLowerCase() ||
                    r.id.toLowerCase().endsWith('/' + firstPart.toLowerCase())
                );
                if (matchedPrefix) {
                    return `${matchedPrefix.id}/${rest}`;
                }
            }

            if (targetPath === 'users' || targetPath === 'projects') {
                return targetPath;
            }

            // 3. Fallback: relative path from root '~' defaults to active primary root
            const defaultRoot = this.getDefaultRoot();
            return `${defaultRoot}/${targetPath}`;
        }

        // Currently inside a directory (e.g. this.cwd = 'users/robles')
        let combined = `${this.cwd}/${targetPath}`;
        const segments = combined.split('/').filter(s => s && s !== '.');
        const normalized: string[] = [];

        for (const seg of segments) {
            if (seg === '..') {
                if (normalized.length > 0) normalized.pop();
            } else {
                normalized.push(seg);
            }
        }

        if (normalized.length === 0) {
            return '~';
        }

        return normalized.join('/');
    }

    private async listAllAssets(folderPath: string): Promise<any[]> {
        const ee = getEE();
        let allAssets: any[] = [];
        let pageToken: string | undefined = undefined;

        do {
            const params: any = {};
            if (pageToken) params.pageToken = pageToken;
            const res: any = await new Promise((resolve, reject) => {
                ee.data.listAssets(folderPath, params, (r: any, err: any) => {
                    if (err) reject(err);
                    else resolve(r || {});
                });
            });
            if (res.assets && Array.isArray(res.assets)) {
                allAssets = allAssets.concat(res.assets);
            }
            pageToken = res.nextPageToken;
        } while (pageToken);

        return allAssets;
    }

    private async deleteAssetRecursively(targetPath: string): Promise<number> {
        const ee = getEE();
        let deletedCount = 0;

        // Try to list children if it's a container (Folder or ImageCollection)
        let children: any[] = [];
        try {
            children = await this.listAllAssets(targetPath);
        } catch (e) {
            // Not a folder or cannot list, delete directly
        }

        for (const child of children) {
            const childId = child.id || child.name;
            const childType = child.type;
            if (childType === 'FOLDER' || childType === 'IMAGE_COLLECTION') {
                const count = await this.deleteAssetRecursively(childId);
                deletedCount += count;
            } else {
                this.consoleView.append(`   🗑️ Deleting child: ${childId.split('/').pop()}`);
                await new Promise((resolve, reject) => {
                    ee.data.deleteAsset(childId, (res: any, err: any) => {
                        if (err) reject(err);
                        else resolve(res);
                    });
                });
                deletedCount++;
            }
        }

        // Delete parent container or asset itself
        this.consoleView.append(`   🗑️ Deleting: ${targetPath.split('/').pop()}`);
        await new Promise((resolve, reject) => {
            ee.data.deleteAsset(targetPath, (res: any, err: any) => {
                if (err) reject(err);
                else resolve(res);
            });
        });
        deletedCount++;

        return deletedCount;
    }

    public showHelp(query: string) {
        const clean = query.trim().replace(/^ee\./, '');
        if (!clean || clean === 'help') {
            this.consoleView.append('📖 Sistema de Ayuda de GEE IDE:');
            this.consoleView.append('  Usa: ?<funcion> o ?<comando> para consultar detalles y parámetros.');
            this.consoleView.append('  Ejemplos de algoritmos GEE:');
            this.consoleView.append('    ?ee.Image.normalizedDifference');
            this.consoleView.append('    ?ee.Reducer.mean');
            this.consoleView.append('    ?ee.Filter.date');
            this.consoleView.append('    ?ee.Algorithms.Landsat.TOA');
            this.consoleView.append('  Comandos del sistema:');
            this.consoleView.append('    ?vars     (ver variables en memoria)');
            this.consoleView.append('    ?history  (ver historial de comandos)');
            this.consoleView.append('    ?clear    (limpiar consola - Atajo: Cmd+L / Ctrl+L)');
            this.consoleView.append('    ?Map.addLayer');
            return;
        }

        // Builtin commands help
        const builtinsHelp: Record<string, { desc: string; usage: string }> = {
            'vars': { desc: 'Muestra todas las variables activas en la memoria local con sus tipos.', usage: 'vars  o  objects' },
            'objects': { desc: 'Muestra todas las variables activas en la memoria local con sus tipos.', usage: 'vars  o  objects' },
            'snippets': { desc: 'Lista todos los snippets de código disponibles (GEE base y personalizados).', usage: 'snippets  o  ?snippets' },
            'history': { desc: 'Muestra la lista de comandos ejecutados en la sesión guardados en .gee_history.', usage: 'history' },
            'clear': { desc: 'Limpia la pantalla de la consola. Atajo rápido: Cmd+L (Mac) o Ctrl+L (Win/Linux).', usage: 'clear  o  cls' },
            'cls': { desc: 'Limpia la pantalla de la consola. Atajo rápido: Cmd+L (Mac) o Ctrl+L (Win/Linux).', usage: 'clear  o  cls' },
            'ls': { desc: 'Lista los archivos de la carpeta actual o carpetas de Assets de GEE.', usage: 'ls [carpeta]' },
            'dir': { desc: 'Lista los archivos de la carpeta actual o carpetas de Assets de GEE.', usage: 'dir [carpeta]' },
            'cd': { desc: 'Cambia el directorio activo de Assets en GEE.', usage: 'cd [ruta]' },
            'pwd': { desc: 'Muestra la ruta del directorio activo de Assets en GEE.', usage: 'pwd' },
            'mkdir': { desc: 'Crea una nueva carpeta en tus Assets de Earth Engine.', usage: 'mkdir [-p] [nombre]' },
            'rm': { desc: 'Elimina un asset de Earth Engine (o recursivo con -r).', usage: 'rm [-r] [asset_id]' },
            'Map.addLayer': { desc: 'Agrega una capa ráster o vectorial al visor de mapas Leaflet.', usage: 'Map.addLayer(eeObject, visParams?, name?, shown?, opacity?)' },
            'Map.centerObject': { desc: 'Centra automáticamente el visor Leaflet sobre la geometría o imagen.', usage: 'Map.centerObject(eeObject, zoom?)' },
            'Map.setCenter': { desc: 'Centra el mapa en coordenadas geográficas específicas [lon, lat].', usage: 'Map.setCenter(lon, lat, zoom?)' }
        };

        if (clean === 'snippets') {
            this.showSnippetsList();
            return;
        }

        if (builtinsHelp[clean] || builtinsHelp[query]) {
            const h = builtinsHelp[clean] || builtinsHelp[query];
            this.consoleView.append(`📖 [Comando] ${clean}`);
            this.consoleView.append(`  ${h.desc}`);
            this.consoleView.append(`  Uso: ${h.usage}`);
            return;
        }

        // Earth Engine Algorithm Lookup
        const ee = getEE();
        try {
            if (ee && ee.ApiFunction) {
                let sig = ee.ApiFunction.lookup(clean) || ee.ApiFunction.lookup(query);
                if (!sig && typeof ee.ApiFunction.allSignatures === 'function') {
                    const all = ee.ApiFunction.allSignatures();
                    if (all) {
                        const targetKey = Object.keys(all).find(k => k.toLowerCase() === clean.toLowerCase() || k.toLowerCase().endsWith('.' + clean.toLowerCase()));
                        if (targetKey) sig = all[targetKey];
                    }
                }

                if (sig) {
                    const returns = sig.returns || 'void';
                    const desc = sig.description || 'Sin descripción disponible.';
                    this.consoleView.append(`📖 ee.${sig.name || clean}`);
                    this.consoleView.append(`  ${desc}`);
                    if (Array.isArray(sig.args) && sig.args.length > 0) {
                        this.consoleView.append('  Parámetros:');
                        sig.args.forEach((a: any) => {
                            const opt = a.optional ? ' (opcional)' : '';
                            const def = a.default !== null && a.default !== undefined ? ` [default: ${a.default}]` : '';
                            this.consoleView.append(`    • ${a.name} (${a.type}${opt}): ${a.description || ''}${def}`);
                        });
                    }
                    this.consoleView.append(`  Retorna: ${returns}`);
                    return;
                }
            }
        } catch (e: any) {}

        this.consoleView.append(`❓ No se encontró documentación para '${query}'.`);
        this.consoleView.append(`  Tip: Escribe ?help para ver ejemplos de consultas de ayuda.`);
    }

    public showSnippetsList() {
        if (!this.snippetsManager) {
            this.consoleView.append('✂️ Gestor de snippets no inicializado aún.');
            return;
        }
        const list = this.snippetsManager.getAllSnippets();
        this.consoleView.append(`✂️ Snippets disponibles en GEE IDE (${list.length}):`);
        this.consoleView.append('  Escribe el prefijo en el editor y presiona Tab para expandirlo con saltos de cursor.');
        this.consoleView.append('----------------------------------------');
        list.forEach((s: any) => {
            const badge = s.isCustom ? '[Personalizado]' : `[${s.lang || 'GEE'}]`;
            this.consoleView.append(`  🔹 ${s.prefix.padEnd(14, ' ')} : ${badge} ${s.title} — ${s.description || ''}`);
        });
        this.consoleView.append('----------------------------------------');
        this.consoleView.append('💡 Tip: Presiona Cmd+Shift+P -> GEE IDE: List & Insert Snippet para buscar e insertar en 1 clic.');
        this.consoleView.append('💡 Tip: Presiona Cmd+Shift+P -> GEE IDE: Edit User Snippets para crear tus propias plantillas.');
    }

    public async handleCommand(text: string) {
        const trimmed = text.trim();
        if (this.consoleView.appendHistory) {
            this.consoleView.appendHistory(trimmed);
        }

        if (trimmed === 'snippets' || trimmed === '?snippets' || trimmed === 'help snippets') {
            this.showSnippetsList();
            return;
        }

        if (trimmed.startsWith('?') || trimmed === 'help' || trimmed.startsWith('help ')) {
            let query = '';
            if (trimmed.startsWith('?')) {
                query = trimmed.substring(1).trim();
            } else {
                query = trimmed.replace(/^help\s*/, '').replace(/[()]/g, '').trim();
            }
            this.showHelp(query);
            return;
        }

        const parts = trimmed.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        const promptDisplay = (!this.cwd || this.cwd === '~') ? '~' : this.cwd;

        this.consoleView.append(`gee:${promptDisplay}> ${text}`);

        const ee = getEE();

        switch (cmd) {
            case 'snippets':
                this.showSnippetsList();
                break;
            case 'pwd':
                this.consoleView.append((!this.cwd || this.cwd === '~') ? '~ (Asset Roots)' : this.cwd);
                break;
            case 'cd':
                const targetDir = args[0] || '~';
                const newPath = this.resolvePath(targetDir);
                this.cwd = newPath;
                this.consoleView.append(`📂 Current directory: ${this.cwd === '~' ? '~ (Root)' : this.cwd}`);
                break;
            case 'history':
                const historyList = this.consoleView.loadHistory ? this.consoleView.loadHistory() : [];
                if (historyList.length === 0) {
                    this.consoleView.append('  (no command history yet in .gee_history)');
                } else {
                    this.consoleView.append(`📜 Historial reciente (${Math.min(25, historyList.length)} de ${historyList.length}):`);
                    const startIdx = Math.max(0, historyList.length - 25);
                    for (let i = startIdx; i < historyList.length; i++) {
                        this.consoleView.append(`  ${(i + 1).toString().padStart(3, ' ')}  ${historyList[i]}`);
                    }
                }
                break;
            case 'vars':
            case 'objects':
            case 'whos':
            case 'who':
                if (!this.context) {
                    this.consoleView.append('  (no active runtime context)');
                    break;
                }
                const builtins = new Set(['ee', 'Map', 'ui', 'Export', 'print', 'require', 'global', 'console', 'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Buffer', 'process']);
                const userVars = Object.keys(this.context).filter(k => !builtins.has(k) && !k.startsWith('_'));
                if (userVars.length === 0) {
                    this.consoleView.append('  (no user variables currently in memory)');
                } else {
                    this.consoleView.append(`📊 Variables en memoria (${userVars.length}):`);
                    userVars.forEach(k => {
                        const val = this.context[k];
                        let typeName = typeof val;
                        let detail = '';
                        if (val && typeof val === 'object') {
                            if (val.constructor && val.constructor.name && val.constructor.name !== 'Object') {
                                typeName = val.constructor.name;
                            }
                            if (val.name && typeof val.name === 'function') {
                                typeName = val.name();
                            }
                            if (Array.isArray(val)) {
                                detail = `[Array length: ${val.length}]`;
                            } else if (val.getInfo) {
                                detail = `[Earth Engine Object]`;
                            }
                        } else if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
                            detail = `= ${val}`;
                        }
                        this.consoleView.append(`  🔹 ${k} : ${typeName} ${detail}`);
                    });
                }
                break;
            case 'dir':
            case 'ls':
                try {
                    let rawArg = args.find(a => !a.startsWith('-')) || '';
                    let targetFolder: string;
                    let pattern: string | null = null;

                    if (rawArg) {
                        if (rawArg.includes('*') || rawArg.includes('?')) {
                            const lastSlash = rawArg.lastIndexOf('/');
                            if (lastSlash !== -1) {
                                targetFolder = this.resolvePath(rawArg.substring(0, lastSlash));
                                pattern = rawArg.substring(lastSlash + 1);
                            } else {
                                targetFolder = (!this.cwd || this.cwd === '~') ? '~' : this.cwd;
                                pattern = rawArg;
                            }
                        } else {
                            targetFolder = this.resolvePath(rawArg);
                        }
                    } else {
                        targetFolder = (!this.cwd || this.cwd === '~') ? '~' : this.cwd;
                    }

                    if (targetFolder === '~') {
                        // At top-level root: list all available asset roots
                        if (this.assetRoots.length === 0) {
                            await this.loadAssetRoots();
                        }
                        let roots = this.assetRoots;
                        if (pattern) {
                            const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                            const regex = new RegExp(regexStr, 'i');
                            roots = roots.filter(r => regex.test(r.shortName) || regex.test(r.id));
                        }

                        if (roots.length === 0) {
                            if (pattern) {
                                this.consoleView.append(`  (no asset roots matching pattern '${pattern}')`);
                            } else {
                                this.consoleView.append('  (no asset roots found)');
                            }
                        } else {
                            roots.forEach(r => {
                                this.consoleView.append(`  📁 ${r.shortName} [${r.type}]  (${r.id})`);
                            });
                            if (pattern) {
                                this.consoleView.append(`  Found ${roots.length} matching root(s).`);
                            }
                        }
                        return;
                    }

                    // Inside a specific folder/collection
                    ee.data.listAssets(targetFolder, {}, (res: any, err: any) => {
                        if (err) {
                            this.consoleView.append(`[Error] Access error: ${err}`);
                            this.consoleView.append(`Tip: Use 'ls ~' to see all your available roots, or 'cd [root_name]'.`);
                        } else {
                            let assets = res.assets || [];
                            if (pattern) {
                                const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                                const regex = new RegExp(regexStr, 'i');
                                assets = assets.filter((a: any) => {
                                    const shortName = a.id ? a.id.split('/').pop() : a.name.split('/').pop();
                                    return regex.test(shortName) || regex.test(a.id || '');
                                });
                            }

                            if (assets.length === 0) {
                                if (pattern) {
                                    this.consoleView.append(`  (no assets matching pattern '${pattern}')`);
                                } else {
                                    this.consoleView.append('  (empty folder)');
                                }
                            } else {
                                assets.forEach((a: any) => {
                                    const shortName = a.id ? a.id.split('/').pop() : a.name.split('/').pop();
                                    const type = a.type || 'ASSET';
                                    const icon = (type === 'FOLDER' || type === 'IMAGE_COLLECTION') ? '📁' : (type === 'IMAGE' ? '🛰️' : '📊');
                                    this.consoleView.append(`  ${icon} ${shortName} [${type}]`);
                                });
                                if (pattern) {
                                    this.consoleView.append(`  Found ${assets.length} matching asset(s).`);
                                }
                            }
                        }
                    });
                } catch (err: any) {
                    this.consoleView.append(`[Error]: ${err.message}`);
                }
                break;
            case 'mkdir':
                const isParents = args.some(a => a === '-p' || a === '-parents');
                const targetDirName = args.find(a => !a.startsWith('-'));
                if (!targetDirName) {
                    this.consoleView.append('Usage: mkdir [-p] [folder_name]');
                    return;
                }
                const folderPath = this.resolvePath(targetDirName);
                this.consoleView.append(`⏳ Creating folder: ${folderPath}...`);
                try {
                    ee.data.createFolder(folderPath, isParents, (res: any, err: any) => {
                        if (err) {
                            this.consoleView.append(`[Error]: ${err}`);
                        } else {
                            this.consoleView.append(`✅ Folder created: ${folderPath}`);
                        }
                    });
                } catch (err: any) {
                    this.consoleView.append(`[Error]: ${err.message || err}`);
                }
                break;
            case 'rm':
            case 'rmdir':
                const isRecursive = args.some(a => a === '-r' || a === '-rf' || a === '-R' || a === '-fr');
                const targetName = args.find(a => !a.startsWith('-'));
                if (!targetName) {
                    this.consoleView.append(`Usage: ${cmd} [-r] [asset_name]`);
                    return;
                }
                const rmTarget = this.resolvePath(targetName);
                if (isRecursive) {
                    this.consoleView.append(`⏳ Recursively deleting '${targetName}'...`);
                    this.deleteAssetRecursively(rmTarget)
                        .then(count => {
                            this.consoleView.append(`✅ Successfully deleted ${count} asset(s) under '${targetName}'.`);
                        })
                        .catch(err => {
                            this.consoleView.append(`[Error] Recursive delete failed: ${err.message || err}`);
                        });
                } else {
                    ee.data.deleteAsset(rmTarget, (res: any, err: any) => {
                        if (err) {
                            this.consoleView.append(`[Error]: ${err}`);
                            this.consoleView.append(`Tip: If this is a non-empty folder, use 'rm -r ${targetName}' to delete recursively.`);
                        } else {
                            this.consoleView.append(`🗑️ Asset deleted: ${targetName}`);
                        }
                    });
                }
                break;
            case 'cp':
                if (!args[0] || !args[1]) {
                    this.consoleView.append('Usage: cp [source] [dest]');
                    return;
                }
                ee.data.copyAsset(this.resolvePath(args[0]), this.resolvePath(args[1]), false, (res: any, err: any) => {
                    if (err) this.consoleView.append(`[Error]: ${err}`);
                    else this.consoleView.append(`📋 Copied to: ${args[1]}`);
                });
                break;
            case 'mv':
                if (!args[0] || !args[1]) {
                    this.consoleView.append('Usage: mv [source] [dest]');
                    return;
                }
                ee.data.renameAsset(this.resolvePath(args[0]), this.resolvePath(args[1]), (res: any, err: any) => {
                    if (err) this.consoleView.append(`[Error]: ${err}`);
                    else this.consoleView.append(`📦 Moved to: ${args[1]}`);
                });
                break;
            case 'clear':
            case 'cls':
                this.consoleView.clear();
                break;
            default:
                try {
                    process.chdir(os.tmpdir());
                } catch (e) {}
                if (this.context) {
                    try {
                        const result = vm.runInContext(text, this.context);
                        if (result !== undefined && !(result instanceof Promise)) {
                            let outputVal = result;
                            if (result && typeof result.getInfo === 'function') {
                                try {
                                    outputVal = result.getInfo();
                                } catch (e: any) {
                                    outputVal = `[EE Object: ${e.message || e}]`;
                                }
                            }
                            if (typeof outputVal === 'object' && outputVal !== null) {
                                this.consoleView.append(JSON.stringify(outputVal, null, 2));
                            } else {
                                this.consoleView.append(String(outputVal));
                            }
                            const uv = this.getUserVariables();
                            if (uv.length > 0) this.consoleView.addCompletions(uv);
                            break;
                        } else if (result === undefined && (text.startsWith('var ') || text.startsWith('let ') || text.startsWith('const ') || text.includes('='))) {
                            const uv = this.getUserVariables();
                            if (uv.length > 0) this.consoleView.addCompletions(uv);
                            break;
                        }
                    } catch (e) {
                        // If it fails as JS expression, continue to unknown command
                    }
                }
                if (text.includes('Map.') || text.includes('ee.')) {
                    this.consoleView.append(`[HINT] To run GEE script code, write it in the Editor and press Cmd+Enter.`);
                } else {
                    this.consoleView.append(`Unknown command: ${cmd}. Available: ls, dir, vars, objects, cd, pwd, mkdir, rm, cp, mv, clear`);
                }
        }
    }
}
