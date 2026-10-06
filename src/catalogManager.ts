import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface CatalogDataset {
    id: string;
    title: string;
    type: 'image_collection' | 'image' | 'table' | string;
    start: string;
    end: string;
    tags: string[];
    bands: string[];
}

export class CatalogManager {
    private catalog: CatalogDataset[] = [];
    private isLoaded: boolean = false;

    // Common recommendations for widely used deprecated collections
    private static KNOWN_REPLACEMENTS: Record<string, string> = {
        'COPERNICUS/S2': 'COPERNICUS/S2_HARMONIZED (o COPERNICUS/S2_SR_HARMONIZED para Level-2A)',
        'LANDSAT/LC08/C01/T1_SR': 'LANDSAT/LC08/C02/T1_L2 (Collection 2 Tier 1)',
        'LANDSAT/LC08/C01/T1_TOA': 'LANDSAT/LC08/C02/T1_TOA (Collection 2 Tier 1)',
        'LANDSAT/LE07/C01/T1_SR': 'LANDSAT/LE07/C02/T1_L2 (Collection 2 Tier 1)',
        'LANDSAT/LT05/C01/T1_SR': 'LANDSAT/LT05/C02/T1_L2 (Collection 2 Tier 1)',
        'MODIS/006/MOD13Q1': 'MODIS/061/MOD13Q1 (MODIS v061)',
        'MODIS/006/MOD09GA': 'MODIS/061/MOD09GA (MODIS v061)',
        'MODIS/006/MCD12Q1': 'MODIS/061/MCD12Q1 (MODIS v061)',
        'USGS/SRTMGL1_003': 'CGIAR/SRTM90_V4 (o NASA/NASADEM_HGT/001)'
    };

    constructor(private context: vscode.ExtensionContext) {
        this.loadCatalog();
    }

    private loadCatalog() {
        if (this.isLoaded) return;
        try {
            const dataPath = path.join(this.context.extensionPath, 'data', 'ee_catalog.json');
            if (fs.existsSync(dataPath)) {
                const raw = fs.readFileSync(dataPath, 'utf8');
                this.catalog = JSON.parse(raw);
                this.isLoaded = true;
            }
        } catch (e) {
            console.error('[GEE CatalogManager] Error loading catalog:', e);
        }
    }

    public getCatalogCount(): number {
        return this.catalog.length;
    }

    public getAllDatasets(): CatalogDataset[] {
        return this.catalog;
    }

    public isDeprecated(dataset: CatalogDataset): boolean {
        const titleLower = (dataset.title || '').toLowerCase();
        const idLower = (dataset.id || '').toLowerCase();
        const hasTag = (dataset.tags || []).some(t => t.toLowerCase() === 'deprecated');
        return titleLower.includes('deprecated') || idLower.includes('deprecated') || hasTag;
    }

    public getReplacementSuggestion(id: string): string | null {
        if (CatalogManager.KNOWN_REPLACEMENTS[id]) {
            return CatalogManager.KNOWN_REPLACEMENTS[id];
        }
        for (const [key, repl] of Object.entries(CatalogManager.KNOWN_REPLACEMENTS)) {
            if (id.startsWith(key)) {
                return repl;
            }
        }
        return null;
    }

    public search(query: string, typeFilter?: string, limit: number = 25): CatalogDataset[] {
        if (!this.isLoaded) this.loadCatalog();
        const cleanQuery = (query || '').trim().toLowerCase();
        const terms = cleanQuery.split(/\s+/).filter(t => t.length > 0);

        let filtered = this.catalog;
        if (typeFilter) {
            const tf = typeFilter.toLowerCase();
            filtered = filtered.filter(item => {
                const itemType = (item.type || '').toLowerCase();
                if (tf === 'image') return itemType === 'image';
                if (tf === 'collection' || tf === 'image_collection' || tf === 'imagecollection') return itemType === 'image_collection';
                if (tf === 'table' || tf === 'vector' || tf === 'fc') return itemType === 'table';
                return true;
            });
        }

        if (terms.length === 0) {
            // Put non-deprecated first even on empty query
            return filtered
                .slice()
                .sort((a, b) => (this.isDeprecated(a) ? 1 : 0) - (this.isDeprecated(b) ? 1 : 0))
                .slice(0, limit);
        }

        // Score results based on match quality + deprecation penalty
        const scored = filtered.map(item => {
            const idLower = item.id.toLowerCase();
            const titleLower = (item.title || '').toLowerCase();
            const tagsLower = (item.tags || []).map(t => t.toLowerCase());
            const bandsLower = (item.bands || []).map(b => b.toLowerCase());
            const deprecated = this.isDeprecated(item);

            let score = 0;
            let allTermsMatched = true;

            for (const term of terms) {
                let termMatched = false;
                if (idLower === term) {
                    score += 100;
                    termMatched = true;
                } else if (idLower.includes(term)) {
                    score += 40;
                    termMatched = true;
                }

                if (titleLower.includes(term)) {
                    score += 25;
                    termMatched = true;
                }

                if (tagsLower.some(t => t === term)) {
                    score += 20;
                    termMatched = true;
                } else if (tagsLower.some(t => t.includes(term))) {
                    score += 10;
                    termMatched = true;
                }

                if (bandsLower.some(b => b === term || b.includes(term))) {
                    score += 15;
                    termMatched = true;
                }

                if (!termMatched) {
                    allTermsMatched = false;
                }
            }

            // Big penalty for deprecated datasets so active ones always rank first
            if (deprecated) {
                score -= 80;
            }

            // Small boost for modern harmonized or Level-2A/Collection-2 products
            if (idLower.includes('harmonized') || idLower.includes('c02') || idLower.includes('sr_harmonized')) {
                score += 30;
            }

            return { item, score, allTermsMatched };
        });

        return scored
            .filter(s => s.allTermsMatched && s.score > -200)
            .sort((a, b) => b.score - a.score)
            .map(s => s.item)
            .slice(0, limit);
    }

    public generateSnippet(dataset: CatalogDataset, lang: string = 'javascript'): string {
        const isCollection = dataset.type === 'image_collection' || dataset.type === 'collection';
        const isTable = dataset.type === 'table';
        const safeVarName = dataset.id.split('/').pop()?.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'dataset';

        if (lang === 'python') {
            if (isCollection) {
                return `${safeVarName} = ee.ImageCollection('${dataset.id}')`;
            } else if (isTable) {
                return `${safeVarName} = ee.FeatureCollection('${dataset.id}')`;
            } else {
                return `${safeVarName} = ee.Image('${dataset.id}')`;
            }
        } else if (lang === 'r') {
            if (isCollection) {
                return `${safeVarName} <- ee$ImageCollection('${dataset.id}')`;
            } else if (isTable) {
                return `${safeVarName} <- ee$FeatureCollection('${dataset.id}')`;
            } else {
                return `${safeVarName} <- ee$Image('${dataset.id}')`;
            }
        } else {
            // JavaScript default
            if (isCollection) {
                return `var ${safeVarName} = ee.ImageCollection('${dataset.id}');`;
            } else if (isTable) {
                return `var ${safeVarName} = ee.FeatureCollection('${dataset.id}');`;
            } else {
                return `var ${safeVarName} = ee.Image('${dataset.id}');`;
            }
        }
    }

    public async showCatalogQuickPick() {
        if (!this.isLoaded) this.loadCatalog();

        const qp = vscode.window.createQuickPick();
        qp.placeholder = 'Buscar en el catálogo público de Earth Engine (ej. sentinel, modis, srtm, landcover)...';
        qp.matchOnDescription = true;
        qp.matchOnDetail = true;

        const populateItems = (datasets: CatalogDataset[]) => {
            qp.items = datasets.map(d => {
                const isColl = d.type === 'image_collection' || d.type === 'collection';
                const isTab = d.type === 'table';
                const deprecated = this.isDeprecated(d);
                const replacement = this.getReplacementSuggestion(d.id);

                let icon = isColl ? '$(layers)' : (isTab ? '$(table)' : '$(file-media)');
                if (deprecated) {
                    icon = '$(warning)';
                }

                const dateStr = d.start ? ` [${d.start} - ${d.end || 'present'}]` : '';
                const bandsStr = d.bands && d.bands.length > 0 ? ` • Bandas: ${d.bands.slice(0, 6).join(', ')}${d.bands.length > 6 ? '...' : ''}` : '';
                const statusTag = deprecated ? ' ⚠️ [OBSOLETO / DEPRECATED]' : '';
                const replText = (deprecated && replacement) ? ` ➔ Usar: ${replacement}` : '';

                return {
                    label: `${icon} ${d.id}${statusTag}`,
                    description: d.title,
                    detail: `Tipo: ${d.type}${dateStr}${bandsStr}${replText}`,
                    dataset: d
                } as vscode.QuickPickItem & { dataset: CatalogDataset };
            });
        };

        // Initial top datasets (Popular remote sensing datasets)
        const popular = this.search('sentinel landsat modis srtm dem', undefined, 20);
        populateItems(popular.length > 0 ? popular : this.catalog.slice(0, 30));

        qp.onDidChangeValue(val => {
            if (val.trim()) {
                const results = this.search(val.trim(), undefined, 35);
                populateItems(results);
            } else {
                populateItems(this.catalog.slice(0, 30));
            }
        });

        qp.onDidAccept(async () => {
            const selected = qp.selectedItems[0] as (vscode.QuickPickItem & { dataset?: CatalogDataset });
            qp.hide();
            qp.dispose();

            if (selected && selected.dataset) {
                const ds = selected.dataset;
                const editor = vscode.window.activeTextEditor;
                const lang = editor ? editor.document.languageId : 'javascript';
                const snippet = this.generateSnippet(ds, lang);
                const deprecated = this.isDeprecated(ds);
                const replacement = this.getReplacementSuggestion(ds.id);

                let header = `🛰️ ${ds.id}`;
                let messageBody = `${ds.title}\n\nSnippet: ${snippet}`;
                if (deprecated) {
                    header = `⚠️ [OBSOLETO] ${ds.id}`;
                    messageBody = `⚠️ ADVERTENCIA: Este dataset está marcado como OBSOLETO (deprecated) por Earth Engine.\n${replacement ? `Se recomienda usar: ${replacement}\n\n` : '\n'}Snippet: ${snippet}`;
                }

                const action = await vscode.window.showInformationMessage(
                    header,
                    { detail: messageBody },
                    'Insertar en Editor',
                    'Copiar Snippet',
                    'Abrir en Earth Engine Catalog'
                );

                if (action === 'Insertar en Editor') {
                    if (editor) {
                        editor.edit(editBuilder => {
                            editBuilder.insert(editor.selection.active, snippet);
                        });
                        if (deprecated) {
                            vscode.window.showWarningMessage(`⚠️ Has insertado '${ds.id}', que está obsoleto.${replacement ? ` Considera actualizar a: ${replacement}` : ''}`);
                        }
                    } else {
                        await vscode.env.clipboard.writeText(snippet);
                        vscode.window.showInformationMessage(`📋 Snippet copiado: ${snippet}`);
                    }
                } else if (action === 'Copiar Snippet') {
                    await vscode.env.clipboard.writeText(snippet);
                    vscode.window.showInformationMessage(`📋 Snippet copiado: ${snippet}`);
                } else if (action === 'Abrir en Earth Engine Catalog') {
                    // Normalize ID to catalog URL slug
                    const url = `https://developers.google.com/earth-engine/datasets/catalog/${ds.id.replace(/\//g, '_')}`;
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }
        });

        qp.show();
    }
}
