import * as vscode from 'vscode';
import { MapView } from './views/mapView';
import { ConsoleView } from './views/consoleView';
import type { GEERuntime } from './geeRuntime';
import { GEERuntimePy } from './geeRuntimePy';
import { GEERuntimeR } from './geeRuntimeR';
import { PythonBridgeServer } from './pythonBridgeServer';
import { LoopbackAuthServer } from './loopbackAuthServer';
import { AssetExplorerProvider } from './views/assetExplorer';
import { AIView } from './views/aiView';
import { SnippetsManager } from './snippetsManager';
import { exchangeCodeForToken, refreshAccessToken, getUserInfo, getAvailableCloudProjects, autoDetectCloudProject } from './auth';

import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = '/tmp/gee_pro_debug.log';
function logStep(msg: string) {
    try {
        const line = `[${new Date().toISOString()}] ${msg}\n`;
        fs.appendFileSync(LOG_FILE, line, 'utf8');
        console.log(`[GEE IDE] ${msg}`);
    } catch (e) {}
}

async function displaySessionBanner(consoleView: any, creds: any, runtime: any) {
    if (!consoleView) return;
    
    let userEmail = creds.email || creds.client_email;
    if (!userEmail && creds.access_token) {
        try {
            const info = await getUserInfo(creds.access_token);
            if (info && info.email) {
                userEmail = info.email;
                creds.email = info.email;
            }
        } catch (e) {}
    }

    if (userEmail) {
        consoleView.append(`👤 Account: ${userEmail}`);
    }

    let activeProj = creds.project_id || (runtime ? runtime.getProjectId() : '');
    if (activeProj === 'gee-pro-default' || activeProj === 'PeruREDD') {
        activeProj = '';
    }
    if (activeProj) {
        consoleView.append(`🚀 Cloud Project: ${activeProj}`);
    } else {
        consoleView.append(`🚀 Cloud Project: (No asignado — usa Cmd+Shift+P -> 'GEE IDE: Set Active Cloud Project')`);
    }
    
    if (runtime) {
        const roots = runtime.getAssetRootsList();
        if (roots && roots.length > 0) {
            consoleView.append(`📁 Asset Roots: ${roots.map((r: any) => `${r.shortName} (${r.id})`).join(', ')}`);
            const completionItems: string[] = [];
            roots.forEach((r: any) => {
                completionItems.push(r.shortName);
                completionItems.push(r.id);
            });
            consoleView.addCompletions(completionItems);
        }
    }
    consoleView.append('🛰️ GEE Ready! (JS, Python & R enabled)');
}

logStep('>>> TOP-LEVEL: extension.ts module loaded by Node.js');

async function detectAndSetGeeLanguage(document: vscode.TextDocument) {
    if (document.uri.fsPath.endsWith('.gee')) {
        let targetLang = 'javascript'; // Default: JavaScript with full syntax coloring
        if (document.lineCount > 0) {
            const firstLine = document.lineAt(0).text.trim().toLowerCase();
            if (firstLine.startsWith('# py') || firstLine.startsWith('// py') || firstLine.startsWith('#python') || firstLine.startsWith('//python')) {
                targetLang = 'python';
            } else if (firstLine.startsWith('# r') || firstLine.startsWith('// r')) {
                targetLang = 'r';
            } else if (firstLine.startsWith('# js') || firstLine.startsWith('// js') || firstLine.startsWith('#javascript') || firstLine.startsWith('//javascript')) {
                targetLang = 'javascript';
            }
        }
        
        if (document.languageId !== targetLang) {
            await vscode.languages.setTextDocumentLanguage(document, targetLang);
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {
        const os = require('os');
        process.chdir(os.tmpdir());
    } catch (e) {}
    logStep('>>> ACTIVATE() STARTED');

    // Register dynamic language switchers
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(detectAndSetGeeLanguage),
        vscode.workspace.onDidChangeTextDocument(e => detectAndSetGeeLanguage(e.document)),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) detectAndSetGeeLanguage(editor.document);
        })
    );
    logStep('Step 1: Language switchers registered');

    // Initial check for already open documents
    vscode.workspace.textDocuments.forEach(detectAndSetGeeLanguage);
    if (vscode.window.activeTextEditor) {
        detectAndSetGeeLanguage(vscode.window.activeTextEditor.document);
    }
    logStep('Step 2: Existing documents checked');

    const assetProvider = new AssetExplorerProvider();
    vscode.window.registerTreeDataProvider('gee-pro-assets', assetProvider);
    logStep('Step 3: Asset explorer registered');

    const mapView = new MapView(context);
    const consoleView = new ConsoleView(context);
    const aiView = new AIView(context);
    let runtime: GEERuntime | undefined;
    let runtimePy: GEERuntimePy | undefined;
    let runtimeR: GEERuntimeR | undefined;
    let bridgeServer: PythonBridgeServer | undefined;
    let activeLoopback: LoopbackAuthServer | undefined;
    const snippetsManager = new SnippetsManager(context);
    context.subscriptions.push(snippetsManager.registerSnippetsProvider());

    logStep('Step 4: Views and variables initialized');

    function extractDocumentVariables(document: vscode.TextDocument): { name: string; kind: vscode.CompletionItemKind; detail: string }[] {
        const text = document.getText();
        const map = new Map<string, { kind: vscode.CompletionItemKind; detail: string }>();

        // 1. JS / TS declarations: var, let, const
        const jsVarRegex = /\b(?:var|let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        let match: RegExpExecArray | null;
        while ((match = jsVarRegex.exec(text)) !== null) {
            map.set(match[1], { kind: vscode.CompletionItemKind.Variable, detail: '(Variable de documento)' });
        }

        // 2. JS / TS function declarations: function funcName(...)
        const jsFuncRegex = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        while ((match = jsFuncRegex.exec(text)) !== null) {
            map.set(match[1], { kind: vscode.CompletionItemKind.Function, detail: '(Función de documento)' });
        }

        // 3. Python def: def func_name(...)
        const pyDefRegex = /^[ \t]*def\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
        while ((match = pyDefRegex.exec(text)) !== null) {
            map.set(match[1], { kind: vscode.CompletionItemKind.Function, detail: '(Función Python)' });
        }

        // 4. Assignments in Python/R/JS: name = ... or name <- ...
        const assignRegex = /^[ \t]*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:=|<-)[^=]/gm;
        const reserved = new Set([
            'if', 'else', 'elif', 'for', 'while', 'def', 'class', 'return', 'import', 'from',
            'var', 'let', 'const', 'function', 'try', 'except', 'catch', 'finally', 'with', 'as',
            'in', 'is', 'not', 'and', 'or', 'lambda', 'switch', 'case', 'break', 'continue',
            'typeof', 'instanceof', 'void', 'delete', 'yield', 'await', 'async'
        ]);
        while ((match = assignRegex.exec(text)) !== null) {
            const name = match[1];
            if (!reserved.has(name) && !map.has(name)) {
                map.set(name, { kind: vscode.CompletionItemKind.Variable, detail: '(Variable de script)' });
            }
        }

        return Array.from(map.entries()).map(([name, info]) => ({
            name,
            kind: info.kind,
            detail: info.detail
        }));
    }

    function syncCompletionsToConsole() {
        const vars = new Set<string>();
        if (runtime) {
            try {
                runtime.getUserVariables().forEach(v => vars.add(v));
            } catch (e) {}
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            extractDocumentVariables(activeEditor.document).forEach(dv => vars.add(dv.name));
        }
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'gee' || doc.languageId === 'javascript' || doc.languageId === 'python' || doc.languageId === 'r' || doc.fileName.endsWith('.gee') || doc.fileName.endsWith('.js')) {
                extractDocumentVariables(doc).forEach(dv => vars.add(dv.name));
            }
        }
        if (vars.size > 0) {
            consoleView.addCompletions(Array.from(vars));
        }
    }

    // IntelliSense prioritario: Variables en memoria (runtime) y variables declaradas en el script (.gee, .js, .py, .r)
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            [
                { scheme: 'file', language: 'gee' }, { scheme: 'untitled', language: 'gee' },
                { scheme: 'file', language: 'javascript' }, { scheme: 'untitled', language: 'javascript' },
                { scheme: 'file', language: 'python' }, { scheme: 'untitled', language: 'python' },
                { scheme: 'file', language: 'r' }, { scheme: 'untitled', language: 'r' }
            ],
            {
                provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                    const items: vscode.CompletionItem[] = [];
                    const seen = new Set<string>();

                    // 1. Máxima prioridad: Variables en memoria activa (runtime)
                    if (runtime) {
                        try {
                            const userVars = runtime.getUserVariables();
                            for (const v of userVars) {
                                seen.add(v);
                                const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Variable);
                                item.detail = '(Variable en memoria GEE)';
                                item.documentation = new vscode.MarkdownString(`Variable activa en la sesión interactiva GEE: \`${v}\``);
                                item.sortText = '00_' + v;
                                item.preselect = true;
                                items.push(item);
                            }
                        } catch (e) {}
                    }

                    // 2. Variables y funciones declaradas en el documento actual (disponibles antes de ejecutar)
                    const docVars = extractDocumentVariables(document);
                    for (const dv of docVars) {
                        if (!seen.has(dv.name)) {
                            seen.add(dv.name);
                            const item = new vscode.CompletionItem(dv.name, dv.kind);
                            item.detail = dv.detail;
                            item.documentation = new vscode.MarkdownString(`Declarada en el script actual: \`${dv.name}\``);
                            item.sortText = '01_' + dv.name;
                            item.preselect = true;
                            items.push(item);
                        }
                    }

                    return items;
                }
            }
        ),
        vscode.window.onDidChangeActiveTextEditor(() => syncCompletionsToConsole()),
        vscode.workspace.onDidSaveTextDocument(() => syncCompletionsToConsole())
    );

    function switchQuadrant(quadrant: number) {
        if (quadrant === 1) {
            vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        } else if (quadrant === 2) {
            consoleView.focus();
        } else if (quadrant === 3) {
            mapView.focus();
        } else if (quadrant === 4) {
            aiView.focus();
        }
    }

    consoleView.onMessage(async (message: any) => {
        logStep(`consoleView.onMessage received: ${message.command}`);
        if (message.command === 'focusQuadrant') {
            switchQuadrant(message.quadrant);
        } else if (message.command === 'webviewError') {
            logStep(`CONSOLE WEBVIEW JS ERROR: ${message.message} | ${message.stack}`);
        } else if (message.command === 'requestCompletions' || message.command === 'consoleReady') {
            syncCompletionsToConsole();
        } else if (message.command === 'geeCommand') {
            if (!runtime || !runtime.isInitialized) {
                consoleView.append('⏳ Inicializando sesión de Earth Engine...');
            }
            await ensureRuntimeInitialized();
            if (runtime) {
                await runtime.handleCommand(message.text);
            } else {
                consoleView.append('⚠️ GEE no está autenticado. Presiona Cmd+Shift+P -> "GEE IDE: Login with Google"');
                consoleView.append('gee> ');
            }
        }
    });

    mapView.onMessage(async (message: any) => {
        if (message.command === 'focusQuadrant') {
            switchQuadrant(message.quadrant);
        } else if (message.command === 'webviewError') {
            logStep(`MAP WEBVIEW ERROR: ${message.message} | ${message.stack}`);
            if (consoleView) consoleView.append(`[Map Error] ${message.message}`);
        } else if (message.command === 'mapClick') {
            const coords = `[${message.lng.toFixed(6)}, ${message.lat.toFixed(6)}]`;
            if (consoleView) consoleView.append(`Map Click: ${coords}`);
            const action = await vscode.window.showInformationMessage(`Coords: ${coords}`, 'Insert at Cursor');
            if (action === 'Insert at Cursor') {
                const editor = vscode.window.activeTextEditor;
                if (editor) editor.edit(edit => edit.insert(editor.selection.active, coords));
            }
        } else if (message.command === 'runAll') {
            vscode.commands.executeCommand('gee-pro.run');
        } else if (message.command === 'runLine') {
            vscode.commands.executeCommand('gee-pro.runSelection');
        } else if (message.command === 'reset') {
            vscode.commands.executeCommand('gee-pro.reset');
        }
    });

    aiView.onMessage((message: any) => {
        if (message.command === 'focusQuadrant') {
            switchQuadrant(message.quadrant);
        }
    });

    // Auto-reconnect webview panels across window reloads
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer('geeConsole', {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                logStep('Deserializing geeConsole webview panel');
                webviewPanel.webview.options = { enableScripts: true };
                consoleView.attachPanel(webviewPanel);
            }
        }),
        vscode.window.registerWebviewPanelSerializer('geeMap', {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                logStep('Deserializing geeMap webview panel');
                webviewPanel.webview.options = { enableScripts: true };
                mapView.attachPanel(webviewPanel);
            }
        }),
        vscode.window.registerWebviewPanelSerializer('geeAI', {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                logStep('Deserializing geeAI webview panel');
                webviewPanel.webview.options = { enableScripts: true };
                aiView.attachPanel(webviewPanel);
            }
        })
    );

    let bridgeServerStarting: Promise<number> | null = null;
    async function ensureBridgeServer(): Promise<number> {
        if (!bridgeServer) {
            bridgeServer = new PythonBridgeServer();
            bridgeServer.onCommand((cmd: any) => {
                logStep(`Bridge server received: ${cmd.action}`);
                if (cmd.action === 'addLayer' && mapView) {
                    logStep(`Bridge addLayer: ${cmd.payload.name}`);
                    mapView.addLayer(cmd.payload.url, cmd.payload.name, cmd.payload.shown, cmd.payload.opacity);
                } else if (cmd.action === 'setCenter' && mapView) {
                    logStep(`Bridge setCenter: lat=${cmd.payload.lat}, lon=${cmd.payload.lon}, zoom=${cmd.payload.zoom}`);
                    mapView.setCenter(cmd.payload.lat, cmd.payload.lon, cmd.payload.zoom);
                } else if (cmd.action === 'clear' && mapView) {
                    logStep('Bridge clear map');
                    mapView.clear();
                }
            });
            context.subscriptions.push({
                dispose: () => {
                    if (bridgeServer) {
                        bridgeServer.stop();
                    }
                }
            });
        }
        if (!bridgeServerStarting) {
            bridgeServerStarting = bridgeServer.start().then(port => {
                logStep(`PythonBridgeServer listening on port ${port}`);
                if (runtimePy) runtimePy.setBridgePort(port);
                if (runtimeR) runtimeR.setBridgePort(port);
                return port;
            }).catch(err => {
                logStep(`Python bridge server error: ${err.message}`);
                return bridgeServer ? bridgeServer.getPort() : 31415;
            });
        }
        const port = await bridgeServerStarting;
        if (runtimePy) runtimePy.setBridgePort(port);
        if (runtimeR) runtimeR.setBridgePort(port);
        return port;
    }

    // Warm up the map bridge server immediately on extension startup
    ensureBridgeServer().catch(() => {});

    let initPromise: Promise<boolean> | undefined;

    async function ensureRuntimeInitialized(forceShowBanner: boolean = false): Promise<boolean> {
        if (runtime && runtime.isInitialized) {
            if (forceShowBanner) {
                const savedJson = await context.secrets.get('gee-pro.credentials');
                if (savedJson) {
                    try {
                        const creds = JSON.parse(savedJson);
                        await displaySessionBanner(consoleView, creds, runtime);
                    } catch (e) {}
                }
            }
            return true;
        }
        if (initPromise) return initPromise;

        initPromise = (async () => {
            logStep('>>> ensureRuntimeInitialized started');
            try {
                const bridgePort = await ensureBridgeServer();

                const savedJson = await context.secrets.get('gee-pro.credentials');
                logStep(`Credentials from secrets: ${savedJson ? 'FOUND' : 'NOT FOUND'}`);

                if (savedJson) {
                    consoleView.append('Loading GEE session...');
                    let creds = JSON.parse(savedJson);

                    if (creds.refresh_token && !creds.private_key) {
                        try {
                            logStep('Refreshing access token...');
                            consoleView.append('Refreshing access token...');
                            const newTokens = await refreshAccessToken(creds.refresh_token);
                            creds = { ...creds, ...newTokens };
                            await context.secrets.store('gee-pro.credentials', JSON.stringify(creds));
                            logStep('Token refresh successful');
                        } catch (e: any) {
                            logStep(`Token refresh warning: ${e.message}`);
                            if (e.message && (e.message.includes('401') || e.message.includes('unauthorized_client') || e.message.includes('invalid_grant'))) {
                                consoleView.append('⚠️ Previous session has expired. Please log in using: Cmd+Shift+P -> GEE IDE: Login with Google');
                                await context.secrets.delete('gee-pro.credentials');
                                return false;
                            }
                            consoleView.append(`Using cached token: ${e.message}`);
                        }
                    }

                    const { GEERuntime } = require('./geeRuntime');
                    const rt = new GEERuntime(consoleView, mapView);
                    rt.setSnippetsManager(snippetsManager);
                    await rt.initialize(creds);
                    runtime = rt;

                    let activeProject = creds.project_id || creds.project;
                    if (activeProject === 'gee-pro-default' || activeProject === 'PeruREDD') {
                        activeProject = '';
                        delete creds.project_id;
                        delete creds.project;
                    }
                    if (!activeProject) {
                        const config = vscode.workspace.getConfiguration('gee-pro');
                        activeProject = config.get<string>('projectId');
                        if (activeProject === 'PeruREDD' || activeProject === 'gee-pro-default') {
                            activeProject = '';
                            await config.update('projectId', '', vscode.ConfigurationTarget.Global);
                        }
                    }

                    // Automatic Cloud Project Detection (Zero-configuration for users!)
                    if (!activeProject && creds.access_token) {
                        try {
                            const detected = await autoDetectCloudProject(
                                creds.access_token,
                                rt.getAssetRootsList(),
                                creds.email
                            );
                            if (detected) {
                                activeProject = detected;
                                logStep(`Auto-detected GEE Cloud Project: ${activeProject}`);
                            }
                        } catch (e) {}
                    }

                    if (activeProject && activeProject !== 'gee-pro-default' && activeProject !== 'PeruREDD') {
                        creds.project_id = activeProject;
                        rt.setProjectId(activeProject);
                        await rt.loadAssetRoots(creds.email);
                        await context.secrets.store('gee-pro.credentials', JSON.stringify(creds));
                    }

                    runtimePy = new GEERuntimePy(consoleView, creds.access_token || '', activeProject || '', context.globalStorageUri.fsPath, bridgePort);
                    runtimeR = new GEERuntimeR(consoleView, creds.access_token || '', activeProject || '', bridgePort);
                    runtimePy.getPythonExecutable().then(py => {
                        if (py && runtimeR) runtimeR.setPythonPath(py);
                    });
                    await displaySessionBanner(consoleView, creds, rt);
                    logStep(`GEE runtime fully initialized with project '${activeProject || 'none'}' & banner displayed`);
                    return true;
                } else {
                    logStep('No credentials stored, prompt user to login');
                    if (!runtime) {
                        const { GEERuntime } = require('./geeRuntime');
                        runtime = new GEERuntime(consoleView, mapView);
                        runtime.setSnippetsManager(snippetsManager);
                    }
                    consoleView.append('Authentication required: Cmd+Shift+P -> GEE IDE: Login with Google');
                    return false;
                }
            } catch (e: any) {
                logStep(`Session init error: ${e.message}`);
                consoleView.append(`Session error: ${e.message}`);
                consoleView.append('💡 Tip: Para reconectar tu cuenta, presiona Cmd+Shift+P -> GEE IDE: Login with Google');
                runtime = undefined;
                return false;
            } finally {
                initPromise = undefined;
            }
        })();

        return initPromise;
    }

    // Session is only initialized on explicit user action (Start Environment, Run code, etc.)
    // to prevent unwanted background resource consumption.

    async function closeAllGeeWebviewTabs() {
        try {
            const tabsToClose: vscode.Tab[] = [];
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputWebview && 
                        ['geeAI', 'geeMap', 'geeConsole'].includes(tab.input.viewType)) {
                        tabsToClose.push(tab);
                    }
                }
            }
            if (tabsToClose.length > 0) {
                await vscode.window.tabGroups.close(tabsToClose);
            }
        } catch (e) {}

        consoleView.dispose();
        mapView.dispose();
        aiView.dispose();
    }

    let startCommand = vscode.commands.registerCommand('gee-pro.start', async () => {
        const customLayoutSaved = context.workspaceState.get<boolean>('gee-pro.customLayoutSaved', false);
        if (!customLayoutSaved) {
            // Close any existing/dormant tabs from prior sessions to avoid duplicate panels
            await closeAllGeeWebviewTabs();

            // 1. Force the professional 2x2 grid layout
            await vscode.commands.executeCommand('vscode.setEditorLayout', {
                orientation: 0,
                groups: [
                    { groups: [{}, {}], size: 0.5 },
                    { groups: [{}, {}], size: 0.5 }
                ]
            });
        }

        // 2. Open the demo script on the Top-Left (Column One)
        const demoPath = vscode.Uri.file(context.asAbsolutePath('demos/welcome_to_gee_ide.gee'));
        const doc = await vscode.workspace.openTextDocument(demoPath);
        await detectAndSetGeeLanguage(doc);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: customLayoutSaved ? undefined : vscode.ViewColumn.One });

        // 3. Show views in their respective grid positions
        if (!customLayoutSaved) {
            consoleView.show(vscode.ViewColumn.Two);
            mapView.show(vscode.ViewColumn.Three);
            aiView.show(vscode.ViewColumn.Four);
        } else {
            consoleView.show();
            mapView.show();
            aiView.show();
        }

        await ensureRuntimeInitialized(true);
        vscode.window.showInformationMessage('GEE IDE: Workspace Ready');
    });

    let authCommand = vscode.commands.registerCommand('gee-pro.authenticate', async () => {
        const json = await vscode.window.showInputBox({
            prompt: 'Paste your Service Account JSON here',
            ignoreFocusOut: true
        });

        if (json) {
            try {
                const creds = JSON.parse(json);
                if (runtime) {
                    await runtime.initialize(creds);
                    const bridgePort = await ensureBridgeServer();
                    runtimePy = new GEERuntimePy(consoleView, creds.access_token || '', creds.project_id || '', context.globalStorageUri.fsPath, bridgePort);
                    await context.secrets.store('gee-pro.credentials', json);
                    vscode.window.showInformationMessage('GEE Authenticated and Saved Successfully');
                    await displaySessionBanner(consoleView, creds, runtime);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Auth Failed: ${err.message}`);
            }
        }
    });

    let loginCommand = vscode.commands.registerCommand('gee-pro.login', async () => {
        const os = require('os');
        const path = require('path');
        const fs = require('fs');
        const credPath = path.join(os.homedir(), '.config', 'earthengine', 'credentials');

        // Step 1: Detect if user already has an active, valid session
        const savedSecret = await context.secrets.get('gee-pro.credentials');
        if (savedSecret) {
            try {
                const existingCreds = JSON.parse(savedSecret);
                if (existingCreds && existingCreds.access_token) {
                    const email = existingCreds.email || 'Google User';
                    const activeProj = existingCreds.project_id || (runtime ? runtime.getProjectId() : '') || 'Default Project';
                    
                    const choice = await vscode.window.showInformationMessage(
                        `You already have an active GEE session as ${email} (Project: ${activeProj}).`,
                        'Keep Current Session',
                        'Switch Account / Re-login'
                    );

                    if (choice !== 'Switch Account / Re-login') {
                        if (consoleView) {
                            consoleView.append(`ℹ️ Active session maintained for: ${email}`);
                        }
                        return;
                    }

                    // User selected Switch Account: perform a clean teardown of prior session
                    if (consoleView) consoleView.append('Switching account: clearing previous session...');
                    await context.secrets.delete('gee-pro.credentials');
                    if (fs.existsSync(credPath)) {
                        try { fs.unlinkSync(credPath); } catch (e) {}
                    }
                    if (runtime) runtime.reset(true);
                    if (runtimePy) runtimePy.stop();
                    if (runtimeR) runtimeR.reset(true);
                }
            } catch (e) {}
        }

        // Step 2: Check for existing refreshable credentials (clean fallback, zero raw 401 dumps)
        if (fs.existsSync(credPath)) {
            try {
                const raw = fs.readFileSync(credPath, 'utf8');
                const cliCreds = JSON.parse(raw);
                if (cliCreds && cliCreds.refresh_token) {
                    const { CLIENT_ID, CLIENT_SECRET } = require('./config');
                    const fullCreds = { ...cliCreds, client_id: CLIENT_ID, client_secret: CLIENT_SECRET };

                    try {
                        const freshTokens = await refreshAccessToken(fullCreds.refresh_token);
                        let readyCreds = { ...fullCreds, ...freshTokens };

                        if (readyCreds.access_token) {
                            const uInfo = await getUserInfo(readyCreds.access_token);
                            if (uInfo && uInfo.email) {
                                readyCreds.email = uInfo.email;
                            }
                        }
                        
                        await context.secrets.store('gee-pro.credentials', JSON.stringify(readyCreds));

                        if (!runtime) {
                            const { GEERuntime } = require('./geeRuntime');
                            runtime = new GEERuntime(consoleView, mapView);
                            runtime.setSnippetsManager(snippetsManager);
                        }

                        await runtime.initialize(readyCreds);
                        const bridgePort = await ensureBridgeServer();
                        runtimePy = new GEERuntimePy(consoleView, readyCreds.access_token || '', readyCreds.project_id || '', context.globalStorageUri.fsPath, bridgePort);
                        runtimeR = new GEERuntimeR(consoleView, readyCreds.access_token || '', readyCreds.project_id || '', bridgePort);
                        runtimePy.getPythonExecutable().then(py => {
                            if (py && runtimeR) runtimeR.setPythonPath(py);
                        });
                        vscode.window.showInformationMessage('✅ GEE IDE: Login Successful!');
                        await displaySessionBanner(consoleView, readyCreds, runtime);
                        return;
                    } catch (refreshErr: any) {
                        // Stale credentials on disk: cleanly remove the invalid file so it doesn't cause errors
                        try { fs.unlinkSync(credPath); } catch (e) {}
                        logStep(`Stale credentials removed from disk: ${refreshErr.message}`);
                    }
                }
            } catch (err: any) {
                // Ignore parse errors, proceed to web login
            }
        }

        // Step 3: Automatic Loopback OAuth flow (Clean web login)
        const { CLIENT_ID } = require('./config');
        const SCOPES = 'https://www.googleapis.com/auth/earthengine https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email';

        if (activeLoopback) {
            activeLoopback.stop();
            activeLoopback = undefined;
        }

        const loopback = new LoopbackAuthServer();
        activeLoopback = loopback;
        try {
            await loopback.start();
            const redirectUri = `http://127.0.0.1:${loopback.port}/callback`;
            const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&state=${loopback.nonce}&access_type=offline&prompt=consent`;

            if (consoleView) consoleView.append('Opening browser for Google Authentication...');
            await vscode.env.openExternal(vscode.Uri.parse(authUrl));

            const { code } = await loopback.waitForCode();
            if (consoleView) consoleView.append('Authorization received. Exchanging code for token...');

            let tokenData = await exchangeCodeForToken(code, redirectUri);
            if (tokenData.access_token) {
                const uInfo = await getUserInfo(tokenData.access_token);
                if (uInfo && uInfo.email) {
                    tokenData.email = uInfo.email;
                }
            }
            if (!runtime) {
                const { GEERuntime } = require('./geeRuntime');
                runtime = new GEERuntime(consoleView, mapView);
                runtime.setSnippetsManager(snippetsManager);
            }

            await runtime.initialize(tokenData);
            let activeProject = tokenData.project_id || tokenData.project;
                if (activeProject === 'gee-pro-default' || activeProject === 'PeruREDD') {
                    activeProject = '';
                    delete tokenData.project_id;
                    delete tokenData.project;
                }
                if (!activeProject) {
                    const config = vscode.workspace.getConfiguration('gee-pro');
                    activeProject = config.get<string>('projectId');
                    if (activeProject === 'PeruREDD' || activeProject === 'gee-pro-default') {
                        activeProject = '';
                        await config.update('projectId', '', vscode.ConfigurationTarget.Global);
                    }
                }
                if (!activeProject && tokenData.access_token) {
                    try {
                        const detected = await autoDetectCloudProject(
                            tokenData.access_token,
                            runtime.getAssetRootsList(),
                            tokenData.email
                        );
                        if (detected) {
                            activeProject = detected;
                        }
                    } catch (e) {}
                }
                if (activeProject && activeProject !== 'gee-pro-default' && activeProject !== 'PeruREDD') {
                    tokenData.project_id = activeProject;
                    runtime.setProjectId(activeProject);
                    await runtime.loadAssetRoots(tokenData.email);
                }
                const bridgePort = await ensureBridgeServer();
                runtimePy = new GEERuntimePy(consoleView, tokenData.access_token || '', activeProject || '', context.globalStorageUri.fsPath, bridgePort);
                runtimeR = new GEERuntimeR(consoleView, tokenData.access_token || '', activeProject || '', bridgePort);
                runtimePy.getPythonExecutable().then(py => {
                    if (py && runtimeR) runtimeR.setPythonPath(py);
                });
                await context.secrets.store('gee-pro.credentials', JSON.stringify(tokenData));

                // Synchronize credentials to ~/.config/earthengine/credentials for CLI/Python/R harmony
                try {
                    const earthengineDir = path.join(os.homedir(), '.config', 'earthengine');
                    if (!fs.existsSync(earthengineDir)) {
                        fs.mkdirSync(earthengineDir, { recursive: true });
                    }
                    const diskCreds: any = {};
                    if (tokenData.refresh_token) diskCreds.refresh_token = tokenData.refresh_token;
                    if (activeProject) diskCreds.project = activeProject;
                    fs.writeFileSync(credPath, JSON.stringify(diskCreds, null, 2), 'utf8');
                } catch (e) {}

                vscode.window.showInformationMessage('✅ GEE IDE: Login Successful!');
                await displaySessionBanner(consoleView, tokenData, runtime);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Login Failed: ${err.message}`);
            if (consoleView) consoleView.append(`Auth Error: ${err.message}`);
        } finally {
            loopback.stop();
            if (activeLoopback === loopback) {
                activeLoopback = undefined;
            }
        }
    });

    let logoutCommand = vscode.commands.registerCommand('gee-pro.logout', async () => {
        if (activeLoopback) {
            activeLoopback.stop();
            activeLoopback = undefined;
        }
        const os = require('os');
        const path = require('path');
        const fs = require('fs');
        const credPath = path.join(os.homedir(), '.config', 'earthengine', 'credentials');

        await context.secrets.delete('gee-pro.credentials');
        if (fs.existsSync(credPath)) {
            try {
                fs.unlinkSync(credPath);
            } catch (e) {}
        }
        if (runtime) {
            runtime.reset(true);
            runtime = undefined;
        }
        if (runtimePy) {
            runtimePy.stop();
            runtimePy = undefined;
        }
        if (runtimeR) {
            runtimeR.reset(true);
            runtimeR = undefined;
        }
        if (mapView) {
            mapView.clear();
        }
        if (consoleView) {
            consoleView.append('🔒 GEE Session logged out. All credentials cleared.');
            consoleView.append('You can now login with another account using: Cmd+Shift+P -> GEE IDE: Login with Google');
        }
        vscode.window.showInformationMessage('🔒 GEE IDE: Session closed. Credentials cleared.');
    });

    let runCommand = vscode.commands.registerCommand('gee-pro.run', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const code = editor.document.getText();
            const langId = editor.document.languageId;
            if (consoleView) {
                consoleView.append('----------------------------------------');
                consoleView.append(`Running full script [${langId.toUpperCase()}]...`);
                const docName = path.basename(editor.document.fileName);
                consoleView.appendHistory(`// Run full script: ${docName}`);
            }
            
            if (langId === 'python') {
                await ensureBridgeServer();
                if (!runtimePy) {
                    await ensureRuntimeInitialized();
                }
                if (runtimePy) {
                    if (mapView) mapView.show(vscode.ViewColumn.Three);
                    runtimePy.execute(code).then(() => {
                        if (consoleView) consoleView.append('gee> ');
                    });
                } else {
                    if (consoleView) consoleView.append('[Error] Python runtime not ready. Please login first (Cmd+Shift+P -> GEE IDE: Login with Google).');
                    if (consoleView) consoleView.append('gee> ');
                }
                return;
            }

            if (langId === 'r') {
                const port = await ensureBridgeServer();
                if (!runtimeR) {
                    runtimeR = new GEERuntimeR(consoleView, '', '', port);
                }
                if (mapView) mapView.show(vscode.ViewColumn.Three);
                runtimeR.execute(code).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
                return;
            }

            if (!runtime || !runtime.isInitialized) {
                await ensureRuntimeInitialized();
            }
            if (runtime) {
                runtime.execute(code, true).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
            }
        }
    });

    let resetCommand = vscode.commands.registerCommand('gee-pro.reset', () => {
        if (runtime) {
            runtime.reset(true);
        }
        if (runtimePy) {
            runtimePy.stop();
        }
        if (runtimeR) {
            runtimeR.reset(true);
        }
        if (mapView) {
            mapView.clear();
        }
        if (consoleView) {
            consoleView.append('🧹 Environment reset. Map and variables cleared.');
        }
    });

    function isNonRunnableLine(text: string, langId: string): boolean {
        const trimmed = text.trim();
        if (trimmed.length === 0) return true;
        if (langId === 'python' || langId === 'r') {
            if (trimmed.startsWith('#')) return true;
        }
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')) {
            return true;
        }
        return false;
    }

    let runSelectionCommand = vscode.commands.registerCommand('gee-pro.runSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            let code = "";
            let targetLine = selection.active.line;

            if (selection.isEmpty) {
                // SMART SELECTION: Expand to complete block if necessary
                const langId = editor.document.languageId;
                let currentLineIndex = selection.active.line;

                // RStudio-style: Skip comments and blank lines forward to next runnable line
                while (currentLineIndex < editor.document.lineCount && isNonRunnableLine(editor.document.lineAt(currentLineIndex).text, langId)) {
                    currentLineIndex++;
                }
                if (currentLineIndex >= editor.document.lineCount) {
                    return;
                }

                let fullCode = "";
                let isBalanced = false;

                if (langId === 'python') {
                    // PYTHON SMART SELECTION (Indentation-based)
                    let startLine = editor.document.lineAt(currentLineIndex);
                    
                    let tempIndex = currentLineIndex;
                    while (tempIndex >= 0) {
                        const line = editor.document.lineAt(tempIndex);
                        if (line.text.trim().endsWith(':') && line.firstNonWhitespaceCharacterIndex <= startLine.firstNonWhitespaceCharacterIndex) {
                            currentLineIndex = tempIndex;
                            startLine = line;
                            break;
                        }
                        if (line.firstNonWhitespaceCharacterIndex === 0 && line.text.trim().length > 0) {
                            break;
                        }
                        tempIndex--;
                    }

                    const baseIndent = startLine.firstNonWhitespaceCharacterIndex;
                    fullCode = startLine.text + "\n";
                    
                    if (startLine.text.trim().endsWith(':')) {
                        let peekIndex = currentLineIndex + 1;
                        while (peekIndex < editor.document.lineCount) {
                            const peekLine = editor.document.lineAt(peekIndex);
                            if (peekLine.text.trim().length > 0 && peekLine.firstNonWhitespaceCharacterIndex <= baseIndent) {
                                break;
                            }
                            fullCode += peekLine.text + "\n";
                            peekIndex++;
                        }
                        isBalanced = true;
                        currentLineIndex = peekIndex - 1;
                    } else {
                        currentLineIndex = selection.active.line;
                        fullCode = editor.document.lineAt(currentLineIndex).text;
                        isBalanced = true;
                    }
                } else {
                    // JS/R SMART SELECTION (Bracket-based + Fluent Method Chaining)
                    // 1. Rewind upwards if current line is a continuation (.filter, $, +, -, %>%, etc.)
                    while (currentLineIndex > 0) {
                        const curText = editor.document.lineAt(currentLineIndex).text.trim();
                        if (curText.startsWith('.') || curText.startsWith('+') || curText.startsWith('-') || curText.startsWith('*') || curText.startsWith('/') || curText.startsWith('$') || curText.startsWith('%>%') || curText.startsWith('|>')) {
                            currentLineIndex--;
                        } else {
                            const prevText = editor.document.lineAt(currentLineIndex - 1).text.trim();
                            const isComment = prevText.startsWith('//') || prevText.startsWith('/*') || (langId === 'r' && prevText.startsWith('#'));
                            const isChainedEnd = prevText.endsWith('$') || prevText.endsWith('%>%') || prevText.endsWith('|>') || prevText.endsWith('+');
                            if (prevText.length > 0 && !isComment &&
                                (isChainedEnd || (!prevText.endsWith(';') && !prevText.endsWith('{') && !prevText.endsWith('}') &&
                                (curText.startsWith('.') || curText.startsWith('$') || curText.startsWith('(') || curText.startsWith('['))))) {
                                currentLineIndex--;
                            } else {
                                break;
                            }
                        }
                    }

                    // 2. Collect lines forward until brackets match and chained calls finish
                    let stack: string[] = [];
                    fullCode = "";
                    let endIndex = currentLineIndex;

                    while (endIndex < editor.document.lineCount) {
                        const lineText = editor.document.lineAt(endIndex).text;
                        fullCode += lineText + "\n";
                        const trimmed = lineText.trim();

                        const isLineComment = trimmed.startsWith('//') || trimmed.startsWith('/*') || (langId === 'r' && trimmed.startsWith('#'));
                        if (!isLineComment) {
                            for (const char of lineText) {
                                if (char === '{' || char === '(' || char === '[') stack.push(char);
                                else if (char === '}') { if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop(); }
                                else if (char === ')') { if (stack.length > 0 && stack[stack.length - 1] === '(') stack.pop(); }
                                else if (char === ']') { if (stack.length > 0 && stack[stack.length - 1] === '[') stack.pop(); }
                            }
                        }

                        if (stack.length === 0) {
                            let nextIsChained = false;
                            const isEndChained = trimmed.endsWith('$') || trimmed.endsWith('%>%') || trimmed.endsWith('|>') || trimmed.endsWith('+');
                            if (isEndChained || !trimmed.endsWith(';')) {
                                let peek = endIndex + 1;
                                while (peek < editor.document.lineCount) {
                                    const peekText = editor.document.lineAt(peek).text.trim();
                                    const isPeekComment = peekText.length === 0 || peekText.startsWith('//') || peekText.startsWith('/*') || (langId === 'r' && peekText.startsWith('#'));
                                    if (isPeekComment) {
                                        peek++;
                                        continue;
                                    }
                                    if (peekText.startsWith('.') || peekText.startsWith('$') || peekText.startsWith('+') || peekText.startsWith('-') || peekText.startsWith('*') || peekText.startsWith('/') || peekText.startsWith('%>%') || peekText.startsWith('|>') || isEndChained) {
                                        nextIsChained = true;
                                    }
                                    break;
                                }
                            }

                            if (!nextIsChained) {
                                isBalanced = true;
                                break;
                            }
                        }
                        endIndex++;
                    }
                    currentLineIndex = endIndex;
                }

                code = isBalanced ? fullCode.trim() : editor.document.lineAt(selection.active.line).text;
                targetLine = currentLineIndex;
            } else {
                code = editor.document.getText(selection);
            }
            
            const view = consoleView;
            const langId = editor.document.languageId;
            
            if (view) {
                view.appendHistory(code);
                const lines = code.split('\n');
                lines.forEach((line, idx) => {
                    if (idx === 0) {
                        view.append(`> ${line.trimEnd()}`);
                    } else {
                        view.append(`  ${line.trimEnd()}`);
                    }
                });
            }

            const trimmedCode = code.trim();
            if (trimmedCode.startsWith('?') || trimmedCode.startsWith('help ') || trimmedCode === 'help') {
                if (!runtime) {
                    const { GEERuntime } = require('./geeRuntime');
                    runtime = new GEERuntime(consoleView, mapView);
                    runtime.setSnippetsManager(snippetsManager);
                }
                const query = trimmedCode.startsWith('?') ? trimmedCode.substring(1).trim() : trimmedCode.replace(/^help\s*/, '').trim();
                runtime.showHelp(query);
                if (consoleView) consoleView.append('gee> ');
            } else if (langId === 'python') {
                await ensureBridgeServer();
                if (!runtimePy) {
                    await ensureRuntimeInitialized();
                }
                if (runtimePy) {
                    runtimePy.executeLine(code).then(() => {
                        if (consoleView) consoleView.append('gee> ');
                    });
                } else {
                    if (consoleView) consoleView.append('[Error] Python runtime not ready. Please login first.');
                    if (consoleView) consoleView.append('gee> ');
                }
            } else if (langId === 'r') {
                const port = await ensureBridgeServer();
                if (!runtimeR) {
                    runtimeR = new GEERuntimeR(consoleView, '', '', port);
                }
                runtimeR.executeLine(code).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
            } else {
                if (!runtime || !runtime.isInitialized) {
                    await ensureRuntimeInitialized();
                }
                if (runtime) {
                    runtime.execute(code).then(() => {
                        if (consoleView) consoleView.append('gee> ');
                    });
                }
            }

            let nextLine = targetLine + 1;
            while (nextLine < editor.document.lineCount && isNonRunnableLine(editor.document.lineAt(nextLine).text, langId)) {
                nextLine++;
            }
            if (nextLine < editor.document.lineCount) {
                const newPos = new vscode.Position(nextLine, 0);
                editor.selection = new vscode.Selection(newPos, newPos);
                editor.revealRange(new vscode.Range(newPos, newPos));
            }
        }
    });

    let setProjectCommand = vscode.commands.registerCommand('gee-pro.setProject', async () => {
        const current = (runtime ? runtime.getProjectId() : '') || 'PeruREDD';
        const project = await vscode.window.showInputBox({
            prompt: 'Enter Google Cloud / Earth Engine Project ID',
            value: current,
            ignoreFocusOut: true
        });
        if (project && project.trim()) {
            const clean = project.trim();
            const config = vscode.workspace.getConfiguration('gee-pro');
            await config.update('projectId', clean, vscode.ConfigurationTarget.Global);
            if (runtime) {
                runtime.setProjectId(clean);
                await runtime.loadAssetRoots();
            }
            if (runtimePy) runtimePy.setProject(clean);
            try {
                const savedJson = await context.secrets.get('gee-pro.credentials');
                if (savedJson) {
                    const c = JSON.parse(savedJson);
                    c.project_id = clean;
                    await context.secrets.store('gee-pro.credentials', JSON.stringify(c));
                }
            } catch (e) {}
            consoleView.append(`🚀 Active Cloud Project updated to: ${clean}`);
            vscode.window.showInformationMessage(`GEE IDE: Cloud Project set to ${clean}`);
        }
    });

    let focusEditorCommand = vscode.commands.registerCommand('gee-pro.focusEditor', () => {
        vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    });

    let focusConsoleCommand = vscode.commands.registerCommand('gee-pro.focusConsole', () => {
        consoleView.focus();
    });

    let focusMapCommand = vscode.commands.registerCommand('gee-pro.focusMap', () => {
        mapView.focus();
    });

    let focusAICommand = vscode.commands.registerCommand('gee-pro.focusAI', () => {
        aiView.focus();
    });

    let clearConsoleCommand = vscode.commands.registerCommand('gee-pro.clearConsole', () => {
        consoleView.clear();
    });

    let saveLayoutCommand = vscode.commands.registerCommand('gee-pro.saveLayout', async () => {
        await context.workspaceState.update('gee-pro.customLayoutSaved', true);
        vscode.window.showInformationMessage('💾 GEE IDE: Diseño actual guardado como predeterminado para este proyecto.');
        consoleView.append('💾 Workspace layout saved as default. Your custom window positions will be preserved.');
    });

    let resetLayoutCommand = vscode.commands.registerCommand('gee-pro.resetLayout', async () => {
        await context.workspaceState.update('gee-pro.customLayoutSaved', false);
        await closeAllGeeWebviewTabs();
        await vscode.commands.executeCommand('vscode.setEditorLayout', {
            orientation: 0,
            groups: [
                { groups: [{}, {}], size: 0.5 },
                { groups: [{}, {}], size: 0.5 }
            ]
        });
        consoleView.show(vscode.ViewColumn.Two);
        mapView.show(vscode.ViewColumn.Three);
        aiView.show(vscode.ViewColumn.Four);
        vscode.window.showInformationMessage('🔄 GEE IDE: Diseño restaurado a cuadrícula 2x2 estándar.');
        consoleView.append('🔄 Workspace layout reset to default 2x2 grid.');
    });

    let editSnippetsCommand = vscode.commands.registerCommand('gee-pro.editSnippets', async () => {
        await snippetsManager.openUserSnippetsFile();
    });

    let listSnippetsCommand = vscode.commands.registerCommand('gee-pro.listSnippets', async () => {
        await snippetsManager.showSnippetsQuickPick();
    });

    context.subscriptions.push(
        startCommand, authCommand, loginCommand, logoutCommand, runCommand, runSelectionCommand, resetCommand, setProjectCommand,
        focusEditorCommand, focusConsoleCommand, focusMapCommand, focusAICommand,
        clearConsoleCommand, saveLayoutCommand, resetLayoutCommand, editSnippetsCommand, listSnippetsCommand
    );
    logStep('>>> ACTIVATE() COMPLETED SUCCESSFULLY — All commands ready');
}

export function deactivate() { }

