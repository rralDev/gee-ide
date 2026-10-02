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

            if (url.pathname === '/callback') {
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                const error = url.searchParams.get('error');

                if (error) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(`<html><body><h2>Authentication error: ${error}</h2><p>You can close this window.</p></body></html>`);
                    this._codeReject(new Error(`OAuth error: ${error}`));
                    return;
                }

                if (!code || state !== this._nonce) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(`<html><body><h2>Invalid response</h2><p>You can close this window.</p></body></html>`);
                    this._codeReject(new Error('Invalid OAuth state or missing code'));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
                    body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
                           justify-content: center; height: 100vh; margin: 0; background: #1e1e1e; color: #fff; }
                    .box { text-align: center; padding: 40px; background: #2d2d2d; border-radius: 12px; }
                    h2 { color: #4ec9b0; } p { color: #888; }
                </style></head><body><div class="box">
                    <h2>✅ GEE IDE — Autenticación exitosa</h2>
                    <p>Puedes cerrar esta ventana y volver a VS Code.</p>
                </div></body></html>`);

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

    waitForCode(timeoutMs = 300000): Promise<OAuthResponse> {
        return Promise.race([
            this._codePromise,
            new Promise<OAuthResponse>((_, reject) =>
                setTimeout(() => reject(new Error('Authentication timed out after 5 minutes')), timeoutMs)
            )
        ]);
    }

    stop(): void {
        this.server.close();
    }
}
