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
import ee

_BRIDGE_PORT = os.environ.get("GEE_PRO_BRIDGE_PORT", "31415")
_BRIDGE_URL = f"http://127.0.0.1:{_BRIDGE_PORT}"


def _send(action: str, payload: dict) -> None:
    """Send a command to the VS Code GEE IDE bridge server."""
    try:
        data = json.dumps({"action": action, "payload": payload}).encode("utf-8")
        req = urllib.request.Request(
            _BRIDGE_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5):
            pass
    except urllib.error.URLError:
        print(f"[GEE IDE] Warning: could not reach the map bridge at {_BRIDGE_URL}")
    except Exception as e:
        print(f"[GEE IDE] Map bridge error: {e}")


def _get_map_id(ee_object, vis_params: dict = None) -> dict | None:
    """Convert an EE object to a tile URL using the EE REST API."""
    vis_params = vis_params or {}
    try:
        if isinstance(ee_object, ee.ImageCollection):
            ee_object = ee_object.mosaic()

        if isinstance(ee_object, (ee.Geometry, ee.Feature, ee.FeatureCollection)):
            features = ee.FeatureCollection(ee_object)
            color = vis_params.get("color", "000000")
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

    def addLayer(self, ee_object, vis_params: dict = None, name: str = "Layer",
                 shown: bool = True, opacity: float = 1.0) -> None:
        """Add an EE layer to the GEE IDE map."""
        print(f"[GEE IDE] Adding layer: {name}...")
        map_id = _get_map_id(ee_object, vis_params or {})
        if map_id:
            _send("addLayer", {
                "url": map_id["urlFormat"],
                "name": name,
                "shown": shown,
                "opacity": opacity,
            })
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
        _send("clear", {})

    # Compatibility stubs for geemap / Code Editor Map API
    def add_layer(self, *args, **kwargs): return self.addLayer(*args, **kwargs)
    def set_center(self, *args, **kwargs): return self.setCenter(*args, **kwargs)
    def center_object(self, *args, **kwargs): return self.centerObject(*args, **kwargs)


# The global Map object — used as `Map.addLayer(...)` in scripts
Map = _GeeProMap()
