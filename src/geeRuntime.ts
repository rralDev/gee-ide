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
    private catalogManager: any;
    public activeLayers: Map<string, any> = new Map();

    public setSnippetsManager(sm: any) {
        this.snippetsManager = sm;
    }

    public setCatalogManager(cm: any) {
        this.catalogManager = cm;
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
        const { GE_PALETTES } = require('./palettes');
        const ctx = {
            ee: eeInstance,
            palettes: GE_PALETTES,
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
            cli: async (cmdStr: string) => {
                await this.handleCommand(cmdStr);
            },
            cd: async (targetPath: string = '') => {
                await this.handleCommand(`cd ${targetPath}`);
            },
            pwd: async () => {
                await this.handleCommand('pwd');
            },
            mkdir: async (folderName: string, isParents: boolean = false) => {
                await this.handleCommand(`mkdir ${isParents ? '-p ' : ''}${folderName}`);
            },
            rm: async (assetName: string, isRecursive: boolean = false) => {
                await this.handleCommand(`rm ${isRecursive ? '-r ' : ''}${assetName}`);
            },
            ls: async (targetPath: string = '') => {
                await this.handleCommand(`ls ${targetPath}`);
            },
            touch: async (collectionName: string) => {
                await this.handleCommand(`touch ${collectionName}`);
            },
            du: async (targetPath: string = '') => {
                await this.handleCommand(`du ${targetPath}`);
            },
            mv: async (src: string, dest: string) => {
                await this.handleCommand(`mv ${src} ${dest}`);
            },
            cp: async (src: string, dest: string) => {
                await this.handleCommand(`cp ${src} ${dest}`);
            },
            find: async (patternOrFlag: string = '') => {
                await this.handleCommand(`find ${patternOrFlag}`);
            },
            Map: {
                addLayer: async (element: any, visParams?: any, name?: string, shown: boolean = true, opacity: number = 1.0) => {
                    const layerName = name || 'unnamed';
                    this.consoleView.append(`Adding layer: ${layerName}...`);
                    this.activeLayers.set(layerName, element);
                    try {
                        const mapId = await new Promise((resolve, reject) => {
                            element.getMapId(visParams || {}, (res: any, err: any) => {
                                if (err) reject(err);
                                else resolve(res);
                            });
                        });
                        this.mapView.addLayer(mapId, name, shown, opacity, visParams);
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
                    this.activeLayers.clear();
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
                    toDrive: (params: any) => this._startExportTask(params, getEE().batch.Export.image.toDrive, 'Image to Drive'),
                    toAsset: (params: any) => this._startExportTask(params, getEE().batch.Export.image.toAsset, 'Image to Asset')
                },
                table: {
                    toDrive: (params: any) => this._startExportTask(params, getEE().batch.Export.table.toDrive, 'Table to Drive'),
                    toAsset: (params: any) => this._startExportTask(params, getEE().batch.Export.table.toAsset, 'Table to Asset')
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
        const builtins = new Set(['ee', 'Map', 'ui', 'Export', 'print', 'require', 'global', 'console', 'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Buffer', 'process', 'palettes']);
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
                // Convert !command lines into cli("command") calls
                cleanCode = cleanCode.split('\n').map(line => {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith('!')) {
                        const cmdText = trimmedLine.substring(1).trim().replace(/"/g, '\\"');
                        return `cli("${cmdText}");`;
                    }
                    return line;
                }).join('\n');
                if (cleanCode) {
                    const result = vm.runInContext(cleanCode, this.context);
                    // RStudio UX: If the executed line/selection is an expression that yields a value, print it
                    if (!resetContext && result !== undefined && !(result instanceof Promise)) {
                        let outputVal = result;
                        let isSpatial = false;
                        if (result && typeof result.getInfo === 'function') {
                            try {
                                const typeName = (typeof result.name === 'function') ? result.name() : '';
                                if (typeof result.getMapId === 'function' || typeName === 'Geometry' || typeName === 'Feature' || typeName.includes('Image') || typeName.includes('Collection')) {
                                    isSpatial = true;
                                    outputVal = `[Earth Engine Spatial Object: ${typeName || 'Unknown'}]`;
                                } else {
                                    outputVal = result.getInfo();
                                }
                            } catch (e: any) {
                                outputVal = `[EE Object: ${e.message || e}]`;
                            }
                        }
                        if (typeof outputVal === 'object' && outputVal !== null) {
                            this.consoleView.append(JSON.stringify(outputVal, null, 2));
                        } else {
                            this.consoleView.append(String(outputVal));
                        }
                        if (isSpatial && this.context && this.context.Map) {
                            this.consoleView.append(`🗺️ Auto-Plotting spatial object...`);
                            this.context.Map.centerObject(result).catch(() => {});
                            this.context.Map.addLayer(result, {}, 'Auto-Plot').catch(() => {});
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

    private async findAssetsRecursively(
        folderPath: string,
        pattern: RegExp | null,
        typeFilter: string | null,
        maxDepth: number,
        currentDepth: number = 0,
        results: any[] = []
    ): Promise<any[]> {
        if (currentDepth > maxDepth) {
            return results;
        }

        let children: any[] = [];
        try {
            children = await this.listAllAssets(folderPath);
        } catch (e) {
            return results;
        }

        for (const child of children) {
            const childId = child.id || child.name || '';
            const shortName = childId.split('/').pop() || '';
            const childType = (child.type || 'ASSET').toUpperCase();

            let matchesName = true;
            if (pattern) {
                matchesName = pattern.test(shortName) || pattern.test(childId);
            }

            let matchesType = true;
            if (typeFilter) {
                matchesType = childType === typeFilter;
            }

            if (matchesName && matchesType) {
                results.push({
                    id: childId,
                    shortName: shortName,
                    type: childType
                });
            }

            // Recurse into subfolders and image collections if depth allows
            if ((childType === 'FOLDER' || childType === 'IMAGE_COLLECTION') && currentDepth < maxDepth) {
                await this.findAssetsRecursively(childId, pattern, typeFilter, maxDepth, currentDepth + 1, results);
            }
        }

        return results;
    }

    public showHelp(query: string) {
        // Normalize: strip leading ee., replace $ with . (for R users), strip trailing () or parameters
        const normalized = query.trim().replace(/^ee[\.\$]/, '').replace(/\$/g, '.').replace(/\(.*?\)$/, '').trim();
        const clean = normalized.replace(/^ee\./, '');

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
            this.consoleView.append('    ?Map.clear');
            return;
        }

        // Builtin commands help
        const builtinsHelp: Record<string, { desc: string; usage: string }> = {
            'vars': { desc: 'Muestra todas las variables activas en la memoria local con sus tipos.', usage: 'vars  o  objects' },
            'objects': { desc: 'Muestra todas las variables activas en la memoria local con sus tipos.', usage: 'vars  o  objects' },
            'snippets': { desc: 'Lista todos los snippets de código disponibles (GEE base y personalizados).', usage: 'snippets  o  ?snippets' },
            'history': { desc: 'Muestra la lista de comandos ejecutados en la sesión guardados en .gee_history.', usage: 'history  o  history(10:40)  o  !numero' },
            'clear': { desc: 'Limpia la pantalla de la consola. Atajo rápido: Cmd+L (Mac) o Ctrl+L (Win/Linux).', usage: 'clear  o  cls' },
            'cls': { desc: 'Limpia la pantalla de la consola. Atajo rápido: Cmd+L (Mac) o Ctrl+L (Win/Linux).', usage: 'clear  o  cls' },
            'find': { desc: 'Busca assets en Earth Engine o en el catálogo público global con -catalog (-c).', usage: 'find [ruta] [-name patron] [-type tipo]  o  find -c <dataset>' },
            'catalog': { desc: 'Busca en el catálogo público oficial de Earth Engine (+1,100 datasets).', usage: 'catalog <query> [-type image|collection|table]' },
            'search': { desc: 'Alias para buscar en el catálogo público de datos de Earth Engine.', usage: 'search <query>' },
            'ls': { desc: 'Lista los archivos de la carpeta actual o carpetas de Assets de GEE.', usage: 'ls [carpeta]' },
            'dir': { desc: 'Lista los archivos de la carpeta actual o carpetas de Assets de GEE.', usage: 'dir [carpeta]' },
            'cd': { desc: 'Cambia el directorio activo de Assets en GEE.', usage: 'cd [ruta]' },
            'pwd': { desc: 'Muestra la ruta del directorio activo de Assets en GEE.', usage: 'pwd' },
            'mkdir': { desc: 'Crea una nueva carpeta en tus Assets de Earth Engine.', usage: 'mkdir [-p] [nombre]' },
            'rm': { desc: 'Elimina un asset de Earth Engine (o recursivo con -r).', usage: 'rm [-r] [asset_id]' },
            'Map.addLayer': { desc: 'Agrega una capa ráster o vectorial al visor de mapas Leaflet.', usage: 'Map.addLayer(eeObject, visParams?, name?, shown?, opacity?)' },
            'Map.centerObject': { desc: 'Centra automáticamente el visor Leaflet sobre la geometría o imagen.', usage: 'Map.centerObject(eeObject, zoom?)' },
            'Map.setCenter': { desc: 'Centra el mapa en coordenadas geográficas específicas [lon, lat].', usage: 'Map.setCenter(lon, lat, zoom?)' },
            'Map.clear': { desc: 'Limpia y elimina todas las capas visibles del visor de mapas Leaflet.', usage: 'Map.clear()' }
        };

        if (clean === 'snippets') {
            this.showSnippetsList();
            return;
        }

        const matchedCmd = builtinsHelp[clean] || builtinsHelp[normalized] || builtinsHelp[query];
        if (matchedCmd) {
            this.consoleView.append(`📖 [Comando] ${clean}`);
            this.consoleView.append(`  ${matchedCmd.desc}`);
            this.consoleView.append(`  Uso: ${matchedCmd.usage}`);
            return;
        }

        // Earth Engine Algorithm Lookup
        const ee = getEE();
        try {
            if (ee && ee.ApiFunction) {
                let sig: any = null;
                const apiFn = ee.ApiFunction.lookupInternal(clean) || ee.ApiFunction.lookupInternal(query);
                if (apiFn && typeof apiFn.getSignature === 'function') {
                    sig = apiFn.getSignature();
                }
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
        try {
            let trimmed = text.trim();
            
            // Bash-like history expansion (!number)
            if (trimmed.match(/^!\d+$/)) {
                const targetIdx = parseInt(trimmed.substring(1), 10) - 1;
                const historyList = this.consoleView.loadHistory ? this.consoleView.loadHistory() : [];
                if (targetIdx >= 0 && targetIdx < historyList.length) {
                    text = historyList[targetIdx];
                    trimmed = text.trim();
                    this.consoleView.append(`🔄 Expandiendo ${trimmed.substring(0, 50)}...`);
                } else {
                    this.consoleView.append(`[Error] Event not found: ${trimmed}`);
                    return;
                }
            }

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

            let parts = trimmed.split(/\s+/);
            
            // Normalize history(args) syntax
            if (parts[0].startsWith('history(') && parts[0].endsWith(')')) {
                const innerArgs = parts[0].substring(8, parts[0].length - 1);
                parts = ['history', innerArgs];
            }
            
            const cmd = parts[0];
            const args = parts.slice(1);
            const promptDisplay = (!this.cwd || this.cwd === '~') ? '~' : this.cwd;

            this.consoleView.append(`gee:${promptDisplay}> ${text}`);

            if (!this.isInitialized && ['find', 'ls', 'dir', 'cd', 'mkdir', 'rm', 'rmdir', 'cp', 'mv'].includes(cmd)) {
                this.consoleView.append('⚠️ GEE no está inicializado. Por favor autentícate primero: Cmd+Shift+P -> "GEE IDE: Login with Google"');
                return;
            }

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
                    let startIdx = Math.max(0, historyList.length - 25);
                    let endIdx = historyList.length;
                    
                    if (args.length > 0) {
                        const arg = args[0];
                        if (arg.includes(':') || arg.includes('-')) {
                            const separator = arg.includes(':') ? ':' : '-';
                            const parts = arg.split(separator);
                            const parsedStart = parseInt(parts[0], 10);
                            const parsedEnd = parseInt(parts[1], 10);
                            if (!isNaN(parsedStart)) startIdx = Math.max(0, parsedStart - 1);
                            if (!isNaN(parsedEnd)) endIdx = Math.min(historyList.length, parsedEnd);
                        } else {
                            const count = parseInt(arg, 10);
                            if (!isNaN(count)) {
                                startIdx = Math.max(0, historyList.length - count);
                            }
                        }
                    }

                    if (startIdx >= endIdx) {
                        this.consoleView.append(`  (No hay comandos en ese rango)`);
                    } else {
                        const count = endIdx - startIdx;
                        this.consoleView.append(`📜 Historial (${count} de ${historyList.length}):`);
                        for (let i = startIdx; i < endIdx; i++) {
                            this.consoleView.append(`  ${(i + 1).toString().padStart(3, ' ')}  ${historyList[i]}`);
                        }
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
                const builtins = new Set(['ee', 'Map', 'ui', 'Export', 'print', 'require', 'global', 'console', 'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Buffer', 'process', 'palettes']);
                const userVars = Object.keys(this.context).filter(k => !builtins.has(k) && !k.startsWith('_'));
                if (userVars.length === 0) {
                    this.consoleView.append('  (no user variables currently in memory)');
                } else {
                    this.consoleView.append(`📊 Variables en memoria (${userVars.length}):`);
                    userVars.forEach(k => {
                        const val = this.context ? this.context[k] : undefined;
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
            case 'search':
            case 'catalog':
            case 'find':
                try {
                    // Check if this is a catalog search (via `catalog <query>`, `search <query>`, or `find -catalog / -c <query>`)
                    const isCatalogDirect = (cmd === 'catalog' || cmd === 'search');
                    const hasCatalogFlag = args.some(a => a === '-c' || a === '-catalog' || a === '--catalog');

                    if (isCatalogDirect || hasCatalogFlag) {
                        if (!this.catalogManager) {
                            this.consoleView.append('⚠️ Gestor de catálogo público no inicializado.');
                            break;
                        }

                        let queryTerms: string[] = [];
                        let catTypeFilter: string | undefined = undefined;

                        for (let i = 0; i < args.length; i++) {
                            const a = args[i];
                            if (a === '-c' || a === '-catalog' || a === '--catalog') {
                                continue;
                            } else if (a === '-type' || a === '--type' || a === '-t') {
                                if (i + 1 < args.length) {
                                    catTypeFilter = args[++i];
                                }
                            } else if (!a.startsWith('-')) {
                                queryTerms.push(a);
                            }
                        }

                        const query = queryTerms.join(' ').trim();
                        if (!query) {
                            this.consoleView.append('📖 Uso del buscador del catálogo público de GEE:');
                            this.consoleView.append('  catalog <termino> [-type image|collection|table]');
                            this.consoleView.append('  find -catalog <termino>');
                            this.consoleView.append('  Ejemplos:');
                            this.consoleView.append('    catalog sentinel 2');
                            this.consoleView.append('    catalog srtm');
                            this.consoleView.append('    catalog "land cover" -type image');
                            this.consoleView.append('    search modis ndvi');
                            this.consoleView.append('💡 Tip: También puedes presionar Cmd+Shift+P -> "GEE IDE: Search Data Catalog" para una búsqueda visual interactiva.');
                            break;
                        }

                        this.consoleView.append(`🌐 Buscando en el catálogo público oficial de GEE (+1,100 datasets): '${query}'...`);
                        const results = this.catalogManager.search(query, catTypeFilter, 15);

                        if (results.length === 0) {
                            this.consoleView.append(`  (No se encontraron datasets para '${query}')`);
                            this.consoleView.append(`  Tip: Intenta con términos más genéricos como 'sentinel', 'landsat', 'modis', 'elevation', 'climate'.`);
                        } else {
                            this.consoleView.append(`✨ Encontrados ${results.length} dataset(s) coincidentes:`);
                            const completions = results.map((r: any) => r.id);
                            this.consoleView.addCompletions(completions);

                            results.forEach((ds: any, idx: number) => {
                                const isColl = ds.type === 'image_collection' || ds.type === 'collection';
                                const isTab = ds.type === 'table';
                                const deprecated = this.catalogManager.isDeprecated(ds);
                                const replacement = this.catalogManager.getReplacementSuggestion(ds.id);

                                let icon = isColl ? '🛰️' : (isTab ? '📊' : '🗺️');
                                if (deprecated) icon = '⚠️';

                                const dateStr = ds.start ? ` [${ds.start} a ${ds.end || 'present'}]` : '';
                                const bandsStr = ds.bands && ds.bands.length > 0 ? `\n     Bandas (${ds.bands.length}): ${ds.bands.slice(0, 8).join(', ')}${ds.bands.length > 8 ? '...' : ''}` : '';
                                const depTag = deprecated ? ' ⚠️ [OBSOLETO]' : '';

                                this.consoleView.append(`  ${icon} ${ds.id}${depTag} (${ds.type})${dateStr}`);
                                this.consoleView.append(`     ${ds.title}${bandsStr}`);
                                if (deprecated && replacement) {
                                    this.consoleView.append(`     🔄 Reemplazo recomendado: ${replacement}`);
                                }
                                this.consoleView.append(`     Snippet: ${this.catalogManager.generateSnippet(ds, 'javascript')}`);
                                if (idx < results.length - 1) {
                                    this.consoleView.append(`     ---`);
                                }
                            });
                            this.consoleView.append('💡 Tip: Copia el Snippet directamente en tu script o presiona Cmd+Shift+P -> "GEE IDE: Search Data Catalog"');
                        }
                        break;
                    }

                    // Otherwise, regular Asset find
                    let searchPath: string = (!this.cwd || this.cwd === '~') ? '~' : this.cwd;
                    let namePatternStr: string | null = null;
                    let typeFilterStr: string | null = null;
                    let maxDepthNum: number = 5;

                    for (let i = 0; i < args.length; i++) {
                        const a = args[i];
                        if (a === '-name' || a === '--name' || a === '-n') {
                            if (i + 1 < args.length) {
                                namePatternStr = args[++i];
                            }
                        } else if (a === '-type' || a === '--type' || a === '-t') {
                            if (i + 1 < args.length) {
                                typeFilterStr = args[++i].toUpperCase();
                            }
                        } else if (a === '-maxdepth' || a === '--maxdepth' || a === '-d') {
                            if (i + 1 < args.length) {
                                const parsedD = parseInt(args[++i], 10);
                                if (!isNaN(parsedD)) maxDepthNum = parsedD;
                            }
                        } else if (!a.startsWith('-')) {
                            // If user specified an explicit path or a direct pattern (e.g. `find *ndvi*` or `find users/foo *ndvi*`)
                            if (a.includes('*') || a.includes('?')) {
                                if (!namePatternStr) {
                                    namePatternStr = a;
                                }
                            } else {
                                searchPath = a;
                            }
                        }
                    }

                    // Normalize type filter aliases (folder, image, collection, table)
                    if (typeFilterStr) {
                        if (typeFilterStr === 'COLLECTION' || typeFilterStr === 'IMAGECOLLECTION') {
                            typeFilterStr = 'IMAGE_COLLECTION';
                        } else if (typeFilterStr === 'DIR' || typeFilterStr === 'DIRECTORY') {
                            typeFilterStr = 'FOLDER';
                        } else if (typeFilterStr === 'VECTOR' || typeFilterStr === 'FC') {
                            typeFilterStr = 'TABLE';
                        }
                    }

                    let compiledRegex: RegExp | null = null;
                    if (namePatternStr) {
                        const cleanPattern = namePatternStr.replace(/^['"]|['"]$/g, '');
                        if (cleanPattern.includes('*') || cleanPattern.includes('?')) {
                            const rx = '^' + cleanPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                            compiledRegex = new RegExp(rx, 'i');
                        } else {
                            compiledRegex = new RegExp(cleanPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i');
                        }
                    }

                    const resolvedStart = this.resolvePath(searchPath);
                    const filterDesc = [
                        namePatternStr ? `name='${namePatternStr}'` : '',
                        typeFilterStr ? `type='${typeFilterStr}'` : '',
                        `maxdepth=${maxDepthNum}`
                    ].filter(Boolean).join(', ');

                    this.consoleView.append(`🔍 Buscando assets en '${resolvedStart === '~' ? '~ (Todas las raíces)' : resolvedStart}' [${filterDesc}]...`);

                    let startRoots: string[] = [];
                    if (resolvedStart === '~') {
                        if (this.assetRoots.length === 0) {
                            await this.loadAssetRoots();
                        }
                        startRoots = this.assetRoots.map(r => r.id);
                    } else {
                        startRoots = [resolvedStart];
                    }

                    if (startRoots.length === 0) {
                        this.consoleView.append('  (no asset roots found to search)');
                        break;
                    }

                    let foundAssets: any[] = [];
                    for (const root of startRoots) {
                        // Check if the root folder itself matches
                        const rootShort = root.split('/').pop() || '';
                        let rootMatchesName = compiledRegex ? (compiledRegex.test(rootShort) || compiledRegex.test(root)) : true;
                        let rootMatchesType = typeFilterStr ? (typeFilterStr === 'FOLDER') : true;
                        if (rootMatchesName && rootMatchesType && resolvedStart === '~') {
                            foundAssets.push({ id: root, shortName: rootShort, type: 'FOLDER' });
                        }

                        const subResults = await this.findAssetsRecursively(root, compiledRegex, typeFilterStr, maxDepthNum, 1);
                        foundAssets = foundAssets.concat(subResults);
                    }

                    if (foundAssets.length === 0) {
                        this.consoleView.append('  (no assets found matching criteria)');
                    } else {
                        this.consoleView.append(`✨ Encontrados ${foundAssets.length} asset(s):`);
                        const completions = foundAssets.map(a => a.shortName);
                        this.consoleView.addCompletions(completions);
                        foundAssets.forEach(a => {
                            const icon = (a.type === 'FOLDER' || a.type === 'IMAGE_COLLECTION') ? '📁' : (a.type === 'IMAGE' ? '🛰️' : '📊');
                            this.consoleView.append(`  ${icon} ${a.id} [${a.type}]`);
                        });
                    }
                } catch (findErr: any) {
                    this.consoleView.append(`[Error in find]: ${findErr.message || findErr}`);
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
                            const rootNames = roots.map(r => r.shortName);
                            this.consoleView.addCompletions(rootNames);
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
                                const completions = assets.map((a: any) => a.id ? a.id.split('/').pop() : a.name.split('/').pop());
                                this.consoleView.addCompletions(completions);
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
                if (targetName.includes('*') || targetName.includes('?')) {
                    // Pattern-based batch deletion
                    let folder = (!this.cwd || this.cwd === '~') ? '~' : this.cwd;
                    let pattern = targetName;
                    if (targetName.includes('/')) {
                        const lastSlash = targetName.lastIndexOf('/');
                        folder = this.resolvePath(targetName.substring(0, lastSlash));
                        pattern = targetName.substring(lastSlash + 1);
                    }
                    this.consoleView.append(`🔍 Buscando assets que coincidan con '${pattern}' en '${folder}'...`);
                    const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                    const regex = new RegExp(regexStr, 'i');
                    ee.data.listAssets(folder, {}, async (res: any, err: any) => {
                        if (err) {
                            this.consoleView.append(`[Error]: ${err}`);
                            return;
                        }
                        const assets = res.assets || [];
                        const matches = assets.filter((a: any) => {
                            const name = a.id ? a.id.split('/').pop() : a.name.split('/').pop();
                            return regex.test(name) || regex.test(a.id || a.name || '');
                        });
                        if (matches.length === 0) {
                            this.consoleView.append(`  (no assets matching pattern '${pattern}')`);
                            return;
                        }
                        this.consoleView.append(`🗑️ Eliminando ${matches.length} asset(s) coincidentes...`);
                        for (const m of matches) {
                            const id = m.id || m.name;
                            const short = id.split('/').pop();
                            const isFolder = m.type === 'FOLDER' || m.type === 'IMAGE_COLLECTION';
                            if (isFolder && isRecursive) {
                                await this.deleteAssetRecursively(id);
                                this.consoleView.append(`  🗑️ Carpeta eliminada recursivamente: ${short}`);
                            } else {
                                await new Promise((resDel) => {
                                    ee.data.deleteAsset(id, () => resDel(true));
                                });
                                this.consoleView.append(`  🗑️ Asset eliminado: ${short}`);
                            }
                        }
                        this.consoleView.append(`✅ Eliminación por patrón completada.`);
                    });
                    break;
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
            case 'touch':
                const touchTarget = args[0];
                if (!touchTarget) {
                    this.consoleView.append('Usage: touch [image_collection_name]');
                    return;
                }
                const touchPath = this.resolvePath(touchTarget);
                this.consoleView.append(`⏳ Creating empty ImageCollection: ${touchPath}...`);
                ee.data.createAsset({ type: 'ImageCollection' }, touchPath, false, undefined, (res: any, err: any) => {
                    if (err) this.consoleView.append(`[Error]: ${err.message || err}`);
                    else this.consoleView.append(`✨ Collection created: ${touchPath}`);
                });
                break;
            case 'du':
            case 'quota':
                const duTarget = args[0] ? this.resolvePath(args[0]) : ((!this.cwd || this.cwd === '~') ? '~' : this.cwd);
                if (duTarget === '~') {
                    if (this.assetRoots.length === 0) await this.loadAssetRoots();
                    this.consoleView.append(`📊 Cuota de almacenamiento en raíces de assets (${this.assetRoots.length}):`);
                    for (const r of this.assetRoots) {
                        ee.data.getAssetRootQuota(r.id, (q: any, err: any) => {
                            if (!err && q) {
                                const usedMb = ((q.asset_size && q.asset_size.usage) || 0) / (1024 * 1024);
                                const maxMb = ((q.asset_size && q.asset_size.limit) || 0) / (1024 * 1024);
                                const count = (q.asset_count && q.asset_count.usage) || 0;
                                const maxCount = (q.asset_count && q.asset_count.limit) || 0;
                                const maxStr = maxMb > 0 ? `${maxMb.toFixed(0)} MB` : 'Ilimitado';
                                this.consoleView.append(`  🔹 [${r.shortName}]: ${usedMb.toFixed(2)} MB / ${maxStr} (${count} assets)`);
                            }
                        });
                    }
                } else {
                    ee.data.getAssetRootQuota(duTarget, (q: any, err: any) => {
                        if (err) {
                            this.consoleView.append(`[Error]: ${err}`);
                        } else if (q) {
                            const usedMb = ((q.asset_size && q.asset_size.usage) || 0) / (1024 * 1024);
                            const maxMb = ((q.asset_size && q.asset_size.limit) || 0) / (1024 * 1024);
                            const count = (q.asset_count && q.asset_count.usage) || 0;
                            const maxStr = maxMb > 0 ? `${maxMb.toFixed(0)} MB` : 'Ilimitado';
                            this.consoleView.append(`📊 Cuota [${duTarget}]: ${usedMb.toFixed(2)} MB / ${maxStr} (${count} assets)`);
                        }
                    });
                }
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
                            let isSpatial = false;
                            if (result && typeof result.getInfo === 'function') {
                                try {
                                    const typeName = (typeof result.name === 'function') ? result.name() : '';
                                    if (typeof result.getMapId === 'function' || typeName === 'Geometry' || typeName === 'Feature' || typeName.includes('Image') || typeName.includes('Collection')) {
                                        isSpatial = true;
                                        outputVal = `[Earth Engine Spatial Object: ${typeName || 'Unknown'}]`;
                                    } else {
                                        outputVal = result.getInfo();
                                    }
                                } catch (e: any) {
                                    outputVal = `[EE Object: ${e.message || e}]`;
                                }
                            }
                            if (typeof outputVal === 'object' && outputVal !== null) {
                                this.consoleView.append(JSON.stringify(outputVal, null, 2));
                            } else {
                                this.consoleView.append(String(outputVal));
                            }
                            if (isSpatial && this.context && this.context.Map) {
                                this.consoleView.append(`🗺️ Auto-Plotting spatial object...`);
                                this.context.Map.centerObject(result).catch(() => {});
                                this.context.Map.addLayer(result, {}, 'Auto-Plot').catch(() => {});
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
                    this.consoleView.append(`Unknown command: ${cmd}. Available: find, ls, dir, vars, objects, cd, pwd, mkdir, rm, cp, mv, clear`);
                }
        }
        } catch (err: any) {
            this.consoleView.append(`[Command Error]: ${err.message || err}`);
        }
    }

    private _startExportTask(params: any, exportFunc: Function, label: string) {
        if (params && params.description) {
            if (label.includes('Drive') && !params.fileNamePrefix && !params.filenamePrefix) {
                params.fileNamePrefix = params.description;
            }
            if (label.includes('Asset') && !params.assetId) {
                params.assetId = params.description;
            }
        }

        const start = (p: any) => {
            try {
                const task = exportFunc(p);
                task.start(() => {
                    this.consoleView.append(`✅ [Export Task Started]: ${label} - ${p.description || 'unnamed'}`);
                }, (err: any) => {
                    this.consoleView.append(`❌ [Export Task Error]: ${err}`);
                });
            } catch (e: any) {
                this.consoleView.append(`❌ [Export Task Error]: ${e.message}`);
            }
        };

        if (params && params.region && typeof params.region.evaluate === 'function') {
            params.region.evaluate((geom: any, err: any) => {
                if (err) {
                    this.consoleView.append(`❌ [Export Task Error]: No se pudo evaluar la región - ${err}`);
                } else {
                    params.region = geom;
                    start(params);
                }
            });
        } else {
            start(params);
        }
    }

    public async getTasks(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            if (!this.isInitialized) {
                return reject(new Error('GEE no está inicializado.'));
            }
            try {
                getEE().data.getTaskList((tasks: any, err: any) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        resolve(tasks || []);
                    }
                });
            } catch (e: any) {
                reject(e);
            }
        });
    }

    public async cancelTask(taskId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.isInitialized) {
                return reject(new Error('GEE no está inicializado.'));
            }
            try {
                getEE().data.cancelTask(taskId, (_: any, err: any) => {
                    if (err) {
                        reject(new Error(err));
                    } else {
                        resolve();
                    }
                });
            } catch (e: any) {
                reject(e);
            }
        });
    }

    public async inspectPixel(lat: number, lon: number) {
        if (!this.isInitialized || this.activeLayers.size === 0) return;
        
        const eeInstance = getEE();
        const point = eeInstance.Geometry.Point([lon, lat]);
        
        // Notify the UI to show loading popup
        this.mapView.showInspectorPopup(lat, lon, '<div style="padding: 10px; color:#ccc; font-family: monospace; font-size: 11px;">⏳ Consultando Earth Engine...</div>');

        let resultsHtml = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11.5px; padding: 4px; min-width: 220px; max-height: 280px; overflow-y: auto; overflow-x: hidden;">`;
        
        const coordsStr = `${lon.toFixed(5)}, ${lat.toFixed(5)}`;
        
        resultsHtml += `<div style="border-bottom: 1px solid #444; margin-bottom: 8px; padding-bottom: 6px; position: sticky; top: 0; background: rgba(20,20,22,0.9); z-index: 10; display: flex; justify-content: center; align-items: center; gap: 8px;">`;
        resultsHtml += `<span style="color:#aaa; font-size: 12px; font-family: monospace;">📍 ${coordsStr}</span>`;
        resultsHtml += `<button onclick="vscode.postMessage({command:'copyToClipboard', text:'[${coordsStr}]'})" style="background:none; border:none; color:#4ec9b0; cursor:pointer; font-size:12px; padding:0; margin:0; line-height:1;" title="Copiar Coordenadas">📋</button>`;
        resultsHtml += `</div>`;
        
        let hasData = false;
        let consoleReport = `\n📍 [Inspector] Point (${coordsStr})\n`;

        const promises = Array.from(this.activeLayers.entries()).map(async ([name, element]) => {
            try {
                let sampled: any = null;
                
                if (typeof element.reduceRegion === 'function') {
                    sampled = element.reduceRegion({
                        reducer: eeInstance.Reducer.first(),
                        geometry: point,
                        scale: 30, // Default evaluation scale
                        bestEffort: true
                    });
                } else if (typeof element.filterBounds === 'function' && typeof element.mosaic === 'function') {
                    const img = element.filterBounds(point).mosaic();
                    sampled = img.reduceRegion({
                        reducer: eeInstance.Reducer.first(),
                        geometry: point,
                        scale: 30,
                        bestEffort: true
                    });
                }
                
                if (sampled) {
                    const values: any = await new Promise((resolve) => {
                        sampled.evaluate((val: any, err: any) => {
                            resolve(err ? null : val);
                        });
                    });
                    return { name, values };
                }
            } catch (err) {
                console.error(`[Inspector Error] Layer ${name}:`, err);
            }
            return { name, values: null };
        });

        const results = await Promise.all(promises);
        
        // Prepare global copy text (JSON format)
        const fullReportObj: any = { coordinates: [lon, lat], layers: {} };

        for (const res of results) {
            if (res.values && Object.keys(res.values).length > 0) {
                hasData = true;
                fullReportObj.layers[res.name] = res.values;
                
                resultsHtml += `<details open style="margin-bottom: 6px; background: rgba(255,255,255,0.03); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">`;
                resultsHtml += `<summary style="color: #4ec9b0; padding: 5px 6px; cursor: pointer; font-weight: 600; outline: none;">${res.name}</summary>`;
                resultsHtml += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px 6px 6px 6px; border-top: 1px solid rgba(255,255,255,0.05);">`;
                
                consoleReport += `  ├─ ${res.name}:\n`;
                
                for (const key of Object.keys(res.values).sort()) {
                    let val = res.values[key];
                    if (val !== null && val !== undefined) {
                        if (typeof val === 'number') {
                            val = Number.isInteger(val) ? val : val.toFixed(4);
                        }
                        resultsHtml += `<div><span style="color: #888; font-family: monospace; font-size: 10px;">${key}:</span> <span style="color: #fff; font-family: monospace; font-size: 10.5px;">${val}</span></div>`;
                        consoleReport += `  │    ${key}: ${val}\n`;
                    }
                }
                resultsHtml += `</div></details>`;
            }
        }
        
        if (!hasData) {
            resultsHtml += `<div style="color: #999; font-style: italic; margin-top: 5px; text-align: center;">No raster data found.</div>`;
            consoleReport += `  └─ No raster data found.\n`;
        } else {
            const encodedJson = encodeURIComponent(JSON.stringify(fullReportObj, null, 2));
            resultsHtml += `<div style="text-align:center; margin-top: 10px;">`;
            resultsHtml += `<button onclick="vscode.postMessage({command:'copyToClipboard', text: decodeURIComponent('${encodedJson}')})" style="background:#2d2d2d; border:1px solid #444; color:#ccc; border-radius:4px; padding:4px 8px; cursor:pointer; font-size:10.5px; width:100%;">📋 Copiar Todo (JSON)</button>`;
            resultsHtml += `</div>`;
        }
        
        resultsHtml += `</div>`;
        
        // Print to Console History
        this.consoleView.append(consoleReport);
        
        this.mapView.showInspectorPopup(lat, lon, resultsHtml);
    }

    public async getAssetsApi(parentFolder: string = '~'): Promise<any[]> {
        return new Promise(async (resolve, reject) => {
            if (!this.isInitialized) {
                return reject(new Error('GEE no está inicializado.'));
            }
            try {
                if (parentFolder === '~') {
                    if (this.assetRoots.length === 0) {
                        await this.loadAssetRoots();
                    }
                    resolve(this.assetRoots.map(r => ({
                        type: 'FOLDER_ROOT',
                        id: r.id,
                        name: (r as any).shortName || r.id.split('/').pop(),
                        isRoot: true
                    })));
                } else {
                    try {
                        const ee = getEE();
                        ee.data.listAssets(parentFolder, {}, (res: any, err: any) => {
                            try {
                                if (err) return reject(new Error(typeof err === 'string' ? err : JSON.stringify(err)));
                                const rawList = (res && res.assets) || [];
                                const normalized = rawList.map((item: any) => {
                                    if (typeof item === 'string') {
                                        return {
                                            id: item,
                                            name: item.split('/').pop() || item,
                                            type: 'UNKNOWN'
                                        };
                                    }
                                    const fullId = item.id || item.name || '';
                                    const short = item.name && !item.name.includes('/') ? item.name : (fullId.split('/').pop() || fullId);
                                    return {
                                        id: fullId,
                                        name: short,
                                        type: (item.type || 'UNKNOWN').toUpperCase()
                                    };
                                });
                                resolve(normalized);
                            } catch (e: any) {
                                reject(e);
                            }
                        });
                    } catch (err: any) {
                        reject(new Error(typeof err === 'string' ? err : JSON.stringify(err)));
                    }
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    public async deleteAssetApi(assetId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.isInitialized) return reject(new Error('GEE no está inicializado.'));
            const ee = require('@google/earthengine');
            ee.data.deleteAsset(assetId, (res: any, err: string) => {
                if (err) return reject(new Error(err));
                resolve();
            });
        });
    }

    public async createFolderApi(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.isInitialized) return reject(new Error('GEE no está inicializado.'));
            const ee = require('@google/earthengine');
            ee.data.createFolder(path, false, (res: any, err: string) => {
                if (err) return reject(new Error(err));
                resolve();
            });
        });
    }

    public async getAssetDetailsApi(id: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.isInitialized) return reject(new Error('GEE no está inicializado.'));
            const ee = require('@google/earthengine');
            ee.data.getAsset(id, (res: any, err: string) => {
                if (err) return reject(new Error(err));
                resolve(res);
            });
        });
    }
}
