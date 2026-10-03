import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface SnippetDefinition {
    prefix: string | string[];
    body: string | string[];
    description?: string;
    scope?: string;
}

export class SnippetsManager {
    private userSnippetsPath: string;
    private userSnippets: Map<string, SnippetDefinition> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        const configDir = path.join(os.homedir(), '.config', 'earthengine');
        try {
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
        } catch (e) {}

        this.userSnippetsPath = path.join(configDir, 'snippets.json');
        this.ensureInitialUserSnippetsFile();
        this.loadUserSnippets();
        this.watchUserSnippets();
    }

    public getUserSnippetsPath(): string {
        return this.userSnippetsPath;
    }

    private ensureInitialUserSnippetsFile() {
        if (!fs.existsSync(this.userSnippetsPath)) {
            const initialTemplate = {
                "_instrucciones": {
                    "descripcion": "GEE IDE: Snippets Personalizados (estilo RStudio)",
                    "sintaxis": "Usa ${1:nombre}, ${2:defecto} para definir dónde salta el cursor con la tecla Tab, y $0 para la posición final."
                },
                "Mi NDVI con Paleta": {
                    "prefix": "myndvi",
                    "body": [
                        "// Cálculo rápido de NDVI y visualización en mapa",
                        "var ${1:ndvi} = ${2:image}.normalizedDifference(['${3:B8}', '${4:B4}']).rename('ndvi');",
                        "Map.addLayer(${1:ndvi}, {min: ${5:0.1}, max: ${6:0.85}, palette: ['blue', 'white', 'green']}, '${7:NDVI Layer}');",
                        "$0"
                    ],
                    "description": "Calcula NDVI y añade la capa con rampa de color al mapa"
                },
                "Filtro Espaciotemporal": {
                    "prefix": "myfilter",
                    "body": [
                        "${1:coleccion}",
                        "  .filterBounds(${2:geometry})",
                        "  .filterDate('${3:2024-01-01}', '${4:2024-12-31}')$0"
                    ],
                    "description": "Filtro rápido de fechas y geometría con saltos de tabulación"
                },
                "Buffer de Geometria": {
                    "prefix": "mybuffer",
                    "body": [
                        "var ${1:bufferGeom} = ${2:geometry}.buffer(${3:1000});",
                        "Map.addLayer(${1:bufferGeom}, {color: '${4:FF0000}'}, '${5:Buffer}');",
                        "$0"
                    ],
                    "description": "Crear un buffer alrededor de una geometría e insertarlo en el mapa"
                }
            };
            try {
                fs.writeFileSync(this.userSnippetsPath, JSON.stringify(initialTemplate, null, 2), 'utf8');
            } catch (e) {}
        }
    }

    public loadUserSnippets() {
        this.userSnippets.clear();
        if (fs.existsSync(this.userSnippetsPath)) {
            try {
                const raw = fs.readFileSync(this.userSnippetsPath, 'utf8');
                const parsed = JSON.parse(raw);
                for (const key of Object.keys(parsed)) {
                    if (key.startsWith('_')) continue; // Skip comments/instructions
                    const item = parsed[key];
                    if (item && item.prefix && item.body) {
                        this.userSnippets.set(key, item);
                    }
                }
            } catch (e) {
                console.error('[GEE IDE] Error parsing user snippets:', e);
            }
        }
    }

    private watchUserSnippets() {
        try {
            fs.watchFile(this.userSnippetsPath, { interval: 1000 }, (curr, prev) => {
                if (curr.mtime !== prev.mtime) {
                    this.loadUserSnippets();
                }
            });
        } catch (e) {}
    }

    public async openUserSnippetsFile() {
        this.ensureInitialUserSnippetsFile();
        try {
            const uri = vscode.Uri.file(this.userSnippetsPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
            vscode.window.showInformationMessage('✏️ GEE IDE: Puedes agregar o modificar tus snippets aquí. Se recargan automáticamente al guardar (Cmd+S / Ctrl+S).');
        } catch (e: any) {
            vscode.window.showErrorMessage(`No se pudo abrir el archivo de snippets: ${e.message}`);
        }
    }

    public getBuiltinSnippets(): Array<{ title: string; prefix: string; description: string; body: string; isCustom: boolean; lang: string }> {
        const result: Array<{ title: string; prefix: string; description: string; body: string; isCustom: boolean; lang: string }> = [];
        const files = [
            { file: 'gee-js.json', lang: 'JavaScript' },
            { file: 'gee-py.json', lang: 'Python' },
            { file: 'gee-r.json', lang: 'R' }
        ];

        for (const item of files) {
            const p = path.join(this.context.extensionPath, 'snippets', item.file);
            if (fs.existsSync(p)) {
                try {
                    const raw = fs.readFileSync(p, 'utf8');
                    const parsed = JSON.parse(raw);
                    for (const key of Object.keys(parsed)) {
                        const s = parsed[key];
                        if (s && s.prefix && s.body) {
                            const prefixes = Array.isArray(s.prefix) ? s.prefix : [s.prefix];
                            const bodyStr = Array.isArray(s.body) ? s.body.join('\n') : s.body;
                            result.push({
                                title: key,
                                prefix: prefixes[0],
                                description: s.description || '',
                                body: bodyStr,
                                isCustom: false,
                                lang: item.lang
                            });
                        }
                    }
                } catch (e) {}
            }
        }
        return result;
    }

    public getAllSnippets(): Array<{ title: string; prefix: string; description: string; body: string; isCustom: boolean; lang?: string }> {
        const list: Array<{ title: string; prefix: string; description: string; body: string; isCustom: boolean; lang?: string }> = [];

        // 1. User custom snippets first
        for (const [title, snippet] of this.userSnippets.entries()) {
            const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
            const bodyStr = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
            list.push({
                title,
                prefix: prefixes.join(', '),
                description: snippet.description || '',
                body: bodyStr,
                isCustom: true,
                lang: 'Personalizado'
            });
        }

        // 2. Builtin snippets
        list.push(...this.getBuiltinSnippets());

        return list;
    }

    public async showSnippetsQuickPick() {
        const snippets = this.getAllSnippets();
        if (snippets.length === 0) {
            vscode.window.showInformationMessage('No hay snippets disponibles.');
            return;
        }

        const items: Array<vscode.QuickPickItem & { snippet: any }> = snippets.map(s => ({
            label: `$(symbol-snippet) ${s.prefix}`,
            description: s.isCustom ? '⭐ [Personalizado]' : `📦 [${s.lang || 'GEE'}]`,
            detail: `${s.title} — ${s.description}`,
            snippet: s
        }));

        items.unshift({
            label: '$(add) + Crear / Editar Snippets Personalizados...',
            description: 'Abrir snippets.json',
            detail: 'Añade tus propias plantillas con saltos de tabulación',
            snippet: null
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Buscar snippet por prefijo, nombre o descripción (ej. eecol, ndvi, mask)...',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selected) return;

        if (!selected.snippet) {
            await this.openUserSnippetsFile();
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await editor.insertSnippet(new vscode.SnippetString(selected.snippet.body));
        } else {
            const action = await vscode.window.showInformationMessage(
                `Snippet '${selected.snippet.prefix}' (${selected.snippet.title}):\n\n${selected.snippet.body}`,
                'Copiar al Portapapeles'
            );
            if (action === 'Copiar al Portapapeles') {
                await vscode.env.clipboard.writeText(selected.snippet.body);
                vscode.window.showInformationMessage('Snippet copiado al portapapeles.');
            }
        }
    }

    public registerSnippetsProvider(): vscode.Disposable {
        const supportedLanguages = [
            { scheme: 'file', language: 'gee' },
            { scheme: 'file', language: 'javascript' },
            { scheme: 'file', language: 'python' },
            { scheme: 'file', language: 'r' },
            { scheme: 'untitled', language: 'gee' },
            { scheme: 'untitled', language: 'javascript' },
            { scheme: 'untitled', language: 'python' },
            { scheme: 'untitled', language: 'r' }
        ];

        return vscode.languages.registerCompletionItemProvider(
            supportedLanguages,
            {
                provideCompletionItems: (document: vscode.TextDocument, position: vscode.Position) => {
                    const items: vscode.CompletionItem[] = [];

                    for (const [title, snippet] of this.userSnippets.entries()) {
                        const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
                        const bodyStr = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;

                        for (const p of prefixes) {
                            const item = new vscode.CompletionItem(p, vscode.CompletionItemKind.Snippet);
                            item.insertText = new vscode.SnippetString(bodyStr);
                            item.detail = `⭐ GEE Snippet: ${title}`;
                            item.documentation = new vscode.MarkdownString(
                                `${snippet.description || title}\n\n*Plantilla con saltos de tabulación (Tab / Shift+Tab)*`
                            );
                            item.sortText = '00_' + p;
                            items.push(item);
                        }
                    }

                    return items;
                }
            }
        );
    }
}
