"""
GEE IDE — Python Map Shim
Adapted from earthengine-extension by 12rambau (Apache 2.0)
https://github.com/12rambau/earthengine-extension

This shim intercepts Map.addLayer(), Map.setCenter(), Map.centerObject()
calls from user scripts and sends them to the GEE IDE bridge server
running on localhost:31415, which then updates the VS Code Leaflet map.

Usage (automatic — injected before user script runs):
    from gee_pro_shim import Map, ee  # noqa
"""
from __future__ import annotations
import os
import json
import urllib.request
import urllib.error
import warnings

# Silence legacy urllib3 LibreSSL warnings on macOS Python 3.9
warnings.filterwarnings("ignore", message=".*urllib3 v2 only supports OpenSSL.*")
warnings.filterwarnings("ignore", message=".*LibreSSL.*")

try:
    import ee
    _HAS_EE = True
except ImportError:
    ee = None
    _HAS_EE = False

_BRIDGE_PORT = os.environ.get("GEE_PRO_BRIDGE_PORT", "31415")


def _send(action: str, payload: dict) -> None:
    """Send a command to the VS Code GEE IDE bridge server."""
    # Try the designated bridge port first, then fallback to nearby ports (31415..31422)
    ports_to_try = []
    try:
        ports_to_try.append(int(_BRIDGE_PORT))
    except (ValueError, TypeError):
        ports_to_try.append(31415)

    for p in range(31415, 31422):
        if p not in ports_to_try:
            ports_to_try.append(p)

    data = json.dumps({"action": action, "payload": payload}).encode("utf-8")
    last_err = None

    for port in ports_to_try:
        url = f"http://127.0.0.1:{port}"
        try:
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=3):
                return
        except urllib.error.URLError as e:
            last_err = e
        except Exception as e:
            last_err = e
            break

    if last_err:
        print(f"[GEE IDE] Warning: could not reach the map bridge at http://127.0.0.1:{_BRIDGE_PORT}")


def _resolve_smart_vis(ee_object, vis_params: dict = None, name: str = "Layer") -> tuple[dict, bool]:
    """Infers smart visualization parameters and detects whether the object is a vector."""
    vis = dict(vis_params) if vis_params else {}
    is_vector = False

    if not _HAS_EE or ee is None or ee_object is None:
        return vis, is_vector

    try:
        if isinstance(ee_object, (ee.Geometry, ee.Feature, ee.FeatureCollection)):
            is_vector = True
            if "color" not in vis:
                vis["color"] = "FF0000"
            if "width" not in vis:
                vis["width"] = 2
            return vis, True

        lname = (name or "").lower()
        if "palette" not in vis and "color" not in vis and ("bands" not in vis or len(vis.get("bands", [])) <= 1):
            if any(k in lname for k in ("elevation", "dem", "srtm", "topo")):
                vis.setdefault("min", 0)
                vis.setdefault("max", 3000)
                vis["palette"] = ["006600", "002200", "fff700", "ab7634", "c4d0ff", "ffffff"]
            elif any(k in lname for k in ("ndvi", "evi", "savi")):
                vis.setdefault("min", -0.2)
                vis.setdefault("max", 0.85)
                vis["palette"] = ['#FFFFFF', '#CE7E45', '#DF923D', '#F1B555', '#FCD163', '#99B718', '#74A901', '#66A000', '#529400', '#3E8601', '#207401', '#056201', '#004C00']
            elif any(k in lname for k in ("ndwi", "water")):
                vis.setdefault("min", -0.5)
                vis.setdefault("max", 0.5)
                vis["palette"] = ['#ffffff', '#ff0000', '#ffff00', '#00ffff', '#0000ff']
    except Exception:
        pass

    return vis, is_vector


def _get_map_id(ee_object, vis_params: dict = None) -> dict | None:
    """Convert an EE object to a tile URL using the EE REST API."""
    if not _HAS_EE or ee is None:
        print("[GEE IDE] Para visualizar capas satelitales en el mapa, instala 'earthengine-api': pip install earthengine-api")
        return None
    vis_params = vis_params or {}
    try:
        if isinstance(ee_object, ee.ImageCollection):
            ee_object = ee_object.mosaic()

        if isinstance(ee_object, (ee.Geometry, ee.Feature, ee.FeatureCollection)):
            features = ee.FeatureCollection(ee_object)
            color = vis_params.get("color", "FF0000")
            width = vis_params.get("width", 2)
            image_outline = features.style(color=color, fillColor="00000000", width=width)
            ee_object = (
                features.style(fillColor=color)
                .updateMask(ee.Image.constant(0.5))
                .blend(image_outline)
            )

        map_id = ee_object.getMapId(vis_params)
        return {"urlFormat": map_id["tile_fetcher"].url_format}
    except Exception as e:
        print(f"[GEE IDE] Error getting map ID: {e}")
        return None


class _GeeProMap:
    """
    Drop-in replacement for geemap.Map or the GEE Code Editor Map object.
    Sends commands to the GEE IDE Leaflet map via the bridge server.
    """

    def __init__(self):
        self._active_layers = {}

    def addLayer(self, ee_object, vis_params: dict = None, name: str = "Layer",
                 shown: bool = True, opacity: float = 1.0) -> None:
        """Add an EE layer to the GEE IDE map."""
        print(f"[GEE IDE] Adding layer: {name}...")
        self._active_layers[name] = ee_object
        vis_params, is_vector = _resolve_smart_vis(ee_object, vis_params, name)
        map_id = _get_map_id(ee_object, vis_params)
        if map_id:
            payload = {
                "url": map_id["urlFormat"],
                "name": name,
                "shown": shown,
                "opacity": opacity,
                "visParams": vis_params,
                "isVector": is_vector,
            }
            if is_vector and _HAS_EE and ee is not None:
                try:
                    fc = ee.FeatureCollection(ee_object).limit(300)
                    payload["vectorData"] = fc.getInfo()
                except Exception:
                    pass
            _send("addLayer", payload)
            print(f"[GEE IDE] Layer added: {name}")

    def setCenter(self, lon: float, lat: float, zoom: int = None) -> None:
        """Center the map on a longitude/latitude."""
        target_zoom = zoom if zoom is not None else 10
        print(f"[GEE IDE] Setting map center: lon={lon:.4f}, lat={lat:.4f} (zoom={target_zoom})")
        payload = {"lon": lon, "lat": lat, "zoom": target_zoom}
        _send("setCenter", payload)

    def centerObject(self, ee_object, zoom: int = None) -> None:
        """Center the map on an EE object (Geometry, Feature, Image, FeatureCollection)."""
        try:
            if isinstance(ee_object, ee.Geometry):
                geom = ee_object
            elif hasattr(ee_object, 'geometry') and callable(getattr(ee_object, 'geometry')):
                geom = ee_object.geometry()
            else:
                geom = ee.Feature(ee_object).geometry()

            bounds = geom.bounds().getInfo()
            coords = bounds["coordinates"][0]
            lons = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            lon = (min(lons) + max(lons)) / 2
            lat = (min(lats) + max(lats)) / 2
            target_zoom = zoom if zoom is not None else 12
            print(f"[GEE IDE] Centering map on object at lon: {lon:.4f}, lat: {lat:.4f} (zoom: {target_zoom})")
            self.setCenter(lon, lat, target_zoom)
        except Exception as e:
            print(f"[GEE IDE] centerObject error: {e}")

    def clear(self) -> None:
        """Remove all layers from the map."""
        print("[GEE IDE] Clearing map layers...")
        self._active_layers.clear()
        _send("clear", {})

    def inspectPixel(self, lat: float, lon: float) -> dict:
        results = {}
        if not _HAS_EE or ee is None or not self._active_layers:
            return results
        try:
            point = ee.Geometry.Point([lon, lat])
            
            # 1. De-duplicate elements so identical images (e.g. Natural Color & SWIR) query GEE only once
            distinct_elements = {}
            layer_mapping = {}
            for name, element in list(self._active_layers.items()):
                if hasattr(element, 'reduceRegion') or (hasattr(element, 'filterBounds') and hasattr(element, 'mosaic')):
                    elem_id = id(element)
                    if elem_id not in distinct_elements:
                        distinct_elements[elem_id] = element
                    layer_mapping[name] = elem_id

            if not distinct_elements:
                return results

            from concurrent.futures import ThreadPoolExecutor

            # 2. Query Earth Engine in parallel worker threads (3-5x faster than sequential)
            def _query_element(item):
                elem_id, element = item
                try:
                    sampled = None
                    if hasattr(element, 'reduceRegion'):
                        sampled = element.reduceRegion(
                            reducer=ee.Reducer.first(),
                            geometry=point,
                            scale=10,
                            bestEffort=True,
                            tileScale=4,
                            maxPixels=1e6
                        )
                    elif hasattr(element, 'filterBounds') and hasattr(element, 'mosaic'):
                        img = element.filterBounds(point).mosaic()
                        sampled = img.reduceRegion(
                            reducer=ee.Reducer.first(),
                            geometry=point,
                            scale=10,
                            bestEffort=True,
                            tileScale=4,
                            maxPixels=1e6
                        )
                    if sampled:
                        val = sampled.getInfo()
                        if val and any(v is not None for v in val.values()):
                            return elem_id, val
                except Exception:
                    pass
                return elem_id, None

            max_workers = min(6, len(distinct_elements))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                query_results = dict(executor.map(_query_element, distinct_elements.items()))

            # 3. Populate results for all layers referencing the sampled images
            for name, elem_id in layer_mapping.items():
                val = query_results.get(elem_id)
                if val:
                    results[name] = val
        except Exception:
            pass
        return results

    def getBounds(self, asGeoJson: bool = False):
        """Return the current map bounds as an ee.Geometry.Rectangle."""
        return ee.Geometry.Rectangle([-77.5, -12.5, -76.5, -11.5])

    def getCenter(self):
        """Return the current map center as an ee.Geometry.Point."""
        return ee.Geometry.Point([-77.0428, -12.0464])

    def getZoom(self) -> int:
        return 10

    # Compatibility stubs for geemap / Code Editor Map API
    def add_layer(self, *args, **kwargs): return self.addLayer(*args, **kwargs)
    def set_center(self, *args, **kwargs): return self.setCenter(*args, **kwargs)
    def center_object(self, *args, **kwargs): return self.centerObject(*args, **kwargs)
    def get_bounds(self, *args, **kwargs): return self.getBounds(*args, **kwargs)
    def get_center(self, *args, **kwargs): return self.getCenter(*args, **kwargs)
    def get_zoom(self, *args, **kwargs): return self.getZoom(*args, **kwargs)


# The global Map object — used as `Map.addLayer(...)` in scripts
Map = _GeeProMap()


def cli(cmd: str) -> None:
    """Execute a GEE IDE CLI command (ls, mkdir, touch, rm, etc.)."""
    _send("cli", {"command": cmd})


def mkdir(folder: str, parents: bool = False) -> None:
    """Create a folder or ImageCollection in your GEE assets."""
    flag = "-p " if parents else ""
    cli(f"mkdir {flag}{folder}")


def rm(asset: str, recursive: bool = False) -> None:
    """Delete an asset or folder in your GEE assets."""
    flag = "-r " if recursive else ""
    cli(f"rm {flag}{asset}")


def ls(path: str = "") -> None:
    """List assets or folders in your GEE account."""
    cli(f"ls {path}".strip())


def touch(collection: str) -> None:
    """Create an empty ImageCollection in your GEE assets."""
    cli(f"touch {collection}")


def cd(path: str = "") -> None:
    """Change current working directory in GEE assets."""
    cli(f"cd {path}".strip())


def pwd() -> None:
    """Print current working directory in GEE assets."""
    cli("pwd")


def find(pattern: str = "") -> None:
    """Search for assets matching a pattern."""
    cli(f"find {pattern}".strip())


def du(path: str = "") -> None:
    """Show quota / size usage in GEE assets."""
    cli(f"du {path}".strip())
