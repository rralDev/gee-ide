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
import { exchangeCodeForToken, refreshAccessToken, getUserInfo, getAvailableCloudProjects, autoDetectCloudProject } from './auth';

import * as fs from 'fs';

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
    logStep('Step 4: Views and variables initialized');

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
        } else if (message.command === 'geeCommand') {
            await ensureRuntimeInitialized();
            if (runtime) {
                runtime.handleCommand(message.text);
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
                ensureRuntimeInitialized().catch(e => logStep(`Background init error: ${e.message}`));
            }
        }),
        vscode.window.registerWebviewPanelSerializer('geeMap', {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                logStep('Deserializing geeMap webview panel');
                webviewPanel.webview.options = { enableScripts: true };
                mapView.attachPanel(webviewPanel);
                ensureRuntimeInitialized().catch(e => logStep(`Background init error: ${e.message}`));
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

    let initPromise: Promise<boolean> | undefined;

    async function ensureRuntimeInitialized(): Promise<boolean> {
        if (runtime && runtime.isInitialized) return true;
        if (initPromise) return initPromise;

        initPromise = (async () => {
            logStep('>>> ensureRuntimeInitialized started');
            try {
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
                    try {
                        const port = await bridgeServer.start();
                        logStep(`PythonBridgeServer listening on port ${port}`);
                        if (runtimePy) {
                            runtimePy.setBridgePort(port);
                        }
                        if (runtimeR) {
                            runtimeR.setBridgePort(port);
                        }
                    } catch (err: any) {
                        logStep(`Python bridge server error: ${err.message}`);
                    }
                }

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
                            consoleView.append(`Refresh failed, using old token: ${e.message}`);
                        }
                    }

                    const { GEERuntime } = require('./geeRuntime');
                    const rt = new GEERuntime(consoleView, mapView);
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

                    runtimePy = new GEERuntimePy(consoleView, creds.access_token || '', activeProject || '', context.globalStorageUri.fsPath, bridgeServer ? bridgeServer.getPort() : 31415);
                    runtimeR = new GEERuntimeR(consoleView, creds.access_token || '', activeProject || '', bridgeServer ? bridgeServer.getPort() : 31415);
                    runtimePy.getPythonExecutable().then(py => {
                        if (py && runtimeR) runtimeR.setPythonPath(py);
                    });
                    await displaySessionBanner(consoleView, creds, rt);
                    logStep(`GEE runtime fully initialized with project '${activeProject || 'none'}' & banner displayed`);
                    return true;
                } else {
                    logStep('No credentials stored, prompt user to login');
                    consoleView.append('Authentication required: Cmd+Shift+P -> GEE IDE: Login with Google');
                    return false;
                }
            } catch (e: any) {
                logStep(`Session init error: ${e.message}`);
                consoleView.append(`Session error: ${e.message}`);
                runtime = undefined;
                return false;
            } finally {
                initPromise = undefined;
            }
        })();

        return initPromise;
    }

    // Initialize session automatically on startup
    ensureRuntimeInitialized();

    let startCommand = vscode.commands.registerCommand('gee-pro.start', async () => {
        // 1. Force the professional 2x2 grid layout
        await vscode.commands.executeCommand('vscode.setEditorLayout', {
            orientation: 0,
            groups: [
                { groups: [{}, {}], size: 0.5 },
                { groups: [{}, {}], size: 0.5 }
            ]
        });

        // 2. Open the demo script on the Top-Left (Column One)
        const demoPath = vscode.Uri.file(context.asAbsolutePath('demos/welcome_to_gee_pro.gee'));
        const doc = await vscode.workspace.openTextDocument(demoPath);
        await detectAndSetGeeLanguage(doc);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });

        // 3. Show views in their respective grid positions
        consoleView.show(vscode.ViewColumn.Two);
        mapView.show(vscode.ViewColumn.Three);
        aiView.show(vscode.ViewColumn.Four);

        await ensureRuntimeInitialized();
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
                    runtimePy = new GEERuntimePy(consoleView, creds.access_token || '', creds.project_id || '', context.globalStorageUri.fsPath, bridgeServer ? bridgeServer.getPort() : 31415);
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

        // Option 1: Try reading earthengine CLI credentials (the easy path)
        if (fs.existsSync(credPath)) {
            try {
                const raw = fs.readFileSync(credPath, 'utf8');
                const cliCreds = JSON.parse(raw);
                const { CLIENT_ID, CLIENT_SECRET } = require('./config');
                const fullCreds = { ...cliCreds, client_id: CLIENT_ID, client_secret: CLIENT_SECRET };

                if (consoleView) consoleView.append('Found earthengine CLI credentials. Getting fresh token...');
                
                const freshTokens = await refreshAccessToken(fullCreds.refresh_token);
                let readyCreds = { ...fullCreds, ...freshTokens };

                if (readyCreds.access_token) {
                    const uInfo = await getUserInfo(readyCreds.access_token);
                    if (uInfo && uInfo.email) {
                        readyCreds.email = uInfo.email;
                    }
                }
                
                await context.secrets.store('gee-pro.credentials', JSON.stringify(readyCreds));

                if (runtime) {
                    await runtime.initialize(readyCreds);
                    runtimePy = new GEERuntimePy(consoleView, readyCreds.access_token || '', readyCreds.project_id || '', context.globalStorageUri.fsPath, bridgeServer ? bridgeServer.getPort() : 31415);
                    vscode.window.showInformationMessage('✅ GEE IDE: Login Successful! (via earthengine CLI)');
                    await displaySessionBanner(consoleView, readyCreds, runtime);
                }
                return;
            } catch (err: any) {
                if (consoleView) consoleView.append(`CLI login failed: ${err.message}. Falling back to OAuth login...`);
            }
        }

        // Option 2: Automatic Loopback OAuth flow
        const { CLIENT_ID } = require('./config');
        const SCOPES = 'https://www.googleapis.com/auth/earthengine https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email';

        const loopback = new LoopbackAuthServer();
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
            if (runtime) {
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
                runtimePy = new GEERuntimePy(consoleView, tokenData.access_token || '', activeProject || '', context.globalStorageUri.fsPath, bridgeServer ? bridgeServer.getPort() : 31415);
                await context.secrets.store('gee-pro.credentials', JSON.stringify(tokenData));
                vscode.window.showInformationMessage('✅ GEE IDE: Login Successful!');
                await displaySessionBanner(consoleView, tokenData, runtime);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Login Failed: ${err.message}`);
            if (consoleView) consoleView.append(`Auth Error: ${err.message}`);
        } finally {
            loopback.stop();
        }
    });

    let runCommand = vscode.commands.registerCommand('gee-pro.run', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const code = editor.document.getText();
            const langId = editor.document.languageId;
            if (consoleView) {
                consoleView.append('----------------------------------------');
                consoleView.append(`Running full script [${langId.toUpperCase()}]...`);
            }
            
            if (langId === 'python') {
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
                if (!runtimeR) {
                    runtimeR = new GEERuntimeR(consoleView, '', '', bridgeServer ? bridgeServer.getPort() : 31415);
                }
                if (mapView) mapView.show(vscode.ViewColumn.Three);
                runtimeR.execute(code).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
                return;
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
            runtime.reset();
        }
        if (runtimePy) {
            runtimePy.stop();
        }
        if (runtimeR) {
            runtimeR.reset();
        }
        if (mapView) {
            mapView.clear();
        }
    });

    let runSelectionCommand = vscode.commands.registerCommand('gee-pro.runSelection', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            let code = "";
            let targetLine = selection.active.line;

            if (selection.isEmpty) {
                // SMART SELECTION: Expand to complete block if necessary
                const langId = editor.document.languageId;
                let currentLineIndex = selection.active.line;
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
                const lines = code.split('\n');
                lines.forEach((line, idx) => {
                    if (idx === 0) {
                        view.append(`> ${line.trimEnd()}`);
                    } else {
                        view.append(`  ${line.trimEnd()}`);
                    }
                });
            }

            if (langId === 'python') {
                if (runtimePy) {
                    runtimePy.executeLine(code).then(() => {
                        if (consoleView) consoleView.append('gee> ');
                    });
                } else {
                    if (consoleView) consoleView.append('[Error] Python runtime not ready. Please login first.');
                    if (consoleView) consoleView.append('gee> ');
                }
            } else if (langId === 'r') {
                if (!runtimeR) {
                    runtimeR = new GEERuntimeR(consoleView, '', '', bridgeServer ? bridgeServer.getPort() : 31415);
                }
                runtimeR.executeLine(code).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
            } else if (runtime) {
                runtime.execute(code).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
            }

            const nextLine = targetLine + 1;
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

    context.subscriptions.push(
        startCommand, authCommand, loginCommand, runCommand, runSelectionCommand, resetCommand, setProjectCommand,
        focusEditorCommand, focusConsoleCommand, focusMapCommand, focusAICommand
    );
    logStep('>>> ACTIVATE() COMPLETED SUCCESSFULLY — All commands ready');
}

export function deactivate() { }

