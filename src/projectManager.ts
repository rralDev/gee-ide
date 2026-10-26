import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { MapView } from './views/mapView';
import { ConsoleView } from './views/consoleView';
import { TasksView, AIView } from './views/tasksView';

export interface GeeProjectMapConfig {
    center: [number, number]; // [lng, lat]
    zoom: number;
    baseLayer?: string;
}

export interface GeeProjectRoiConfig {
    file?: string;
    assetId?: string;
}

export interface GeeProjectConfig {
    $schema?: string;
    name: string;
    description?: string;
    version?: string;
    created?: string;
    lastModified?: string;
    author?: string;
    defaultScript?: string;
    defaultLanguage?: 'javascript' | 'python' | 'r';
    map?: GeeProjectMapConfig;
    roi?: GeeProjectRoiConfig;
    settings?: {
        cloudCoverMax?: number;
        autoRestoreSession?: boolean;
    };
}

export class ProjectManager {
    private static instance: ProjectManager;
    private currentProject: GeeProjectConfig | null = null;
    private projectFilePath: string | null = null;
    private statusBarItem: vscode.StatusBarItem;

    private constructor(
        private context: vscode.ExtensionContext,
        private mapView?: MapView,
        private consoleView?: ConsoleView,
        private aiView?: AIView
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'gee-pro.openProjectSettings';
        context.subscriptions.push(this.statusBarItem);
    }

    public static initialize(context: vscode.ExtensionContext, mapView?: MapView, consoleView?: ConsoleView, aiView?: AIView): ProjectManager {
        if (!ProjectManager.instance) {
            ProjectManager.instance = new ProjectManager(context, mapView, consoleView, aiView);
        } else {
            if (mapView) ProjectManager.instance.mapView = mapView;
            if (consoleView) ProjectManager.instance.consoleView = consoleView;
            if (aiView) ProjectManager.instance.aiView = aiView;
        }
        return ProjectManager.instance;
    }

    public static getInstance(): ProjectManager {
        return ProjectManager.instance;
    }

    public getCurrentProject(): GeeProjectConfig | null {
        return this.currentProject;
    }

    public getProjectFilePath(): string | null {
        return this.projectFilePath;
    }

    public isProjectOpen(): boolean {
        return this.currentProject !== null;
    }

    /**
     * Scans active workspace for .geeproj or .geeproj.json and loads it.
     */
    public async loadProject(): Promise<GeeProjectConfig | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.currentProject = null;
            this.projectFilePath = null;
            this.statusBarItem.text = `$(folder-opened) Abrir Proyecto GEE`;
            this.statusBarItem.tooltip = `Haz clic para seleccionar y abrir un proyecto GEE existente o crear uno nuevo`;
            this.statusBarItem.command = 'gee-pro.openProject';
            this.statusBarItem.show();
            return null;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const candidates = ['.geeproj', '.geeproj.json', 'project.geeproj'];

        let foundPath: string | null = null;
        for (const candidate of candidates) {
            const p = path.join(rootPath, candidate);
            if (fs.existsSync(p)) {
                foundPath = p;
                break;
            }
        }

        if (!foundPath) {
            this.currentProject = null;
            this.projectFilePath = null;
            this.statusBarItem.text = `$(folder-opened) Abrir Proyecto GEE`;
            this.statusBarItem.tooltip = `Haz clic para seleccionar y abrir un proyecto GEE existente o crear uno nuevo`;
            this.statusBarItem.command = 'gee-pro.openProject';
            this.statusBarItem.show();
            return null;
        }

        try {
            const raw = fs.readFileSync(foundPath, 'utf8');
            const parsed = JSON.parse(raw) as GeeProjectConfig;
            this.currentProject = parsed;
            this.projectFilePath = foundPath;

            // Update Status Bar
            this.statusBarItem.text = `$(project) GEE: ${parsed.name}`;
            this.statusBarItem.tooltip = `GEE Project: ${parsed.name}\n${parsed.description || 'Proyecto activo de Google Earth Engine'}\nHaz clic para ver configuración (.geeproj)`;
            this.statusBarItem.command = 'gee-pro.openProjectSettings';
            this.statusBarItem.show();

            // Notify Console
            if (this.consoleView) {
                this.consoleView.append(`📁 [GEE Project] Proyecto cargado: ${parsed.name}`);
            }

            // Sync Map Center if defined
            if (parsed.map && Array.isArray(parsed.map.center) && parsed.map.center.length >= 2 && this.mapView) {
                const lng = parsed.map.center[0];
                const lat = parsed.map.center[1];
                const zoom = parsed.map.zoom || 10;
                setTimeout(() => {
                    this.mapView?.sendMessage({
                        command: 'setCenter',
                        lat,
                        lng,
                        zoom
                    });
                }, 400);
            }

            // Close any raw .geeproj tab opened by VS Code
            try {
                vscode.window.tabGroups.all.forEach(group => {
                    group.tabs.forEach(tab => {
                        if (tab.input && (tab.input as any).uri && (tab.input as any).uri.fsPath.endsWith('.geeproj')) {
                            vscode.window.tabGroups.close(tab);
                        }
                    });
                });
            } catch (e) {}

            // Automatically open project main script instead of .geeproj JSON
            setTimeout(() => {
                this.openMainScript().catch(() => {});
            }, 300);

            // Ensure Quadrant 2 (GEE Terminal) is open in Column Two
            if (this.consoleView) {
                setTimeout(() => {
                    this.consoleView?.show(vscode.ViewColumn.Two, true);
                }, 350);
            }

            // Ensure Quadrant 4 (GEE Tools / AI) is populated so Group 4 is never a black void
            if (this.aiView) {
                setTimeout(() => {
                    this.aiView?.show(vscode.ViewColumn.Four, true);
                }, 400);
            }

            // Restore project ROI on the map if roi file exists
            if (parsed.roi && parsed.roi.file && this.mapView) {
                const roiPath = path.isAbsolute(parsed.roi.file) ? parsed.roi.file : path.join(rootPath, parsed.roi.file);
                if (fs.existsSync(roiPath)) {
                    try {
                        const rawRoi = fs.readFileSync(roiPath, 'utf8');
                        const roiGeoJson = JSON.parse(rawRoi);
                        setTimeout(() => {
                            this.mapView?.sendMessage({
                                command: 'highlightFeature',
                                geometry: roiGeoJson
                            });
                        }, 700);
                    } catch (e) {}
                }
            }

            // If autoRestoreSession is true, auto-execute the project script so all variables and map layers are immediately in memory
            if (parsed.settings?.autoRestoreSession !== false) {
                setTimeout(async () => {
                    await this.openMainScript();
                    await vscode.commands.executeCommand('gee-pro.run');
                }, 1000);
            }

            return parsed;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error al leer archivo .geeproj: ${err.message}`);
            this.statusBarItem.hide();
            return null;
        }
    }

    /**
     * Saves current project configuration to .geeproj file.
     */
    public async saveProject(config?: GeeProjectConfig): Promise<boolean> {
        if (config) {
            this.currentProject = config;
        }
        if (!this.currentProject || !this.projectFilePath) {
            return false;
        }
        try {
            this.currentProject.lastModified = new Date().toISOString();
            fs.writeFileSync(this.projectFilePath, JSON.stringify(this.currentProject, null, 2), 'utf8');
            this.statusBarItem.text = `$(project) GEE: ${this.currentProject.name}`;
            return true;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error guardando .geeproj: ${err.message}`);
            return false;
        }
    }

    /**
     * Updates map center in current .geeproj.
     */
    public async setProjectMapCenter(lng: number, lat: number, zoom: number): Promise<boolean> {
        if (!this.currentProject) {
            vscode.window.showWarningMessage('No hay ningún proyecto GEE abierto en este espacio de trabajo.');
            return false;
        }
        if (!this.currentProject.map) {
            this.currentProject.map = { center: [lng, lat], zoom };
        } else {
            this.currentProject.map.center = [lng, lat];
            this.currentProject.map.zoom = zoom;
        }
        const ok = await this.saveProject();
        if (ok) {
            vscode.window.showInformationMessage(`📍 Vista de mapa guardada en .geeproj [${lat.toFixed(4)}, ${lng.toFixed(4)}, zoom ${zoom}]`);
        }
        return ok;
    }

    /**
     * Exports the entire project workspace into a portable .zip bundle.
     */
    public async exportProjectBundle(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('Abre un proyecto GEE para exportar el paquete.');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const projName = this.currentProject?.name || path.basename(rootPath);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultZipName = `${projName}_bundle_${timestamp}.zip`;

        const targetUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(path.dirname(rootPath), defaultZipName)),
            filters: { 'ZIP Archive (*.zip)': ['zip'] }
        });

        if (!targetUri) return;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `[GEE IDE] Empaquetando proyecto "${projName}" en ZIP...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const targetZipPath = targetUri.fsPath;
                const cmd = `cd "${rootPath}" && zip -r "${targetZipPath}" . -x "*.git*" "*node_modules*" "*.DS_Store*"`;
                cp.exec(cmd, (err, stdout, stderr) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Error al empaquetar proyecto: ${err.message}`);
                        reject(err);
                    } else {
                        vscode.window.showInformationMessage(`📦 [GEE IDE] Proyecto empaquetado con éxito: ${path.basename(targetZipPath)}`);
                        if (this.consoleView) {
                            this.consoleView.append(`📦 [GEE IDE] Bundle exportado: ${targetZipPath}`);
                        }
                        resolve();
                    }
                });
            });
        });
    }

    /**
     * Interactive Wizard to create a new GEE Project (RStudio style).
     */
    public async createNewProject(): Promise<void> {
        // Step 1: Project Name
        const projectName = await vscode.window.showInputBox({
            prompt: 'Nombre del nuevo proyecto GEE (ej: Deforestacion_Amazonia_2024)',
            placeHolder: 'Mi_Proyecto_GEE',
            validateInput: (value: string) => {
                if (!value || !value.trim()) return 'El nombre no puede estar vacío';
                if (!/^[a-zA-Z0-9_\- ]+$/.test(value)) return 'Usa solo letras, números, guiones y guiones bajos';
                return null;
            }
        });
        if (!projectName) return;

        const cleanName = projectName.trim().replace(/\s+/g, '_');

        // Step 2: Description
        const projectDesc = await vscode.window.showInputBox({
            prompt: 'Descripción breve del proyecto (opcional)',
            placeHolder: 'Análisis de cobertura vegetal y series temporales con Earth Engine'
        });

        // Step 3: Main language
        const langChoice = await vscode.window.showQuickPick(
            [
                { label: '$(file-code) Earth Engine Script (.gee)', description: 'Google Earth Engine JavaScript API (Recomendado)', lang: 'javascript', ext: '.gee' },
                { label: '$(file-code) Python (.py)', description: 'Earth Engine Python API (earthengine-api)', lang: 'python', ext: '.py' },
                { label: '$(file-code) R (.R)', description: 'rgee package', lang: 'r', ext: '.R' },
                { label: '$(file-code) JavaScript (.js)', description: 'Standard JS file', lang: 'javascript', ext: '.js' }
            ],
            { placeHolder: 'Selecciona el formato del script principal del proyecto' }
        );
        if (!langChoice) return;

        // Step 4: Map Location Preset
        const locationChoice = await vscode.window.showQuickPick(
            [
                { label: '🌎 Latinoamérica / Amazonía', center: [-65.0, -10.0] as [number, number], zoom: 5 },
                { label: '📍 Perú (Lima / Andes)', center: [-75.0, -9.5] as [number, number], zoom: 6 },
                { label: '📍 Colombia (Bogotá)', center: [-74.08, 4.60] as [number, number], zoom: 6 },
                { label: '📍 México (Centro)', center: [-99.13, 19.43] as [number, number], zoom: 6 },
                { label: '📍 España (Península)', center: [-3.70, 40.41] as [number, number], zoom: 6 },
                { label: '🌐 Vista Global', center: [0, 20] as [number, number], zoom: 3 },
                { label: '✏️ Ingresar Coordenadas Personalizadas...', center: null, zoom: 10 }
            ],
            { placeHolder: 'Selecciona la región o extensión inicial del mapa' }
        );
        if (!locationChoice) return;

        let centerCoords: [number, number] = locationChoice.center || [-75.0, -10.0];
        let mapZoom: number = locationChoice.zoom;

        if (!locationChoice.center) {
            const rawCoords = await vscode.window.showInputBox({
                prompt: 'Ingresa Longitud, Latitud separadas por coma (ej: -75.123, -12.456)',
                placeHolder: '-75.123, -12.456',
                validateInput: (v) => {
                    const parts = v.split(',').map(s => Number(s.trim()));
                    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                        return 'Formato inválido. Debe ser: longitud, latitud';
                    }
                    if (parts[0] < -180 || parts[0] > 180) return 'Longitud debe estar entre -180 y 180';
                    if (parts[1] < -90 || parts[1] > 90) return 'Latitud debe estar entre -90 y 90';
                    return null;
                }
            });
            if (!rawCoords) return;
            const parts = rawCoords.split(',').map(s => Number(s.trim()));
            centerCoords = [parts[0], parts[1]];
        }

        // Step 5: Select parent folder
        const folderUris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Crear carpeta del proyecto aquí'
        });
        if (!folderUris || folderUris.length === 0) return;

        const parentDir = folderUris[0].fsPath;
        const projectDir = path.join(parentDir, cleanName);

        if (fs.existsSync(projectDir)) {
            const overwrite = await vscode.window.showWarningMessage(
                `La carpeta "${cleanName}" ya existe en este directorio. ¿Deseas configurarla como proyecto GEE?`,
                'Sí, continuar',
                'Cancelar'
            );
            if (overwrite !== 'Sí, continuar') return;
        } else {
            fs.mkdirSync(projectDir, { recursive: true });
        }

        // Subdirectories
        const scriptsDir = path.join(projectDir, 'scripts');
        const dataDir = path.join(projectDir, 'data');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.mkdirSync(dataDir, { recursive: true });

        // Create main script
        const scriptFilename = `main${langChoice.ext}`;
        const scriptFilePath = path.join(scriptsDir, scriptFilename);

        let scriptContent = '';
        if (langChoice.lang === 'javascript') {
            scriptContent = `/**
 * =========================================================================
 * PROYECTO GEE: ${cleanName}
 * Descripción: ${projectDesc || 'Análisis geoespacial con Google Earth Engine'}
 * Generado por: GEE IDE (RStudio-style Project Workspace)
 * =========================================================================
 */

// 1. Centro del mapa del proyecto
Map.setCenter(${centerCoords[0]}, ${centerCoords[1]}, ${mapZoom});

// 2. Cargar colección Sentinel-2 Harmonized (Mosaico RGB)
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate('2024-01-01', '2024-06-30')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .median();

// 3. Parámetros de visualización (RGB Color Verdadero: B4, B3, B2)
var visRGB = {
    bands: ['B4', 'B3', 'B2'],
    min: 0,
    max: 3000
};

// 4. Agregar capa satelital al mapa
Map.addLayer(s2, visRGB, 'Sentinel-2 RGB (${cleanName})');

// 5. Cargar y visualizar el Área de Interés (ROI) del proyecto
try {
    var roi = loadLocalVector('data/roi.geojson');
    Map.addLayer(roi, { color: '#00e5ff', fillColor: '#00e5ff33' }, 'ROI: ${cleanName}');
} catch (e) {}

print('✅ Proyecto inicializado con éxito: ${cleanName}');
`;
        } else if (langChoice.lang === 'python') {
            scriptContent = `"""
=========================================================================
PROYECTO GEE: ${cleanName}
Descripción: ${projectDesc || 'Análisis geoespacial con Google Earth Engine'}
Generado por: GEE IDE (RStudio-style Project Workspace)
=========================================================================
"""
import ee

# 1. Centrar mapa
# En GEE IDE, Map está disponible automáticamente
# Map.setCenter(${centerCoords[0]}, ${centerCoords[1]}, ${mapZoom})

# 2. Cargar colección Sentinel-2
s2 = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
      .filterDate('2024-01-01', '2024-12-31')
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
      .median())

vis_rgb = {'bands': ['B4', 'B3', 'B2'], 'min': 0, 'max': 3000}
Map.addLayer(s2, vis_rgb, 'Sentinel-2 RGB (${cleanName})')

print("✅ Proyecto Python inicializado con éxito: ${cleanName}")
`;
        } else {
            scriptContent = `# =========================================================================
# PROYECTO GEE: ${cleanName}
# Descripción: ${projectDesc || 'Análisis geoespacial con rgee / Earth Engine'}
# Generado por: GEE IDE (RStudio-style Project Workspace)
# =========================================================================
library(rgee)
ee_Initialize()

s2 <- ee$ImageCollection('COPERNICUS/S2_SR_HARMONIZED')$
  filterDate('2024-01-01', '2024-12-31')$
  filter(ee$Filter$lt('CLOUDY_PIXEL_PERCENTAGE', 20))$
  median()

visRGB <- list(bands = c('B4', 'B3', 'B2'), min = 0, max = 3000)
Map$addLayer(s2, visRGB, 'Sentinel-2 RGB (${cleanName})')

cat("✅ Proyecto R inicializado: ${cleanName}\\n")
`;
        }

        if (!fs.existsSync(scriptFilePath)) {
            fs.writeFileSync(scriptFilePath, scriptContent, 'utf8');
        }

        // Create sample roi.geojson in data/
        const roiFilePath = path.join(dataDir, 'roi.geojson');
        const d = 0.05;
        const roiGeoJson = {
            type: "FeatureCollection",
            name: `${cleanName}_ROI`,
            features: [
                {
                    type: "Feature",
                    properties: { name: "Área de Estudio Inicial", project: cleanName },
                    geometry: {
                        type: "Polygon",
                        coordinates: [[
                            [Number((centerCoords[0] - d).toFixed(5)), Number((centerCoords[1] - d).toFixed(5))],
                            [Number((centerCoords[0] + d).toFixed(5)), Number((centerCoords[1] - d).toFixed(5))],
                            [Number((centerCoords[0] + d).toFixed(5)), Number((centerCoords[1] + d).toFixed(5))],
                            [Number((centerCoords[0] - d).toFixed(5)), Number((centerCoords[1] + d).toFixed(5))],
                            [Number((centerCoords[0] - d).toFixed(5)), Number((centerCoords[1] - d).toFixed(5))]
                        ]]
                    }
                }
            ]
        };
        if (!fs.existsSync(roiFilePath)) {
            fs.writeFileSync(roiFilePath, JSON.stringify(roiGeoJson, null, 2), 'utf8');
        }

        // Create .geehistory
        const historyFilePath = path.join(projectDir, '.geehistory');
        if (!fs.existsSync(historyFilePath)) {
            fs.writeFileSync(historyFilePath, `# GEE Console History for ${cleanName}\n`, 'utf8');
        }

        // Create README.md
        const readmePath = path.join(projectDir, 'README.md');
        const readmeContent = `# 🛰️ Proyecto GEE: ${cleanName}

> ${projectDesc || 'Proyecto de análisis satelital con Google Earth Engine.'}

## 📁 Estructura del Proyecto
- \`.geeproj\`: Manifiesto y configuración del proyecto (centro del mapa, ROI, lenguaje).
- \`.geehistory\`: Historial persistente de la consola de comandos.
- \`scripts/\`: Scripts de análisis (archivo principal: \`scripts/${scriptFilename}\`).
- \`data/\`: Archivos vectoriales y datos locales (\`data/roi.geojson\`).

## 🚀 Inicio Rápido
1. Abre \`scripts/${scriptFilename}\` en el editor.
2. Presiona \`Cmd + Shift + Enter\` (o \`Ctrl + Shift + Enter\`) para ejecutar todo el script.
3. El mapa y la consola se centrarán automáticamente en la zona de estudio.
`;
        if (!fs.existsSync(readmePath)) {
            fs.writeFileSync(readmePath, readmeContent, 'utf8');
        }

        // Create .geeproj manifest
        const projectConfig: GeeProjectConfig = {
            $schema: "https://gee-ide.dev/schemas/geeproj.v1.json",
            name: cleanName,
            description: projectDesc || '',
            version: "1.0.0",
            created: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            author: (process.env.USER || process.env.USERNAME || 'Analista GEE'),
            defaultScript: `scripts/${scriptFilename}`,
            defaultLanguage: langChoice.lang as any,
            map: {
                center: centerCoords,
                zoom: mapZoom,
                baseLayer: "googleHybrid"
            },
            roi: {
                file: "data/roi.geojson"
            },
            settings: {
                cloudCoverMax: 20,
                autoRestoreSession: true
            }
        };

        const geeprojPath = path.join(projectDir, '.geeproj');
        fs.writeFileSync(geeprojPath, JSON.stringify(projectConfig, null, 2), 'utf8');

        // Ask user to open folder
        const openChoice = await vscode.window.showInformationMessage(
            `🎉 Proyecto GEE "${cleanName}" creado con éxito.`,
            'Abrir en esta Ventana',
            'Abrir en Nueva Ventana'
        );

        const projectUri = vscode.Uri.file(projectDir);
        if (openChoice === 'Abrir en esta Ventana') {
            await vscode.commands.executeCommand('vscode.openFolder', projectUri, false);
        } else if (openChoice === 'Abrir en Nueva Ventana') {
            await vscode.commands.executeCommand('vscode.openFolder', projectUri, true);
        }
    }

    /**
     * Opens the main script associated with this project.
     */
    public async openMainScript(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;
        const rootPath = workspaceFolders[0].uri.fsPath;

        let scriptToOpen: string | null = null;
        if (this.currentProject?.defaultScript) {
            const candidate = path.isAbsolute(this.currentProject.defaultScript) ? this.currentProject.defaultScript : path.join(rootPath, this.currentProject.defaultScript);
            if (fs.existsSync(candidate)) {
                scriptToOpen = candidate;
            }
        }
        if (!scriptToOpen) {
            const fallbackFiles = [
                'scripts/main.gee', 'scripts/main.js', 'scripts/main.py', 'scripts/main.R',
                'main.gee', 'main.js', 'main.py', 'main.R',
                'welcome_to_gee_ide.gee'
            ];
            for (const fb of fallbackFiles) {
                const fullFb = path.join(rootPath, fb);
                if (fs.existsSync(fullFb)) {
                    scriptToOpen = fullFb;
                    break;
                }
            }
        }
        if (scriptToOpen) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(scriptToOpen));
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
        }
    }

    /**
     * Browse file system to select and open any existing GEE Project folder or .geeproj file.
     */
    public async openExistingProject(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Abrir Proyecto GEE',
            title: 'Selecciona la carpeta del proyecto o el archivo .geeproj',
            filters: {
                'Archivos de Proyecto GEE': ['geeproj', 'json']
            }
        });

        if (!uris || uris.length === 0) return;

        const selectedPath = uris[0].fsPath;
        let projectFolder = selectedPath;
        try {
            const stat = fs.statSync(selectedPath);
            if (stat.isFile()) {
                projectFolder = path.dirname(selectedPath);
            }
        } catch (e) {}

        const projectUri = vscode.Uri.file(projectFolder);
        const hasOpenFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
        if (!hasOpenFolder) {
            await vscode.commands.executeCommand('vscode.openFolder', projectUri, false);
            return;
        }

        const choice = await vscode.window.showInformationMessage(
            `¿Cómo deseas abrir el proyecto "${path.basename(projectFolder)}"?`,
            'En esta Ventana',
            'En Nueva Ventana'
        );

        if (choice === 'En esta Ventana') {
            await vscode.commands.executeCommand('vscode.openFolder', projectUri, false);
        } else if (choice === 'En Nueva Ventana') {
            await vscode.commands.executeCommand('vscode.openFolder', projectUri, true);
        }
    }

    /**
     * Shows an interactive project menu (RStudio style) with quick actions.
     */
    public async showProjectMenu(): Promise<void> {
        if (!this.currentProject || !this.projectFilePath) {
            const choice = await vscode.window.showQuickPick(
                [
                    { label: '$(folder-opened) Abrir Proyecto GEE Existente...', description: 'Buscar carpeta de proyecto o archivo .geeproj en tu disco', action: 'open' },
                    { label: '$(add) Crear Nuevo Proyecto GEE...', description: 'Crear un nuevo proyecto estructurado con asistente', action: 'new' }
                ],
                { placeHolder: 'No hay un proyecto GEE activo en este espacio de trabajo' }
            );
            if (choice?.action === 'open') {
                await this.openExistingProject();
            } else if (choice?.action === 'new') {
                await this.createNewProject();
            }
            return;
        }

        const items: (vscode.QuickPickItem & { action: string })[] = [
            {
                label: `$(file-code) Abrir Script Principal`,
                description: this.currentProject.defaultScript || 'scripts/main.gee',
                action: 'openScript'
            },
            {
                label: `$(play) Ejecutar Script Completo`,
                description: 'Ejecutar script en la consola y cargar capas/variables en memoria',
                action: 'runScript'
            },
            {
                label: `$(globe) Centrar Mapa en Proyecto`,
                description: this.currentProject.map ? `[${this.currentProject.map.center.join(', ')}] zoom ${this.currentProject.map.zoom}` : 'Coordenadas del proyecto',
                action: 'centerMap'
            },
            {
                label: `$(archive) Empaquetar Proyecto en ZIP (.zip)`,
                description: 'Exportar todos los scripts y datos en un archivo ZIP portátil para compartir',
                action: 'exportBundle'
            },
            {
                label: `$(folder-opened) Abrir Otro Proyecto GEE...`,
                description: 'Seleccionar otra carpeta o archivo .geeproj del disco',
                action: 'openOther'
            },
            {
                label: `$(add) Crear Nuevo Proyecto GEE...`,
                description: 'Crear un nuevo proyecto con asistente estructurado',
                action: 'new'
            },
            {
                label: `$(gear) Editar Configuración (.geeproj)`,
                description: 'Abrir el archivo JSON de configuración .geeproj',
                action: 'editConfig'
            }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Proyecto GEE: ${this.currentProject.name}`
        });

        if (!selected) return;

        if (selected.action === 'openScript') {
            await this.openMainScript();
        } else if (selected.action === 'runScript') {
            await this.openMainScript();
            await vscode.commands.executeCommand('gee-pro.run');
        } else if (selected.action === 'centerMap') {
            if (this.currentProject.map && this.mapView) {
                this.mapView.sendMessage({
                    command: 'setCenter',
                    lat: this.currentProject.map.center[1],
                    lng: this.currentProject.map.center[0],
                    zoom: this.currentProject.map.zoom || 10
                });
            }
        } else if (selected.action === 'exportBundle') {
            await this.exportProjectBundle();
        } else if (selected.action === 'openOther') {
            await this.openExistingProject();
        } else if (selected.action === 'new') {
            await this.createNewProject();
        } else if (selected.action === 'editConfig') {
            if (this.projectFilePath && fs.existsSync(this.projectFilePath)) {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this.projectFilePath));
                await vscode.window.showTextDocument(doc, { preview: false });
            }
        }
    }

    /**
     * Opens .geeproj or shows project menu.
     */
    public async openProjectSettings(): Promise<void> {
        await this.showProjectMenu();
    }
}
