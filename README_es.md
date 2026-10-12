# GEE IDE (Google Earth Engine IDE)

<p align="center">
  <img src="https://raw.githubusercontent.com/rralDev/gee-ide/main/media/logo.png" alt="GEE IDE Logo" width="130" />
</p>

<p align="center">
  <strong>El entorno de desarrollo geoespacial definitivo para Google Earth Engine en Visual Studio Code.</strong><br>
  <em>Diseñado para investigadores, científicos de datos y profesionales de la teledetección.</em>
</p>

<p align="center">
  <a href="#-filosofía-y-arquitectura-el-puente-entre-gee-y-rstudio"><img src="https://img.shields.io/badge/Paradigma-RStudio%20%2B%20VS%20Code-75AADB?style=flat-square" alt="RStudio Style"></a>
  <a href="#-soporte-políglota-unificado-archivos-gee"><img src="https://img.shields.io/badge/Lenguajes-JavaScript%20%7C%20Python%20%7C%20R-orange?style=flat-square" alt="Polyglot"></a>
  <a href="#-licencia-ética-y-compatibilidad-de-código"><img src="https://img.shields.io/badge/Licencia-Apache_2.0-blue?style=flat-square" alt="License Apache 2.0"></a>
  <a href="#-atajos-de-teclado-y-productividad"><img src="https://img.shields.io/badge/Atajos-Cmd%2BEnter%20%7C%20Cmd%2BL-blueviolet?style=flat-square" alt="Shortcuts"></a>
</p>

---

## 📖 Tabla de Contenidos
1. [Filosofía y Arquitectura: El Puente entre GEE y RStudio](#-filosofía-y-arquitectura-el-puente-entre-gee-y-rstudio)
2. [El Espacio de Trabajo en 4 Cuadrantes Científicos](#-el-espacio-de-trabajo-en-4-cuadrantes-científicos)
3. [Soporte Políglota Unificado: Archivos `.gee`](#-soporte-políglota-unificado-archivos-gee)
4. [Asociación de Archivos `.gee`, Iconos y Vista Previa (Quick Look)](#-asociación-de-archivos-gee-iconos-y-vista-previa-quick-look)
5. [Motor de Ejecución Inteligente y REPL Científico](#-motor-de-ejecución-inteligente-y-repl-científico)
6. [Consola Interactiva Avanzada y Gestión de Historial](#-consola-interactiva-avanzada-y-gestión-de-historial)
7. [Sistema de Ayuda y Documentación Integrado (`?` y `help`)](#-sistema-de-ayuda-y-documentación-integrado--y-help)
8. [Sistema de Snippets con Navegación por Tabulación (`Tabstops`)](#-sistema-de-snippets-con-navegación-por-tabulación-tabstops)
9. [Visor de Mapas Leaflet Sincronizado en Tiempo Real](#-visor-de-mapas-leaflet-sincronizado-en-tiempo-real)
10. [Asistente de Índices Espectrales (Awesome Spectral Indices Wizard)](#-asistente-de-índices-espectrales-awesome-spectral-indices-wizard)
11. [Autenticación Unificada Zero-Friction y Detección de Proyectos](#-autenticación-unificada-zero-friction-y-detección-de-proyectos)
12. [Explorador de Assets, Monitor de Tareas y Sistema de Archivos Virtual CLI](#-explorador-de-assets-monitor-de-tareas-y-sistema-de-archivos-virtual-cli)
13. [Motor de Auto-Plotting Inteligente y Búsqueda en el Catálogo Público (+1,100 Datasets)](#-motor-de-auto-plotting-inteligente-y-búsqueda-en-el-catálogo-público-1100-datasets)
14. [Tabla de Atajos de Teclado (Cheat Sheet)](#-tabla-de-atajos-de-teclado-cheat-sheet)
15. [Licencia, Ética y Compatibilidad de Código](#-licencia-ética-y-compatibilidad-de-código)

---

## 🏛 Filosofía y Arquitectura: El Puente entre GEE y RStudio

Históricamente, los científicos de datos espaciales y analistas de teledetección han tenido que elegir entre dos experiencias:
1. **El Code Editor oficial de Google Earth Engine (Web):** Excelente para prototipar en JavaScript con visor de mapas integrado, pero restringido a un único lenguaje en el navegador, sin control de versiones local, sin soporte offline ni atajos avanzados.
2. **Entornos de escritorio como RStudio o Jupyter:** Famosos por su inigualable ergonomía científica (ejecución línea por línea, inspección inmediata de objetos en memoria, terminal interactiva con historial persistente y gestión de plantillas), pero sin una integración nativa y reactiva con el ecosistema visual de Earth Engine.

**GEE IDE fusiona lo mejor de ambos mundos en Visual Studio Code:**
* Adopta el diseño de **4 cuadrantes interactivos** y la ergonomía de **RStudio** (auto-evaluación de variables, atajos clásicos como `Cmd+L` / `Ctrl+L`, archivo `.gee_history` local, inspección con `?` y snippets con tabulación).
* Mantiene la inmediatez visual del **GEE Code Editor** gracias a su consola interactiva dedicada y su visor de mapas Leaflet.
* Permite programar indistintamente en **JavaScript, Python o R** dentro del mismo proyecto sin necesidad de reconfigurar entornos ni duplicar inicios de sesión.

---

## 🪟 El Espacio de Trabajo en 4 Cuadrantes Científicos

Al ejecutar el comando `GEE IDE: Start Environment`, el IDE organiza automáticamente tu ventana en una cuadrícula armónica 2x2:

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│  CUADRANTE 1: Editor de Código       │  CUADRANTE 2: Visor de Mapas Leaflet │
│  - Archivos políglotas (.gee)        │  - Renderizado en vivo de capas      │
│  - Sintaxis JS / Python / R          │  - Inspector interactivo             │
│  - Expansión de snippets con Tab     │  - Map.addLayer sincrónico           │
├──────────────────────────────────────┼──────────────────────────────────────┤
│  CUADRANTE 3: Consola Interactiva    │  CUADRANTE 4: Asistente IA & Assets  │
│  - Prompt reactivo gee>              │  - Explorador visual de Assets       │
│  - Evaluación automática             │  - Asistente de código inteligente   │
│  - Historial infinito (.gee_history) │  - Gestión de tareas y cuotas        │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 💾 Persistencia de Diseño Personalizado
A diferencia de extensiones rígidas, GEE IDE te da el control total sobre tu espacio de trabajo:
* **Mueve y redimensiona:** Puedes arrastrar cualquier panel a otra posición, dividirlo o apilarlo según el tamaño de tu monitor.
* **Guardar como Predeterminado:** Ejecuta `Cmd+Shift+P` ➔ **`GEE IDE: Save Current Layout as Default`**. El IDE recordará tu distribución favorita y no forzará la cuadrícula estándar al reabrir el proyecto.
* **Restaurar:** Si deseas volver al diseño 2x2 original en cualquier momento, ejecuta `Cmd+Shift+P` ➔ **`GEE IDE: Reset to 2x2 Grid Layout`**.

---

## 🌐 Soporte Políglota Unificado: Archivos `.gee`

GEE IDE introduce la especificación de archivos **`.gee`**, permitiendo que un único proyecto albergue scripts en los tres lenguajes líderes de teledetección mediante **shebang routing** en la primera línea:

### 1. JavaScript (`// js`)
Ejecutado localmente mediante el motor Node.js con `@google/earthengine`:
```javascript
// js
var coleccion = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterDate('2024-01-01', '2024-03-31')
  .filterBounds(Map.getBounds());

var imagen = coleccion.median();
Map.addLayer(imagen, {bands: ['B4', 'B3', 'B2'], min: 0, max: 3000}, 'Sentinel-2 RGB');
print('Número de imágenes:', coleccion.size());
```

### 2. Python (`# py`)
Enlazado con el runtime de Python, `earthengine-api` y `geemap`:
```python
# py
import ee

coleccion = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate('2024-01-01', '2024-03-31'))

imagen = coleccion.median()
Map.addLayer(imagen, {'bands': ['B8', 'B4', 'B3'], 'min': 0, 'max': 3000}, 'Falso Color (NIR)')
print('Metadatos calculados en Python.')
```

### 3. R (`# r`)
Integrado directamente con `rgee` y el entorno espacial de R:
```R
# r
library(rgee)

coleccion <- ee$ImageCollection('COPERNICUS/S2_SR_HARMONIZED')$
  filterDate('2024-01-01', '2024-03-31')

imagen <- coleccion$median()
Map$addLayer(imagen, list(bands = c('B4', 'B3', 'B2'), min = 0, max = 3000), 'RGEE Sentinel')
print('Procesamiento completado en R.')
```

---

## 🖱️ Asociación de Archivos `.gee`, Iconos y Vista Previa (Quick Look)

Cuando trabajas con un nuevo tipo de archivo como `.gee`, los sistemas operativos (macOS, Windows, Linux) por defecto muestran una hoja en blanco genérica (en macOS una hoja con el signo `?` de documento desconocido) y no muestran el código fuente en su panel de vista previa rápida.

Aquí te mostramos cómo solucionar esto en **menos de un minuto** para disfrutar de una integración de escritorio impecable:

---

### 1. 📂 Abrir con Doble Clic (Asociación con VS Code)

#### 🍎 En macOS (Finder):
1. En el **Finder**, haz clic derecho sobre cualquier archivo `.gee`.
2. Selecciona **Obtener información** (o presiona el atajo `Cmd + I`).
3. En la sección **Abrir con:**, selecciona **Visual Studio Code** en el menú desplegable.
4. Haz clic en el botón **"Cambiar todo..."** (*Change All...*) y confirma en **Continuar**.
> 🚀 *A partir de ese instante, cualquier archivo `.gee` en todo tu Mac se abrirá automáticamente en VS Code con un simple doble clic.*

#### 🪟 En Windows (Explorador de Archivos):
1. Haz clic derecho sobre cualquier archivo `.gee`.
2. Selecciona **Abrir con** ➔ **Elegir otra aplicación**.
3. Selecciona **Visual Studio Code** en la lista.
4. **Paso clave:** Marca la casilla **"Siempre usar esta aplicación para abrir los archivos .gee"**.
5. Haz clic en **Aceptar**.

#### 🐧 En Linux (Ubuntu, Debian, Fedora, Arch):
1. Clic derecho en cualquier archivo `.gee` ➔ **Propiedades**.
2. Ve a la pestaña **Abrir con** (*Open With*).
3. Selecciona **Visual Studio Code** y haz clic en **Establecer como predeterminado** (*Set as default*).
*(O por terminal: `xdg-mime default code.desktop text/x-gee`)*.

---

### 2. 👁️ Ver el Código en la Vista Previa del Sistema (Quick Look / Barra Espaciadora)

Por defecto, los sistemas operativos no saben que `.gee` es un archivo de texto plano o código fuente (`public.source-code`), por lo que al presionar la **Barra Espaciadora** en Mac o abrir el panel de vista previa en Windows, solo muestran un icono estático en lugar de tus líneas de código.

#### 🍎 En macOS (Quick Look con Barra Espaciadora):
Para ver el código coloreado y formateado con números de línea al presionar la **Barra Espaciadora** o en la columna de vista previa del Finder:
* **Solución recomendada (Estándar en desarrollo Mac):**
  Instala la extensión gratuita y open-source **Syntax Highlight** (compatible con Apple Silicon y macOS Sonoma/Sequoia):
  ```bash
  brew install --cask syntax-highlight
  ```
  *(O descárgala gratis desde [GitHub sbarex/SourceCodeSyntaxHighlight](https://github.com/sbarex/SourceCodeSyntaxHighlight)).*
* **Configuración:**
  Abre la aplicación **Syntax Highlight**, ve a la pestaña **Extensions** y asegúrate de que `gee` esté en la lista (o agrégala con un clic).
  > ✨ **Resultado:** Al presionar la **Barra Espaciadora** sobre cualquier archivo `.gee` en el Finder, se abrirá al instante una ventana con todo tu código satelital iluminado con sintaxis y números de línea sin abrir ningún editor.
* **Alternativa clásica:** `brew install --cask qlcolorcode`.

#### 🪟 En Windows (Panel de Vista Previa `Alt + P`):
Para que el Explorador de Windows lea `.gee` como código fuente en su panel lateral de vista previa:
1. Abre el bloc de notas y guarda un archivo llamado `vista_previa_gee.reg`:
```ini
Windows Registry Editor Version 5.00

[HKEY_CLASSES_ROOT\.gee]
"PerceivedType"="text"
"Content Type"="text/plain"
```
2. Haz doble clic sobre el archivo `.reg` y confirma la importación.
> ✨ **Resultado:** Al presionar `Alt + P` en el Explorador de Windows, podrás leer todo el código del archivo `.gee` en el panel lateral derecho.

#### 🐧 En Linux (GNOME Sushi):
En distribuciones con GNOME (Ubuntu, Fedora), instala **Sushi**:
```bash
sudo apt install gnome-sushi
```
Al registrar el MIME `text/x-gee` derivado de `text/plain`, al seleccionar cualquier archivo `.gee` en Nautilus y presionar la **Barra Espaciadora**, verás el código completo formateado.

---

### 3. 🎨 Personalizar el Icono del Archivo (Reemplazar la hoja con `?`)

#### 🍎 En macOS: Cambiar el icono por el Logo Oficial de GEE IDE
macOS permite cambiar el icono de tus archivos en **10 segundos** de forma 100% nativa:
1. Abre la imagen del logo `media/logo.png` en la aplicación nativa **Vista Previa** (*Preview*).
2. Presiona `Cmd + A` (seleccionar todo) y luego `Cmd + C` (copiar).
3. En el Finder, haz clic sobre el archivo `.gee` (o plantilla) y presiona **`Cmd + I`** (*Obtener información*).
4. Haz clic sobre el **pequeño icono** ubicado en la esquina superior izquierda de la ventana de información (verás que se resalta con un borde azul).
5. Presiona **`Cmd + V`** (pegar).
> ✨ **¡Listo!** El icono blanco genérico con el signo `?` será reemplazado al instante por el hermoso logo oficial de **GEE IDE** en el Finder y el Escritorio.

#### 🪟 En Windows: Icono del Sistema para todos los `.gee`
Usa el archivo de icono nativo `media/gee.ico` incluido en el repositorio:
1. Guarda el siguiente texto como `icono_gee.reg`:
```ini
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Classes\.gee]
@="GEE_Script_File"
"PerceivedType"="text"

[HKEY_CURRENT_USER\Software\Classes\GEE_Script_File\DefaultIcon]
@="C:\\Ruta\\A\\Tu\\Proyecto\\media\\gee.ico,0"

[HKEY_CURRENT_USER\Software\Classes\GEE_Script_File\shell\open\command]
@="\"C:\\Users\\TU_USUARIO\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe\" \"%1\""
```
2. Haz doble clic en el archivo `.reg` para aplicar. Todos los archivos `.gee` de Windows lucirán el logo oficial.

#### 🐧 En Linux: Icono del Sistema
Copia el icono PNG oficial a la biblioteca de mimetypes del usuario:
```bash
mkdir -p ~/.local/share/icons/hicolor/128x128/mimetypes/
cp media/logo.png ~/.local/share/icons/hicolor/128x128/mimetypes/text-x-gee.png
gtk-update-icon-cache ~/.local/share/icons/hicolor/
```

---

## ⚡ Motor de Ejecución Inteligente y REPL Científico

### 1. Ejecución Inteligente de Bloques (`Cmd + Enter` / `Ctrl + Enter`)
Inspirado en el comportamiento de **RStudio**:
* **Detección multilínea fluida:** Si el cursor está en una línea que forma parte de una cadena de métodos (encadenamiento con `.filter()`, pipes `%>%`, `|>` o indentación en Python), el motor detecta el inicio y fin del bloque completo y lo ejecuta como una sola sentencia.
* **Salto automático:** Tras ejecutar la selección o bloque, el cursor salta automáticamente a la siguiente línea de código ejecutable, omitiendo líneas vacías y comentarios para permitir una ejecución continua y veloz.

### 2. Auto-Evaluación de Expresiones (Auto-Printing estilo RStudio)
En RStudio, cuando seleccionas el nombre de un objeto (ej. `mi_variable`) y presionas `Cmd+Enter`, la consola imprime su contenido de inmediato sin obligarte a envolverlo en `print()`. 
* **En GEE IDE esto es nativo:** Si seleccionas cualquier variable, cálculo u objeto de servidor (ej. `numeroServidor.add(5).multiply(2)` o `textoServidor`), el motor evalúa la expresión y, si es un objeto de Earth Engine (`ee.*`), invoca automáticamente `.getInfo()` para mostrarte el resultado final calculado en los servidores de Google de forma transparente.

---

## 🖥 Consola Interactiva Avanzada y Gestión de Historial

La consola de GEE IDE no es un simple visor de logs; es una terminal REPL especializada para teledetección:

* **🧹 Limpieza instantánea (`Cmd + L` / `Ctrl + L`):**
  Limpia la pantalla de inmediato, tanto si estás redactando en el editor como si tienes el foco en el prompt interactivo `gee>`.
* **📜 Historial Persistente en Disco (`.gee_history`):**
  Al igual que el archivo `.Rhistory` de RStudio, cada comando ejecutado desde la consola interactiva o enviado desde el editor con `Cmd+Enter` se guarda en un archivo `.gee_history` dentro de la raíz de tu proyecto local.
  * Navega fácilmente por comandos anteriores con **Flecha Arriba (↑)** y **Flecha Abajo (↓)**.
  * Escribe el comando **`history`** en el prompt `gee>` para visualizar una lista indexada de tus ejecuciones recientes.
* **📊 Inspección de Variables en Memoria:**
  Escribe **`vars`** u **`objects`** en el prompt para listar todas las variables activas en tu sesión, con su tipo de dato, dimensiones y estado de cliente o servidor.
* **💡 Autocompletado Reactivo en la Consola:**
  Presiona **`Tab`** en el prompt `gee>` para autocompletar nombres de variables en memoria, comandos y rutas de Assets.

---

## ❓ Sistema de Ayuda y Documentación Integrado (`?` y `help`)

Olvídate de cambiar de ventana para abrir el navegador en busca de la documentación oficial de Earth Engine. Puedes inspeccionar cualquier algoritmo directamente en la consola interactiva con sintaxis académica:

```text
gee> ?ee.Image.normalizedDifference
```
o
```text
gee> help(ee.Algorithms.Landsat.simpleCloudScore)
```

**La consola te responderá con:**
1. Descripción funcional del algoritmo.
2. Lista de parámetros con sus tipos de datos esperados y cuáles son opcionales.
3. Valores predeterminados (`default`).
4. Tipo de objeto que retorna.

*También puedes consultar ayuda de comandos internos:* `?vars`, `?history`, `?clear`, `?snippets`, `?ls`.

---

## ✂️ Sistema de Snippets con Navegación por Tabulación (`Tabstops`)

Escribir código repetitivo de Earth Engine consume tiempo valioso. GEE IDE incorpora un sistema de snippets de alto rendimiento con dos capas:

### 1. Biblioteca Base (Pre-instalada)
Escribe el prefijo en el editor y presiona **`Tab`** para expandir la plantilla. Presiona **`Tab`** sucesivamente para que el cursor salte entre los parámetros que debes configurar:
* **`eecol`** ➔ Carga completa de `ee.ImageCollection` con filtros temporales y espaciales.
* **`eeimg`** ➔ Carga directa de imagen `ee.Image('...')`.
* **`ndvi`** / **`ndwi`** ➔ Cálculo automático de índices espectrales con `.normalizedDifference(...)`.
* **`maplayer`** / **`addlayer`** ➔ Inserción de `Map.addLayer(...)` con paletas y rangos `min`/`max`.
* **`cloudmask`** ➔ Algoritmo de máscara de nubes y cirros Sentinel-2 / Landsat.
* **`exportimg`** / **`exporttable`** ➔ Tareas de exportación hacia Google Drive.
* **`reduce`** ➔ Estadísticas zonales mediante `reduceRegion`.
* **`shebangjs`**, **`shebangpy`**, **`shebangr`** ➔ Cabeceras de lenguaje rápidas.

### 2. Entorno de Snippets Personalizados del Usuario (Estilo RStudio)
* **Archivo de configuración global:** Ubicado en `~/.config/earthengine/snippets.json`, disponible para todos tus proyectos de manera universal.
* **Comando de edición rápida:** Presiona `Cmd+Shift+P` ➔ **`GEE IDE: Edit User Snippets (Editar Snippets Personalizados)`**.
* **Hot-Reload:** Guarda el archivo (`Cmd+S`) y tus nuevos snippets estarán disponibles al instante, sin necesidad de reiniciar la ventana.

### 3. Listado y Búsqueda Interactiva
* **En el Editor:** Presiona `Cmd+Shift+P` ➔ **`GEE IDE: List & Insert Snippet`** para abrir un menú interactivo (`QuickPick`) con buscador en vivo de todos los snippets disponibles (base y personalizados). Al pulsar `Enter`, se inserta en tu cursor.
* **En la Consola:** Escribe **`snippets`** en el prompt `gee>` para ver la tabla completa de plantillas disponibles con sus descripciones.

---

## 🗺 Visor de Mapas Leaflet Sincronizado en Tiempo Real

El Cuadrante 3 alberga un lienzo cartográfico interactivo basado en Leaflet diseñado específicamente para análisis de teledetección y flujos de trabajo SIG avanzados:
* **Puente de Sockets Bidireccional:** Un servidor socket interno (`PythonBridgeServer`) intercepta llamadas como `Map.addLayer(...)` desde JavaScript, Python y R, renderizando capas ráster y vectoriales en vivo en cuestión de segundos.
* **🎛 Gestor Avanzado de Capas (Layers Manager):**
  * **Viewport Adaptativo y Altura Dinámica:** Adapta automáticamente su altura máxima (`max-height: calc(100vh - 195px)`) con desplazamiento suave interno (*smooth scroll*), evitando que listados extensos de capas tapen los botones flotantes de acción (Swipe, Dibujo, Herramientas).
  * **Panel Flotante Compacto:** Base flotante no intrusiva con auto-colapso, modo fijado (*pin mode*) y conmutación rápida mediante atajos numéricos (`1..9` para alternar visibilidad de capas individuales y `0` para conmutar todas).
  * **Controles Individuales:** Conmutación instantánea de visibilidad por capa y deslizadores continuos de opacidad (`0% – 100%`).
  * **Leyendas Dinámicas y Muestras de Color RGB:** Al añadir cualquier ráster con paleta (`palette`), se genera automáticamente una leyenda con gradiente continuo y valores mín/máx. Las imágenes multibanda en RGB muestran una muestra inteligente de color verdadero (*True Color swatch*).
  * **Agrupación Jerárquica:** Soporte para subcarpetas (ej. `Clasificaciones/NDVI`) con control de visibilidad a nivel de grupo.
* **🔀 Herramienta de Comparación Swipe (Split-Panel / Modo BC):**
  * **Análisis Comparativo Dividido:** Activa el deslizador en pantalla dividida haciendo clic en el botón flotante 🔀 (BC) en la barra del mapa para comparar visualmente las dos capas ráster superiores visibles.
  * **Modo de Doble Orientación (Vertical y Horizontal):** Alterna fácilmente entre división vertical (lado a lado) y división horizontal (arriba y abajo).
  * **Conmutación Rápida por Teclado o Tirador:** Presiona la tecla `Command` (macOS) / `Ctrl` (Windows/Linux) o simplemente haz **doble clic** en la barra divisoria central para alternar al instante entre orientación vertical y horizontal sin menús.
  * **Insignias Direccionales Dinámicas:** Muestra insignias en vivo `[L]` (Izquierda / *Left*) y `[R]` (Derecha / *Right*) en modo vertical, cambiando automáticamente a `[T]` (Arriba / *Top*) y `[B]` (Abajo / *Bottom*) en modo horizontal para identificar de inmediato cada capa.
  * **Apilado DOM sin Parpadeo:** Jerarquía de contenedores Leaflet optimizada para garantizar un recorte milimétrico sin desincronización de teselas ni desplazamientos indeseados durante el arrastre.
* **📸 Capturas de Pantalla HD en Resolución Retina (`Option + S` / `Alt + S`):**
  * Captura en 1 clic o mediante atajo del visor del mapa en ultra-alta definición **Retina 2x**.
  * Exportación automática a la carpeta `Screenshots/` de tu proyecto (`gee_snapshot_YYYYMMDD_HHMMSS.png`).
  * Menú HUD interactivo tras la captura: **Abrir Imagen**, **Abrir Carpeta**, **Guardar Como...** y **Copiar al Portapapeles**.
* **✏️ Herramientas de Dibujo Vectorial y Digitalización SIG:**
  * **Barra de Herramientas de Dibujo:** Digitaliza puntos/marcadores, polígonos, rectángulos, transectos de polilínea y círculos directamente sobre imágenes satelitales.
  * **Micro-Vértices de Alta Precisión:** Tiradores circulares de 9px con iluminación suave para edición precisa de límites sin saltos ni desalineaciones.
  * **Micro-Barra Flotante Contextual:** Al hacer clic en cualquier geometría dibujada aparece una micro-barra elevada `[ ✏️ Edit ] [ 🎨 Style ] [ 🗑️ Delete ]` sobre la figura sin obstruir los vértices.
  * **Paleta SIG Curada de 10 Colores e Inserción HEX/HTML:** Selecciona entre 10 colores estándar de la industria (Verde Esmeralda, Rojo Rubí, Azul Zafiro, Ámbar, etc.) o ingresa códigos personalizados `#HEX` con vista previa en tiempo real.
  * **Prevención de Pérdida Accidental:** Confirmación en dos pasos (`¿Eliminar? [ ✓ ] [ ✕ ]`) que previene la eliminación involuntaria de digitalizaciones complejas.
* **📍 Inspector de Coordenadas y Píxeles de Alta Precisión:**
  * Haz clic en cualquier coordenada del mapa para consultar los valores de píxel de todas las capas ráster activas en un popup interactivo con tarjetas desplegables en tema oscuro.
  * Modo de mira de precisión (*crosshair*) manteniendo presionado `Alt`, `Cmd` o `Ctrl` al pasar el cursor sobre el mapa, evitando arrastres accidentales.
  * Copia rápida de coordenadas `[lon, lat]` o descarga de datos con **"📋 Copiar Todo (JSON)"**.
  * **Vuelo 3D a Google Earth Pro Desktop:** Pulsa `Cmd + Shift + Clic` (macOS) o `Ctrl + Shift + Clic` (Windows/Linux) en cualquier punto del mapa para abrir Google Earth Pro de escritorio y volar la cámara 3D directamente a esa coordenada.
  * Registro automático en la consola `gee>`. Pulsa `Esc` para cerrar el popup del inspector.
* **🎨 Paletas Cromáticas Globales Integradas (`palettes`):**
  * Paletas profesionales inyectadas directamente en el contexto de ejecución: `palettes.ndvi`, `palettes.water`, `palettes.dem`, `palettes.temperature`, `palettes.fire`, `palettes.soil`, `palettes.snow`, `palettes.urban`.

---

## 🌿 Asistente de Índices Espectrales (Awesome Spectral Indices Wizard)

GEE IDE incorpora un **Asistente de Índices Espectrales** completo e interactivo, diseñado para generar flujos de trabajo profesionales listos para ejecutar en monitoreo ambiental, agrícola, forestal e hidrológico:

* **Acceso desde la Paleta de Comandos y Menú Contextual:** Pulsa `Cmd+Shift+P` ➔ **`GEE IDE: Insert Spectral Index`** o haz clic derecho en cualquier script `.gee` y selecciona **Insert Spectral Index**.
* **Más de 10 Índices Espectrales Estándar:**
  * **Vegetación y Biomasa:** `NDVI`, `EVI`, `SAVI`, `MSAVI`, `GNDVI`, `NDRE`
  * **Agua y Humedad:** `NDWI` (McFeeters), `MNDWI` (Xu), `NDMI`
  * **Severidad de Incendios y Cicatrices de Fuego:** `NBR`, `NBR2`
  * **Área Urbana y Suelo Construido:** `NDBI`
* **Calibración Automática Multi-Sensor:** Mapeo automático de nombres de bandas y factores de escala radiométrica para:
  * **Sentinel-2 MSI** (Harmonized Level-2A / Level-1C)
  * **Landsat 8 y 9 OLI/TIRS** (Surface Reflectance Tier 1)
  * **Landsat 4, 5 y 7 TM/ETM+** (Surface Reflectance Tier 1)
  * **MODIS Terra/Aqua** (MOD09GA / MOD13Q1)
* **Generador Automático de Series Temporales Multianuales:**
  * Configura un rango de fechas multianual (ej. `2015 – 2020`).
  * El asistente genera un bucle anual interactivo que calcula el compuesto mediano de cada año calendario.
  * Añade cada año de forma secuencial al Visor de Mapas con paletas cromáticas calibradas y nombres representativos (ej. `NDVI_2015`, `NDVI_2020`).
  * **Listo para Comparación con Swipe (BC):** Las capas generadas quedan inmediatamente listas para compararse lado a lado o arriba-abajo con la herramienta Swipe.
* **Generación de Código Políglota:** Sintaxis idiomática y limpia adaptada al lenguaje activo: JavaScript (`// js`), Python (`# py`) o R (`# r`).
* **Visualización Inteligente Precargada:** Inyección automática de paletas oficiales (`palettes.ndvi`, etc.) y rangos de visualización `[min, max]` calibrados.

---

## 🔑 Autenticación Unificada Zero-Friction y Detección de Proyectos

Iniciar sesión en Earth Engine en múltiples lenguajes suele ser un proceso engorroso. GEE IDE lo resuelve de raíz:
1. **Loopback OAuth 2.0 Automático:**
   Presiona `Cmd+Shift+P` ➔ **`GEE IDE: Login with Google (Easy)`**. Se abrirá tu navegador para autorizar la cuenta de Google y el token se capturará automáticamente sin necesidad de copiar y pegar códigos de autenticación.
2. **Detección de Proyectos Cloud:**
   El IDE consulta automáticamente los proyectos de Google Cloud vinculados a tu cuenta y configura el `Project ID` activo sin intervención manual.
3. **Sincronización Total Políglota:**
   Una sola autenticación habilita de inmediato la sesión para los motores de JavaScript, Python (`earthengine-api`) y R (`rgee`).

---

## 💻 Terminal CLI y Sistema de Archivos Virtual para Assets

GEE IDE incorpora una consola con un sistema de archivos virtual diseñado específicamente para gestionar tus assets de Google Earth Engine sin salir del editor.

### ⚡ 3 Formas de Ejecutar Comandos CLI

1. **Directamente desde el Editor de Código (`Cmd + Enter` / `Ctrl + Enter`):**
   Escribe cualquier comando de terminal en una línea de tu script `.gee` (ej. `ls`, `du`, `pwd`, `find *`) y pulsa `Cmd + Enter`. GEE IDE detecta automáticamente el comando y lo ejecuta en la consola `gee>` sin errores de sintaxis de JavaScript.
2. **Prefijo Bash `!` en Scripts Completos:**
   Añade el prefijo `!` para intercalar comandos de terminal en tus scripts:
   ```javascript
   // js
   !mkdir analisis_temporal_2024
   !touch analisis_temporal_2024/mascaras_nubes
   !ls analisis_temporal_2024
   ```
3. **Automatización Programática en JavaScript (Bucles y Procesamiento por Lotes):**
   Automatiza operaciones masivas dentro de bucles `for` en JavaScript usando las funciones auxiliares nativas (`cli()`, `mkdir()`, `rm()`, `ls()`, `touch()`, `du()`, `mv()`, `cp()`, `find()`):
   ```javascript
   // Crear 5 carpetas de forma recurrente con un bucle
   for (var i = 1; i <= 5; i++) {
       mkdir('temporada_' + i);
   }

   // Eliminación masiva recursiva con comodines en 1 sola línea
   rm('temporada_*', true); // true = recursivo (-r)
   ```

---

### 🛠️ Tabla Completa de Comandos CLI y Ejemplos

| Comando CLI | Equivalente en la API Oficial de GEE (`ee.data.*`) | Sintaxis / Banderas | Descripción y Ejemplos Prácticos |
| :--- | :--- | :--- | :--- |
| **`ls` / `dir`** | `ee.data.listAssets(path)` | `ls [ruta] [patrón]` | Lista el contenido de la carpeta actual o destino. Admite comodines (`*`, `?`). `ls ~` lista todas las raíces de proyectos.<br>• *Ejemplos:* `ls`, `ls ~`, `ls users/mi_usuario`, `ls *sentinel*` |
| **`pwd`** | *(Contexto de Shell Virtual)* | `pwd` | Muestra la ruta del directorio de trabajo activo en tus assets.<br>• *Ejemplo:* `pwd` |
| **`cd`** | *(Contexto de Shell Virtual)* | `cd [ruta]` | Cambia el directorio de trabajo activo. Admite rutas relativas (`..`) y absolutas (`~`, `users/...`, `projects/...`).<br>• *Ejemplos:* `cd mi_carpeta`, `cd ..`, `cd ~` |
| **`mkdir`** | `ee.data.createFolder(path)` | `mkdir [-p] <ruta>` | Crea una nueva carpeta en la nube. Con la bandera `-p` crea directorios padre de forma recursiva.<br>• *Ejemplos:* `mkdir temporada_2024`, `mkdir -p proyectos/2024/ndvi` |
| **`touch`** | `ee.data.createAsset({type: 'ImageCollection'})` | `touch <nombre>` | Crea un contenedor o `ImageCollection` vacío en Earth Engine.<br>• *Ejemplo:* `touch s2_compuestos_2024` |
| **`rm` / `rmdir`** | `ee.data.deleteAsset(id)` | `rm [-r/-rf] <destino>` | Elimina un asset. Con `-r` elimina carpetas no vacías de forma recursiva. **¡Soporta comodines (`*`, `?`) para borrado masivo!**<br>• *Ejemplos:* `rm imagen_vieja`, `rm -r carpeta_vieja`, `rm -r temp_*` |
| **`mv`** | `ee.data.renameAsset(src, dest)` | `mv <origen> <destino>` | Renombra o mueve un asset entre carpetas o proyectos de la nube.<br>• *Ejemplos:* `mv test_v1 test_v2`, `mv temp/raster final/raster` |
| **`cp`** | `ee.data.copyAsset(src, dest)` | `cp <origen> <destino>` | Copia un asset de origen a destino.<br>• *Ejemplo:* `cp backup_imagen working_imagen` |
| **`du` / `quota`** | `ee.data.getAssetRootQuota(root)` | `du [ruta]` | Muestra la cuota y uso de disco en MB y conteo de assets. `du ~` consulta todas las raíces de proyectos.<br>• *Ejemplos:* `du`, `du ~`, `du users/mi_usuario` |
| **`find`** | `ee.data.listAssets(...)` *(recursivo)* | `find [ruta] [-name pat] [-type typ] [-maxdepth n]` | Búsqueda recursiva con filtros avanzados (`-type FOLDER\|IMAGE\|TABLE\|IMAGE_COLLECTION`).<br>• *Ejemplos:* `find *landsat*`, `find -type IMAGE`, `find -maxdepth 2` |
| **`catalog` / `search`** | *(Earth Engine Discovery REST API)* | `catalog <búsqueda>` | Busca en el catálogo público global de Google Earth Engine (+1,100 datasets) y genera snippets listos.<br>• *Ejemplos:* `catalog sentinel 2`, `search modis ndvi`, `find -c elevation` |
| **`vars` / `whos`** | *(Inspector de Scope en Memoria)* | `vars` | Inspecciona todas las variables en memoria y sus tipos de Earth Engine (UX RStudio/MATLAB).<br>• *Ejemplo:* `vars` |
| **`history`** | *(Registro Persistente .gee_history)* | `history [n]` | Muestra el historial de comandos guardado en `.gee_history`. Usa `!15` para reejecutar el comando #15.<br>• *Ejemplos:* `history`, `history 10`, `!5` |
| **`clear` / `cls`** | `console.clear()` | `clear` | Limpia la pantalla de la consola interactiva (`Cmd + L` / `Ctrl + L`).<br>• *Ejemplo:* `clear` |

---

## 📂 Explorador de Assets, Monitor de Tareas y Sistema de Archivos Virtual CLI

Administra tus recursos en la nube y monitorea procesos analíticos en segundo plano directamente desde el Cuadrante 4 sin cambiar de ventana:

### 1. Gestor de Assets (Nube)
* **Árbol de Directorios Persistente:** Explora tus proyectos Cloud (`projects/*/assets`) y carpetas heredadas (`users/*`), recordando las carpetas abiertas entre ejecuciones.
* **Creación de Carpetas en 2 Pasos Seguros:** Pulsa el botón `📁+` en la cabecera o usa `Cmd+Shift+N` / `Ctrl+Shift+N` para iniciar un flujo guiado: primero selecciona el proyecto raíz destino en un menú `QuickPick` y luego escribe el nombre de la carpeta, evitando errores accidentales en catálogos de solo lectura.
* **Modal de Detalles de Asset:** Haz **doble clic** en cualquier imagen o tabla para abrir una ventana emergente con sus propiedades completas, bandas, dimensiones y metadatos.
* **Inserción Inmediata en el Editor:** Haz clic en el botón `➕` para insertar la ruta del asset directamente donde esté ubicado tu cursor en el script `.gee`.
* **Copiar y Eliminar:** Botones directos para copiar la ruta del asset (`📋`) o eliminarlo de la nube (`❌`).
* **Normalización Robusta de la API Cloud:** Compatible de forma nativa con los nuevos estándares de respuesta de la API REST v1 de Earth Engine.

### 2. Gestor de Tareas (Cloud Tasks - Diseño Compacto Tree UI)
* **Diseño Minimalista:** Interfaz compacta en formato árbol (`.tree-item`) alineada a la izquierda que se adapta automáticamente al tema claro u oscuro de VS Code.
* **Estado y Duración en Tiempo Real:** Visualiza duraciones de cómputo (ej. `(1m)`), tipos de exportación (`EXPORT_IMAGE`, `EXPORT_TABLE`) e insignias de estado con código de colores (`READY`, `RUNNING`, `COMPLETED`, `FAILED`).
* **Actualizaciones Optimistas Instantáneas:** Inserción visual inmediata (`🔄 Enviando a GEE...`) con ráfagas de sondeo exponencial reactivo al lanzar exportaciones.
* **Notificaciones de Escritorio del Sistema Operativo:** Alertas emergentes nativas en tu escritorio al completarse (`✅ GEE Task completada`) o fallar (`❌ GEE Task falló`) con sugerencias inteligentes de diagnóstico de memoria (`tileScale: 4`).
* **Acciones en 1 Clic:**
  * 🛑 **Cancelar Tarea:** Cancela de inmediato tareas en cola o ejecución.
  * 📁 **Buscar en Google Drive:** Abre directamente la búsqueda en Google Drive del archivo generado.
  * 📋 **Copiar ID:** Copia el identificador único de la tarea al portapapeles.
  * ⚠️ **Copiar Error:** Copia el mensaje técnico detallado en caso de fallos.

### 3. Sistema de Archivos Virtual CLI para Assets
Ejecuta operaciones de terminal de alta velocidad directamente contra los servidores de Google Earth Engine:

* **3 Formas de Ejecutar Comandos CLI:**
  1. **Directamente desde el Editor de Código (`Cmd + Enter` / `Ctrl + Enter`):** Escribe cualquier comando en una línea de tu script `.gee` (ej. `ls`, `du`, `pwd`, `find *`) y ejecútalo sin errores de sintaxis.
  2. **Prefijo Bash `!` en Scripts:** Intercala comandos de terminal en tus flujos de trabajo (ej. `!mkdir temporada_2024`).
  3. **Automatización Programática en JavaScript:** Automatiza operaciones por lotes con funciones auxiliares nativas (`cli()`, `mkdir()`, `rm()`, `ls()`, `touch()`, `du()`, `mv()`, `cp()`, `find()`).

| Comando CLI | Equivalente en la API Oficial de GEE (`ee.data.*`) | Sintaxis / Banderas | Descripción y Ejemplos Prácticos |
| :--- | :--- | :--- | :--- |
| **`ls` / `dir`** | `ee.data.listAssets(path)` | `ls [ruta] [patrón]` | Lista el contenido de la carpeta actual o destino. Admite comodines (`*`, `?`). `ls ~` lista todas las raíces de proyectos.<br>• *Ejemplos:* `ls`, `ls ~`, `ls users/mi_usuario`, `ls *sentinel*` |
| **`pwd`** | *(Contexto de Shell Virtual)* | `pwd` | Muestra la ruta del directorio de trabajo activo en tus assets.<br>• *Ejemplo:* `pwd` |
| **`cd`** | *(Contexto de Shell Virtual)* | `cd [ruta]` | Cambia el directorio de trabajo activo. Admite rutas relativas (`..`) y absolutas (`~`, `users/...`, `projects/...`).<br>• *Ejemplos:* `cd mi_carpeta`, `cd ..`, `cd ~` |
| **`mkdir`** | `ee.data.createFolder(path)` | `mkdir [-p] <ruta>` | Crea una nueva carpeta en la nube. Con la bandera `-p` crea directorios padre de forma recursiva.<br>• *Ejemplos:* `mkdir temporada_2024`, `mkdir -p proyectos/2024/ndvi` |
| **`touch`** | `ee.data.createAsset({type: 'ImageCollection'})` | `touch <nombre>` | Crea un contenedor o `ImageCollection` vacío en Earth Engine.<br>• *Ejemplo:* `touch s2_compuestos_2024` |
| **`rm` / `rmdir`** | `ee.data.deleteAsset(id)` | `rm [-r/-rf] <destino>` | Elimina un asset. Con `-r` elimina carpetas no vacías de forma recursiva. **¡Soporta comodines (`*`, `?`) para borrado masivo!**<br>• *Ejemplos:* `rm imagen_vieja`, `rm -r carpeta_vieja`, `rm -r temp_*` |
| **`mv`** | `ee.data.renameAsset(src, dest)` | `mv <origen> <destino>` | Renombra o mueve un asset entre carpetas o proyectos de la nube.<br>• *Ejemplos:* `mv test_v1 test_v2`, `mv temp/raster final/raster` |
| **`cp`** | `ee.data.copyAsset(src, dest)` | `cp <origen> <destino>` | Copia un asset de origen a destino.<br>• *Ejemplo:* `cp backup_imagen working_imagen` |
| **`du` / `quota`** | `ee.data.getAssetRootQuota(root)` | `du [ruta]` | Muestra la cuota y uso de disco en MB y conteo de assets. `du ~` consulta todas las raíces de proyectos.<br>• *Ejemplos:* `du`, `du ~`, `du users/mi_usuario` |
| **`find`** | `ee.data.listAssets(...)` *(recursivo)* | `find [ruta] [-name pat] [-type typ] [-maxdepth n]` | Búsqueda recursiva con filtros avanzados (`-type FOLDER\|IMAGE\|TABLE\|IMAGE_COLLECTION`).<br>• *Ejemplos:* `find *landsat*`, `find -type IMAGE`, `find -maxdepth 2` |
| **`catalog` / `search`** | *(Earth Engine Discovery REST API)* | `catalog <búsqueda>` | Busca en el catálogo público global de Google Earth Engine (+1,100 datasets) y genera snippets listos.<br>• *Ejemplos:* `catalog sentinel 2`, `search modis ndvi`, `find -c elevation` |
| **`vars` / `whos`** | *(Inspector de Scope en Memoria)* | `vars` | Inspecciona todas las variables en memoria y sus tipos de Earth Engine (UX RStudio/MATLAB).<br>• *Ejemplo:* `vars` |
| **`history`** | *(Registro Persistente .gee_history)* | `history [n]` | Muestra el historial de comandos guardado en `.gee_history`. Usa `!15` para reejecutar el comando #15.<br>• *Ejemplos:* `history`, `history 10`, `!5` |
| **`clear` / `cls`** | `console.clear()` | `clear` | Limpia la pantalla de la consola interactiva (`Cmd + L` / `Ctrl + L`).<br>• *Ejemplo:* `clear` |

---

## 🌐 Motor de Auto-Plotting Inteligente y Búsqueda en el Catálogo Público (+1,100 Datasets)

Explora y descubre más de 1,100 conjuntos de datos públicos oficiales de Google Earth Engine (Sentinel, Landsat, MODIS, ERA5, SRTM, Dynamic World, WorldCover, etc.) y visualiza objetos espaciales sin fricción:

### 1. Búsqueda Interactiva en Paleta de Comandos (`Cmd+Shift+P`)
* Presiona `Cmd+Shift+P` ➔ **`GEE IDE: Search Data Catalog`**.
* Busca en tiempo real por misión, sensor, variable, banda o etiqueta (ej. `sentinel 2`, `landsat 8`, `elevation`, `srtm`, `modis ndvi`, `landcover`).
* Consulta cobertura temporal, tipo de dato y resumen de bandas.
* **Acciones en 1 Clic:**
  * **Insertar y Visualizar en Mapa (Auto-Plot):** Inserta la declaración del dataset y concatena automáticamente `Map.centerObject()` y `Map.addLayer()`. Incluye un **Adivinador Inteligente de VisParams** que detecta el tipo de dato (NDVI, Elevación, Agua, LST) y configura rangos y paletas profesionales.
  * **Insertar en el Editor:** Inserta declaraciones con sintaxis limpia en el lenguaje activo (JS, Python o R) en la posición actual del cursor.
  * **Copiar Snippet y Abrir en Web:** Copia el fragmento al portapapeles o abre la página oficial de documentación de Google en el navegador.

### 2. Búsqueda CLI en Consola `gee>`
* **Comandos directos:**
  ```text
  gee> catalog sentinel 2
  gee> search modis ndvi
  gee> catalog srtm -type image
  gee> find -catalog "land cover"
  ```
* Imprime identificadores, descripciones, rangos temporales, bandas y fragmentos de código listos para ejecutar directamente en la consola.

### 3. Auto-Plotting Inteligente en Consola (UX RStudio)
Al evaluar cualquier expresión espacial de Earth Engine o estructura GeoJSON nativa en el REPL interactivo `gee>`, el IDE la plotea automáticamente en el Visor de Mapas y centra la cámara sin requerir `Map.addLayer()` explícito:
* **Entidades Soportadas:** Soporte nativo para `ee.Image`, `ee.ImageCollection`, `ee.FeatureCollection`, `ee.Feature`, `ee.Geometry` y estructuras directas GeoJSON `{"type": "Polygon", ...}`.
* **Priorización Inteligente de RGB Color Verdadero:** Detecta automáticamente composiciones de color natural (`B4`/`B3`/`B2`, `B4_median`/`B3_median`/`B2_median`) y las prioriza sobre bandas térmicas o de calidad QA, evitando visualizaciones en escalas de grises erróneas.
* **Muestras de Color en Vivo:** Los autoplots integran muestras cromáticas representativas en el Gestor de Capas.

---

## ⌨️ Tabla de Atajos de Teclado (Cheat Sheet)

| Atajo (macOS) | Atajo (Win/Linux) | Acción | Contexto |
| :--- | :--- | :--- | :--- |
| `Cmd + Enter` | `Ctrl + Enter` | **Ejecutar Línea o Bloque Inteligente** | Editor `.gee` |
| `Cmd + Shift + Enter` | `Ctrl + Shift + Enter` | **Ejecutar Script Completo** | Editor `.gee` |
| `Cmd + L` | `Ctrl + L` | **Limpiar Pantalla de Consola** | Global / Consola |
| `Option + S` | `Alt + S` | **Captura de Pantalla HD (2x Retina)** | Visor de Mapas / Global |
| `1` – `9` | `1` – `9` | **Alternar Visibilidad de Capas 1 a 9** | Visor de Mapas (Capas) |
| `0` | `0` | **Alternar Visibilidad de Todas las Capas** | Visor de Mapas (Capas) |
| `Tab` | `Tab` | **Saltar al siguiente parámetro de Snippet** | Durante edición |
| `Shift + Tab` | `Shift + Tab` | **Regresar al parámetro anterior de Snippet** | Durante edición |
| `↑` / `↓` | `↑` / `↓` | **Navegar por el historial de comandos** | Consola `gee>` |
| `Cmd + 1` | `Ctrl + 1` | **Foco al Cuadrante 1 (Editor)** | Global |
| `Cmd + 2` | `Ctrl + 2` | **Foco al Cuadrante 2 (Consola)** | Global |
| `Cmd + 3` | `Ctrl + 3` | **Foco al Cuadrante 3 (Mapa)** | Global |
| `Cmd + 4` | `Ctrl + 4` | **Foco al Cuadrante 4 (AI / Assets)** | Global |

---

## ⚖️ Licencia, Ética y Compatibilidad de Código

### Transparencia sobre Paradigmas de RStudio
GEE IDE implementa deliberadamente **paradigmas ergonómicos y patrones de flujo de trabajo** popularizados por **RStudio** (tales como la auto-evaluación en consola, la cuadrícula de 4 cuadrantes científicos, el archivo de historial persistente `.gee_history`, la búsqueda de ayuda mediante `?` y las plantillas con tabulación). 

> **Nota Legal y de Propiedad Intelectual:**
> Los flujos de trabajo de interfaz de usuario, atajos de teclado y convenciones de interacción científica son conceptos de diseño universalmente adoptados en la industria del software. **GEE IDE no copia ni distribuye código fuente privativo de RStudio (Posit Software, PBC)**. Todo el código de GEE IDE ha sido desarrollado de forma original e independiente en TypeScript y JavaScript, distribuido de manera 100% abierta bajo la **Licencia Apache 2.0**.

### Atribuciones de Código Abierto
* Diseñado sobre el ecosistema de extensiones de [Visual Studio Code](https://code.visualstudio.com/).
* Biblioteca oficial de cliente [@google/earthengine](https://www.npmjs.com/package/@google/earthengine) (Apache License 2.0).
* Visor cartográfico interactivo impulsado por [Leaflet](https://leafletjs.com/) (BSD 2-Clause License).
* Integración con la comunidad de [rgee](https://github.com/r-spatial/rgee) y [geemap](https://geemap.org/).
* Inspirado en contribuciones de la comunidad geoespacial abierta, incluyendo [earthengine-extension](https://github.com/12rambau/earthengine-extension) (Apache License 2.0). Ver `NOTICES.md` para el desglose completo.

---

<p align="center">
  Desarrollado con dedicación por <strong>Luis Robles</strong> para la comunidad global de ciencias de la Tierra y teledetección.
</p>
