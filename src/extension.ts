import * as dns from 'dns';
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

import * as vscode from 'vscode';
import { MapView } from './views/mapView';
import { ConsoleView } from './views/consoleView';
import type { GEERuntime } from './geeRuntime';
import { GEERuntimePy } from './geeRuntimePy';
import { GEERuntimeR } from './geeRuntimeR';
import { PythonBridgeServer } from './pythonBridgeServer';
import { LoopbackAuthServer } from './loopbackAuthServer';
import { AssetExplorerProvider } from './views/assetExplorer';
import { TasksView, AIView } from './views/tasksView';
import { SnippetsManager } from './snippetsManager';
import { CatalogManager } from './catalogManager';
import { SpectralIndicesManager } from './spectralIndices';
import { exchangeCodeForToken, refreshAccessToken, getUserInfo, getAvailableCloudProjects, autoDetectCloudProject } from './auth';
import { TaskNotifier } from './taskNotifier';
import { ProjectManager } from './projectManager';

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

    let activeProj = creds.project_id || (runtime ? runtime!.getProjectId() : '');
    if (activeProj === 'gee-pro-default' || activeProj === 'PeruREDD') {
        activeProj = '';
    }

    // Set connected session info for clean RStudio-style header
    if (typeof consoleView.setSessionInfo === 'function') {
        consoleView.setSessionInfo({
            account: userEmail || '',
            project: activeProj || ''
        });
    }
    
    // Register asset root paths for silent background autocompletion (no screen clutter)
    if (runtime) {
        const roots = runtime!.getAssetRootsList();
        if (roots && roots.length > 0) {
            const completionItems: string[] = [];
            roots.forEach((r: any) => {
                completionItems.push(r.shortName);
                completionItems.push(r.id);
            });
            consoleView.addCompletions(completionItems);
        }
    }
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

    let lastActiveEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor || vscode.window.visibleTextEditors.find(e => !e.document.isClosed && !e.document.uri.scheme.includes('output') && !e.document.uri.scheme.includes('ai'));
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(detectAndSetGeeLanguage),
        vscode.workspace.onDidChangeTextDocument(e => detectAndSetGeeLanguage(e.document)),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && !editor.document.uri.scheme.includes('output') && !editor.document.uri.scheme.includes('ai')) {
                lastActiveEditor = editor;
                detectAndSetGeeLanguage(editor.document);
            }
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
    const taskNotifier = new TaskNotifier();
    context.subscriptions.push(taskNotifier);

    async function getTargetEditor(): Promise<vscode.TextEditor | undefined> {
        let editor = vscode.window.activeTextEditor;
        if (editor && !editor.document.isClosed && !editor.document.uri.scheme.includes('output') && !editor.document.uri.scheme.includes('ai')) {
            return editor;
        }
        if (lastActiveEditor && !lastActiveEditor.document.isClosed) {
            try {
                return await vscode.window.showTextDocument(lastActiveEditor.document, lastActiveEditor.viewColumn || vscode.ViewColumn.One, false);
            } catch (e) {
                return lastActiveEditor;
            }
        }
        editor = vscode.window.visibleTextEditors.find(e => 
            !e.document.isClosed && 
            !e.document.uri.scheme.includes('output') && 
            !e.document.uri.scheme.includes('ai') &&
            e.document.uri.scheme !== 'vscode-userdata'
        );
        if (editor) return editor;

        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputText) {
                    const uri = tab.input.uri;
                    if (!uri.scheme.includes('output') && !uri.scheme.includes('ai') && uri.scheme !== 'vscode-userdata') {
                        try {
                            const doc = await vscode.workspace.openTextDocument(uri);
                            return await vscode.window.showTextDocument(doc, group.viewColumn || vscode.ViewColumn.One, false);
                        } catch (e) {}
                    }
                }
            }
        }

        let targetDoc = vscode.workspace.textDocuments.find(d => 
            !d.isClosed && 
            !d.uri.scheme.includes('output') &&
            (d.languageId === 'javascript' || d.languageId === 'gee' || d.languageId === 'python' || d.languageId === 'r' || d.fileName.endsWith('.gee') || d.fileName.endsWith('.js') || d.fileName.endsWith('.py') || d.fileName.endsWith('.r') || d.isUntitled)
        );
        if (targetDoc) {
            try {
                return await vscode.window.showTextDocument(targetDoc, vscode.ViewColumn.One, false);
            } catch (e) {}
        }
        return undefined;
    }

    const projectManager = ProjectManager.initialize(context, mapView, consoleView, aiView);
    projectManager.loadProject();
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
        projectManager.loadProject();
    }, null, context.subscriptions);

    function attachTaskNotifierToRuntime(rt: any) {
        if (!rt) return;
        rt.onTaskStarted((desc?: string) => {
            taskNotifier.wakeUp(desc);
            if (aiView && aiView.isCreated) {
                aiView.sendMessage({ command: 'taskStarting', description: desc });
            }
        });
        taskNotifier.start(
            () => rt.isInitialized ? rt.getTasks() : Promise.resolve([]),
            (tasks: any[]) => {
                if (aiView && aiView.isCreated) {
                    aiView.sendMessage({ command: 'tasksData', tasks });
                }
            }
        );
    }

    let runtime: GEERuntime | undefined;
    let runtimePy: GEERuntimePy | undefined;
    let runtimeR: GEERuntimeR | undefined;
    let bridgeServer: PythonBridgeServer | undefined;
    let activeLoopback: LoopbackAuthServer | undefined;
    const snippetsManager = new SnippetsManager(context);
    context.subscriptions.push(snippetsManager.registerSnippetsProvider());
    const catalogManager = new CatalogManager(context);

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
                runtime!.getUserVariables().forEach(v => vars.add(v));
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
                            const userVars = runtime!.getUserVariables();
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
        vscode.window.onDidChangeActiveTextEditor(editor => {
            syncCompletionsToConsole();
            if (editor) {
                const lang = editor.document.languageId;
                if (lang === 'python') consoleView.setLangMode('py');
                else if (lang === 'r') consoleView.setLangMode('r');
                else if (lang === 'javascript' || lang === 'gee') consoleView.setLangMode('js');
            }
        }),
        vscode.workspace.onDidSaveTextDocument(() => syncCompletionsToConsole())
    );

    function switchQuadrant(quadrant: number) {
        if (quadrant === 1) {
            vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        } else if (quadrant === 2) {
            vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
            if (consoleView.isCreated) consoleView.focus();
        } else if (quadrant === 3) {
            vscode.commands.executeCommand('workbench.action.focusThirdEditorGroup');
            if (mapView.isCreated) mapView.focus();
        } else if (quadrant === 4) {
            vscode.commands.executeCommand('workbench.action.focusFourthEditorGroup');
            if (aiView.isCreated) aiView.focus();
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
            const rawText = message.text;
            const trimmed = rawText.trim();
            const langMode = consoleView.getLangMode();

            // First: Detect CLI commands: !cmd, .cmd, cd, ls, pwd, mkdir, rm, find, du, history, clear, etc.
            const firstWord = trimmed.replace(/^!|^gee>\s*|^\./, '').trim().split(/\s+/)[0];
            const isKnownCli = ['ls', 'dir', 'pwd', 'cd', 'mkdir', 'rm', 'rmdir', 'cp', 'mv', 'find', 'catalog', 'search', 'du', 'quota', 'history', 'clear', 'cls', 'touch', 'objects', 'snippets', 'indices', 'index', 'log', 'help'].includes(firstWord);
            const isExplicitCli = trimmed.startsWith('!') || trimmed.startsWith('.') || trimmed.startsWith('gee>') || (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/*'));
            const isPureCli = (isExplicitCli || isKnownCli) && !trimmed.includes('=') && !trimmed.includes('(') && !trimmed.includes(')');

            if (isPureCli) {
                if (!runtime || !runtime.isInitialized) {
                    await ensureRuntimeInitialized();
                }
                if (runtime) {
                    const cliCmd = trimmed.replace(/^!|^gee>\s*|^\.|\//, (m) => m === '.' || m === '!' ? m : '').trim();
                    await runtime.handleCommand(cliCmd);
                }
                return;
            }

            if (langMode === 'py') {
                const port = await ensureBridgeServer();
                if (!runtimePy) {
                    await ensureRuntimeInitialized();
                }
                if (!runtimePy) {
                    runtimePy = new GEERuntimePy(consoleView, '', '', context.globalStorageUri.fsPath, port);
                }
                const activeDoc = vscode.window.activeTextEditor?.document;
                const activeFilePath = (activeDoc && !activeDoc.isUntitled) ? activeDoc.fileName : undefined;
                await runtimePy.execute(rawText, activeFilePath);
                return;
            }

            if (langMode === 'r') {
                if (runtimeR) {
                    await runtimeR.execute(rawText);
                } else {
                    consoleView.append('[Error] Runtime de R no inicializado.');
                }
                return;
            }

            // Modo JavaScript (predeterminado)
            if (!runtime || !runtime!.isInitialized) {
                consoleView.append('⏳ Inicializando sesión de Earth Engine...');
            }
            await ensureRuntimeInitialized();
            if (runtime) {
                await runtime!.handleCommand(rawText);
            } else {
                consoleView.append('⚠️ GEE no está autenticado. Presiona Cmd+Shift+P -> "GEE IDE: Login with Google"');
            }
        }
    });

    mapView.onMessage(async (message: any) => {
        if (message.command === 'ready') {
            const savedLayers = context.workspaceState.get<any[]>('gee_geometries_backup');
            if (savedLayers && Array.isArray(savedLayers) && savedLayers.length > 0) {
                mapView.sendMessage({ command: 'restoreGeometries', layers: savedLayers });
            }
        } else if (message.command === 'focusQuadrant') {
            switchQuadrant(message.quadrant);
        } else if (message.command === 'mapClicked') {
            const coordsStr = `${message.lng.toFixed(5)}, ${message.lat.toFixed(5)}`;
            mapView.showInspectorPopup(message.lat, message.lng, `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11.5px; padding: 6px; min-width: 220px;">
                    <div style="border-bottom: 1px solid #444; margin-bottom: 8px; padding-bottom: 6px; display: flex; justify-content: center; align-items: center; gap: 8px;">
                        <span style="color:#aaa; font-size: 12px; font-family: monospace;">📍 ${coordsStr}</span>
                        <button onclick="vscode.postMessage({command:'copyToClipboard', text:'[${coordsStr}]'})" style="background:none; border:none; color:#4ec9b0; cursor:pointer;" title="Copy Coordinates">📋</button>
                    </div>
                    <div style="padding: 12px 6px; color:#4ec9b0; font-family: monospace; font-size: 11px; text-align: center;">
                        ⏳ Consultando píxel en Earth Engine...
                    </div>
                </div>
            `);

            if (!runtime || !runtime.isInitialized) {
                await ensureRuntimeInitialized();
            }
            let pyResults: Record<string, any> = {};
            if (runtimePy) {
                try {
                    pyResults = await runtimePy.inspectPixel(message.lat, message.lng);
                } catch (e) {}
            }
            if (runtime && runtime.isInitialized) {
                await runtime.inspectPixel(message.lat, message.lng, pyResults);
            } else {
                const coordsStr = `${message.lng.toFixed(5)}, ${message.lat.toFixed(5)}`;
                const resultsHtml = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11.5px; padding: 4px; min-width: 220px;">` +
                    `<div style="border-bottom: 1px solid #444; margin-bottom: 8px; padding-bottom: 6px; display: flex; justify-content: center; align-items: center; gap: 8px;">` +
                    `<span style="color:#aaa; font-size: 12px; font-family: monospace;">📍 ${coordsStr}</span>` +
                    `<button onclick="vscode.postMessage({command:'copyToClipboard', text:'[${coordsStr}]'})" style="background:none; border:none; color:#4ec9b0; cursor:pointer;" title="Copy Coordinates">📋</button>` +
                    `</div><div style="color: #999; font-style: italic; margin-top: 5px; text-align: center;">No raster data found.</div></div>`;
                mapView.showInspectorPopup(message.lat, message.lng, resultsHtml);
            }
        } else if (message.command === 'copyToClipboard') {
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage('📋 Copiado al portapapeles');
        } else if (message.command === 'flyToGoogleEarth') {
            const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>GEE IDE FlyTo</name>
    <Placemark>
      <name>Inspector Point</name>
      <LookAt>
        <longitude>${message.lng}</longitude>
        <latitude>${message.lat}</latitude>
        <altitude>0</altitude>
        <heading>0</heading>
        <tilt>0</tilt>
        <range>5000</range>
        <altitudeMode>relativeToGround</altitudeMode>
      </LookAt>
      <Point>
        <coordinates>${message.lng},${message.lat},0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
            const path = require('path');
            const os = require('os');
            const fs = require('fs');
            // Generate a unique filename using timestamp to prevent GE "reload" prompts
            const timestamp = Date.now();
            const tempKmlPath = path.join(os.tmpdir(), `gee_ide_flyto_${timestamp}.kml`);
            fs.writeFileSync(tempKmlPath, kmlContent, 'utf8');
            vscode.env.openExternal(vscode.Uri.file(tempKmlPath));
            vscode.window.showInformationMessage(`🌍 GEE IDE: Abriendo en Google Earth Pro Desktop...`);
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
        } else if (message.command === 'insertCode') {
            const codeToInsert = message.code || message.text;
            if (!codeToInsert) {
                vscode.window.showWarningMessage('No hay código para insertar.');
                return;
            }
            await vscode.env.clipboard.writeText(codeToInsert);
            const ed = await getTargetEditor();
            if (ed) {
                await ed.edit(editBuilder => {
                    const pos = ed.selection.active || new vscode.Position(ed.document.lineCount, 0);
                    editBuilder.insert(pos, '\n' + codeToInsert + '\n');
                });
                vscode.window.showInformationMessage('✅ Filtro de grilla insertado en el editor (y copiado al portapapeles).');
            } else {
                vscode.window.showInformationMessage('📋 Código copiado al portapapeles (abre un script para pegarlo con Cmd+V).');
            }
        } else if (message.command === 'syncGeometryImports') {
            if (context && context.workspaceState && Array.isArray(message.layers)) {
                context.workspaceState.update('gee_geometries_backup', message.layers);
            }
            if (runtime && runtime.isInitialized && Array.isArray(message.layers)) {
                runtime.updateGeometryImports(message.layers);
            }
        } else if (message.command === 'insertGeometryCode') {
            const codeToInsert = message.code;
            if (!codeToInsert) {
                vscode.window.showWarningMessage('No hay código de geometrías para insertar.');
                return;
            }
            await vscode.env.clipboard.writeText(codeToInsert);
            const ed = await getTargetEditor();
            if (!ed) {
                vscode.window.showWarningMessage('Abre un archivo de script para insertar las geometrías (el código se copió al portapapeles).');
                return;
            }
            const START_MARKER = '// --- GEE IDE GEOMETRY IMPORTS START ---';
            const END_MARKER = '// --- GEE IDE GEOMETRY IMPORTS END ---';
            const text = ed.document.getText();
            const startIdx = text.indexOf(START_MARKER);
            const endIdx = text.indexOf(END_MARKER);
            const blockContent = `${START_MARKER}\n${codeToInsert}\n${END_MARKER}`;

            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const startPos = ed.document.positionAt(startIdx);
                const endPos = ed.document.positionAt(endIdx + END_MARKER.length);
                await ed.edit(editBuilder => {
                    editBuilder.replace(new vscode.Range(startPos, endPos), blockContent);
                });
                vscode.window.showInformationMessage('🔄 Declaraciones de geometría actualizadas en el script (Smart Replace).');
            } else {
                await ed.edit(editBuilder => {
                    editBuilder.insert(new vscode.Position(0, 0), blockContent + '\n\n');
                });
                vscode.window.showInformationMessage('📥 Declaraciones de geometría insertadas al inicio del script.');
            }
        }
    });

    aiView.onMessage(async (message: any) => {
        if (message.command === 'focusQuadrant') {
            switchQuadrant(message.quadrant);
        } else if (message.command === 'getTasks') {
            if (!runtime || !runtime.isInitialized) {
                await ensureRuntimeInitialized();
            }
            if (runtime && runtime.isInitialized) {
                const rt = runtime;
                const fetchTasks = () => Promise.race([
                    rt.getTasks(),
                    new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('Timeout al consultar tareas (red lenta)')), 45000))
                ]);
                try {
                    let tasks: any[];
                    try {
                        tasks = await fetchTasks();
                    } catch (first) {
                        tasks = await fetchTasks(); // one automatic retry
                    }
                    taskNotifier.feedTasks(tasks);
                    aiView.sendMessage({ command: 'tasksData', tasks: tasks });
                } catch (e: any) {
                    aiView.sendMessage({ command: 'tasksData', error: e.message });
                }
            } else {
                aiView.sendMessage({ command: 'tasksData', error: 'not_initialized' });
            }
        } else if (message.command === 'cancelTask') {
            if (runtime && runtime.isInitialized) {
                try {
                    await runtime.cancelTask(message.taskId);
                    vscode.window.showInformationMessage(`Tarea ${message.taskId} cancelada.`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Error al cancelar tarea: ${e.message}`);
                }
            }
        } else if (message.command === 'copyToClipboard') {
            vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage(`Copiado al portapapeles: ${message.text}`);
        } else if (message.command === 'insertInEditor') {
            let editor = vscode.window.activeTextEditor;
            if (!editor && lastActiveEditor && !lastActiveEditor.document.isClosed) {
                editor = lastActiveEditor;
            }
            if (!editor) {
                editor = vscode.window.visibleTextEditors.find(e => !e.document.isClosed && !e.document.uri.scheme.includes('output') && !e.document.uri.scheme.includes('ai'));
            }
            let targetDoc = editor ? editor.document : undefined;
            if (!targetDoc) {
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (tab.input instanceof vscode.TabInputText) {
                            const found = vscode.workspace.textDocuments.find(d => d.uri.toString() === (tab.input as vscode.TabInputText).uri.toString());
                            if (found && !found.isClosed) {
                                targetDoc = found;
                                break;
                            }
                        }
                    }
                    if (targetDoc) break;
                }
            }
            if (!targetDoc) {
                targetDoc = vscode.workspace.textDocuments.find(d => !d.isClosed && (d.fileName.endsWith('.gee') || d.fileName.endsWith('.js') || d.fileName.endsWith('.py') || d.fileName.endsWith('.r')));
            }

            if (targetDoc) {
                try {
                    const ed = await vscode.window.showTextDocument(targetDoc, vscode.ViewColumn.One, false);
                    const assetSnippet = `'${message.text}'`;
                    await ed.edit(editBuilder => {
                        if (ed.selection.isEmpty) {
                            editBuilder.insert(ed.selection.active, assetSnippet);
                        } else {
                            editBuilder.replace(ed.selection, assetSnippet);
                        }
                    });
                    vscode.window.showInformationMessage(`Asset insertado en el editor: ${assetSnippet}`);
                } catch (e: any) {
                    vscode.env.clipboard.writeText(`'${message.text}'`);
                    vscode.window.showInformationMessage(`Copiado al portapapeles: '${message.text}'`);
                }
            } else {
                vscode.env.clipboard.writeText(`'${message.text}'`);
                vscode.window.showInformationMessage(`Copiado al portapapeles: '${message.text}'`);
            }
        } else if (message.command === 'addProject') {
            const input = await vscode.window.showInputBox({
                prompt: 'Ingresa el ID del Cloud Project o ruta de Asset Legacy',
                placeHolder: 'ej. ee-mi-proyecto, projects/mi-proyecto o users/mi-usuario'
            });
            if (input && input.trim()) {
                const clean = input.trim();
                const config = vscode.workspace.getConfiguration('gee-pro');
                const existingRoots: string[] = config.get<string[]>('assetRoots', []) || [];
                if (!existingRoots.includes(clean)) {
                    const updated = [...existingRoots, clean];
                    await config.update('assetRoots', updated, vscode.ConfigurationTarget.Global);
                }
                if (runtime) {
                    runtime.addAssetRoot(clean);
                    const assets = await runtime.getAssetsApi('~');
                    aiView.sendMessage({ command: 'assetsData', assets, parent: '~' });
                    vscode.window.showInformationMessage(`Proyecto agregado a Assets: ${clean}`);
                }
            }
        } else if (message.command === 'openExternal') {
            vscode.env.openExternal(vscode.Uri.parse(message.url));
        } else if (message.command === 'createFolder') {
            if (runtime && runtime.isInitialized) {
                const roots = runtime.getAssetRootsList();
                const quickPickItems = roots.map(r => ({
                    label: `📁 ${r.shortName || r.id.split('/').pop()}`,
                    description: r.id,
                    rootId: r.id
                }));

                // If we have an active path, add it to the top so they can create a folder inside the current selection
                if (message.activePath && !roots.find(r => r.id === message.activePath)) {
                    quickPickItems.unshift({
                        label: `📁 ${message.activePath.split('/').pop()} (Current)`,
                        description: message.activePath,
                        rootId: message.activePath
                    });
                }

                vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: '1. Selecciona el directorio padre para la nueva carpeta'
                }).then(selection => {
                    if (selection) {
                        const parentPath = selection.rootId;
                        const defaultPath = parentPath + '/nueva_carpeta';
                        
                        vscode.window.showInputBox({ 
                            prompt: '2. Ruta completa de la nueva carpeta', 
                            value: defaultPath,
                            valueSelection: defaultPath ? [defaultPath.lastIndexOf('/') + 1, defaultPath.length] : undefined
                        }).then(async val => {
                            if (val) {
                                try {
                                    let finalVal = val;
                                    if (!val.includes('/') && defaultPath) {
                                        finalVal = defaultPath.substring(0, defaultPath.lastIndexOf('/')) + '/' + val;
                                    }
                                    await runtime!.createFolderApi(finalVal);
                                    vscode.window.showInformationMessage(`Carpeta ${finalVal} creada exitosamente.`);
                                    aiView.sendMessage({ command: 'assetDeleted' }); // Reuses refresh
                                } catch (e: any) {
                                    vscode.window.showErrorMessage('Error al crear folder: ' + e.message);
                                }
                            }
                        });
                    }
                });
            }
        } else if (message.command === 'getAssetDetails') {
            if (runtime && runtime.isInitialized) {
                try {
                    const details = await runtime.getAssetDetailsApi(message.assetId);
                    aiView.sendMessage({ command: 'assetDetailsData', details, assetId: message.assetId });
                } catch (e: any) {
                    vscode.window.showErrorMessage('Error al obtener detalles: ' + e.message);
                }
            }
        } else if (message.command === 'getAssets') {
            if (!runtime || !runtime.isInitialized) {
                await ensureRuntimeInitialized();
            }
            if (runtime && runtime.isInitialized) {
                const rt = runtime;
                const parent = message.parent || '~';
                try {
                    if (message.refresh && typeof rt.clearQuotaCache === 'function') {
                        rt.clearQuotaCache();
                    }
                    const assets: any[] = await Promise.race([
                        rt.getAssetsApi(parent),
                        new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('Timeout al consultar assets (red lenta)')), 45000))
                    ]);
                    aiView.sendMessage({ command: 'assetsData', assets, parent });

                    if (parent === '~') {
                        // Stream quotas one by one (never blocks the tree)
                        const streamQuotas = (list: any[]) => {
                            for (const a of list) {
                                if (a && a.isRoot && !a.quota) {
                                    rt.getAssetQuota(a.id).then((q: any) => {
                                        if (q) aiView.sendMessage({ command: 'assetQuota', id: a.id, quota: q });
                                    }).catch(() => {});
                                }
                            }
                        };
                        streamQuotas(assets);

                        // Discover extra Cloud projects (once per session); re-render roots if new ones appear
                        rt.discoverCloudProjectRoots().then(async (added: boolean) => {
                            if (!added) return;
                            const updated = await rt.getAssetsApi('~');
                            aiView.sendMessage({ command: 'assetsData', assets: updated, parent: '~' });
                            streamQuotas(updated);
                        }).catch(() => {});
                    }
                } catch (e: any) {
                    aiView.sendMessage({ command: 'assetsData', error: e.message, parent });
                }
            } else {
                aiView.sendMessage({ command: 'assetsData', error: 'not_initialized' });
            }
        } else if (message.command === 'deleteAsset') {
            if (runtime && runtime.isInitialized) {
                vscode.window.showWarningMessage(`¿Estás seguro de eliminar el asset '${message.assetId}' de Earth Engine permanentemente?`, 'Sí, Eliminar', 'Cancelar').then(async selection => {
                    if (selection === 'Sí, Eliminar') {
                        try {
                            await runtime!.deleteAssetApi(message.assetId);
                            vscode.window.showInformationMessage(`Asset eliminado: ${message.assetId}`);
                            aiView.sendMessage({ command: 'assetDeleted' });
                        } catch (e: any) {
                            vscode.window.showErrorMessage('Error al eliminar asset: ' + e.message);
                        }
                    }
                });
            }
        }
    });

    // Auto-reconnect webview panels across window reloads
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer('geeConsole', {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, _state: any) {
                logStep('Migrating old geeConsole webview to native terminal...');
                const targetColumn = webviewPanel.viewColumn || vscode.ViewColumn.Two;
                try {
                    webviewPanel.dispose();
                } catch (e) {}
                await consoleView.show(targetColumn, false);
            }
        }),
        vscode.window.registerWebviewPanelSerializer('geeMap', {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                logStep('Deserializing geeMap webview panel');
                if (mapView.isCreated) {
                    webviewPanel.dispose();
                    return;
                }
                webviewPanel.webview.options = { enableScripts: true };
                mapView.attachPanel(webviewPanel);
            }
        }),
        vscode.window.registerWebviewPanelSerializer('geeTasks', {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                logStep('Deserializing geeTasks webview panel');
                if (aiView.isCreated) {
                    webviewPanel.dispose();
                    return;
                }
                webviewPanel.webview.options = { enableScripts: true };
                aiView.attachPanel(webviewPanel);
            }
        }),
        vscode.window.registerWebviewPanelSerializer('geeAI', {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                logStep('Deserializing legacy geeAI webview panel');
                if (aiView.isCreated) {
                    webviewPanel.dispose();
                    return;
                }
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
                    mapView.addLayer(cmd.payload.url, cmd.payload.name, cmd.payload.shown, cmd.payload.opacity, cmd.payload.visParams, cmd.payload.isVector);
                } else if (cmd.action === 'setCenter' && mapView) {
                    logStep(`Bridge setCenter: lat=${cmd.payload.lat}, lon=${cmd.payload.lon}, zoom=${cmd.payload.zoom}`);
                    mapView.setCenter(cmd.payload.lat, cmd.payload.lon, cmd.payload.zoom);
                } else if (cmd.action === 'clear' && mapView) {
                    logStep('Bridge clear map');
                    mapView.clear();
                } else if (cmd.action === 'cli') {
                    logStep(`Bridge CLI command: ${cmd.payload?.command}`);
                    if (!runtime) {
                        const { GEERuntime } = require('./geeRuntime');
                        runtime = new GEERuntime(consoleView, mapView);
                        runtime!.setSnippetsManager(snippetsManager);
                    }
                    if (runtime && cmd.payload?.command) {
                        runtime.handleCommand(cmd.payload.command);
                    }
                } else if (cmd.action === 'viewObject' && mapView) {
                    mapView.showObjectViewer(cmd.payload?.name || 'Objeto', cmd.payload?.data);
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
        if (runtime && runtime!.isInitialized) {
            attachTaskNotifierToRuntime(runtime);
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

                let savedJson = await context.secrets.get('gee-pro.credentials');
                logStep(`Credentials from secrets: ${savedJson ? 'FOUND' : 'NOT FOUND'}`);

                if (!savedJson) {
                    const credPath = path.join(os.homedir(), '.config', 'earthengine', 'credentials');
                    if (fs.existsSync(credPath)) {
                        try {
                            const raw = fs.readFileSync(credPath, 'utf8');
                            const cliCreds = JSON.parse(raw);
                            if (cliCreds && cliCreds.refresh_token) {
                                const { CLIENT_ID, CLIENT_SECRET } = require('./config');
                                const fullCreds = { ...cliCreds, client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
                                const freshTokens = await refreshAccessToken(fullCreds.refresh_token);
                                const readyCreds = { ...fullCreds, ...freshTokens };
                                if (readyCreds.access_token) {
                                    try {
                                        const uInfo = await getUserInfo(readyCreds.access_token);
                                        if (uInfo && uInfo.email) readyCreds.email = uInfo.email;
                                    } catch (e) {}
                                }
                                savedJson = JSON.stringify(readyCreds);
                                await context.secrets.store('gee-pro.credentials', savedJson);
                                logStep('Auto-restored GEE session from ~/.config/earthengine/credentials');
                            }
                        } catch (e) {}
                    }
                }

                if (savedJson) {
                    logStep('Loading GEE session...');
                    let creds = JSON.parse(savedJson);

                    if (creds.refresh_token && !creds.private_key) {
                        try {
                            logStep('Refreshing access token...');
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
                    rt.setCatalogManager(catalogManager);
                    const userRoots = vscode.workspace.getConfiguration('gee-pro').get<string[]>('assetRoots', []);
                    if (userRoots && userRoots.length > 0) {
                        rt.setUserConfiguredRoots(userRoots);
                    }
                    await rt.initialize(creds);
                    runtime = rt;
                    attachTaskNotifierToRuntime(rt);

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

                    runtimePy = new GEERuntimePy(consoleView, creds.access_token || '', activeProject || '', context.globalStorageUri.fsPath, bridgePort, creds.refresh_token || '');
                    runtimeR = new GEERuntimeR(consoleView, creds.access_token || '', activeProject || '', bridgePort);
                    runtimePy.getPythonExecutable().then(py => {
                        if (py && runtimeR) runtimeR.setPythonPath(py);
                    });
                    await displaySessionBanner(consoleView, creds, rt);
                    logStep(`GEE runtime fully initialized with project '${activeProject || 'none'}' & banner displayed`);
                    if (aiView.isCreated) { aiView.sendMessage({ command: 'assetDeleted' }); }
                    return true;
                } else {
                    logStep('No credentials stored, prompt user to login');
                    if (!runtime) {
                        const { GEERuntime } = require('./geeRuntime');
                        runtime = new GEERuntime(consoleView, mapView);
                        runtime!.setSnippetsManager(snippetsManager);
                        runtime!.setCatalogManager(catalogManager);
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
                    if (tab.input instanceof vscode.TabInputWebview) {
                        const vt = (tab.input.viewType || '').toLowerCase();
                        const label = (tab.label || '').toLowerCase();
                        if (vt.includes('gee') || label.includes('gee map') || label.includes('gee console') || label.includes('gee tools') || label.includes('gee ai')) {
                            tabsToClose.push(tab);
                        }
                    } else if (tab.input instanceof vscode.TabInputText) {
                        if (tab.input.uri.fsPath.endsWith('welcome_to_gee_ide.gee')) {
                            tabsToClose.push(tab);
                        }
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
        const panelsExist = consoleView.isCreated || mapView.isCreated || aiView.isCreated;
        
        if (!panelsExist) {
            // Close any dormant tabs just in case
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

        // Close any duplicate demo tabs located outside Column One
        try {
            const demoTabsToClose: vscode.Tab[] = [];
            for (const group of vscode.window.tabGroups.all) {
                if (group.viewColumn !== vscode.ViewColumn.One) {
                    for (const tab of group.tabs) {
                        if (tab.input instanceof vscode.TabInputText && 
                            tab.input.uri.fsPath.endsWith('welcome_to_gee_ide.gee')) {
                            demoTabsToClose.push(tab);
                        }
                    }
                }
            }
            if (demoTabsToClose.length > 0) {
                await vscode.window.tabGroups.close(demoTabsToClose);
            }
        } catch (e) {}

        // 2. Open the demo script strictly on Top-Left (Column One)
        const demoPath = vscode.Uri.file(context.asAbsolutePath('demos/welcome_to_gee_ide.gee'));
        const doc = await vscode.workspace.openTextDocument(demoPath);
        await detectAndSetGeeLanguage(doc);
        
        if (!panelsExist) {
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
            consoleView.show(vscode.ViewColumn.Two);
            mapView.show(vscode.ViewColumn.Three);
            aiView.show(vscode.ViewColumn.Four);
        } else {
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
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
                    await runtime!.initialize(creds);
                    const bridgePort = await ensureBridgeServer();
                    runtimePy = new GEERuntimePy(consoleView, creds.access_token || '', creds.project_id || '', context.globalStorageUri.fsPath, bridgePort, creds.refresh_token || '');
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
                    const activeProj = existingCreds.project_id || (runtime ? runtime!.getProjectId() : '') || 'Default Project';
                    
                    const choice = await vscode.window.showInformationMessage(
                        `You already have an active GEE session as ${email} (Project: ${activeProj}).`,
                        'Keep Current Session',
                        'Switch Account / Re-login'
                    );

                    if (choice !== 'Switch Account / Re-login') {
                        if (consoleView) {
                            consoleView.append(`ℹ️ Active session maintained for: ${email}`);
                        }
                        await ensureRuntimeInitialized(true);
                        return;
                    }

                    // User selected Switch Account: perform a clean teardown of prior session
                    if (consoleView) consoleView.append('Switching account: clearing previous session...');
                    await context.secrets.delete('gee-pro.credentials');
                    if (fs.existsSync(credPath)) {
                        try { fs.unlinkSync(credPath); } catch (e) {}
                    }
                    if (runtime) runtime!.reset(true);
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
                            runtime!.setSnippetsManager(snippetsManager);
                            runtime!.setCatalogManager(catalogManager);
                        }

                        await runtime!.initialize(readyCreds);
                        attachTaskNotifierToRuntime(runtime);
                        const bridgePort = await ensureBridgeServer();
                        runtimePy = new GEERuntimePy(consoleView, readyCreds.access_token || '', readyCreds.project_id || '', context.globalStorageUri.fsPath, bridgePort, readyCreds.refresh_token || '');
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
                runtime!.setSnippetsManager(snippetsManager);
                runtime!.setCatalogManager(catalogManager);
            }

            await runtime!.initialize(tokenData);
            attachTaskNotifierToRuntime(runtime);
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
                            runtime!.getAssetRootsList(),
                            tokenData.email
                        );
                        if (detected) {
                            activeProject = detected;
                        }
                    } catch (e) {}
                }
                if (activeProject && activeProject !== 'gee-pro-default' && activeProject !== 'PeruREDD') {
                    tokenData.project_id = activeProject;
                    runtime!.setProjectId(activeProject);
                    await runtime!.loadAssetRoots(tokenData.email);
                }
                const bridgePort = await ensureBridgeServer();
                runtimePy = new GEERuntimePy(consoleView, tokenData.access_token || '', activeProject || '', context.globalStorageUri.fsPath, bridgePort, tokenData.refresh_token || '');
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
            runtime!.reset(true);
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
        const editor = (await getTargetEditor()) || vscode.window.activeTextEditor;
        if (editor) {
            const code = editor.document.getText();
            const langId = editor.document.languageId;
            if (consoleView) {
                (consoleView as any).setPromptActive(false);
                consoleView.append('----------------------------------------');
                consoleView.append(`Running full script [${langId.toUpperCase()}]...`);
                const docName = path.basename(editor.document.fileName);
                consoleView.appendHistory(`// Run full script: ${docName}`);
            }
            
            if (langId === 'python') {
                const port = await ensureBridgeServer();
                if (!runtimePy) {
                    await ensureRuntimeInitialized();
                }
                if (!runtimePy) {
                    runtimePy = new GEERuntimePy(consoleView, '', '', context.globalStorageUri.fsPath, port);
                }
                if (mapView) mapView.show(vscode.ViewColumn.Three);
                if (/export/i.test(code)) {
                    const match = code.match(/description\s*[:=]\s*['"]([^'"]+)['"]/i);
                    const desc = match ? match[1] : undefined;
                    taskNotifier.wakeUp(desc);
                    if (aiView && aiView.isCreated) {
                        aiView.sendMessage({ command: 'taskStarting', description: desc });
                    }
                }
                const activeFilePath = editor.document.isUntitled ? undefined : editor.document.fileName;
                runtimePy.execute(code, activeFilePath).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
                return;
            }

            if (langId === 'r') {
                const port = await ensureBridgeServer();
                if (!runtimeR) {
                    runtimeR = new GEERuntimeR(consoleView, '', '', port);
                }
                if (mapView) mapView.show(vscode.ViewColumn.Three);
                if (/export/i.test(code)) {
                    const match = code.match(/description\s*[:=]\s*['"]([^'"]+)['"]/i);
                    const desc = match ? match[1] : undefined;
                    taskNotifier.wakeUp(desc);
                    if (aiView && aiView.isCreated) {
                        aiView.sendMessage({ command: 'taskStarting', description: desc });
                    }
                }
                runtimeR.execute(code).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
                return;
            }

            if (!runtime || !runtime!.isInitialized) {
                await ensureRuntimeInitialized();
            }
            if (runtime) {
                runtime!.execute(code, true).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
            }
        }
    });

    let resetCommand = vscode.commands.registerCommand('gee-pro.reset', () => {
        if (runtime) {
            runtime!.reset(true);
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

    function isLineInCommentOrBlank(document: vscode.TextDocument, lineIdx: number, langId: string): boolean {
        if (lineIdx >= document.lineCount) return false;
        const text = document.lineAt(lineIdx).text.trim();
        if (text.length === 0) return true;

        if (langId === 'python' || langId === 'r') {
            if (text.startsWith('#')) return true;
        }
        if (langId === 'javascript' || langId === 'gee') {
            if (text.startsWith('//')) return true;
        }

        // Multi-line block comments and docstrings detection
        let inPyTripleDouble = false;
        let inPyTripleSingle = false;
        let inJsBlock = false;

        for (let i = 0; i <= lineIdx; i++) {
            const line = document.lineAt(i).text.trim();
            if (line.length === 0) continue;

            if (langId === 'python') {
                if (line.startsWith('#')) continue;

                if (inPyTripleDouble) {
                    if (i === lineIdx) return true;
                    if (line.includes('"""')) {
                        inPyTripleDouble = false;
                    }
                } else if (inPyTripleSingle) {
                    if (i === lineIdx) return true;
                    if (line.includes("'''")) {
                        inPyTripleSingle = false;
                    }
                } else {
                    if (line.startsWith('"""')) {
                        const secondIdx = line.indexOf('"""', 3);
                        if (secondIdx === -1) {
                            inPyTripleDouble = true;
                        }
                        if (i === lineIdx) return true;
                    } else if (line.startsWith("'''")) {
                        const secondIdx = line.indexOf("'''", 3);
                        if (secondIdx === -1) {
                            inPyTripleSingle = true;
                        }
                        if (i === lineIdx) return true;
                    }
                }
            } else if (langId === 'javascript' || langId === 'gee') {
                if (line.startsWith('//')) continue;

                if (inJsBlock) {
                    if (i === lineIdx) return true;
                    if (line.includes('*/')) {
                        inJsBlock = false;
                    }
                } else {
                    if (line.startsWith('/*')) {
                        if (!line.includes('*/', 2)) {
                            inJsBlock = true;
                        }
                        if (i === lineIdx) return true;
                    } else if (line.startsWith('*') || line.startsWith('*/')) {
                        if (i === lineIdx) return true;
                    }
                }
            } else if (langId === 'r') {
                if (line.startsWith('#')) continue;
            }
        }

        return false;
    }

    function isPureCommentOrBlank(code: string, langId: string): boolean {
        const trimmed = code.trim();
        if (trimmed.length === 0) return true;
        if (langId === 'python') {
            if ((trimmed.startsWith('"""') && trimmed.endsWith('"""') && trimmed.length >= 6) ||
                (trimmed.startsWith("'''") && trimmed.endsWith("'''") && trimmed.length >= 6)) {
                return true;
            }
            const lines = trimmed.split('\n');
            if (lines.every(l => { const lt = l.trim(); return lt.length === 0 || lt.startsWith('#'); })) {
                return true;
            }
        } else if (langId === 'javascript' || langId === 'gee') {
            if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) return true;
            const lines = trimmed.split('\n');
            if (lines.every(l => { const lt = l.trim(); return lt.length === 0 || lt.startsWith('//') || lt.startsWith('*'); })) {
                return true;
            }
        } else if (langId === 'r') {
            const lines = trimmed.split('\n');
            if (lines.every(l => { const lt = l.trim(); return lt.length === 0 || lt.startsWith('#'); })) {
                return true;
            }
        }
        return false;
    }

    let runSelectionCommand = vscode.commands.registerCommand('gee-pro.runSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            let code = "";
            let targetLine = selection.active.line;

            // Determine effective language (.gee shebang, extension, or languageId)
            let effectiveLang: 'python' | 'r' | 'javascript' = 'javascript';
            const docLang = editor.document.languageId;
            if (docLang === 'python' || editor.document.fileName.endsWith('.py')) {
                effectiveLang = 'python';
            } else if (docLang === 'r' || editor.document.fileName.endsWith('.r') || editor.document.fileName.endsWith('.R')) {
                effectiveLang = 'r';
            } else if (editor.document.lineCount > 0) {
                const first = editor.document.lineAt(0).text.trim().toLowerCase();
                if (first.startsWith('# py') || first.startsWith('// py') || first.startsWith('#python') || first.startsWith('//python')) {
                    effectiveLang = 'python';
                } else if (first.startsWith('# r') || first.startsWith('// r')) {
                    effectiveLang = 'r';
                }
            }

            if (selection.isEmpty) {
                // SMART SELECTION: Expand to complete block if necessary
                let currentLineIndex = selection.active.line;

                // RStudio-style: Skip comments and blank lines forward to next runnable line
                while (currentLineIndex < editor.document.lineCount && isLineInCommentOrBlank(editor.document, currentLineIndex, effectiveLang)) {
                    currentLineIndex++;
                }
                if (currentLineIndex >= editor.document.lineCount) {
                    return;
                }

                let fullCode = "";
                let isBalanced = false;

                if (effectiveLang === 'python') {
                    // PYTHON SMART SELECTION
                    // 1. Check if current line is a continuation clause (else:, elif ..., except ..., finally:)
                    // If so, rewind to root statement (if, try, for, while) at the exact same indent level
                    const curTrimmed = editor.document.lineAt(currentLineIndex).text.trim();
                    const isContinuationClause = /^(else:|elif\b|except\b|finally:)/.test(curTrimmed);
                    if (isContinuationClause) {
                        const targetIndent = editor.document.lineAt(currentLineIndex).firstNonWhitespaceCharacterIndex;
                        let scanIdx = currentLineIndex - 1;
                        while (scanIdx >= 0) {
                            const pLine = editor.document.lineAt(scanIdx);
                            const pTrim = pLine.text.trim();
                            if (pTrim.length === 0 || pTrim.startsWith('#')) {
                                scanIdx--;
                                continue;
                            }
                            const pIndent = pLine.firstNonWhitespaceCharacterIndex;
                            if (pIndent < targetIndent) break;
                            if (pIndent === targetIndent) {
                                if (/^(if|try|for|while)\b/.test(pTrim)) {
                                    currentLineIndex = scanIdx;
                                    break;
                                }
                            }
                            scanIdx--;
                        }
                    }

                    // 2. Rewind upwards for method chaining, operators, open brackets or decorators
                    while (currentLineIndex > 0) {
                        const curText = editor.document.lineAt(currentLineIndex).text.trim();
                        if (curText.startsWith('.') || curText.startsWith('+') || curText.startsWith('-') || curText.startsWith('*') || curText.startsWith('/') || curText.startsWith(',') || curText.startsWith('\\') || curText.startsWith(')') || curText.startsWith(']') || curText.startsWith('}')) {
                            currentLineIndex--;
                        } else {
                            const prevLine = editor.document.lineAt(currentLineIndex - 1);
                            const prevText = prevLine.text.trim();
                            const isComment = prevText.startsWith('#');
                            const isChainedEnd = prevText.endsWith('\\') || prevText.endsWith(',') || prevText.endsWith('+') || prevText.endsWith('-') || prevText.endsWith('*') || prevText.endsWith('/') || prevText.endsWith('(') || prevText.endsWith('[') || prevText.endsWith('{');
                            if (prevText.length > 0 && !isComment && (isChainedEnd || curText.startsWith('.') || curText.startsWith('(') || curText.startsWith('[') || curText.startsWith('{'))) {
                                currentLineIndex--;
                            } else if (prevText.startsWith('@') && prevLine.firstNonWhitespaceCharacterIndex === editor.document.lineAt(currentLineIndex).firstNonWhitespaceCharacterIndex) {
                                currentLineIndex--;
                            } else {
                                break;
                            }
                        }
                    }

                    // 3. Check if statement starts a compound block (if, elif, else, try, except, finally, for, while, with, def, class, match, @)
                    const startLine = editor.document.lineAt(currentLineIndex);
                    const baseIndent = startLine.firstNonWhitespaceCharacterIndex;
                    const startTrim = startLine.text.trim();
                    const isCompound = startTrim.endsWith(':') || /^(if|elif|else|try|except|finally|for|while|with|def|class|async\s+def|async\s+with|async\s+for|match|@)\b/.test(startTrim);

                    let rootClause = 'other';
                    if (/^if\b/.test(startTrim)) rootClause = 'if';
                    else if (/^try\b/.test(startTrim)) rootClause = 'try';
                    else if (/^(for|while)\b/.test(startTrim)) rootClause = 'loop';

                    // 4. Scan forward balancing brackets and collecting compound statements
                    let stack: string[] = [];
                    fullCode = "";
                    let endIndex = currentLineIndex;

                    while (endIndex < editor.document.lineCount) {
                        const lineText = editor.document.lineAt(endIndex).text;
                        fullCode += lineText + "\n";
                        const trimmed = lineText.trim();

                        const isLineComment = trimmed.startsWith('#');
                        if (!isLineComment) {
                            let inSingle = false;
                            let inDouble = false;
                            for (let i = 0; i < lineText.length; i++) {
                                const ch = lineText[i];
                                if (ch === '#' && !inSingle && !inDouble) break;
                                if (ch === "'" && !inDouble && (i === 0 || lineText[i - 1] !== '\\')) inSingle = !inSingle;
                                else if (ch === '"' && !inSingle && (i === 0 || lineText[i - 1] !== '\\')) inDouble = !inDouble;
                                else if (!inSingle && !inDouble) {
                                    if (ch === '{' || ch === '(' || ch === '[') stack.push(ch);
                                    else if (ch === '}') { if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop(); }
                                    else if (ch === ')') { if (stack.length > 0 && stack[stack.length - 1] === '(') stack.pop(); }
                                    else if (ch === ']') { if (stack.length > 0 && stack[stack.length - 1] === '[') stack.pop(); }
                                }
                            }
                        }

                        if (stack.length === 0) {
                            if (isCompound) {
                                // Peek forward for lines indented deeper than baseIndent OR continuation clauses at baseIndent
                                let peek = endIndex + 1;
                                let keepGoing = false;
                                while (peek < editor.document.lineCount) {
                                    if (isLineInCommentOrBlank(editor.document, peek, effectiveLang)) {
                                        peek++;
                                        continue;
                                    }
                                    const peekLine = editor.document.lineAt(peek);
                                    const peekTrim = peekLine.text.trim();
                                    const peekIndent = peekLine.firstNonWhitespaceCharacterIndex;
                                    if (peekIndent > baseIndent) {
                                        // Still inside the current clause body
                                        keepGoing = true;
                                        break;
                                    }
                                    if (peekIndent === baseIndent) {
                                        // Check for valid compound continuation clauses
                                        if (rootClause === 'if' && /^(elif\b|else:)/.test(peekTrim)) {
                                            keepGoing = true;
                                            break;
                                        }
                                        if (rootClause === 'try' && /^(except\b|else:|finally:)/.test(peekTrim)) {
                                            keepGoing = true;
                                            break;
                                        }
                                        if (rootClause === 'loop' && /^else:/.test(peekTrim)) {
                                            keepGoing = true;
                                            break;
                                        }
                                    }
                                    // Neither deeper indented nor a continuation keyword for this block
                                    break;
                                }

                                if (keepGoing) {
                                    endIndex++;
                                    continue;
                                }
                                isBalanced = true;
                                break;
                            } else {
                                // Expression or statement: check if next non-empty line starts with '.' or if line ends with '\'
                                const isEndChained = trimmed.endsWith('\\') || trimmed.endsWith(',') || trimmed.endsWith('+') || trimmed.endsWith('-') || trimmed.endsWith('*') || trimmed.endsWith('/');
                                let nextIsChained = false;
                                let peek = endIndex + 1;
                                while (peek < editor.document.lineCount) {
                                    const peekText = editor.document.lineAt(peek).text.trim();
                                    if (peekText.length === 0 || peekText.startsWith('#')) {
                                        peek++;
                                        continue;
                                    }
                                    if (peekText.startsWith('.') || isEndChained) {
                                        nextIsChained = true;
                                    }
                                    break;
                                }

                                if (!nextIsChained) {
                                    isBalanced = true;
                                    break;
                                }
                            }
                        }
                        endIndex++;
                    }
                    currentLineIndex = endIndex;
                } else {
                    // JS/R SMART SELECTION (Bracket-based + Fluent Method Chaining + Compound Clauses)
                    // 1. Rewind upwards if current line is a continuation (.filter, $, +, -, %>%, else, catch, finally)
                    while (currentLineIndex > 0) {
                        const curText = editor.document.lineAt(currentLineIndex).text.trim();
                        if (curText.startsWith('.') || curText.startsWith('+') || curText.startsWith('-') || curText.startsWith('*') || curText.startsWith('/') || curText.startsWith('$') || curText.startsWith('%>%') || curText.startsWith('|>') || curText.startsWith('else') || curText.startsWith('catch') || curText.startsWith('finally')) {
                            currentLineIndex--;
                        } else {
                            const prevText = editor.document.lineAt(currentLineIndex - 1).text.trim();
                            const isComment = prevText.startsWith('//') || prevText.startsWith('/*') || (effectiveLang === 'r' && prevText.startsWith('#'));
                            const isChainedEnd = prevText.endsWith('$') || prevText.endsWith('%>%') || prevText.endsWith('|>') || prevText.endsWith('+') || prevText.endsWith(',') || prevText.endsWith('\\');
                            if (prevText.length > 0 && !isComment &&
                                (isChainedEnd || (!prevText.endsWith(';') && !prevText.endsWith('{') && !prevText.endsWith('}') &&
                                (curText.startsWith('.') || curText.startsWith('$') || curText.startsWith('(') || curText.startsWith('['))))) {
                                currentLineIndex--;
                            } else {
                                break;
                            }
                        }
                    }

                    // 2. Collect lines forward until brackets match, chained calls finish, and compound clauses (else, catch, finally) are included
                    let stack: string[] = [];
                    fullCode = "";
                    let endIndex = currentLineIndex;

                    while (endIndex < editor.document.lineCount) {
                        const lineText = editor.document.lineAt(endIndex).text;
                        fullCode += lineText + "\n";
                        const trimmed = lineText.trim();

                        const isLineComment = trimmed.startsWith('//') || trimmed.startsWith('/*') || (effectiveLang === 'r' && trimmed.startsWith('#'));
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
                            const isEndChained = trimmed.endsWith('$') || trimmed.endsWith('%>%') || trimmed.endsWith('|>') || trimmed.endsWith('+') || trimmed.endsWith(',');
                            if (isEndChained || !trimmed.endsWith(';') || trimmed.endsWith('}')) {
                                let peek = endIndex + 1;
                                while (peek < editor.document.lineCount) {
                                    if (isLineInCommentOrBlank(editor.document, peek, effectiveLang)) {
                                        peek++;
                                        continue;
                                    }
                                    const peekText = editor.document.lineAt(peek).text.trim();
                                    if (peekText.startsWith('.') || peekText.startsWith('$') || peekText.startsWith('+') || peekText.startsWith('-') || peekText.startsWith('*') || peekText.startsWith('/') || peekText.startsWith('%>%') || peekText.startsWith('|>') || isEndChained || /^(else\b|catch\b|finally\b)/.test(peekText)) {
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
                targetLine = selection.end.line;
            }

            if (isPureCommentOrBlank(code, effectiveLang)) {
                let nextLine = targetLine + 1;
                while (nextLine < editor.document.lineCount && isLineInCommentOrBlank(editor.document, nextLine, effectiveLang)) {
                    nextLine++;
                }
                if (nextLine < editor.document.lineCount) {
                    const newPos = new vscode.Position(nextLine, 0);
                    editor.selection = new vscode.Selection(newPos, newPos);
                    editor.revealRange(new vscode.Range(newPos, newPos));
                }
                return;
            }
            
            const view = consoleView;
            
            if (view) {
                (view as any).setPromptActive(false);
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
            const firstWord = trimmedCode.replace(/^!|^gee>\s*/, '').trim().split(/\s+/)[0];
            const isKnownCli = ['ls', 'dir', 'pwd', 'cd', 'mkdir', 'rm', 'rmdir', 'cp', 'mv', 'find', 'catalog', 'search', 'du', 'quota', 'history', 'clear', 'cls', 'touch', 'vars', 'objects', 'snippets', 'indices', 'index'].includes(firstWord);
            const isExplicitCli = trimmedCode.startsWith('!') || trimmedCode.startsWith('gee>') || (trimmedCode.startsWith('/') && !trimmedCode.startsWith('//') && !trimmedCode.startsWith('/*'));

            if (isExplicitCli || (isKnownCli && !trimmedCode.includes(';') && !trimmedCode.includes('=') && !trimmedCode.includes('('))) {
                if (!runtime) {
                    const { GEERuntime } = require('./geeRuntime');
                    runtime = new GEERuntime(consoleView, mapView);
                    runtime!.setSnippetsManager(snippetsManager);
                }
                if (!runtime!.isInitialized) {
                    await ensureRuntimeInitialized();
                }
                const cliCmd = trimmedCode.replace(/^!|^gee>\s*|^\//, (m) => m === '/' ? '/' : '').trim();
                await runtime!.handleCommand(cliCmd);
                if (consoleView) consoleView.append('gee> ');
            } else if (trimmedCode.startsWith('?') || trimmedCode.startsWith('help ') || trimmedCode === 'help') {
                if (!runtime) {
                    const { GEERuntime } = require('./geeRuntime');
                    runtime = new GEERuntime(consoleView, mapView);
                    runtime!.setSnippetsManager(snippetsManager);
                }
                const query = trimmedCode.startsWith('?') ? trimmedCode.substring(1).trim() : trimmedCode.replace(/^help\s*/, '').trim();
                runtime!.showHelp(query);
                if (consoleView) consoleView.append('gee> ');
            } else if (effectiveLang === 'python') {
                const port = await ensureBridgeServer();
                if (!runtimePy) {
                    await ensureRuntimeInitialized();
                }
                if (!runtimePy) {
                    runtimePy = new GEERuntimePy(consoleView, '', '', context.globalStorageUri.fsPath, port);
                }
                if (/export/i.test(code)) {
                    const match = code.match(/description\s*[:=]\s*['"]([^'"]+)['"]/i);
                    const desc = match ? match[1] : undefined;
                    taskNotifier.wakeUp(desc);
                    if (aiView && aiView.isCreated) {
                        aiView.sendMessage({ command: 'taskStarting', description: desc });
                    }
                }
                const activeFilePath = editor.document.isUntitled ? undefined : editor.document.fileName;
                runtimePy.executeLine(code, activeFilePath).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
            } else if (effectiveLang === 'r') {
                const port = await ensureBridgeServer();
                if (!runtimeR) {
                    runtimeR = new GEERuntimeR(consoleView, '', '', port);
                }
                if (/export/i.test(code)) {
                    const match = code.match(/description\s*[:=]\s*['"]([^'"]+)['"]/i);
                    const desc = match ? match[1] : undefined;
                    taskNotifier.wakeUp(desc);
                    if (aiView && aiView.isCreated) {
                        aiView.sendMessage({ command: 'taskStarting', description: desc });
                    }
                }
                runtimeR.executeLine(code).then(() => {
                    if (consoleView) consoleView.append('gee> ');
                });
            } else {
                if (!runtime || !runtime!.isInitialized) {
                    await ensureRuntimeInitialized();
                }
                if (runtime) {
                    runtime!.execute(code).then(() => {
                        if (consoleView) consoleView.append('gee> ');
                    });
                }
            }

            let nextLine = targetLine + 1;
            while (nextLine < editor.document.lineCount && isLineInCommentOrBlank(editor.document, nextLine, effectiveLang)) {
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
        const current = (runtime ? runtime!.getProjectId() : '') || 'PeruREDD';
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
                runtime!.setProjectId(clean);
                await runtime!.loadAssetRoots();
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

    let focusEditorCommand = vscode.commands.registerCommand('gee-pro.focusEditor', async () => {
        await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        const activeEd = vscode.window.activeTextEditor;
        if (!activeEd || activeEd.viewColumn !== vscode.ViewColumn.One) {
            let targetDoc = lastActiveEditor && !lastActiveEditor.document.isClosed ? lastActiveEditor.document : undefined;
            if (!targetDoc) {
                targetDoc = vscode.workspace.textDocuments.find(d => !d.isClosed && (d.fileName.endsWith('.gee') || d.fileName.endsWith('.js') || d.fileName.endsWith('.py') || d.fileName.endsWith('.r')));
            }
            if (targetDoc) {
                await vscode.window.showTextDocument(targetDoc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
            } else {
                const demoPath = vscode.Uri.file(context.asAbsolutePath('demos/welcome_to_gee_ide.gee'));
                try {
                    const doc = await vscode.workspace.openTextDocument(demoPath);
                    await detectAndSetGeeLanguage(doc);
                    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
                } catch (e) {}
            }
        }
    });

    let focusConsoleCommand = vscode.commands.registerCommand('gee-pro.focusConsole', async () => {
        await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
        if (consoleView.isCreated) {
            consoleView.focus();
        } else {
            await consoleView.show(vscode.ViewColumn.Two, false);
        }
    });

    let focusMapCommand = vscode.commands.registerCommand('gee-pro.focusMap', async () => {
        await vscode.commands.executeCommand('workbench.action.focusThirdEditorGroup');
        if (mapView.isCreated) {
            mapView.focus();
        } else {
            await mapView.show(vscode.ViewColumn.Three, false);
        }
    });

    const focusQuadrant4 = async () => {
        await vscode.commands.executeCommand('workbench.action.focusFourthEditorGroup');
        if (aiView.isCreated) {
            aiView.focus();
        } else {
            await aiView.show(vscode.ViewColumn.Four, false);
        }
    };
    let focusTasksCommand = vscode.commands.registerCommand('gee-pro.focusTasks', focusQuadrant4);
    let focusAICommand = vscode.commands.registerCommand('gee-pro.focusAI', focusQuadrant4);

    let clearConsoleCommand = vscode.commands.registerCommand('gee-pro.clearConsole', () => {
        consoleView.clear();
    });

    let openLogFileCommand = vscode.commands.registerCommand('gee-pro.openLogFile', async () => {
        await consoleView.openLogFile();
    });

    const logStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    logStatusBarItem.command = 'gee-pro.openLogFile';
    logStatusBarItem.text = '$(output) GEE Log';
    logStatusBarItem.tooltip = 'Abrir archivo gee_console.log (Historial de salidas y errores)';
    logStatusBarItem.show();
    context.subscriptions.push(openLogFileCommand, logStatusBarItem);

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

    let searchCatalogCommand = vscode.commands.registerCommand('gee-pro.searchCatalog', async () => {
        await catalogManager.showCatalogQuickPick();
    });

    let insertSpectralIndexCommand = vscode.commands.registerCommand('gee-pro.insertSpectralIndex', async () => {
        await SpectralIndicesManager.showIndicesQuickPick();
    });

    let openDemosCommand = vscode.commands.registerCommand('gee-pro.openDemos', async () => {
        const demosDir = path.join(context.extensionPath, 'demos');
        if (!fs.existsSync(demosDir)) {
            vscode.window.showErrorMessage('No se encontró la carpeta de demostraciones.');
            return;
        }
        const files = fs.readdirSync(demosDir).filter(f => f.endsWith('.gee'));
        if (files.length === 0) {
            vscode.window.showInformationMessage('No hay demos disponibles en este momento.');
            return;
        }
        
        const fileItems = files.map(f => ({
            label: `$(code) ${f}`,
            description: 'GEE IDE Demo',
            filename: f
        }));
        
        const selected = await vscode.window.showQuickPick(fileItems, {
            placeHolder: 'Selecciona un archivo de demostración para abrir...'
        });
        
        if (selected) {
            const filePath = path.join(demosDir, selected.filename);
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(doc);
        }
    });

    let openProjectCommand = vscode.commands.registerCommand('gee-pro.openProject', async () => {
        await projectManager.openExistingProject();
    });

    let newProjectCommand = vscode.commands.registerCommand('gee-pro.newProject', async () => {
        await projectManager.createNewProject();
    });

    let openProjectSettingsCommand = vscode.commands.registerCommand('gee-pro.openProjectSettings', async () => {
        await projectManager.showProjectMenu();
    });

    let setProjectMapCenterCommand = vscode.commands.registerCommand('gee-pro.setProjectMapCenter', async () => {
        const current = projectManager.getCurrentProject();
        if (!current) {
            vscode.window.showWarningMessage('No hay un proyecto GEE activo en este espacio de trabajo.');
            return;
        }
        const coordsInput = await vscode.window.showInputBox({
            prompt: 'Ingresa Longitud, Latitud, Zoom para guardar como vista predeterminada de este proyecto',
            value: current.map ? `${current.map.center[0]}, ${current.map.center[1]}, ${current.map.zoom}` : '-75.0, -10.0, 10',
            placeHolder: 'longitud, latitud, zoom'
        });
        if (coordsInput) {
            const parts = coordsInput.split(',').map(s => Number(s.trim()));
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                const zoom = parts.length >= 3 && !isNaN(parts[2]) ? parts[2] : 10;
                await projectManager.setProjectMapCenter(parts[0], parts[1], zoom);
            }
        }
    });

    let exportProjectBundleCommand = vscode.commands.registerCommand('gee-pro.exportProjectBundle', async () => {
        await projectManager.exportProjectBundle();
    });

    let drawPanCommand = vscode.commands.registerCommand('gee-pro.drawPan', () => {
        mapView.setDrawMode('pan');
    });
    let drawPointCommand = vscode.commands.registerCommand('gee-pro.drawPoint', () => {
        mapView.setDrawMode('marker');
    });
    let drawLineCommand = vscode.commands.registerCommand('gee-pro.drawLine', () => {
        mapView.setDrawMode('polyline');
    });
    let drawPolygonCommand = vscode.commands.registerCommand('gee-pro.drawPolygon', () => {
        mapView.setDrawMode('polygon');
    });
    let drawRectCommand = vscode.commands.registerCommand('gee-pro.drawRectangle', () => {
        mapView.setDrawMode('rectangle');
    });

    let setupPythonCommand = vscode.commands.registerCommand('gee-pro.setupPython', async () => {
        const { PythonRuntimeManager } = require('./pythonRuntimeManager');
        const manager = PythonRuntimeManager.getInstance();
        vscode.window.showInformationMessage('GEE IDE: Verificando y configurando entorno científico Python 3.11...');
        const py = await manager.resolvePython(consoleView, true);
        if (py) {
            vscode.window.showInformationMessage(`✅ Entorno Python configurado: ${py}`);
            if (runtimePy) {
                runtimePy.stop();
            }
        }
    });

    context.subscriptions.push(
        startCommand, authCommand, loginCommand, logoutCommand, runCommand, runSelectionCommand, resetCommand, setProjectCommand,
        focusEditorCommand, focusConsoleCommand, focusMapCommand, focusTasksCommand, focusAICommand,
        clearConsoleCommand, saveLayoutCommand, resetLayoutCommand, editSnippetsCommand, listSnippetsCommand,
        searchCatalogCommand, insertSpectralIndexCommand, openDemosCommand,
        openProjectCommand, newProjectCommand, openProjectSettingsCommand, setProjectMapCenterCommand, exportProjectBundleCommand,
        drawPanCommand, drawPointCommand, drawLineCommand, drawPolygonCommand, drawRectCommand, setupPythonCommand
    );
    logStep('>>> ACTIVATE() COMPLETED SUCCESSFULLY — All commands ready');
}

export function deactivate() { }

