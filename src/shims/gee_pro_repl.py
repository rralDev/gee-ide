"""
GEE IDE — Python Interactive REPL Runner
Maintains a persistent Python session in memory, evaluates expressions,
manages user variables across line-by-line executions, and connects to the Leaflet bridge.
"""
from __future__ import annotations
import sys
import os
import ast
import json
import traceback
import warnings
import textwrap
import math
import re
import datetime

# Silence legacy urllib3 LibreSSL warnings on macOS Python 3.9
warnings.filterwarnings("ignore", message=".*urllib3 v2 only supports OpenSSL.*")
warnings.filterwarnings("ignore", message=".*LibreSSL.*")

# Force immediate line buffering for unbuffered terminal output
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass

SENTINEL = "___GEE_PRO_PY_DONE___"

# Add the shims directory to sys.path
_shims_dir = os.path.dirname(os.path.abspath(__file__))
if _shims_dir not in sys.path:
    sys.path.insert(0, _shims_dir)

# Initialize global namespace for user code with built-in standard modules
user_globals: dict = {
    "__name__": "__main__",
    "__doc__": None,
    "os": os,
    "sys": sys,
    "json": json,
    "math": math,
    "re": re,
    "datetime": datetime,
}

# Auto-initialize Earth Engine if available
_access_token = os.environ.get("GEE_PRO_ACCESS_TOKEN", "")
_project = os.environ.get("GEE_PRO_PROJECT", "")
_refresh_token = os.environ.get("GEE_PRO_REFRESH_TOKEN", "")
_client_id = os.environ.get("GEE_PRO_CLIENT_ID", "") or "1036274178372-q49ood00eek54o0oro08ldp4765ptbo9.apps.googleusercontent.com"
_client_secret = os.environ.get("GEE_PRO_CLIENT_SECRET", "") or "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"

# Fallback: read ~/.config/earthengine/credentials if project or refresh_token not set
try:
    _cred_path = os.path.expanduser("~/.config/earthengine/credentials")
    if os.path.exists(_cred_path):
        with open(_cred_path, "r", encoding="utf-8") as _f:
            _data = json.load(_f)
            if not _project or _project in ("PeruREDD", "gee-pro-default"):
                if _data.get("project"):
                    _project = _data["project"]
            if not _refresh_token and _data.get("refresh_token"):
                _refresh_token = _data["refresh_token"]
            if _data.get("client_id"):
                _client_id = _data["client_id"]
            if _data.get("client_secret"):
                _client_secret = _data["client_secret"]
except Exception:
    pass

try:
    import ee
    _ee_available = True
    user_globals["ee"] = ee
except ImportError:
    _ee_available = False

_default_creds = None
if _ee_available:
    try:
        from google.oauth2.credentials import Credentials
        if _refresh_token:
            # Full OAuth2 credential with automatic refresh capability (indefinite lifespan)
            _default_creds = Credentials(
                token=_access_token or None,
                refresh_token=_refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=_client_id,
                client_secret=_client_secret
            )
        elif _access_token:
            _default_creds = Credentials(_access_token)

        _orig_init = ee.Initialize

        def _safe_init(credentials=None, project=None, *args, **kwargs):
            creds = credentials if credentials is not None else _default_creds
            proj = project or _project or None
            try:
                if creds:
                    if proj:
                        return _orig_init(creds, project=proj, *args, **kwargs)
                    return _orig_init(creds, *args, **kwargs)
                elif proj:
                    return _orig_init(project=proj, *args, **kwargs)
                else:
                    return _orig_init(*args, **kwargs)
            except Exception as init_err:
                err_str = str(init_err)
                if "invalid_grant" in err_str or "unauthorized_client" in err_str or "RefreshError" in err_str:
                    print("\n⚠️ [GEE IDE] La sesión de Google Earth Engine ha expirado o requiere renovación.", file=sys.stderr)
                    print("👉 Para renovarla en 5 segundos ejecuta: Cmd+Shift+P -> 'GEE IDE: Login with Google'\n", file=sys.stderr)
                raise init_err

        ee.Initialize = _safe_init

        # Perform initial initialization
        try:
            ee.Initialize()
        except Exception:
            pass
    except Exception:
        pass

# Import Map shim and CLI helpers
try:
    import gee_pro_shim
    from gee_pro_shim import Map, cli, mkdir, rm, ls, touch, cd, pwd, find, du
    user_globals.update({
        "Map": Map,
        "cli": cli,
        "mkdir": mkdir,
        "rm": rm,
        "ls": ls,
        "touch": touch,
        "cd": cd,
        "pwd": pwd,
        "find": find,
        "du": du,
    })
except Exception:
    pass

# Helper to inspect user-defined variables
def _vars():
    builtins_set = {
        "__name__", "__doc__", "__builtins__", "ee", "Map", "cli",
        "mkdir", "rm", "ls", "touch", "cd", "pwd", "find", "du", "vars",
        "plot", "show"
    }
    user_vars = {}
    for k, v in user_globals.items():
        if k.startswith("_") or k in builtins_set:
            continue
        user_vars[k] = type(v).__name__
    if not user_vars:
        print("[python] No user variables in memory.")
        return
    print("[python] Variables in memory:")
    for k, t in sorted(user_vars.items()):
        val_str = str(user_globals[k])
        if len(val_str) > 60:
            val_str = val_str[:57] + "..."
        print(f"  {k} ({t}) = {val_str}")

user_globals["vars"] = _vars

def plot(obj, name=None, **vis_params):
    """Plot an Earth Engine object explicitly on the map."""
    if "Map" in user_globals and user_globals["Map"] is not None:
        user_globals["Map"].addLayer(obj, vis_params or None, name or "Layer")

user_globals["plot"] = plot
user_globals["show"] = plot

def View(obj, name=None):
    """View detailed metadata and structure of an Earth Engine or Python object in the map inspector."""
    var_name = name or "Objeto"
    info = None
    if _ee_available and hasattr(obj, "getInfo") and callable(getattr(obj, "getInfo")):
        try:
            info = obj.getInfo()
        except Exception as e:
            info = {"error": str(e), "repr": repr(obj)}
    elif isinstance(obj, (dict, list)):
        info = obj
    else:
        info = {"type": type(obj).__name__, "value": repr(obj)}

    port = os.environ.get("GEE_PRO_BRIDGE_PORT")
    if port:
        try:
            import urllib.request
            payload = {
                "action": "viewObject",
                "payload": {
                    "name": var_name,
                    "data": info
                }
            }
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=1.5)
        except Exception:
            pass

    print(f"👁️ [View] Inspeccionando '{var_name}' en el visor interactivo (Presiona Esc para cerrar).")

user_globals["View"] = View
user_globals["view"] = View


def execute_block(source: str):
    # Strip shebang or header lines
    lines = source.split("\n")
    cleaned_lines = []
    for l in lines:
        stripped = l.strip()
        if stripped.startswith("# py") or stripped.startswith("# python") or stripped.startswith("// py") or stripped.startswith("// python"):
            continue
        cleaned_lines.append(l)
    code_str = "\n".join(cleaned_lines)
    code_str = textwrap.dedent(code_str).strip()
    if not code_str:
        return

    # 1. Shell commands (!ls, .pwd, !git, etc.)
    if code_str.startswith("!") or code_str.startswith("."):
        cli(code_str)
        return

    # 2. CLI commands (cd robles, ls users/robles, mkdir ..., rm ..., find ..., du ..., etc.)
    tokens = code_str.split()
    if tokens:
        first = tokens[0]
        cli_cmds = {"cd", "ls", "dir", "mkdir", "rm", "rmdir", "touch", "find", "du", "quota", "history", "clear", "cls", "help"}
        if first in cli_cmds:
            # Check if this is a CLI command rather than a python assignment or expression
            has_py_syntax = any(c in code_str for c in ("=", "(", ")", "[", "]", "{", "}", ",", "+", "*", "/", ":", "\\"))
            if not has_py_syntax:
                cli(code_str)
                return

    try:
        parsed = ast.parse(code_str)
    except SyntaxError:
        traceback.print_exc()
        return

    if not parsed.body:
        return

    # If the block is solely a bare string literal (e.g. a docstring or multi-line comment block),
    # do not evaluate it and print its raw string representation to the terminal.
    if (
        len(parsed.body) == 1
        and isinstance(parsed.body[0], ast.Expr)
        and isinstance(getattr(parsed.body[0].value, "value", getattr(parsed.body[0].value, "s", None)), str)
        and (code_str.strip().startswith('"""') or code_str.strip().startswith("'''"))
    ):
        return

    try:
        # If the last statement is an expression (e.g. a variable name, arithmetic, or function call without assignment),
        # evaluate it and print its result just like a native REPL
        if isinstance(parsed.body[-1], ast.Expr):
            stmt_nodes = parsed.body[:-1]
            last_expr = parsed.body[-1].value

            if stmt_nodes:
                mod = ast.Module(body=stmt_nodes, type_ignores=[])
                code_obj = compile(mod, "<gee-console>", "exec")
                exec(code_obj, user_globals)

            expr_mod = ast.Expression(body=last_expr)
            code_obj = compile(expr_mod, "<gee-console>", "eval")
            res = eval(code_obj, user_globals)
            if res is not None:
                # If evaluated expression is a callable invoked as a bare identifier (e.g. `vars`, `pwd`, `ls`), execute it!
                if callable(res) and isinstance(last_expr, ast.Name):
                    import inspect
                    try:
                        sig = inspect.signature(res)
                        req_params = [
                            p for p in sig.parameters.values()
                            if p.default == inspect.Parameter.empty and p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
                        ]
                        if len(req_params) == 0:
                            call_res = res()
                            if call_res is not None:
                                print(repr(call_res))
                            res = None
                    except Exception:
                        pass

                # If result is an Earth Engine spatial object (e.g. `roi`, `image`, `ndvi`, `fc`)
                elif _ee_available and isinstance(res, (ee.Geometry, ee.Feature, ee.FeatureCollection, ee.Image, ee.ImageCollection)):
                    var_name = last_expr.id if isinstance(last_expr, ast.Name) else "Auto-Plot"
                    summary = ""
                    try:
                        cname = type(res).__name__
                        if isinstance(res, ee.Geometry):
                            gtype = res.type().getInfo()
                            summary = f"[ee.Geometry.{gtype}]"
                        elif isinstance(res, ee.Image):
                            bnames = res.bandNames().getInfo()
                            bands_str = ", ".join(f"'{b}'" for b in bnames[:6])
                            if len(bnames) > 6:
                                bands_str += f", ... (+{len(bnames) - 6})"
                            summary = f"[ee.Image: Bandas [{bands_str}]]"
                        elif isinstance(res, ee.FeatureCollection):
                            summary = f"[ee.FeatureCollection: {var_name}]"
                        elif isinstance(res, ee.ImageCollection):
                            summary = f"[ee.ImageCollection: {var_name}]"
                        elif isinstance(res, ee.Feature):
                            summary = f"[ee.Feature: {var_name}]"
                        else:
                            summary = f"[ee.{cname}]"
                    except Exception:
                        summary = f"<ee.{type(res).__name__} object>"

                    print(f"  🔹 {summary}")
                    print(f"🗺️ Auto-Plot: [{var_name}] proyectado en el visor")
                    print(f"💡 Tip: Usa View({var_name}) para ver su estructura o print({var_name}) para ver el JSON.")

                    # Auto-plot on Map
                    try:
                        if "Map" in user_globals and user_globals["Map"] is not None:
                            user_globals["Map"].centerObject(res)
                            user_globals["Map"].addLayer(res, None, var_name)
                    except Exception:
                        pass
                    res = None

                if res is not None:
                    print(repr(res))
        else:
            code_obj = compile(parsed, "<gee-console>", "exec")
            exec(code_obj, user_globals)
    except Exception as exc:
        try:
            sys.stdout.flush()
        except Exception:
            pass
        exc_str = str(exc)
        if "RefreshError" in type(exc).__name__ or "invalid_grant" in exc_str or "unauthorized_client" in exc_str or "refresh the access token" in exc_str:
            print("\n" + "="*70, file=sys.stderr)
            print("🔑 [GEE IDE] SESIÓN DE GOOGLE EARTH ENGINE EXPIRADA O REVOCADA", file=sys.stderr)
            print("="*70, file=sys.stderr)
            print("El token de acceso de Google ha expirado y requiere ser renovado.", file=sys.stderr)
            print("👉 Solución rápida (5 segundos):", file=sys.stderr)
            print("   Presiona Cmd+Shift+P y selecciona: 'GEE IDE: Login with Google'", file=sys.stderr)
            print("="*70 + "\n", file=sys.stderr)
        traceback.print_exc()
        try:
            sys.stderr.flush()
        except Exception:
            pass


def reset_memory():
    preserved = {
        "__name__", "__doc__", "__builtins__", "ee", "Map", "cli",
        "mkdir", "rm", "ls", "touch", "cd", "pwd", "find", "du", "vars",
        "plot", "show", "os", "sys", "json", "math", "re", "datetime"
    }
    to_delete = [k for k in user_globals if k not in preserved and not k.startswith("_")]
    for k in to_delete:
        del user_globals[k]
    print("[python] Sesión de Python reiniciada. Variables en memoria liberadas.")


def main():
    # Signal that REPL has booted and is ready
    sys.stdout.write(SENTINEL + "\n")
    sys.stdout.flush()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            action = payload.get("action", "exec")
            if action == "exec":
                file_path = payload.get("file")
                if file_path:
                    user_globals["__file__"] = file_path
                    script_dir = os.path.dirname(os.path.abspath(file_path))
                    if script_dir not in sys.path:
                        sys.path.insert(0, script_dir)
                    try:
                        os.chdir(script_dir)
                    except Exception:
                        pass

                code_to_run = payload.get("code", "")
                if code_to_run:
                    execute_block(code_to_run)
            elif action == "reset":
                reset_memory()
            elif action == "vars":
                _vars()
            elif action == "inspect":
                lat = float(payload.get("lat", 0))
                lon = float(payload.get("lon", 0))
                res = Map.inspectPixel(lat, lon) if (hasattr(Map, 'inspectPixel') and callable(getattr(Map, 'inspectPixel'))) else {}
                sys.stdout.write(f"___INSPECT_RESULT___{json.dumps(res)}\n")
        except Exception:
            traceback.print_exc()
        finally:
            sys.stdout.flush()
            sys.stderr.flush()
            sys.stdout.write(SENTINEL + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
