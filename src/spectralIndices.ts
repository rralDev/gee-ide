import * as vscode from 'vscode';
import { GE_PALETTES } from './palettes';

export interface SpectralIndexDefinition {
    id: string;
    name: string;
    category: 'Vegetation' | 'Water' | 'Burn' | 'Soil/Urban' | 'Snow';
    formulaDescription: string;
    // If simple 2-band normalized difference: [bandA, bandB]
    normalizedDiffBands?: { [sensor: string]: [string, string] };
    // If complex expression:
    expression?: {
        formula: string;
        bands: { [sensor: string]: { [placeholder: string]: string } };
    };
    defaultVisParams: {
        min: number;
        max: number;
        paletteName: 'ndvi' | 'water' | 'dem' | 'temperature' | 'fire' | 'soil' | 'snow' | 'urban';
    };
}

export interface SensorMetadata {
    id: string;
    label: string;
    description: string;
    collectionId: string;
    minYear: number;
    maxYear: number;
    defaultYear: number;
    cloudBand: string;
    cloudThreshold: number;
    rgbBands: [string, string, string];
    rgbVis: { min: number; max: number };
}

export const SENSOR_METADATA: Record<string, SensorMetadata> = {
    'Sentinel-2': {
        id: 'Sentinel-2',
        label: '🛰️ Sentinel-2',
        description: 'MSI (Level-2A Surface Reflectance, 2015-presente)',
        collectionId: 'COPERNICUS/S2_SR_HARMONIZED',
        minYear: 2015,
        maxYear: 2026,
        defaultYear: 2023,
        cloudBand: 'CLOUDY_PIXEL_PERCENTAGE',
        cloudThreshold: 20,
        rgbBands: ['B4', 'B3', 'B2'],
        rgbVis: { min: 0, max: 3000 }
    },
    'Landsat 8/9': {
        id: 'Landsat 8/9',
        label: '🛰️ Landsat 8/9',
        description: 'OLI / OLI-2 (Collection 2 Tier 1 Level-2, 2013-presente)',
        collectionId: 'LANDSAT/LC08/C02/T1_L2',
        minYear: 2013,
        maxYear: 2026,
        defaultYear: 2023,
        cloudBand: 'CLOUD_COVER',
        cloudThreshold: 20,
        rgbBands: ['SR_B4', 'SR_B3', 'SR_B2'],
        rgbVis: { min: 7000, max: 20000 }
    },
    'Landsat 4/5/7': {
        id: 'Landsat 4/5/7',
        label: '🛰️ Landsat 4/5/7',
        description: 'TM / ETM+ (Collection 2 Tier 1 Level-2, 1984-2022)',
        collectionId: 'LANDSAT/LT05/C02/T1_L2',
        minYear: 1984,
        maxYear: 2022,
        defaultYear: 2005,
        cloudBand: 'CLOUD_COVER',
        cloudThreshold: 20,
        rgbBands: ['SR_B3', 'SR_B2', 'SR_B1'],
        rgbVis: { min: 7000, max: 20000 }
    },
    'MODIS': {
        id: 'MODIS',
        label: '🛰️ MODIS',
        description: 'Terra Surface Reflectance (Daily 250m/500m, 2000-presente)',
        collectionId: 'MODIS/061/MOD09GA',
        minYear: 2000,
        maxYear: 2026,
        defaultYear: 2022,
        cloudBand: '',
        cloudThreshold: 0,
        rgbBands: ['sur_refl_b01', 'sur_refl_b04', 'sur_refl_b03'],
        rgbVis: { min: 0, max: 4000 }
    }
};

export const SPECTRAL_INDICES: SpectralIndexDefinition[] = [
    // --- VEGETACIÓN ---
    {
        id: 'NDVI',
        name: 'Normalized Difference Vegetation Index',
        category: 'Vegetation',
        formulaDescription: '(NIR - Red) / (NIR + Red)',
        normalizedDiffBands: {
            'Sentinel-2': ['B8', 'B4'],
            'Landsat 8/9': ['SR_B5', 'SR_B4'],
            'Landsat 4/5/7': ['SR_B4', 'SR_B3'],
            'MODIS': ['sur_refl_b02', 'sur_refl_b01'],
            'Generic': ['NIR', 'RED']
        },
        defaultVisParams: { min: 0.0, max: 0.9, paletteName: 'ndvi' }
    },
    {
        id: 'EVI',
        name: 'Enhanced Vegetation Index',
        category: 'Vegetation',
        formulaDescription: '2.5 * ((NIR - Red) / (NIR + 6 * Red - 7.5 * Blue + 1))',
        expression: {
            formula: '2.5 * ((NIR - RED) / (NIR + 6.0 * RED - 7.5 * BLUE + 1.0))',
            bands: {
                'Sentinel-2': { NIR: 'B8', RED: 'B4', BLUE: 'B2' },
                'Landsat 8/9': { NIR: 'SR_B5', RED: 'SR_B4', BLUE: 'SR_B2' },
                'Landsat 4/5/7': { NIR: 'SR_B4', RED: 'SR_B3', BLUE: 'SR_B1' },
                'MODIS': { NIR: 'sur_refl_b02', RED: 'sur_refl_b01', BLUE: 'sur_refl_b03' },
                'Generic': { NIR: 'NIR', RED: 'RED', BLUE: 'BLUE' }
            }
        },
        defaultVisParams: { min: 0.0, max: 0.8, paletteName: 'ndvi' }
    },
    {
        id: 'EVI2',
        name: 'Two-Band Enhanced Vegetation Index',
        category: 'Vegetation',
        formulaDescription: '2.5 * ((NIR - Red) / (NIR + 2.4 * Red + 1))',
        expression: {
            formula: '2.5 * ((NIR - RED) / (NIR + 2.4 * RED + 1.0))',
            bands: {
                'Sentinel-2': { NIR: 'B8', RED: 'B4' },
                'Landsat 8/9': { NIR: 'SR_B5', RED: 'SR_B4' },
                'Landsat 4/5/7': { NIR: 'SR_B4', RED: 'SR_B3' },
                'MODIS': { NIR: 'sur_refl_b02', RED: 'sur_refl_b01' },
                'Generic': { NIR: 'NIR', RED: 'RED' }
            }
        },
        defaultVisParams: { min: 0.0, max: 0.8, paletteName: 'ndvi' }
    },
    {
        id: 'SAVI',
        name: 'Soil-Adjusted Vegetation Index (L=0.5)',
        category: 'Vegetation',
        formulaDescription: '((NIR - Red) / (NIR + Red + 0.5)) * 1.5',
        expression: {
            formula: '((NIR - RED) / (NIR + RED + 0.5)) * 1.5',
            bands: {
                'Sentinel-2': { NIR: 'B8', RED: 'B4' },
                'Landsat 8/9': { NIR: 'SR_B5', RED: 'SR_B4' },
                'Landsat 4/5/7': { NIR: 'SR_B4', RED: 'SR_B3' },
                'MODIS': { NIR: 'sur_refl_b02', RED: 'sur_refl_b01' },
                'Generic': { NIR: 'NIR', RED: 'RED' }
            }
        },
        defaultVisParams: { min: 0.0, max: 0.8, paletteName: 'ndvi' }
    },
    {
        id: 'MSAVI',
        name: 'Modified Soil-Adjusted Vegetation Index',
        category: 'Vegetation',
        formulaDescription: '(2 * NIR + 1 - sqrt((2 * NIR + 1)^2 - 8 * (NIR - Red))) / 2',
        expression: {
            formula: '(2.0 * NIR + 1.0 - sqrt(pow((2.0 * NIR + 1.0), 2) - 8.0 * (NIR - RED))) / 2.0',
            bands: {
                'Sentinel-2': { NIR: 'B8', RED: 'B4' },
                'Landsat 8/9': { NIR: 'SR_B5', RED: 'SR_B4' },
                'Landsat 4/5/7': { NIR: 'SR_B4', RED: 'SR_B3' },
                'MODIS': { NIR: 'sur_refl_b02', RED: 'sur_refl_b01' },
                'Generic': { NIR: 'NIR', RED: 'RED' }
            }
        },
        defaultVisParams: { min: 0.0, max: 0.8, paletteName: 'ndvi' }
    },
    {
        id: 'NDRE',
        name: 'Normalized Difference Red Edge Index',
        category: 'Vegetation',
        formulaDescription: '(NIR - RedEdge1) / (NIR + RedEdge1)',
        normalizedDiffBands: {
            'Sentinel-2': ['B8', 'B5'],
            'Landsat 8/9': ['SR_B5', 'SR_B4'],
            'Generic': ['NIR', 'RED_EDGE']
        },
        defaultVisParams: { min: 0.0, max: 0.8, paletteName: 'ndvi' }
    },
    {
        id: 'GNDVI',
        name: 'Green Normalized Difference Vegetation Index',
        category: 'Vegetation',
        formulaDescription: '(NIR - Green) / (NIR + Green)',
        normalizedDiffBands: {
            'Sentinel-2': ['B8', 'B3'],
            'Landsat 8/9': ['SR_B5', 'SR_B3'],
            'Landsat 4/5/7': ['SR_B4', 'SR_B2'],
            'MODIS': ['sur_refl_b02', 'sur_refl_b04'],
            'Generic': ['NIR', 'GREEN']
        },
        defaultVisParams: { min: 0.0, max: 0.8, paletteName: 'ndvi' }
    },
    {
        id: 'ARVI',
        name: 'Atmospherically Resistant Vegetation Index',
        category: 'Vegetation',
        formulaDescription: '(NIR - (2 * Red - Blue)) / (NIR + (2 * Red - Blue))',
        expression: {
            formula: '(NIR - (2.0 * RED - BLUE)) / (NIR + (2.0 * RED - BLUE))',
            bands: {
                'Sentinel-2': { NIR: 'B8', RED: 'B4', BLUE: 'B2' },
                'Landsat 8/9': { NIR: 'SR_B5', RED: 'SR_B4', BLUE: 'SR_B2' },
                'Landsat 4/5/7': { NIR: 'SR_B4', RED: 'SR_B3', BLUE: 'SR_B1' },
                'Generic': { NIR: 'NIR', RED: 'RED', BLUE: 'BLUE' }
            }
        },
        defaultVisParams: { min: 0.0, max: 0.8, paletteName: 'ndvi' }
    },

    // --- AGUA E INUNDACIONES ---
    {
        id: 'NDWI',
        name: 'Normalized Difference Water Index (McFeeters)',
        category: 'Water',
        formulaDescription: '(Green - NIR) / (Green + NIR)',
        normalizedDiffBands: {
            'Sentinel-2': ['B3', 'B8'],
            'Landsat 8/9': ['SR_B3', 'SR_B5'],
            'Landsat 4/5/7': ['SR_B2', 'SR_B4'],
            'MODIS': ['sur_refl_b04', 'sur_refl_b02'],
            'Generic': ['GREEN', 'NIR']
        },
        defaultVisParams: { min: -0.5, max: 0.5, paletteName: 'water' }
    },
    {
        id: 'MNDWI',
        name: 'Modified Normalized Difference Water Index (Xu)',
        category: 'Water',
        formulaDescription: '(Green - SWIR1) / (Green + SWIR1)',
        normalizedDiffBands: {
            'Sentinel-2': ['B3', 'B11'],
            'Landsat 8/9': ['SR_B3', 'SR_B6'],
            'Landsat 4/5/7': ['SR_B2', 'SR_B5'],
            'MODIS': ['sur_refl_b04', 'sur_refl_b06'],
            'Generic': ['GREEN', 'SWIR1']
        },
        defaultVisParams: { min: -0.5, max: 0.5, paletteName: 'water' }
    },
    {
        id: 'NDMI',
        name: 'Normalized Difference Moisture Index (Gao)',
        category: 'Water',
        formulaDescription: '(NIR - SWIR1) / (NIR + SWIR1)',
        normalizedDiffBands: {
            'Sentinel-2': ['B8', 'B11'],
            'Landsat 8/9': ['SR_B5', 'SR_B6'],
            'Landsat 4/5/7': ['SR_B4', 'SR_B5'],
            'MODIS': ['sur_refl_b02', 'sur_refl_b06'],
            'Generic': ['NIR', 'SWIR1']
        },
        defaultVisParams: { min: -0.4, max: 0.6, paletteName: 'water' }
    },
    {
        id: 'AWEIsh',
        name: 'Automated Water Extraction Index (with Shadow)',
        category: 'Water',
        formulaDescription: 'Blue + 2.5 * Green - 1.5 * (NIR + SWIR1) - 0.25 * SWIR2',
        expression: {
            formula: 'BLUE + 2.5 * GREEN - 1.5 * (NIR + SWIR1) - 0.25 * SWIR2',
            bands: {
                'Sentinel-2': { BLUE: 'B2', GREEN: 'B3', NIR: 'B8', SWIR1: 'B11', SWIR2: 'B12' },
                'Landsat 8/9': { BLUE: 'SR_B2', GREEN: 'SR_B3', NIR: 'SR_B5', SWIR1: 'SR_B6', SWIR2: 'SR_B7' },
                'Landsat 4/5/7': { BLUE: 'SR_B1', GREEN: 'SR_B2', NIR: 'SR_B4', SWIR1: 'SR_B5', SWIR2: 'SR_B7' },
                'Generic': { BLUE: 'BLUE', GREEN: 'GREEN', NIR: 'NIR', SWIR1: 'SWIR1', SWIR2: 'SWIR2' }
            }
        },
        defaultVisParams: { min: -2000, max: 1000, paletteName: 'water' }
    },

    // --- FUEGO Y QUEMAS ---
    {
        id: 'NBR',
        name: 'Normalized Burn Ratio',
        category: 'Burn',
        formulaDescription: '(NIR - SWIR2) / (NIR + SWIR2)',
        normalizedDiffBands: {
            'Sentinel-2': ['B8', 'B12'],
            'Landsat 8/9': ['SR_B5', 'SR_B7'],
            'Landsat 4/5/7': ['SR_B4', 'SR_B7'],
            'MODIS': ['sur_refl_b02', 'sur_refl_b07'],
            'Generic': ['NIR', 'SWIR2']
        },
        defaultVisParams: { min: -0.5, max: 0.8, paletteName: 'fire' }
    },
    {
        id: 'NBR2',
        name: 'Normalized Burn Ratio 2',
        category: 'Burn',
        formulaDescription: '(SWIR1 - SWIR2) / (SWIR1 + SWIR2)',
        normalizedDiffBands: {
            'Sentinel-2': ['B11', 'B12'],
            'Landsat 8/9': ['SR_B6', 'SR_B7'],
            'Landsat 4/5/7': ['SR_B5', 'SR_B7'],
            'MODIS': ['sur_refl_b06', 'sur_refl_b07'],
            'Generic': ['SWIR1', 'SWIR2']
        },
        defaultVisParams: { min: -0.3, max: 0.5, paletteName: 'fire' }
    },
    {
        id: 'MIRBI',
        name: 'Mid-Infrared Burn Index',
        category: 'Burn',
        formulaDescription: '10 * SWIR2 - 9.8 * SWIR1 + 2',
        expression: {
            formula: '10.0 * SWIR2 - 9.8 * SWIR1 + 2.0',
            bands: {
                'Sentinel-2': { SWIR1: 'B11', SWIR2: 'B12' },
                'Landsat 8/9': { SWIR1: 'SR_B6', SWIR2: 'SR_B7' },
                'Landsat 4/5/7': { SWIR1: 'SR_B5', SWIR2: 'SR_B7' },
                'Generic': { SWIR1: 'SWIR1', SWIR2: 'SWIR2' }
            }
        },
        defaultVisParams: { min: 0.0, max: 5.0, paletteName: 'fire' }
    },

    // --- SUELO Y URBANO ---
    {
        id: 'NDBI',
        name: 'Normalized Difference Built-up Index',
        category: 'Soil/Urban',
        formulaDescription: '(SWIR1 - NIR) / (SWIR1 + NIR)',
        normalizedDiffBands: {
            'Sentinel-2': ['B11', 'B8'],
            'Landsat 8/9': ['SR_B6', 'SR_B5'],
            'Landsat 4/5/7': ['SR_B5', 'SR_B4'],
            'MODIS': ['sur_refl_b06', 'sur_refl_b02'],
            'Generic': ['SWIR1', 'NIR']
        },
        defaultVisParams: { min: -0.5, max: 0.5, paletteName: 'urban' }
    },
    {
        id: 'BSI',
        name: 'Bare Soil Index',
        category: 'Soil/Urban',
        formulaDescription: '((SWIR1 + Red) - (NIR + Blue)) / ((SWIR1 + Red) + (NIR + Blue))',
        expression: {
            formula: '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
            bands: {
                'Sentinel-2': { SWIR1: 'B11', RED: 'B4', NIR: 'B8', BLUE: 'B2' },
                'Landsat 8/9': { SWIR1: 'SR_B6', RED: 'SR_B4', NIR: 'SR_B5', BLUE: 'SR_B2' },
                'Landsat 4/5/7': { SWIR1: 'SR_B5', RED: 'SR_B3', NIR: 'SR_B4', BLUE: 'SR_B1' },
                'Generic': { SWIR1: 'SWIR1', RED: 'RED', NIR: 'NIR', BLUE: 'BLUE' }
            }
        },
        defaultVisParams: { min: -0.3, max: 0.5, paletteName: 'soil' }
    },
    {
        id: 'UI',
        name: 'Urban Index',
        category: 'Soil/Urban',
        formulaDescription: '(SWIR2 - NIR) / (SWIR2 + NIR)',
        normalizedDiffBands: {
            'Sentinel-2': ['B12', 'B8'],
            'Landsat 8/9': ['SR_B7', 'SR_B5'],
            'Landsat 4/5/7': ['SR_B7', 'SR_B4'],
            'Generic': ['SWIR2', 'NIR']
        },
        defaultVisParams: { min: -0.5, max: 0.5, paletteName: 'urban' }
    },
    {
        id: 'NDTI',
        name: 'Normalized Difference Tillage Index',
        category: 'Soil/Urban',
        formulaDescription: '(SWIR1 - SWIR2) / (SWIR1 + SWIR2)',
        normalizedDiffBands: {
            'Sentinel-2': ['B11', 'B12'],
            'Landsat 8/9': ['SR_B6', 'SR_B7'],
            'Landsat 4/5/7': ['SR_B5', 'SR_B7'],
            'Generic': ['SWIR1', 'SWIR2']
        },
        defaultVisParams: { min: -0.2, max: 0.4, paletteName: 'soil' }
    },

    // --- NIEVE Y HIELO ---
    {
        id: 'NDSI',
        name: 'Normalized Difference Snow Index',
        category: 'Snow',
        formulaDescription: '(Green - SWIR1) / (Green + SWIR1)',
        normalizedDiffBands: {
            'Sentinel-2': ['B3', 'B11'],
            'Landsat 8/9': ['SR_B3', 'SR_B6'],
            'Landsat 4/5/7': ['SR_B2', 'SR_B5'],
            'MODIS': ['sur_refl_b04', 'sur_refl_b06'],
            'Generic': ['GREEN', 'SWIR1']
        },
        defaultVisParams: { min: 0.0, max: 0.8, paletteName: 'snow' }
    }
];

export class SpectralIndicesManager {
    public static getSupportedSensors(): string[] {
        return ['Sentinel-2', 'Landsat 8/9', 'Landsat 4/5/7', 'MODIS', 'Generic'];
    }

    public static getIndices(): SpectralIndexDefinition[] {
        return SPECTRAL_INDICES;
    }

    public static generateCalculationCode(index: SpectralIndexDefinition, sensor: string, imageVar: string = 'image', lang: string = 'javascript'): string {
        const idLower = index.id.toLowerCase();

        if (index.normalizedDiffBands && index.normalizedDiffBands[sensor]) {
            const [b1, b2] = index.normalizedDiffBands[sensor];
            if (lang === 'python') {
                return `${idLower} = ${imageVar}.normalizedDifference(['${b1}', '${b2}']).rename('${index.id}')`;
            } else if (lang === 'r') {
                return `${idLower} <- ${imageVar}$normalizedDifference(c('${b1}', '${b2}'))$rename('${index.id}')`;
            } else {
                return `var ${idLower} = ${imageVar}.normalizedDifference(['${b1}', '${b2}']).rename('${index.id}');`;
            }
        } else if (index.expression && index.expression.bands[sensor]) {
            const formula = index.expression.formula;
            const bandMap = index.expression.bands[sensor];

            if (lang === 'python') {
                const mapEntries = Object.entries(bandMap).map(([k, b]) => `'${k}': ${imageVar}.select('${b}')`).join(',\n        ');
                return `${idLower} = ${imageVar}.expression(\n    '${formula}', {\n        ${mapEntries}\n    }\n).rename('${index.id}')`;
            } else if (lang === 'r') {
                const mapEntries = Object.entries(bandMap).map(([k, b]) => `${k} = ${imageVar}$select('${b}')`).join(',\n        ');
                return `${idLower} <- ${imageVar}$expression(\n    '${formula}', list(\n        ${mapEntries}\n    )\n)$rename('${index.id}')`;
            } else {
                const mapEntries = Object.entries(bandMap).map(([k, b]) => `'${k}': ${imageVar}.select('${b}')`).join(',\n        ');
                return `var ${idLower} = ${imageVar}.expression(\n    '${formula}', {\n        ${mapEntries}\n    }\n).rename('${index.id}');`;
            }
        } else {
            return `// ${index.id} no está disponible para ${sensor}`;
        }
    }

    public static generateCode(index: SpectralIndexDefinition, sensor: string, imageVar: string = 'image', lang: string = 'javascript'): string {
        const idLower = index.id.toLowerCase();
        const palette = index.defaultVisParams.paletteName;
        const minVal = index.defaultVisParams.min;
        const maxVal = index.defaultVisParams.max;
        const calcCode = this.generateCalculationCode(index, sensor, imageVar, lang);

        let comment = `// Índice ${index.id}: ${index.name} (${sensor})\n// Fórmula: ${index.formulaDescription}`;
        let mapCall = '';
        if (lang === 'python') {
            comment = `# Índice ${index.id}: ${index.name} (${sensor})\n# Fórmula: ${index.formulaDescription}`;
            mapCall = `Map.addLayer(${idLower}, {'min': ${minVal}, 'max': ${maxVal}, 'palette': palettes.${palette}}, '${index.id} (${sensor})')`;
        } else if (lang === 'r') {
            comment = `# Índice ${index.id}: ${index.name} (${sensor})\n# Fórmula: ${index.formulaDescription}`;
            mapCall = `Map$addLayer(${idLower}, list(min = ${minVal}, max = ${maxVal}, palette = palettes$${palette}), '${index.id} (${sensor})')`;
        } else {
            mapCall = `Map.addLayer(${idLower}, {min: ${minVal}, max: ${maxVal}, palette: palettes.${palette}}, '${index.id} (${sensor})');`;
        }

        return `${comment}\n${calcCode}\n${mapCall}\n`;
    }

    public static generateFullPipelineCode(index: SpectralIndexDefinition, sensor: string, startYear: number, endYear: number, lang: string = 'javascript'): string {
        const idLower = index.id.toLowerCase();
        const palette = index.defaultVisParams.paletteName;
        const minVal = index.defaultVisParams.min;
        const maxVal = index.defaultVisParams.max;
        const meta = SENSOR_METADATA[sensor];

        if (!meta) {
            return this.generateCode(index, sensor, 'image', lang);
        }

        const yearLabel = startYear === endYear ? `${startYear}` : `${startYear}-${endYear}`;
        const startDate = `${startYear}-01-01`;
        const endDate = `${endYear}-12-31`;

        // Generate the mapping function to compute the index across every image of the entire collection
        let mapFunctionCode = '';
        if (index.normalizedDiffBands && index.normalizedDiffBands[sensor]) {
            const [b1, b2] = index.normalizedDiffBands[sensor];
            if (lang === 'python') {
                mapFunctionCode = `def add_${idLower}(img):\n    idx = img.normalizedDifference(['${b1}', '${b2}']).rename('${index.id}')\n    return img.addBands(idx)\n\ncol_with_${idLower} = col.map(add_${idLower})`;
            } else if (lang === 'r') {
                mapFunctionCode = `add_${idLower} <- function(img) {\n    idx <- img$normalizedDifference(c('${b1}', '${b2}'))$rename('${index.id}')\n    return(img$addBands(idx))\n}\n\ncol_with_${idLower} <- col$map(add_${idLower})`;
            } else {
                mapFunctionCode = `var add${index.id} = function(img) {\n    var idx = img.normalizedDifference(['${b1}', '${b2}']).rename('${index.id}');\n    return img.addBands(idx);\n};\nvar colWith${index.id} = col.map(add${index.id});`;
            }
        } else if (index.expression && index.expression.bands[sensor]) {
            const formula = index.expression.formula;
            const bandMap = index.expression.bands[sensor];
            if (lang === 'python') {
                const mapEntries = Object.entries(bandMap).map(([k, b]) => `'${k}': img.select('${b}')`).join(',\n        ');
                mapFunctionCode = `def add_${idLower}(img):\n    idx = img.expression(\n        '${formula}', {\n            ${mapEntries}\n        }\n    ).rename('${index.id}')\n    return img.addBands(idx)\n\ncol_with_${idLower} = col.map(add_${idLower})`;
            } else if (lang === 'r') {
                const mapEntries = Object.entries(bandMap).map(([k, b]) => `${k} = img$select('${b}')`).join(',\n        ');
                mapFunctionCode = `add_${idLower} <- function(img) {\n    idx <- img$expression(\n        '${formula}', list(\n            ${mapEntries}\n        )\n    )$rename('${index.id}')\n    return(img$addBands(idx))\n}\n\ncol_with_${idLower} <- col$map(add_${idLower})`;
            } else {
                const mapEntries = Object.entries(bandMap).map(([k, b]) => `'${k}': img.select('${b}')`).join(',\n        ');
                mapFunctionCode = `var add${index.id} = function(img) {\n    var idx = img.expression(\n        '${formula}', {\n            ${mapEntries}\n        }\n    ).rename('${index.id}');\n    return img.addBands(idx);\n};\nvar colWith${index.id} = col.map(add${index.id});`;
            }
        }

        if (lang === 'python') {
            const cloudFilter = meta.cloudBand ? `\n    .filter(ee.Filter.lt('${meta.cloudBand}', ${meta.cloudThreshold}))` : '';
            if (startYear === endYear) {
                return `# ============================================================
# Flujo Completo: Cálculo de ${index.id} en Colección Temporal
# Sensor: ${sensor} | Período: ${yearLabel}
# Fórmula: ${index.formulaDescription}
# ============================================================

# 1. Área de Interés (Usa tu ROI si existe, o la vista actual del mapa)
aoi = roi if 'roi' in locals() else ee.Geometry(Map.getBounds(True))

# 2. Cargar colección satelital oficial (${startDate} a ${endDate})
col = (ee.ImageCollection('${meta.collectionId}')
    .filterBounds(aoi)
    .filterDate('${startDate}', '${endDate}')${cloudFilter})

# 3. Mapear el cálculo de ${index.id} sobre TODA la colección temporal
${mapFunctionCode}

# 4. Reducir colección a compósito mediano para visualización espacial
rgb_median = col.median()
index_median = col_with_${idLower}.select('${index.id}').median()

# 5. Centrar vista y añadir capas al Mapa
Map.centerObject(aoi, 10)
Map.addLayer(rgb_median, {'bands': ['${meta.rgbBands.join("', '")}'], 'min': ${meta.rgbVis.min}, 'max': ${meta.rgbVis.max}}, '${sensor} RGB (${yearLabel})')
Map.addLayer(index_median, {'min': ${minVal}, 'max': ${maxVal}, 'palette': palettes.${palette}}, '${index.id} Mediana (${sensor} ${yearLabel})')
`;
            } else {
                return `# ============================================================
# Flujo Completo: Cálculo de ${index.id} Multianual (${startYear}-${endYear})
# Sensor: ${sensor} | Período: ${startYear} a ${endYear}
# Fórmula: ${index.formulaDescription}
# ============================================================

# 1. Área de Interés (Usa tu ROI si existe, o la vista actual del mapa)
aoi = roi if 'roi' in locals() else ee.Geometry(Map.getBounds(True))

# 2. Cargar colección satelital oficial (${startDate} a ${endDate})
col = (ee.ImageCollection('${meta.collectionId}')
    .filterBounds(aoi)
    .filterDate('${startDate}', '${endDate}')${cloudFilter})

# 3. Mapear el cálculo de ${index.id} sobre TODA la colección temporal
${mapFunctionCode}

# 4. Centrar vista y añadir compósitos anuales para comparar año por año
Map.centerObject(aoi, 10)
rgb_base = col.filterDate('${startYear}-01-01', '${startYear}-12-31').median()
Map.addLayer(rgb_base, {'bands': ['${meta.rgbBands.join("', '")}'], 'min': ${meta.rgbVis.min}, 'max': ${meta.rgbVis.max}}, '${sensor} RGB (${startYear})', False)

for y in range(${startYear}, ${endYear} + 1):
    yearly = col_with_${idLower}.filterDate(f'{y}-01-01', f'{y}-12-31').select('${index.id}').median()
    is_visible = (y == ${startYear} or y == ${endYear})
    Map.addLayer(yearly, {'min': ${minVal}, 'max': ${maxVal}, 'palette': palettes.${palette}}, f'${index.id} ({y})', is_visible)
`;
            }
        } else if (lang === 'r') {
            const cloudFilter = meta.cloudBand ? `$\n    filter(ee$Filter$lt('${meta.cloudBand}', ${meta.cloudThreshold}))` : '';
            if (startYear === endYear) {
                return `# ============================================================
# Flujo Completo: Cálculo de ${index.id} en Colección Temporal
# Sensor: ${sensor} | Período: ${yearLabel}
# Fórmula: ${index.formulaDescription}
# ============================================================

# 1. Área de Interés (Usa tu ROI si existe, o la vista actual del mapa)
aoi <- if (exists("roi")) roi else ee$Geometry(Map$getBounds(TRUE))

# 2. Cargar colección satelital oficial (${startDate} a ${endDate})
col <- ee$ImageCollection('${meta.collectionId}')$
    filterBounds(aoi)$
    filterDate('${startDate}', '${endDate}')${cloudFilter}

# 3. Mapear el cálculo de ${index.id} sobre TODA la colección temporal
${mapFunctionCode}

# 4. Reducir colección a compósito mediano para visualización espacial
rgb_median <- col$median()
index_median <- col_with_${idLower}$select('${index.id}')$median()

# 5. Centrar vista y añadir capas al Mapa
Map$centerObject(aoi, 10)
Map$addLayer(rgb_median, list(bands = c('${meta.rgbBands.join("', '")}'), min = ${meta.rgbVis.min}, max = ${meta.rgbVis.max}), '${sensor} RGB (${yearLabel})')
Map$addLayer(index_median, list(min = ${minVal}, max = ${maxVal}, palette = palettes$${palette}), '${index.id} Mediana (${sensor} ${yearLabel})')
`;
            } else {
                return `# ============================================================
# Flujo Completo: Cálculo de ${index.id} Multianual (${startYear}-${endYear})
# Sensor: ${sensor} | Período: ${startYear} a ${endYear}
# Fórmula: ${index.formulaDescription}
# ============================================================

# 1. Área de Interés (Usa tu ROI si existe, o la vista actual del mapa)
aoi <- if (exists("roi")) roi else ee$Geometry(Map$getBounds(TRUE))

# 2. Cargar colección satelital oficial (${startDate} a ${endDate})
col <- ee$ImageCollection('${meta.collectionId}')$
    filterBounds(aoi)$
    filterDate('${startDate}', '${endDate}')${cloudFilter}

# 3. Mapear el cálculo de ${index.id} sobre TODA la colección temporal
${mapFunctionCode}

# 4. Centrar vista y añadir compósitos anuales para comparar año por año
Map$centerObject(aoi, 10)
rgb_base <- col$filterDate('${startYear}-01-01', '${startYear}-12-31')$median()
Map$addLayer(rgb_base, list(bands = c('${meta.rgbBands.join("', '")}'), min = ${meta.rgbVis.min}, max = ${meta.rgbVis.max}), '${sensor} RGB (${startYear})', FALSE)

for (y in ${startYear}:${endYear}) {
    yearly <- col_with_${idLower}$filterDate(paste0(y, '-01-01'), paste0(y, '-12-31'))$select('${index.id}')$median()
    is_visible <- (y == ${startYear} || y == ${endYear})
    Map$addLayer(yearly, list(min = ${minVal}, max = ${maxVal}, palette = palettes$${palette}), paste0('${index.id} (', y, ')'), is_visible)
}
`;
            }
        } else {
            // JavaScript default
            const cloudFilter = meta.cloudBand ? `\n    .filter(ee.Filter.lt('${meta.cloudBand}', ${meta.cloudThreshold}))` : '';
            if (startYear === endYear) {
                return `// ============================================================
// Flujo Completo: Cálculo de ${index.id} en Colección Temporal
// Sensor: ${sensor} | Período: ${yearLabel}
// Fórmula: ${index.formulaDescription}
// ============================================================

// 1. Área de Interés (Usa tu ROI si existe, o la vista actual del mapa)
var aoi = (typeof roi !== 'undefined') ? roi : ee.Geometry(Map.getBounds(true));

// 2. Cargar colección satelital oficial (${startDate} a ${endDate})
var col = ee.ImageCollection('${meta.collectionId}')
    .filterBounds(aoi)
    .filterDate('${startDate}', '${endDate}')${cloudFilter};

// 3. Mapear el cálculo de ${index.id} sobre TODA la colección temporal
${mapFunctionCode}

// 4. Reducir colección a compósito mediano para visualización espacial
var rgbMedian = col.median();
var indexMedian = colWith${index.id}.select('${index.id}').median();

// 5. Centrar vista y añadir capas al Mapa
Map.centerObject(aoi, 10);
Map.addLayer(rgbMedian, {bands: ['${meta.rgbBands.join("', '")}'], min: ${meta.rgbVis.min}, max: ${meta.rgbVis.max}}, '${sensor} RGB (${yearLabel})');
Map.addLayer(indexMedian, {min: ${minVal}, max: ${maxVal}, palette: palettes.${palette}}, '${index.id} Mediana (${sensor} ${yearLabel})');
`;
            } else {
                return `// ============================================================
// Flujo Completo: Cálculo de ${index.id} Multianual (${startYear}-${endYear})
// Sensor: ${sensor} | Período: ${startYear} a ${endYear}
// Fórmula: ${index.formulaDescription}
// ============================================================

// 1. Área de Interés (Usa tu ROI si existe, o la vista actual del mapa)
var aoi = (typeof roi !== 'undefined') ? roi : ee.Geometry(Map.getBounds(true));

// 2. Cargar colección satelital oficial (${startDate} a ${endDate})
var col = ee.ImageCollection('${meta.collectionId}')
    .filterBounds(aoi)
    .filterDate('${startDate}', '${endDate}')${cloudFilter};

// 3. Mapear el cálculo de ${index.id} sobre TODA la colección temporal
${mapFunctionCode}

// 4. Centrar vista y añadir compósitos anuales para comparar año por año
Map.centerObject(aoi, 10);
var rgbBase = col.filterDate('${startYear}-01-01', '${startYear}-12-31').median();
Map.addLayer(rgbBase, {bands: ['${meta.rgbBands.join("', '")}'], min: ${meta.rgbVis.min}, max: ${meta.rgbVis.max}}, '${sensor} RGB (${startYear})', false);

for (var y = ${startYear}; y <= ${endYear}; y++) {
    var yearly = colWith${index.id}.filterDate(y + '-01-01', y + '-12-31').select('${index.id}').median();
    var isVisible = (y === ${startYear} || y === ${endYear});
    Map.addLayer(yearly, {min: ${minVal}, max: ${maxVal}, palette: palettes.${palette}}, '${index.id} (' + y + ')', isVisible);
}
`;
            }
        }
    }

    public static async showIndicesQuickPick() {
        const qp = vscode.window.createQuickPick();
        qp.placeholder = 'Selecciona un Índice Espectral (ej. NDVI, NDWI, EVI, NBR, SAVI, BSI)...';
        qp.matchOnDescription = true;
        qp.matchOnDetail = true;

        const categoryIcons: Record<string, string> = {
            'Vegetation': '🌿',
            'Water': '💧',
            'Burn': '🔥',
            'Soil/Urban': '🏙️',
            'Snow': '❄️'
        };

        qp.items = SPECTRAL_INDICES.map(idx => {
            const icon = categoryIcons[idx.category] || '📊';
            return {
                label: `${icon} ${idx.id}`,
                description: idx.name,
                detail: `Categoría: ${idx.category} | Fórmula: ${idx.formulaDescription}`,
                indexDef: idx
            } as vscode.QuickPickItem & { indexDef: SpectralIndexDefinition };
        });

        qp.onDidAccept(async () => {
            const selected = qp.selectedItems[0] as (vscode.QuickPickItem & { indexDef?: SpectralIndexDefinition });
            qp.hide();
            qp.dispose();

            if (!selected || !selected.indexDef) return;
            const indexDef = selected.indexDef;

            // Step 2: Choose Sensor
            const sensorPicks: vscode.QuickPickItem[] = [
                { label: '🛰️ Sentinel-2', description: 'MSI (Level-2A, 2015-presente)', detail: 'Bandas: B2, B3, B4, B8, B11, B12' },
                { label: '🛰️ Landsat 8/9', description: 'OLI / OLI-2 (Level-2, 2013-presente)', detail: 'Bandas: SR_B2, SR_B3, SR_B4, SR_B5, SR_B6, SR_B7' },
                { label: '🛰️ Landsat 4/5/7', description: 'TM / ETM+ (Level-2, 1984-2022)', detail: 'Bandas: SR_B1, SR_B2, SR_B3, SR_B4, SR_B5, SR_B7' },
                { label: '🛰️ MODIS', description: 'Terra Surface Reflectance (2000-presente)', detail: 'Bandas: sur_refl_b01, sur_refl_b02, sur_refl_b06...' },
                { label: '🌐 Generic Bands', description: 'Bandas universales (NIR, RED, GREEN, BLUE, SWIR1, SWIR2)' }
            ];

            const sensorSelected = await vscode.window.showQuickPick(sensorPicks, {
                placeHolder: `Selecciona el sensor satelital para calcular ${indexDef.id}:`
            });

            if (!sensorSelected) return;

            let sensorName = 'Sentinel-2';
            if (sensorSelected.label.includes('Landsat 8/9')) sensorName = 'Landsat 8/9';
            else if (sensorSelected.label.includes('Landsat 4/5/7')) sensorName = 'Landsat 4/5/7';
            else if (sensorSelected.label.includes('MODIS')) sensorName = 'MODIS';
            else if (sensorSelected.label.includes('Generic')) sensorName = 'Generic';

            // Step 3: Determine language from active editor
            const editor = vscode.window.activeTextEditor;
            let lang = 'javascript';
            let docText = '';
            if (editor) {
                docText = editor.document.getText();
                const ext = editor.document.fileName.split('.').pop()?.toLowerCase();
                const firstLine = editor.document.lineCount > 0 ? editor.document.lineAt(0).text.trim().toLowerCase() : '';
                if (firstLine.startsWith('# py') || ext === 'py') lang = 'python';
                else if (firstLine.startsWith('# r') || ext === 'r') lang = 'r';
                else lang = 'javascript';
            }

            const sensorMeta = SENSOR_METADATA[sensorName];

            // If sensor is Generic, insert formula directly
            if (!sensorMeta) {
                const generatedCode = SpectralIndicesManager.generateCode(indexDef, sensorName, 'image', lang);
                await SpectralIndicesManager.insertOrCopyCode(editor, generatedCode, indexDef.id, sensorName);
                return;
            }

            // Step 4: Ask whether user wants a Full Self-Contained Pipeline or just the Formula
            const hasImageDeclared = /\b(var\s+image|let\s+image|const\s+image|image\s*=)\b/.test(docText);

            const modeItems: vscode.QuickPickItem[] = [
                {
                    label: '🚀 Flujo Completo en Colección (Recomendado)',
                    description: `Carga colección ${sensorName}, filtra período, calcula ${indexDef.id} con .map() y visualiza`,
                    detail: 'Ideal para compósitos o series de tiempo sin errores de "image is not defined".'
                },
                {
                    label: '⚡ Solo Fórmula del Índice',
                    description: `Calcula ${indexDef.id} sobre una variable de imagen ya existente en tu script`,
                    detail: hasImageDeclared ? 'Detectada variable "image" en tu script actual.' : 'Requiere que ya tengas una variable de imagen declarada.'
                }
            ];

            const modeSelected = await vscode.window.showQuickPick(modeItems, {
                placeHolder: `¿Cómo deseas insertar el cálculo de ${indexDef.id}?`
            });

            if (!modeSelected) return;

            if (modeSelected.label.includes('Flujo Completo')) {
                // Step 5: Ask for Year or Year Range with validation
                const yearPrompt = `Ingresa un año (ej. ${sensorMeta.defaultYear}) o rango de años (ej. ${sensorMeta.minYear}-${sensorMeta.maxYear})`;
                const yearInput = await vscode.window.showInputBox({
                    title: `Año o Rango de Años para ${sensorName}`,
                    prompt: yearPrompt,
                    value: `${sensorMeta.defaultYear}`,
                    placeHolder: `ej. 2023 o ${sensorMeta.minYear}-${sensorMeta.maxYear}`,
                    validateInput: (val) => {
                        const trimmed = val.trim();
                        // Check single year
                        const singleMatch = trimmed.match(/^(\d{4})$/);
                        if (singleMatch) {
                            const y = parseInt(singleMatch[1], 10);
                            if (y < sensorMeta.minYear || y > sensorMeta.maxYear) {
                                return `⚠️ ${sensorName} solo tiene datos disponibles entre ${sensorMeta.minYear} y ${sensorMeta.maxYear}.`;
                            }
                            return null;
                        }

                        // Check range e.g. 2015-2025 or 2015:2025 or 2015 a 2025
                        const rangeMatch = trimmed.match(/^(\d{4})\s*[-:aA\/]\s*(\d{4})$/);
                        if (rangeMatch) {
                            const y1 = parseInt(rangeMatch[1], 10);
                            const y2 = parseInt(rangeMatch[2], 10);
                            if (y1 > y2) {
                                return 'El año inicial no puede ser mayor al año final.';
                            }
                            if (y1 < sensorMeta.minYear || y2 > sensorMeta.maxYear) {
                                return `⚠️ ${sensorName} solo tiene datos disponibles entre ${sensorMeta.minYear} y ${sensorMeta.maxYear}.`;
                            }
                            return null;
                        }

                        return `Formato inválido. Ingresa un año (ej. 2023) o rango (ej. ${sensorMeta.minYear}-${sensorMeta.maxYear}).`;
                    }
                });

                if (!yearInput) return;
                const trimmedInput = yearInput.trim();

                let startYear = sensorMeta.defaultYear;
                let endYear = sensorMeta.defaultYear;

                const rangeMatch = trimmedInput.match(/^(\d{4})\s*[-:aA\/]\s*(\d{4})$/);
                if (rangeMatch) {
                    startYear = parseInt(rangeMatch[1], 10);
                    endYear = parseInt(rangeMatch[2], 10);
                } else {
                    const single = parseInt(trimmedInput, 10);
                    if (!isNaN(single)) {
                        startYear = single;
                        endYear = single;
                    }
                }

                const generatedCode = SpectralIndicesManager.generateFullPipelineCode(indexDef, sensorName, startYear, endYear, lang);
                const periodLabel = startYear === endYear ? `${startYear}` : `${startYear}-${endYear}`;
                await SpectralIndicesManager.insertOrCopyCode(editor, generatedCode, indexDef.id, `${sensorName} (${periodLabel})`);
            } else {
                // Formula only
                let imageVarName = 'image';
                if (!hasImageDeclared) {
                    const customVar = await vscode.window.showInputBox({
                        title: 'Nombre de la variable de imagen',
                        prompt: 'Ingresa el nombre de la variable de tu imagen en el código',
                        value: 'image'
                    });
                    if (customVar && customVar.trim()) {
                        imageVarName = customVar.trim();
                    }
                }

                const generatedCode = SpectralIndicesManager.generateCode(indexDef, sensorName, imageVarName, lang);
                await SpectralIndicesManager.insertOrCopyCode(editor, generatedCode, indexDef.id, sensorName);
            }
        });

        qp.show();
    }

    private static async insertOrCopyCode(editor: vscode.TextEditor | undefined, code: string, indexId: string, sensorDesc: string) {
        if (editor) {
            await editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage(`✅ Índice ${indexId} (${sensorDesc}) insertado en el editor.`);
        } else {
            await vscode.env.clipboard.writeText(code);
            vscode.window.showInformationMessage(`📋 Código de ${indexId} (${sensorDesc}) copiado al portapapeles.`);
        }
    }
}
