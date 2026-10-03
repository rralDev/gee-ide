import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

// Adapted from eetasks by gee-community (MIT)
// https://github.com/gee-community/eetasks
// Modifications: TypeScript rewrite, VS Code EventEmitter integration

interface OAuthResponse {
    code: string;
    state: string;
}

/**
 * A local HTTP server that handles the OAuth2 loopback redirect flow.
 * Listens on a random free port, serves the redirect, and resolves
 * the authorization code promise when Google redirects back.
 */
export class LoopbackAuthServer {
    private server: http.Server;
    private _nonce: string;
    private _port: number = 0;
    private _codeResolve!: (value: OAuthResponse) => void;
    private _codeReject!: (reason: any) => void;
    private _codePromise: Promise<OAuthResponse>;

    constructor() {
        this._nonce = crypto.randomBytes(16).toString('hex');
        this._codePromise = new Promise((resolve, reject) => {
            this._codeResolve = resolve;
            this._codeReject = reject;
        });

        this.server = http.createServer((req, res) => {
            if (!req.url) { res.end(); return; }
            const url = new URL(req.url, `http://127.0.0.1`);

            if (url.pathname === '/logo.png') {
                const fs = require('fs');
                const path = require('path');
                const logoPath = path.join(__dirname, '..', 'media', 'logo.png');
                if (fs.existsSync(logoPath)) {
                    res.writeHead(200, { 'Content-Type': 'image/png' });
                    fs.createReadStream(logoPath).pipe(res);
                    return;
                }
                res.writeHead(404); res.end();
                return;
            }

            if (url.pathname === '/callback') {
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                const error = url.searchParams.get('error');

                if (error) {
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
                        body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0b0f19; color: #fff; }
                        .card { background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(239, 68, 68, 0.3); padding: 40px; border-radius: 16px; text-align: center; max-width: 420px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
                        h2 { color: #ef4444; margin-bottom: 10px; } p { color: #94a3b8; }
                    </style></head><body><div class="card">
                        <h2>❌ Error de Autenticación</h2>
                        <p>${error}</p>
                        <p>Puedes cerrar esta ventana e intentarlo nuevamente en VS Code.</p>
                    </div></body></html>`);
                    this._codeReject(new Error(`OAuth error: ${error}`));
                    return;
                }

                if (!code || state !== this._nonce) {
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
                        body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0b0f19; color: #fff; }
                        .card { background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(239, 68, 68, 0.3); padding: 40px; border-radius: 16px; text-align: center; max-width: 420px; }
                        h2 { color: #ef4444; } p { color: #94a3b8; }
                    </style></head><body><div class="card">
                        <h2>⚠️ Respuesta no válida</h2>
                        <p>El código o el estado de seguridad no coinciden. Puedes cerrar esta ventana.</p>
                    </div></body></html>`);
                    this._codeReject(new Error('Invalid OAuth state or missing code'));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GEE IDE — Autenticación Exitosa</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #090d16 radial-gradient(circle at 50% 25%, #172a45 0%, #090d16 80%);
            color: #f1f5f9;
            padding: 20px;
        }
        .container {
            background: rgba(22, 31, 48, 0.75);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 24px;
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7), 0 0 40px rgba(0, 122, 255, 0.15);
            padding: 45px 35px;
            max-width: 490px;
            width: 100%;
            text-align: center;
            animation: fadeIn 0.5s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(15px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .logo-wrap {
            position: relative;
            display: inline-block;
            margin-bottom: 20px;
        }
        .logo-img {
            width: 84px;
            height: 84px;
            border-radius: 20px;
            box-shadow: 0 10px 25px rgba(0, 122, 255, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.2);
            display: block;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.3);
            padding: 5px 14px;
            border-radius: 50px;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.5px;
            margin-bottom: 14px;
        }
        h1 {
            font-size: 24px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 10px;
            letter-spacing: -0.3px;
        }
        p {
            color: #94a3b8;
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 28px;
        }
        p strong {
            color: #e2e8f0;
        }
        .actions-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #64748b;
            margin-bottom: 12px;
            text-align: left;
        }
        .links-grid {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 25px;
        }
        .link-card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 12px 16px;
            color: #f8fafc;
            text-decoration: none;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
        }
        .link-card:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(56, 189, 248, 0.5);
            transform: translateY(-2px);
        }
        .link-card .icon-label {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .link-arrow {
            color: #64748b;
            font-size: 14px;
        }
        .footer {
            font-size: 12px;
            color: #64748b;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 18px;
        }
        .status-pill {
            background: rgba(59, 130, 246, 0.12);
            color: #60a5fa;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo-wrap">
            <img src="/logo.png" alt="GEE IDE" class="logo-img" onerror="this.style.display='none'">
        </div>
        <div class="badge">🛰️ SESIÓN SATELITAL VINCULADA</div>
        <h1>¡Autenticación Exitosa!</h1>
        <p>Tu cuenta de Google Earth Engine se ha conectado correctamente con <strong>GEE IDE</strong>.</p>
        
        <div class="status-pill">
            <span>✨</span> Puedes cerrar esta pestaña y volver a <strong>VS Code</strong>.
        </div>

        <div class="actions-title">Comunidad &amp; Recursos</div>
        <div class="links-grid">
            <a href="https://github.com/rralDev/gee-ide" target="_blank" class="link-card">
                <span class="icon-label">⭐ <span>Repositorio Oficial en GitHub</span></span>
                <span class="link-arrow">↗</span>
            </a>
            <a href="https://github.com/rralDev/gee-ide#readme" target="_blank" class="link-card">
                <span class="icon-label">📖 <span>Manual &amp; Guía de Inicio</span></span>
                <span class="link-arrow">↗</span>
            </a>
            <a href="https://github.com/rralDev/gee-ide/issues" target="_blank" class="link-card">
                <span class="icon-label">💡 <span>Reportar un Error o Sugerir Ideas</span></span>
                <span class="link-arrow">↗</span>
            </a>
        </div>

        <div class="footer">
            GEE IDE · Professional Geospatial IDE for VS Code
        </div>
    </div>
</body>
</html>`);

                this._codeResolve({ code, state });
            } else {
                res.writeHead(404); res.end();
            }
        });
    }

    get nonce(): string { return this._nonce; }
    get port(): number { return this._port; }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server.address() as { port: number };
                this._port = addr.port;
                resolve();
            });
            this.server.on('error', reject);
        });
    }

    private _timeoutTimer?: NodeJS.Timeout;

    waitForCode(timeoutMs = 300000): Promise<OAuthResponse> {
        const timeoutPromise = new Promise<OAuthResponse>((_, reject) => {
            this._timeoutTimer = setTimeout(() => {
                reject(new Error('Authentication timed out after 5 minutes'));
            }, timeoutMs);
        });

        return Promise.race([
            this._codePromise.then(res => {
                if (this._timeoutTimer) {
                    clearTimeout(this._timeoutTimer);
                    this._timeoutTimer = undefined;
                }
                return res;
            }),
            timeoutPromise
        ]);
    }

    stop(): void {
        if (this._timeoutTimer) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = undefined;
        }
        try {
            this.server.close();
        } catch (e) {}
    }
}
