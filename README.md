# GEE IDE (Google Earth Engine IDE)

<p align="center">
  <img src="https://raw.githubusercontent.com/rralDev/gee-ide/main/media/logo.png" alt="GEE IDE Logo" width="130" />
</p>

<p align="center">
  <strong>The Ultimate Geospatial Development Environment for Google Earth Engine in Visual Studio Code.</strong><br>
  <em>Engineered for Researchers, Data Scientists, and Remote Sensing Professionals.</em>
</p>

<p align="center">
  <a href="#-philosophy--architecture-the-bridge-between-gee-and-rstudio"><img src="https://img.shields.io/badge/Paradigm-RStudio%20%2B%20VS%20Code-75AADB?style=flat-square" alt="RStudio Style"></a>
  <a href="#-unified-polyglot-support-gee-files"><img src="https://img.shields.io/badge/Languages-JavaScript%20%7C%20Python%20%7C%20R-orange?style=flat-square" alt="Polyglot"></a>
  <a href="#-licensing-ethics--intellectual-property"><img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square" alt="License Apache 2.0"></a>
  <a href="#-keyboard-shortcuts-cheat-sheet"><img src="https://img.shields.io/badge/Shortcuts-Cmd%2BEnter%20%7C%20Cmd%2BL-blueviolet?style=flat-square" alt="Shortcuts"></a>
</p>

---

## 📖 Table of Contents
1. [Philosophy & Architecture: The Bridge Between GEE and RStudio](#-philosophy--architecture-the-bridge-between-gee-and-rstudio)
2. [The 4-Quadrant Scientific Workspace](#-the-4-quadrant-scientific-workspace)
3. [Unified Polyglot Support: `.gee` Files](#-unified-polyglot-support-gee-files)
4. [File Association, Icons & Quick Look Previews (`.gee`)](#-file-association-icons--quick-look-previews-gee)
5. [Intelligent Execution Engine & Scientific REPL](#-intelligent-execution-engine--scientific-repl)
6. [Interactive Terminal & Dynamic Multi-Tab Sessions](#-interactive-terminal--dynamic-multi-tab-sessions)
7. [High-Speed Parallel Pixel Inspector](#-high-speed-parallel-pixel-inspector)
8. [Geometry Tools & Vector Digitization](#-geometry-tools--vector-digitization)
9. [Integrated Help & Documentation System (`?` and `help`)](#-integrated-help--documentation-system--and-help)
10. [Snippet System with Tab-Stop Navigation](#-snippet-system-with-tab-stop-navigation)
11. [Real-Time Synchronized Leaflet Map Viewer](#-real-time-synchronized-leaflet-map-viewer)
12. [Awesome Spectral Indices Wizard](#-awesome-spectral-indices-wizard)
13. [Zero-Friction Unified Authentication & Cloud Project Detection](#-zero-friction-unified-authentication--cloud-project-detection)
14. [Cloud Assets Explorer, Task Monitor & Virtual CLI Filesystem](#-cloud-assets-explorer-task-monitor--virtual-cli-filesystem)
15. [Smart Auto-Plotting Engine & Public Data Catalog Search (+1,100 Datasets)](#-smart-auto-plotting-engine--public-data-catalog-search-1100-datasets)
16. [Advanced Satellite Grid Overlay Suite (Landsat, MODIS, Sentinel-2)](#-advanced-satellite-grid-overlay-suite-landsat-wrs-2-modis-sinusoidal-sentinel-2-mgrs)
17. [Project Management & Portable Packaging (`.geeproj` / Bundle `.zip`)](#-project-management--portable-packaging-geeproj--bundle-zip)
18. [Keyboard Shortcuts Cheat Sheet](#-keyboard-shortcuts-cheat-sheet)
19. [Licensing, Ethics & Intellectual Property](#-licensing-ethics--intellectual-property)

---

## 🏛 Philosophy & Architecture: The Bridge Between GEE and RStudio

Historically, spatial data scientists and remote sensing analysts faced a forced trade-off:
1. **The official Google Earth Engine Code Editor (Web):** Excellent for rapid JavaScript prototyping with an integrated map canvas, but confined to a single language inside a browser tab, lacking local version control (git), offline file management, and customizable keybindings.
2. **Scientific Desktop IDEs like RStudio or Jupyter:** Renowned for their unparalleled scientific ergonomics (line-by-line block execution, instant in-memory variable evaluation, interactive terminal with persistent history, and robust template management), yet lacking native, reactive synchronization with Earth Engine's visual map layer stack.

**GEE IDE bridges this gap directly inside Visual Studio Code:**
* Adopts the **4-quadrant interactive layout** and productivity ergonomics of **RStudio** (automatic variable inspection, classic shortcuts like `Cmd+L` / `Ctrl+L`, project-level persistent `.gee_history`, instant inline `?help`, and tabstop-driven snippets).
* Preserves the immediate visual feedback of the **GEE Code Editor** via a dedicated reactive console and real-time Leaflet map viewer.
* Enables seamless polyglot scripting in **JavaScript, Python, or R** within the same workspace—eliminating repetitive environment configurations and multi-account login fatigue.

---

## 🪟 The 4-Quadrant Scientific Workspace

Executing the command `GEE IDE: Start Environment` automatically organizes your editor into an ergonomic 2x2 scientific grid:

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│  QUADRANT 1: Code Editor             │  QUADRANT 2: Leaflet Map Viewer      │
│  - Polyglot scripts (.gee)           │  - Live satellite layer rendering    │
│  - JS / Python / R syntax routing    │  - Interactive coordinate inspector  │
│  - Tabstop snippet expansion         │  - Map.addLayer / Map$addLayer sync  │
├──────────────────────────────────────┼──────────────────────────────────────┤
│  QUADRANT 3: Interactive Console     │  QUADRANT 4: Tasks & Assets Manager  │
│  - Reactive prompt gee>              │  - Visual Earth Engine Assets tree   │
│  - Automatic server-side evaluation  │  - Task monitor & export tracker     │
│  - Infinite history (.gee_history)   │  - Storage quota & asset inspector   │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 💾 Persistent Custom Layouts
Unlike rigid editor layouts, GEE IDE provides full workspace sovereignty:
* **Drag & Resize:** Freely reposition, dock, stack, or float any view across single or multi-monitor setups.
* **Save as Default:** Press `Cmd+Shift+P` ➔ **`GEE IDE: Save Current Layout as Default`**. GEE IDE remembers your preferred geometry across project reloads without overriding it upon startup.
* **Reset Layout:** Restore the pristine 2x2 scientific grid anytime via `Cmd+Shift+P` ➔ **`GEE IDE: Reset to 2x2 Grid Layout`**.

---

## 🌐 Unified Polyglot Support: `.gee` Files

> ⚠️ **Important Notice on Language Support:**
> All IDE features, map interactions, REPL evaluations, and cloud tool integrations in GEE IDE are primarily developed, continuously benchmarked, and **fully production-stable in JavaScript (`// js`)**. 
> Support for **Python (`# py`)** and **R (`# r`)** is currently in active experimental development. Some language-specific bridge features may encounter unexpected behaviors while these two engines are being finalized.

GEE IDE introduces the **`.gee`** file specification. A single project can orchestrate scripts across the three major remote sensing languages using **shebang routing** on the first line:

### 1. JavaScript (`// js`)
Executed locally via Node.js coupled with the official `@google/earthengine` client:
```javascript
// js
var collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterDate('2024-01-01', '2024-03-31')
  .filterBounds(Map.getBounds());

var image = collection.median();
Map.addLayer(image, {bands: ['B4', 'B3', 'B2'], min: 0, max: 3000}, 'Sentinel-2 RGB');
print('Image count:', collection.size());
```

### 2. Python (`# py`)
Seamlessly routed through your Python environment with `earthengine-api` and `geemap`:
```python
# py
import ee

collection = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate('2024-01-01', '2024-03-31'))

image = collection.median()
Map.addLayer(image, {'bands': ['B8', 'B4', 'B3'], 'min': 0, 'max': 3000}, 'False Color (NIR)')
print('Metadata evaluated in Python.')
```

### 3. R (`# r`)
Executed through the R spatial ecosystem using `rgee` and `reticulate`:
```R
# r
library(rgee)

collection <- ee$ImageCollection('COPERNICUS/S2_SR_HARMONIZED')$
  filterDate('2024-01-01', '2024-03-31')

image <- collection$median()
Map$addLayer(image, list(bands = c('B4', 'B3', 'B2'), min = 0, max = 3000), 'RGEE Sentinel')
print('Analysis executed in R.')
```

---

## 🖱️ File Association, Icons & Quick Look Previews (`.gee`)

When working with a specialized file format like `.gee`, operating systems initially display a generic document icon and cannot preview source code lines without specific configurations. GEE IDE includes everything required to configure an intuitive desktop experience in under one minute:

---

### 1. 📂 Double-Click to Open (VS Code Association)

#### 🍎 macOS (Finder):
1. In **Finder**, right-click any `.gee` file.
2. Select **Get Info** (or press `Cmd + I`).
3. Under **Open with:**, select **Visual Studio Code** from the dropdown menu.
4. Click **Change All...** and confirm **Continue**.
> 🚀 *All `.gee` files across your system will now launch directly in VS Code upon double-click.*

#### 🪟 Windows (File Explorer):
1. Right-click any `.gee` file.
2. Select **Open with** ➔ **Choose another app**.
3. Select **Visual Studio Code**.
4. Check the box: **"Always use this app to open .gee files"**.
5. Click **OK**.

#### 🐧 Linux (Ubuntu, Debian, Fedora, Arch):
1. Right-click any `.gee` file ➔ **Properties**.
2. Navigate to the **Open With** tab.
3. Select **Visual Studio Code** and click **Set as default**.
*(Or via terminal: `xdg-mime default code.desktop text/x-gee`)*.

---

### 2. 👁️ Quick Look & System Source Code Previews

By default, operating systems treat unknown extensions as non-text binary data. To preview syntax-highlighted code when pressing the **Spacebar** in macOS or opening the preview pane in Windows:

#### 🍎 macOS (Quick Look with Spacebar):
* **Recommended Utility (Community Standard):**
  Install the open-source utility **Syntax Highlight** (fully optimized for Apple Silicon and macOS Sonoma/Sequoia):
  ```bash
  brew install --cask syntax-highlight
  ```
  *(Or download it from [GitHub sbarex/SourceCodeSyntaxHighlight](https://github.com/sbarex/SourceCodeSyntaxHighlight)).*
* **Configuration:**
  Open **Syntax Highlight Settings**, go to **Plain**, click `+`, set `File name pattern: *.gee` and select `Syntax: JavaScript`. In macOS **System Settings** ➔ **Privacy & Security** ➔ **Extensions** ➔ **Quick Look**, ensure **Syntax Highlight** is enabled.
  > ✨ *Pressing **Spacebar** on any `.gee` file in Finder immediately reveals syntax-colored code with line numbering without opening an editor.*

#### 🪟 Windows (Preview Pane `Alt + P`):
To enable live code previewing in Windows File Explorer:
1. Save the following registry script as `preview_gee.reg`:
```ini
Windows Registry Editor Version 5.00

[HKEY_CLASSES_ROOT\.gee]
"PerceivedType"="text"
"Content Type"="text/plain"
```
2. Double-click `preview_gee.reg` to merge into the registry.
> ✨ *Pressing `Alt + P` in File Explorer displays full syntax-colored code in the side preview pane.*

#### 🐧 Linux (GNOME Sushi):
Install **Sushi** on GNOME desktop environments:
```bash
sudo apt install gnome-sushi
```
Pressing **Spacebar** over a `.gee` file in Nautilus immediately renders the source code.

---

### 3. 🎨 Customizing the File Icon

#### 🍎 macOS File Icon:
1. Open the official logo `media/logo.png` in macOS **Preview**.
2. Press `Cmd + A` (select all) and `Cmd + C` (copy).
3. In Finder, right-click your `.gee` file and press **`Cmd + I`** (*Get Info*).
4. Click the small document icon in the top-left corner (highlighted in blue).
5. Press **`Cmd + V`** (paste).
> ✨ *The generic icon is replaced with the official **GEE IDE** insignia.*

#### 🪟 Windows System-Wide Icon:
Use the included `media/gee.ico` file to brand all `.gee` files:
1. Save the following as `icon_gee.reg`:
```ini
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Classes\.gee]
@="GEE_Script_File"
"PerceivedType"="text"

[HKEY_CURRENT_USER\Software\Classes\GEE_Script_File\DefaultIcon]
@="C:\\Path\\To\\Your\\Project\\media\\gee.ico,0"

[HKEY_CURRENT_USER\Software\Classes\GEE_Script_File\shell\open\command]
@="\"C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe\" \"%1\""
```
2. Double-click `icon_gee.reg` to apply system-wide.

#### 🐧 Linux System-Wide Icon:
Copy the official logo to your desktop theme icon directory:
```bash
mkdir -p ~/.local/share/icons/hicolor/128x128/mimetypes/
cp media/logo.png ~/.local/share/icons/hicolor/128x128/mimetypes/text-x-gee.png
gtk-update-icon-cache ~/.local/share/icons/hicolor/
```

---

## ⚡ Intelligent Execution Engine & Scientific REPL

### 1. Smart Block & Chain Detection (`Cmd + Enter` / `Ctrl + Enter`)
Faithful to the ergonomics of **RStudio**:
* **Fluid Multiline Method Chaining:** When cursor is positioned within fluent method calls (`.filterDate().filterBounds()`, pipes `%>%`, `|>`, or indented Python blocks), GEE IDE detects the entire expression and executes it as a singular unified block.
* **Automatic Line Advancement:** After execution, the cursor advances to the next runnable statement, skipping empty lines and comments for frictionless, continuous exploration.

### 2. Automatic Expression Evaluation (RStudio-Style Auto-Printing)
In RStudio, highlighting a variable name and pressing `Cmd+Enter` evaluates and displays its contents immediately without requiring explicit `print()` statements:
* **Native in GEE IDE:** Selecting any variable, calculation, or server-side recipe (e.g., `serverNumber.add(5).multiply(2)` or `serverText`) automatically evaluates the expression. If the result is an Earth Engine server object (`ee.*`), it automatically invokes `.getInfo()` and renders the Google Cloud resolved payload cleanly in the console.

---

## 🖥 Interactive Terminal & Dynamic Multi-Tab Sessions

The GEE IDE console is a native, high-performance interactive scientific terminal (PTY powered by xterm.js) engineered for geospatial analytics and polyglot computing:

### 1. Dynamic Multi-Tab Management & Clean Isolated Sessions
* **Tab Switcher (`+` and `x` Buttons):** Add fresh terminals on demand using the `+` button in the terminal header bar, and close inactive sessions with `x`.
* **Guaranteed Clean Slate:** Every new terminal session begins completely fresh, ensuring that ongoing experiments or test scripts never inherit stale variables, contaminated memory, or residual state from earlier executions.
* **Concurrent Polyglot Shells:** Run simultaneous JavaScript interactive sessions (`gee>`) and Python REPLs (`gee (py)>`) side by side.

### 2. Silent OAuth Token Auto-Refresh
* **Zero Interruption Workflows:** GEE IDE automatically monitors and refreshes Google Cloud access tokens (`refresh_token`, `client_id`, `client_secret`) in the background across JavaScript and Python REPL processes, preventing authentication timeouts during extended modeling runs.

### 3. Native Terminal Ergonomics
* **🧹 Instant Clearing (`Cmd + L` / `Ctrl + L`):**
  Wipes the console canvas clean instantly, functional both when typing in the editor or focused directly on the prompt.
* **📜 Persistent Project History (`.geehistory`):**
  Mirroring RStudio's `.Rhistory`, every interactive statement executed via the prompt or sent from the editor is appended to `.geehistory` in your project root.
  * Recall previous statements using **Up Arrow (↑)** and **Down Arrow (↓)**.
  * Enter **`history`** at the prompt to inspect an indexed catalog of prior executions.
* **📊 In-Memory Variable Inspector:**
  Type **`vars`** in any mode to list active in-memory variables and their Earth Engine representations.
* **💡 Reactive Tab Completion:**
  Press **`Tab`** in the prompt to autocomplete active variable identifiers, built-in commands, and Earth Engine asset paths.

---

## 🎯 High-Speed Parallel Pixel Inspector

The GEE IDE Pixel Inspector provides instant, multi-spectral point sampling directly upon clicking any coordinate across the interactive map:

* **Parallel Multi-Threaded Sampling (`ThreadPoolExecutor`):** When querying multiple satellite layers, spatial point reductions run concurrently across worker threads, dramatically reducing response latency.
* **Robust Multi-Band Support (`maxPixels: 1e6`):** Engineered for dense image collections containing dozens of bands without triggering pixel limit exceptions.
* **Clean Terminal Architecture:** Coordinate and band inspection payloads no longer flood or pollute the active terminal session. All information is organized cleanly in a floating map card.
* **Floating Map Card with `📋 Copy JSON` Button:**
  * Displays precise geographic coordinates (Latitude, Longitude) and current zoom level.
  * Hierarchical breakdown of every active layer, band name, and sampled numeric value.
  * Interactive **`📋 Copy JSON`** button to export the complete inspection payload directly to the clipboard.

---

## 📐 Geometry Tools & Vector Digitization

GEE IDE features built-in drawing controls to digitize regions of interest (ROI), transects, and sampling coordinates directly on the satellite map:

* **Direct Keyboard Shortcuts for Digitization:**
  * **`Ctrl + 1`**: Activate **Point** tool (`Point`).
  * **`Ctrl + 2`**: Activate **Line** tool (`LineString`).
  * **`Ctrl + 3`**: Activate **Polygon** tool (`Polygon`).
  * **`Ctrl + 4`**: Activate **Rectangle** tool (`Rectangle`).
  * **`Esc` or `Ctrl + 0`**: Deactivate active drawing tool and return instantly to **Navigation Mode (Hand / Pan)**.
* **Contextual 3D Exploration in Google Earth:**
  * **`Cmd + Shift + Click`** (macOS) / **`Ctrl + Shift + Click`** (Win/Linux) on any map coordinate opens **Google Earth 3D** in your default web browser for immersive, high-resolution terrain verification.
* **Pro Features Notification:**
  * Advanced capabilities reserved for GEE IDE Pro (such as the *Spyglass Lens* with `Shift`, *Quad-Swipe 2x2* with `Ctrl+Shift`, or the *Satellite Grid Overlay Suite*) display an informative HUD banner in the Free edition noting their availability in GEE IDE Pro.

---

## ❓ Integrated Help & Documentation System (`?` and `help`)

Eliminate the cognitive disruption of switching to a browser to lookup Earth Engine algorithm signatures. Query official documentation directly inside the interactive console:

```text
gee> ?ee.Image.normalizedDifference
```
or
```text
gee> help(ee.Algorithms.Landsat.simpleCloudScore)
```

**The console returns structured, technical metadata:**
1. Method overview and functional description.
2. Required and optional parameters with expected types.
3. Default parameter values.
4. Return type specification.

*Built-in system command reference is also available:* `?vars`, `?history`, `?clear`, `?snippets`, `?ls`.

---

## ✂️ Snippet System with Tab-Stop Navigation

Typing redundant Earth Engine boilerplate consumes valuable analytical focus. GEE IDE incorporates an enterprise-grade snippet engine:

### 1. Built-in Core Library (Pre-installed)
Type a prefix and hit **`Tab`** to deploy standard remote sensing patterns, jumping across placeholders with successive **`Tab`** keystrokes:
* **`eecol`** ➔ Full `ee.ImageCollection` with spatial and temporal filters.
* **`eeimg`** ➔ Standalone `ee.Image('...')` declaration.
* **`ndvi`** / **`ndwi`** ➔ Spectral index calculation with `.normalizedDifference(...)`.
* **`maplayer`** / **`addlayer`** ➔ `Map.addLayer(...)` with visualization parameters.
* **`cloudmask`** ➔ Sentinel-2 / Landsat QA60 cloud and cirrus masking routine.
* **`exportimg`** / **`exporttable`** ➔ Google Drive export task blocks.
* **`reduce`** ➔ Zonal statistics via `reduceRegion` with statistical reducer choices.
* **`shebangjs`**, **`shebangpy`**, **`shebangr`** ➔ Instant language headers.

### 2. User-Defined Custom Snippets (RStudio-Style)
* **Global Universal Configuration:** Stored at `~/.config/earthengine/snippets.json`, accessible across all current and future projects.
* **Quick Configuration Command:** Press `Cmd+Shift+P` ➔ **`GEE IDE: Edit User Snippets`**.
* **Hot-Reload:** Saving the JSON file (`Cmd+S`) updates autocomplete suggestions immediately without restarting the window.

### 3. Interactive Snippet Search & Insertion
* **Editor QuickPick:** Press `Cmd+Shift+P` ➔ **`GEE IDE: List & Insert Snippet`** to open a real-time searchable palette. Selecting any snippet inserts it directly at cursor with tabstops active.
* **Console Catalog:** Type **`snippets`** at the `gee>` prompt to print a catalog of all registered templates.

---

## 🗺 Real-Time Synchronized Leaflet Map Viewer

Quadrant 3 hosts an integrated Leaflet map canvas engineered specifically for remote sensing analysis and interactive GIS workflows:
* **Bidirectional Socket Bridge:** An internal socket bridge (`PythonBridgeServer`) intercepts `Map.addLayer(...)` calls across JavaScript, Python, and R, rendering spatial rasters and vectors live in seconds.
* **🎛 Advanced Layers Manager:**
  * **Dynamic Responsive Viewport:** Dynamically adapts its height (`max-height: calc(100vh - 195px)`) with smooth internal scrolling, ensuring that extensive layer stacks never overlap or obscure bottom action buttons (Swipe, Draw, Tools).
  * **Compact Floating Dock:** A dedicated, non-intrusive **Layers** dock with auto-collapse, pin mode (always visible or hover-only), and numeric toggle shortcuts (`1..9` and `0` to toggle all).
  * **Individual Layer Controls:** Instant per-layer visibility toggles and continuous precision opacity sliders (`0% – 100%`).
  * **Automatic Map Legends & True Color Swatches:** Adding any raster with a `palette` (e.g. `palettes.ndvi`) automatically renders an inline gradient legend with min/max values. Multi-band RGB images display an intelligent True Color preview swatch.
  * **Hierarchical Grouping:** Supports subfolder organization (e.g., `Classifications/NDVI`) with group-level visibility toggles.
* **🔀 Advanced Swipe Comparison Tool (Split Panel / BC Mode):**
  * **Interactive Dual-Layer Comparison:** Activate the split-screen slider by clicking the floating 🔀 (BC) button in the map toolbar to visually compare the top two visible raster layers.
  * **Dual-Orientation Mode (Vertical & Horizontal):** Seamlessly switch between vertical split (side-by-side) and horizontal split (top-to-bottom).
  * **Instant Shortcut & Handle Toggle:** Press `Command` (macOS) / `Ctrl` (Windows/Linux) or simply **double-click** the center divider handle to toggle between vertical and horizontal orientation on the fly.
  * **Context-Aware Dynamic Badges:** Real-time badges display `[L]` (Left) and `[R]` (Right) in vertical mode, and automatically switch to `[T]` (Top) and `[B]` (Bottom) in horizontal mode.
  * **Zero-Flicker Tile Stacking:** Native DOM hierarchy ensures pixel-perfect clipping and eliminates tile desynchronization or displacement during drag interactions.
* **📸 HD Retina Map Snapshots (`Option + S` / `Alt + S`):**
  * One-click or hotkey capture of the current map viewport in crystal-clear **2x Retina resolution**.
  * Automatic export to a dedicated `Screenshots/` directory within your workspace (`gee_snapshot_YYYYMMDD_HHMMSS.png`).
  * Instant access via interactive HUD notifications: **Open Image**, **Open Folder**, **Save As...**, and **Copy to Clipboard**.
* **✏️ Interactive Vector Geometry & GIS Drawing Tools:**
  * **Drawing Toolbar:** Draw custom Points/Markers, Polygons, Rectangles, Polyline transects, and Circles directly over satellite basemaps.
  * **GIS Micro-Dot Vertices:** High-precision, jitter-free 9px circular vertex handles with glow feedback for fine-grained boundary editing.
  * **Floating Micro-Dock Toolbar:** Clicking any drawn geometry displays an elevated micro-toolbar `[ ✏️ Edit ] [ 🎨 Style ] [ 🗑️ Delete ]` directly above the shape without obscuring vertices.
  * **10-Color Curated GIS Palette & Custom HTML/HEX Input:** Select from 10 industry-standard GIS colors (Emerald Green, Ruby Red, Sapphire Blue, Amber Orange, etc.) or enter custom `#HEX` / HTML codes with real-time preview and one-click application.
  * **Accidental Loss Prevention:** Two-step inline confirmation (`¿Eliminar? [ ✓ ] [ ✕ ]`) prevents accidental deletion of complex digitized boundaries.
* **📍 High-Precision Coordinate & Pixel Inspector:**
  * Click anywhere on the map to inspect raw pixel values for all active raster layers with collapsible, dark-themed accordion cards.
  * Hold `Alt`, `Cmd`, or `Ctrl` while hovering to activate the precision crosshair, preventing accidental map panning.
  * Copy raw coordinates `[lon, lat]` or click **"📋 Copiar Todo (JSON)"** to copy complete pixel records to clipboard.
  * **Fly to Google Earth Pro:** `Cmd + Shift + Click` (macOS) or `Ctrl + Shift + Click` (Windows/Linux) directly on the map to launch Google Earth Desktop and automatically fly the 3D camera to that exact location.
  * Inspected points are automatically logged to the `gee>` Console. Press `Esc` to close the inspector popup.
* **🎨 Built-in Curated Global Palettes (`palettes`):**
  * Injected directly into the script execution scope: `palettes.ndvi`, `palettes.water`, `palettes.dem`, `palettes.temperature`, `palettes.fire`, `palettes.soil`, `palettes.snow`, `palettes.urban`.

---

## 🌿 Awesome Spectral Indices Wizard

GEE IDE features an integrated, full-featured **Spectral Indices Wizard** designed to generate complete, ready-to-run Earth Engine processing workflows for environmental, agricultural, and hydrological monitoring:

* **Command Palette & Editor Access:** Press `Cmd+Shift+P` ➔ **`GEE IDE: Insert Spectral Index`** or right-click in any `.gee` file and select **Insert Spectral Index**.
* **10+ Standardized Indices:** Instantly configure algorithms for:
  * **Vegetation:** `NDVI`, `EVI`, `SAVI`, `MSAVI`, `GNDVI`, `NDRE`
  * **Water & Moisture:** `NDWI` (McFeeters), `MNDWI` (Xu), `NDMI`
  * **Burn & Fire Severity:** `NBR`, `NBR2`
  * **Built-up / Urban:** `NDBI`
* **Comprehensive Multi-Sensor Calibration:** Automatically binds correct sensor band names and radiometric calibrations across:
  * **Sentinel-2 MSI** (Harmonized Level-2A / Level-1C)
  * **Landsat 8 & 9 OLI/TIRS** (Surface Reflectance Tier 1)
  * **Landsat 4, 5 & 7 TM/ETM+** (Surface Reflectance Tier 1)
  * **MODIS Terra/Aqua** (MOD09GA / MOD13Q1)
* **Automated Multi-Year Time Series Loops:**
  * Select a multi-year analysis range (e.g. `2015 – 2020`).
  * The wizard automatically generates an annual loop creating median/mean composites for each calendar year.
  * Adds each year sequentially to the Map Viewer with calibrated index palettes and smart layer names (e.g., `NDVI_2015`, `NDVI_2020`).
  * **Instant Split-Panel Ready:** Layers are loaded sequentially into the Map Viewer, ready for immediate comparison using the Swipe Tool (BC).
* **Polyglot Code Generation:** Generates clean, idiomatic code formatted for your active language: JavaScript (`// js`), Python (`# py`), or R (`# r`).
* **Smart Visualization Injection:** Automatically imports curated color palettes (`palettes.ndvi`, `palettes.water`, etc.) and calibrated min/max dynamic ranges.

---

## 🔑 Zero-Friction Unified Authentication & Cloud Project Detection

Earth Engine authentication across heterogeneous language runtimes is traditionally fragmented. GEE IDE unifies this workflow:
1. **Loopback OAuth 2.0 Flow:**
   Press `Cmd+Shift+P` ➔ **`GEE IDE: Login with Google (Easy)`**. A secure local server completes the browser handshake, automatically persisting tokens securely.
2. **Automated Cloud Project Resolution:**
   The IDE queries associated Google Cloud projects and sets the active `Project ID` without manual credential juggling.
3. **Tri-Language Token Synchronization:**
   A single authentication handshake simultaneously provisions sessions for JavaScript, Python (`earthengine-api`), and R (`rgee`).

---

## 📂 Cloud Assets Explorer, Task Monitor & Virtual CLI Filesystem

Manage cloud storage assets and monitor long-running background tasks directly from Quadrant 4 without switching to a web browser:

### 1. Cloud Asset Manager
* **Persistent Tree View:** An elegant, native-feeling hierarchical directory tree that remembers open folders across workspace reloads and script executions.
* **Two-Step Secure Folder Creation:** Click the `📁+` button in the header (or press `Cmd+Shift+N` / `Ctrl+Shift+N`) to trigger an interactive workflow: first select the parent project via a native `QuickPick` dropdown, then specify the new folder name. This prevents accidental creation attempts on read-only public catalogs.
* **Asset Details Modal:** Double-click any image or table to open an overlay modal displaying its complete cloud metadata, bands, properties, and dimensions.
* **Insert in Editor:** Click the `➕` button on any asset to insert its cloud identifier directly at your cursor in the `.gee` script.
* **Copy & Delete:** Quick-action buttons to copy the asset ID (`📋`) or safely delete assets (`❌`) directly from the panel.
* **Robust Cloud v1 API Normalization:** Built-in payload adaptation ensuring full compatibility with both legacy (`users/*`) and modern Google Cloud projects (`projects/*/assets`).

### 2. Cloud Tasks Manager (Minimalist Tree UI)
* **Compact Tree Design:** Seamlessly matches the Asset Manager's `.tree-item` layout, left-aligned and dynamically styled for dark and light VS Code themes.
* **Live Status & Duration:** View task execution durations (e.g. `(1m)`), types (`EXPORT_IMAGE`, `EXPORT_TABLE`), and real-time states (`READY`, `RUNNING`, `COMPLETED`, `FAILED`).
* **Optimistic Instant Updates:** Immediate reactive insertion (`🔄 Submitting to GEE...`) with multi-stage exponential polling bursts upon script evaluation.
* **Native Desktop OS Notifications:** Receives native OS banner alerts upon task completion (`✅ GEE Task completed`) or failure (`❌ GEE Task failed`) with intelligent memory diagnostic suggestions (`tileScale: 4`).
* **1-Click Contextual Actions:**
  * 🛑 **Cancel Task:** Immediately abort running or queued tasks.
  * 📁 **Google Drive Search:** Instantly opens a filtered search in Google Drive for exported image files.
  * 📋 **Copy Task ID:** Copies the unique cloud task identifier to the clipboard.
  * ⚠️ **Copy Error:** Copies sanitized, multi-line error traces from failed operations.

### 3. Interactive Virtual CLI Filesystem
Execute terminal-grade filesystem operations directly against Google Earth Engine servers:

* **3 Ways to Execute CLI Commands:**
  1. **Directly from the Code Editor (`Cmd + Enter` / `Ctrl + Enter`):** Type any CLI command on any line of your `.gee` script (e.g. `ls`, `du`, `pwd`, `find *`) and execute it.
  2. **Bash-Style `!` Prefix in Scripts:** Prefix lines with `!` to execute terminal commands inside your workflows (e.g. `!mkdir seasonal_2024`).
  3. **Programmatic Automation in JavaScript:** Automate batch tasks with native helper functions (`cli()`, `mkdir()`, `rm()`, `ls()`, `touch()`, `du()`, `mv()`, `cp()`, `find()`).

| Command | Official GEE API Equivalent (`ee.data.*`) | Syntax / Flags | Description & Practical Examples |
| :--- | :--- | :--- | :--- |
| **`ls` / `dir`** | `ee.data.listAssets(path)` | `ls [path] [pattern]` | Lists folder or collection contents. Supports glob matching (`*`, `?`). `ls ~` lists all project roots.<br>• *Examples:* `ls`, `ls ~`, `ls users/mi_usuario`, `ls *sentinel*` |
| **`pwd`** | *(Virtual Shell Context)* | `pwd` | Prints current working directory in Earth Engine assets hierarchy.<br>• *Example:* `pwd` |
| **`cd`** | *(Virtual Shell Context)* | `cd [path]` | Changes active working directory. Supports relative (`..`) and absolute paths (`~`, `users/...`, `projects/...`).<br>• *Examples:* `cd mi_carpeta`, `cd ..`, `cd ~` |
| **`mkdir`** | `ee.data.createFolder(path)` | `mkdir [-p] <path>` | Creates a new cloud asset folder. Flag `-p` creates parent folders recursively.<br>• *Examples:* `mkdir temporada_2024`, `mkdir -p proyectos/2024/ndvi` |
| **`touch`** | `ee.data.createAsset({type: 'ImageCollection'})` | `touch <name>` | Creates an empty `ImageCollection` container in Earth Engine.<br>• *Example:* `touch s2_composites_2024` |
| **`rm` / `rmdir`** | `ee.data.deleteAsset(id)` | `rm [-r/-rf] <target>` | Deletes assets. Flag `-r` enables recursive folder deletion. **Supports wildcard patterns (`*`, `?`)** for bulk cleanup!<br>• *Examples:* `rm old_image`, `rm -r old_folder`, `rm -r temp_*` |
| **`mv`** | `ee.data.renameAsset(src, dest)` | `mv <source> <dest>` | Renames or moves an asset across cloud folders or projects.<br>• *Examples:* `mv test_v1 test_v2`, `mv temp/raster final/raster` |
| **`cp`** | `ee.data.copyAsset(src, dest)` | `cp <source> <dest>` | Copies an asset from source to destination.<br>• *Example:* `cp backup_image working_image` |
| **`du` / `quota`** | `ee.data.getAssetRootQuota(root)` | `du [path]` | Displays storage usage and quota in megabytes and asset count. `du ~` inspects all project roots.<br>• *Examples:* `du`, `du ~`, `du users/mi_usuario` |
| **`find`** | `ee.data.listAssets(...)` *(recursive)* | `find [path] [-name pat] [-type typ] [-maxdepth n]` | Recursively searches assets with advanced filters (`-type FOLDER\|IMAGE\|TABLE\|IMAGE_COLLECTION`).<br>• *Examples:* `find *landsat*`, `find -type IMAGE`, `find -maxdepth 2` |
| **`catalog` / `search`** | *(Earth Engine Discovery REST API)* | `catalog <query>` | Searches the global Google Earth Engine public data catalog (+1,100 datasets) and generates runnable snippets.<br>• *Examples:* `catalog sentinel 2`, `search modis ndvi`, `find -c elevation` |
| **`vars` / `whos`** | *(In-Memory Scope Inspector)* | `vars` | Inspects all in-memory variables and their Earth Engine types (RStudio/MATLAB UX).<br>• *Example:* `vars` |
| **`history`** | *(Persistent .gee_history Log)* | `history [n]` | Displays command history stored in `.gee_history`. Use `!15` to re-execute event #15.<br>• *Examples:* `history`, `history 10`, `!5` |
| **`clear` / `cls`** | `console.clear()` | `clear` | Clears the interactive console screen canvas (`Cmd + L` / `Ctrl + L`).<br>• *Example:* `clear` |

---

## 🌐 Smart Auto-Plotting Engine & Public Data Catalog Search (+1,100 Datasets)

Query and discover over 1,100 official public Google Earth Engine datasets (Sentinel, Landsat, MODIS, ERA5, SRTM, Dynamic World, WorldCover, etc.) and auto-visualize spatial objects without friction:

### 1. Interactive Command Palette Search (`Cmd+Shift+P`)
* Press `Cmd+Shift+P` ➔ **`GEE IDE: Search Data Catalog`**.
* Search in real-time by mission, sensor, variable, band, or tag (e.g. `sentinel 2`, `landsat 8`, `elevation`, `srtm`, `modis ndvi`, `landcover`).
* Inspect temporal coverage, data type, and band summaries.
* **One-Click Actions:**
  * **Insert & Auto-Plot on Map:** Inserts the dataset declaration AND automatically appends `Map.centerObject()` and `Map.addLayer()` code. Includes a **Smart VisParams Guesser** that detects dataset type (NDVI, Elevation, Water, LST) and configures calibrated ranges and professional palettes.
  * **Insert in Editor:** Inserts language-aware declarations (`var s2 = ee.ImageCollection('...')` in JS, Python, or R) at active cursor.
  * **Copy Snippet & Open in Web:** Copies snippet to clipboard or opens the official Google documentation page.

### 2. Interactive CLI Search via `gee>` Console
* **Direct commands:**
  ```text
  gee> catalog sentinel 2
  gee> search modis ndvi
  gee> catalog srtm -type image
  gee> find -catalog "land cover"
  ```
* Prints dataset IDs, descriptions, temporal ranges, band lists, and runnable code snippets directly to the console canvas.

### 3. Smart Console Auto-Plot (RStudio UX)
Evaluating any Earth Engine spatial expression or native GeoJSON structure in the interactive `gee>` REPL automatically plots it on the Map Viewer and centers the camera without requiring explicit `Map.addLayer()`:
* **Supported Geometries:** Native support for `ee.Image`, `ee.ImageCollection`, `ee.FeatureCollection`, `ee.Feature`, `ee.Geometry` and raw GeoJSON `{"type": "Polygon", ...}`.
* **Intelligent True Color RGB Prioritization:** Automatically detects natural color band sets (`B4`/`B3`/`B2`, `B4_median`/`B3_median`/`B2_median`) and prioritizes them over thermal or QA bands, avoiding false gray scale previews.
* **Live Color Chips:** Auto-plots include representative color chips in the Layer Manager.

---

## 🌐 Advanced Satellite Grid Overlay Suite (Landsat WRS-2, MODIS Sinusoidal, Sentinel-2 MGRS)

To facilitate orbital acquisition planning, temporal collection filtering, and spatial navigation, GEE IDE integrates interactive satellite grid overlays directly in the free tier:

* **Instant Access:** Floating **`🌐 Grid`** button located in the map layer dock header (Quadrant 2/3), left of `Snap`.
* **Supported Grid Systems:**
  * **Landsat WRS-2:** Worldwide Reference System (Path and Row) for Landsat 4, 5, 7, 8, and 9.
  * **MODIS Sinusoidal:** Global sinusoidal tile partitioning ($10^\circ \times 10^\circ$ h/v tiles).
  * **Sentinel-2 MGRS:** Military Grid Reference System ($6^\circ$ UTM zones and 100 km grid cells).
* **Interactive Multi-Tile Selection:**
  * **Single Click:** Selects cell and displays micro-popup with Path/Row, Tile ID, or UTM zone info.
  * **`Shift + Click`:** Select or deselect multiple orbital tiles concurrently on the map canvas.
  * **Floating Selection Bar:** Displays live selection count with interactive identifier chips.
  * **Composite Filter Generator:**
    * **`[📋 Copy Filter]`**: Generates and copies optimized code (`ee.Filter.or([ ... ])` or `ee.Filter.inList('MGRS_TILE', [ ... ])`).
    * **`[✏️ Insert in Editor]`**: Automatically injects composite filter code at the active cursor position.

---

## 📦 Project Management & Portable Packaging (`.geeproj` / Bundle `.zip`)

GEE IDE adopts the project architecture made famous by **RStudio**, organizing scripts, local data, and map states into self-contained, reproducible workspaces:

* **Manifest File (`.geeproj`):**
  * Tracks project metadata, default entrypoint script, active language (JS, Python, R), and initial map center coordinates/zoom.
  * Reopening the folder in VS Code automatically restores map view framing and project configuration.
* **Status Bar Project Menu:**
  * Click `$(project) GEE: Project_Name` in the status bar to access quick shortcuts: center map on ROI, open entrypoint script, run complete pipeline, or edit settings.
* **1-Click Portable Bundling (`Bundle .zip`):**
  * Select **`$(archive) Empaquetar Proyecto en ZIP (.zip)`** from the project menu or execute `GEE IDE: Export Project Bundle (.zip)`.
  * Generates a clean, portable `.zip` archive excluding bloated temporary folders (`.git/`, `node_modules/`, `.DS_Store`), ideal for distributing classroom labs to students, attaching code to peer-reviewed papers, or sharing reproducible pipelines with colleagues.

---

## ⌨️ Keyboard Shortcuts Cheat Sheet

| macOS Shortcut | Windows/Linux Shortcut | Action | Context |
| :--- | :--- | :--- | :--- |
| `Cmd + Enter` | `Ctrl + Enter` | **Execute Line or Smart Block** | `.gee` Editor |
| `Cmd + Shift + Enter` | `Ctrl + Shift + Enter` | **Execute Entire Script** | `.gee` Editor |
| `Cmd + L` | `Ctrl + L` | **Clear Console Screen** | Global / Console |
| `Option + M` | `Alt + M` | **Toggle QGIS Distance & Area Measurement Ruler** | Map Viewer |
| `Option + S` | `Alt + S` | **Capture HD Map Snapshot (2x Retina)** | Map Viewer / Global |
| `Option + W` | `Alt + W` | **Toggle Basic Split Curtain (Swipe)** | Map Viewer |
| `Cmd + Shift + Click` | `Ctrl + Shift + Click` | **Inspect Map Location in Google Earth 3D (Web)** | Map Viewer |
| `Ctrl + 1` | `Ctrl + 1` | **Activate Point Drawing Tool (`Point`)** | Map Viewer (Geometries) |
| `Ctrl + 2` | `Ctrl + 2` | **Activate Line Drawing Tool (`LineString`)** | Map Viewer (Geometries) |
| `Ctrl + 3` | `Ctrl + 3` | **Activate Polygon Drawing Tool (`Polygon`)** | Map Viewer (Geometries) |
| `Ctrl + 4` | `Ctrl + 4` | **Activate Rectangle Drawing Tool (`Rectangle`)** | Map Viewer (Geometries) |
| `Esc` or `Ctrl + 0` | `Esc` or `Ctrl + 0` | **Deactivate Drawing and Return to Pan Mode** | Map Viewer (Geometries) |
| `1` – `9` | `1` – `9` | **Toggle Layer 1 to 9 Visibility** | Map Viewer (Layers Dock) |
| `Shift + 1` – `9` | `Shift + 1` – `9` | **Solo Layer 1 to 9 (Isolate Layer / Peek)** | Map Viewer (Layers Dock) |
| `0` | `0` | **Toggle All Layers Visibility** | Map Viewer (Layers Dock) |
| `Tab` | `Tab` | **Advance to next Snippet Placeholder** | Snippet Mode |
| `Shift + Tab` | `Shift + Tab` | **Return to previous Snippet Placeholder**| Snippet Mode |
| `↑` / `↓` | `↑` / `↓` | **Cycle Command History** | `gee>` Console |
| `Cmd + 1` | `Ctrl + 1` | **Focus Quadrant 1 (Code Editor)** | Global |
| `Cmd + 2` | `Ctrl + 2` | **Focus Quadrant 2 (Console / Terminal)** | Global |
| `Cmd + 3` | `Ctrl + 3` | **Focus Quadrant 3 (Map Viewer)** | Global |
| `Cmd + 4` | `Ctrl + 4` | **Focus Quadrant 4 (Tasks & Assets)** | Global |

---

## ⚖️ Licensing, Ethics & Intellectual Property

### Alignment with RStudio Ergonomics
GEE IDE intentionally incorporates **ergonomic interaction patterns and workflow concepts** popularized by **RStudio** (including REPL auto-evaluation, 4-quadrant layout partitioning, persistent `.gee_history` logging, inline `?` documentation lookup, and tabstop template expansion).

> **Intellectual Property & Legal Notice:**
> User interface workflows, keyboard shortcut conventions, and interactive programming paradigms are universal software design concepts in scientific computing. **GEE IDE does not copy, redistribute, or incorporate proprietary source code from RStudio / Posit Software, PBC**. All GEE IDE code is an original, clean-room implementation in TypeScript and JavaScript, distributed under the open-source **Apache License 2.0**.

### Open Source Attributions
* Built on the [Visual Studio Code](https://code.visualstudio.com/) extension ecosystem.
* Official [@google/earthengine](https://www.npmjs.com/package/@google/earthengine) JavaScript client (Apache License 2.0).
* Interactive mapping powered by [Leaflet](https://leafletjs.com/) (BSD 2-Clause License).
* Integrates with the open-source geospatial community around [rgee](https://github.com/r-spatial/rgee) and [geemap](https://geemap.org/).
* Inspired by community tools including [earthengine-extension](https://github.com/12rambau/earthengine-extension) (Apache License 2.0). See `NOTICES.md` for full attribution.

---

<p align="center">
  Crafted with dedication by <strong>Luis Robles</strong> for the global remote sensing, geospatial, and Earth observation scientific community.
</p>
