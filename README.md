# GEE IDE

Welcome to **GEE IDE**, the ultimate Earth Engine development environment integrated directly into Visual Studio Code!

GEE IDE transforms VS Code into a powerful, multi-language (JavaScript, Python, R) workspace tailored for geospatial analysis with Google Earth Engine (GEE). It features a unique 4-quadrant layout that brings together your code, console output, interactive maps, and an AI assistant—all without leaving your editor.

---

## 🌟 Key Features

### 1. Multi-Language Support (`.gee` files)
GEE IDE introduces the `.gee` file format. By using simple "shebangs" at the top of your file, the extension automatically routes the execution to the correct runtime engine.

* **JavaScript (`# js`)**: Native execution using Node.js and the official `@google/earthengine` library.
* **Python (`# py`)**: Full Python ecosystem support, integrating `earthengine-api` and mapping tools (geemap).
* **R (`# r`)**: Leverages `rgee` and `reticulate` to bring Earth Engine to the R spatial community.

### 2. Interactive Map Viewer (Leaflet Integration)
See your results instantly. Using a custom bridge server, all `Map.addLayer` (JS), `Map.addLayer` (Python), and `Map$addLayer` (R) commands render immediately in a live Leaflet map panel right next to your code.

### 3. Integrated GEE Console
Print objects, view computed values (like `getInfo()`), and debug your geospatial algorithms in a dedicated output console that mirrors the classic GEE Code Editor experience.

### 4. Zero-Friction Authentication
GEE IDE implements a seamless, automatic OAuth 2.0 flow. 
- It captures credentials via a local loopback server.
- The credentials are automatically shared across **all three languages** (JS, Python, R) within the same session. No more running `earthengine authenticate` manually for every language!

### 5. AI Assistant
Ask questions, generate Earth Engine scripts, or debug your algorithms with the built-in AI assistant panel, specifically fine-tuned for geospatial and GEE workflows.

---

## 🚀 Getting Started

### Prerequisites
- **VS Code**: Version 1.80 or higher.
- **Node.js**: Required for the core extension and JavaScript runtime.
- **Python (Optional)**: If you want to run `# py` scripts (requires `earthengine-api` installed in your environment).
- **R (Optional)**: If you want to run `# r` scripts (requires `rgee` and `reticulate`).

> ⚠️ **Windows Users:** When installing Python or R, please ensure you check the **"Add to PATH"** (or "Add to environment variables") option in the installer. This allows GEE IDE to automatically detect and run the languages in the background.

### Installation
1. Install **GEE IDE** from the VS Code Extensions Marketplace (or via VSIX).
2. Open a workspace and create a new file with the `.gee` extension (e.g., `script.gee`).
3. The GEE IDE sidebars and tools will activate automatically.

---

## 💻 How to Use

### 1. Create a `.gee` Script
Create a file like `analysis.gee`. The very first line determines the language:

**For JavaScript:**
```javascript
# js
var image = ee.Image('CGIAR/SRTM90_V4');
Map.addLayer(image, {min: 0, max: 3000}, 'SRTM DEM');
print('Elevation computed.');
```

**For Python:**
```python
# py
import ee
image = ee.Image('CGIAR/SRTM90_V4')
Map.addLayer(image, {'min': 0, 'max': 3000}, 'SRTM DEM (Py)')
print('Elevation computed in Python.')
```

**For R:**
```R
# r
library(rgee)
image <- ee$Image('CGIAR/SRTM90_V4')
Map$addLayer(image, list(min=0, max=3000), 'SRTM DEM (R)')
print('Elevation computed in R.')
```

### 2. Execute Code
- **Run Selected Code / Current Line**: Press `Cmd + Enter` (Mac) or `Ctrl + Enter` (Windows/Linux).
- **Run Entire Script**: Press `Cmd + Shift + Enter` (Mac) or `Ctrl + Shift + Enter` (Windows/Linux).

The IDE will intelligently:
1. Identify the language.
2. Send the code to the corresponding engine (`GEERuntimeJS`, `GEERuntimePy`, or `GEERuntimeR`).
3. Display `print()` outputs in the **GEE Console**.
4. Render `Map.addLayer()` calls in the **Map Viewer**.

### 3. The 4-Quadrant UI
We recommend arranging your VS Code workspace to maximize productivity:
1. **Top-Left**: Your `.gee` Code Editor.
2. **Top-Right**: The interactive Map Viewer (`GEE IDE: Map Viewer`).
3. **Bottom-Left**: GEE Output Console (`GEE IDE: Console`).
4. **Bottom-Right**: GEE AI Assistant / Assets Explorer (`GEE IDE: AI`).

*(Tip: You can move panels around by dragging their tabs in VS Code!)*

---

## 🛠 Advanced Features

### Shared Python/R Environment
The extension dynamically builds a virtual environment (`.gee_env`) if needed. When R is launched, it automatically configures `reticulate` to use the exact same Python environment as the Python runtime. This ensures that Earth Engine API versions and authentication tokens stay perfectly synced.

### Task Management (Coming Soon)
A sidebar view (`gee-pro-tasks`) to monitor, cancel, and manage your Earth Engine exports directly from the IDE is currently in development!

---

## 📄 Attributions & License

This extension builds upon great work from the open-source community. Concepts and UI elements were inspired by the [earthengine-extension](https://github.com/12rambau/earthengine-extension) (Apache License 2.0). See `NOTICES.md` for full attribution.

**License**: MIT License (for GEE IDE code).

---

## ⚠️ Beta Version & Feedback
If you find a bug or have a feature request, please:
- Report it via email to: [albert.physik@gmail.com](mailto:albert.physik@gmail.com)
- Open an issue on our [GitHub Repository](https://github.com/rralDev/gee-ide/issues).
