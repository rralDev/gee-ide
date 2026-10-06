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
  <a href="#-licensing-ethics--intellectual-property"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License MIT"></a>
  <a href="#-keyboard-shortcuts-cheat-sheet"><img src="https://img.shields.io/badge/Shortcuts-Cmd%2BEnter%20%7C%20Cmd%2BL-blueviolet?style=flat-square" alt="Shortcuts"></a>
</p>

---

## 📖 Table of Contents
1. [Philosophy & Architecture: The Bridge Between GEE and RStudio](#-philosophy--architecture-the-bridge-between-gee-and-rstudio)
2. [The 4-Quadrant Scientific Workspace](#-the-4-quadrant-scientific-workspace)
3. [Unified Polyglot Support: `.gee` Files](#-unified-polyglot-support-gee-files)
4. [File Association, Icons & Quick Look Previews (`.gee`)](#-file-association-icons--quick-look-previews-gee)
5. [Intelligent Execution Engine & Scientific REPL](#-intelligent-execution-engine--scientific-repl)
6. [Advanced Interactive Console & Persistent History](#-advanced-interactive-console--persistent-history)
7. [Integrated Help & Documentation System (`?` and `help`)](#-integrated-help--documentation-system--and-help)
8. [Snippet System with Tab-Stop Navigation](#-snippet-system-with-tab-stop-navigation)
9. [Real-Time Synchronized Leaflet Map Viewer](#-real-time-synchronized-leaflet-map-viewer)
10. [Zero-Friction Unified Authentication & Cloud Project Detection](#-zero-friction-unified-authentication--cloud-project-detection)
11. [Cloud Assets Explorer & Virtual CLI Filesystem](#-cloud-assets-explorer--virtual-cli-filesystem)
12. [Keyboard Shortcuts Cheat Sheet](#-keyboard-shortcuts-cheat-sheet)
13. [Licensing, Ethics & Intellectual Property](#-licensing-ethics--intellectual-property)

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
│  QUADRANT 3: Interactive Console     │  QUADRANT 4: AI Assistant & Assets   │
│  - Reactive prompt gee>              │  - Visual Earth Engine Assets tree   │
│  - Automatic server-side evaluation  │  - Intelligent coding assistant      │
│  - Infinite history (.gee_history)   │  - Task monitor & export tracker     │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 💾 Persistent Custom Layouts
Unlike rigid editor layouts, GEE IDE provides full workspace sovereignty:
* **Drag & Resize:** Freely reposition, dock, stack, or float any view across single or multi-monitor setups.
* **Save as Default:** Press `Cmd+Shift+P` ➔ **`GEE IDE: Save Current Layout as Default`**. GEE IDE remembers your preferred geometry across project reloads without overriding it upon startup.
* **Reset Layout:** Restore the pristine 2x2 scientific grid anytime via `Cmd+Shift+P` ➔ **`GEE IDE: Reset to 2x2 Grid Layout`**.

---

## 🌐 Unified Polyglot Support: `.gee` Files

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

## 🖥 Advanced Interactive Console & Persistent History

The GEE IDE console is a full-fledged reactive scientific REPL designed specifically for geospatial workloads:

* **🧹 Instant Clearing (`Cmd + L` / `Ctrl + L`):**
  Wipes the console canvas clean instantly, functional both when typing in the editor or focused directly on the `gee>` prompt.
* **📜 Persistent Project History (`.gee_history`):**
  Mirroring RStudio's `.Rhistory`, every interactive statement executed via the prompt or sent from the editor is appended to `.gee_history` in your project root.
  * Recall previous statements using **Up Arrow (↑)** and **Down Arrow (↓)**.
  * Enter **`history`** at the `gee>` prompt to inspect an indexed catalog of prior executions.
* **📊 In-Memory Variable Inspector:**
  Type **`vars`** or **`objects`** to list all active in-memory variables, data structures, and client vs. server status.
* **💡 Reactive Tab Completion:**
  Press **`Tab`** in the `gee>` prompt to autocomplete active variable identifiers, built-in commands, and Earth Engine asset paths.

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
  * **Compact Floating Dock:** A dedicated, non-intrusive **Layers** dock with auto-collapse, pin mode (always visible or hover-only), and numeric toggle shortcuts (`1..9` and `0` to toggle all).
  * **Individual Layer Controls:** Instant per-layer visibility toggles and continuous precision opacity sliders (`0% – 100%`).
  * **Hierarchical Grouping:** Supports subfolder organization (e.g., `Classifications/NDVI`) with group-level visibility toggles.
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
* **📍 High-Precision Coordinate Inspector:** Click anywhere on the map canvas to extract high-precision geographic coordinates `[longitude, latitude]` with one-click cursor insertion into code.

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

## 📂 Cloud Assets Explorer & Virtual CLI Filesystem

Manage cloud storage assets directly from your editor workspace:
* **Visual Sidebar Tree:** Browse user roots (`users/...`) and Google Cloud storage assets (`projects/...`).
* **Interactive CLI Filesystem:**
  * `find`: Recursive asset discovery with glob matching and type filtering:
    * `find -name "*ndvi*"`: Search all assets matching a pattern across all roots.
    * `find users/mi_usuario -name "*2023*" -type image`: Search images specifically.
    * `find -type folder -maxdepth 2`: Search subfolders up to a specific recursion depth.
  * `ls` / `dir`: List collections, rasters, and tables (supports glob patterns like `ls *landsat*`).
  * `cd`: Change active asset directory.
  * `pwd`: Print working directory.
  * `mkdir`: Create new Earth Engine asset folders (`mkdir [-p] nombre`).
  * `rm`: Delete assets (supports `-r` recursive removal for folders and collections).
  * `cp` / `mv`: Copy or rename/move assets across folders or projects.

---

## 🌐 Earth Engine Public Data Catalog Search (+1,100 Datasets)

Query and discover over 1,100 official public Google Earth Engine datasets (Sentinel, Landsat, MODIS, ERA5, SRTM, Dynamic World, WorldCover, etc.) without switching to a web browser:

### 1. Interactive Command Palette Search (`Cmd+Shift+P`)
* Press `Cmd+Shift+P` ➔ **`GEE IDE: Search Data Catalog`**.
* Search in real-time by mission, sensor, variable, band, or tag (e.g. `sentinel 2`, `landsat 8`, `elevation`, `srtm`, `modis ndvi`, `landcover`).
* Inspect temporal coverage, data type, and band summaries.
* **One-Click Actions:**
  * **Insert in Editor:** Automatically inserts language-aware declarations (`var s2 = ee.ImageCollection('...')` in JS, Python, or R) at your active cursor.
  * **Copy Snippet:** Copies the dataset declaration to your system clipboard.
  * **Open in Earth Engine Catalog:** Opens the official Google documentation page in your browser.

### 2. Interactive CLI Search via `gee>` Console
* **Direct commands:**
  ```text
  gee> catalog sentinel 2
  gee> search modis ndvi
  gee> catalog srtm -type image
  ```
* **Unified via `find` flag:**
  ```text
  gee> find -catalog "land cover"
  gee> find -c elevation
  ```
* Prints dataset IDs, descriptions, temporal ranges, band lists, and runnable code snippets directly to the console canvas.

---

## ⌨️ Keyboard Shortcuts Cheat Sheet

| macOS Shortcut | Windows/Linux Shortcut | Action | Context |
| :--- | :--- | :--- | :--- |
| `Cmd + Enter` | `Ctrl + Enter` | **Execute Line or Smart Block** | `.gee` Editor |
| `Cmd + Shift + Enter` | `Ctrl + Shift + Enter` | **Execute Entire Script** | `.gee` Editor |
| `Cmd + L` | `Ctrl + L` | **Clear Console Screen** | Global / Console |
| `Option + S` | `Alt + S` | **Capture HD Map Snapshot (2x Retina)** | Map Viewer / Global |
| `1` – `9` | `1` – `9` | **Toggle Layer 1 to 9 Visibility** | Map Viewer (Layers Dock) |
| `0` | `0` | **Toggle All Layers Visibility** | Map Viewer (Layers Dock) |
| `Tab` | `Tab` | **Advance to next Snippet Placeholder** | Snippet Mode |
| `Shift + Tab` | `Shift + Tab` | **Return to previous Snippet Placeholder**| Snippet Mode |
| `↑` / `↓` | `↑` / `↓` | **Cycle Command History** | `gee>` Console |
| `Cmd + 1` | `Ctrl + 1` | **Focus Quadrant 1 (Editor)** | Global |
| `Cmd + 2` | `Ctrl + 2` | **Focus Quadrant 2 (Console)** | Global |
| `Cmd + 3` | `Ctrl + 3` | **Focus Quadrant 3 (Map Viewer)** | Global |
| `Cmd + 4` | `Ctrl + 4` | **Focus Quadrant 4 (AI / Assets)** | Global |

---

## ⚖️ Licensing, Ethics & Intellectual Property

### Alignment with RStudio Ergonomics
GEE IDE intentionally incorporates **ergonomic interaction patterns and workflow concepts** popularized by **RStudio** (including REPL auto-evaluation, 4-quadrant layout partitioning, persistent `.gee_history` logging, inline `?` documentation lookup, and tabstop template expansion).

> **Intellectual Property & Legal Notice:**
> User interface workflows, keyboard shortcut conventions, and interactive programming paradigms are universal software design concepts in scientific computing. **GEE IDE does not copy, redistribute, or incorporate proprietary source code from RStudio / Posit Software, PBC**. All GEE IDE code is an original, clean-room implementation in TypeScript and JavaScript, distributed under the open-source **MIT License**.

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
