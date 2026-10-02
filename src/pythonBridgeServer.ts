import * as http from 'http';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';

// Adapted from earthengine-extension by 12rambau (Apache 2.0)
// https://github.com/12rambau/earthengine-extension
// Modifications: TypeScript rewrite, adapted to GEE IDE architecture

export interface MapCommand {
    action: 'addLayer' | 'setCenter' | 'centerObject' | 'clear';
    payload: any;
}

/**
 * A local HTTP server that listens for Map commands from Python scripts.
 * Python scripts use the vscee shim (Map.addLayer, Map.setCenter, etc.)
 * which POSTs JSON to this server. The server fires VS Code events
 * that update the Leaflet map in the WebView.
 *
 * Port: 31415 (π × 10000, same as earthengine-extension convention)
 */
export class PythonBridgeServer {
    private server: http.Server | null = null;
    private _onCommand = new vscode.EventEmitter<MapCommand>();
    public readonly onCommand = this._onCommand.event;
    private port = 31415;

    public getPort(): number {
        return this.port;
    }

    start(preferredPort = 31415): Promise<number> {
        return new Promise((resolve, reject) => {
            const tryListen = (portToTry: number) => {
                const srv = http.createServer((req, res) => {
                    if (req.method !== 'POST') {
                        res.writeHead(405); res.end(); return;
                    }

                    let body = '';
                    req.on('data', chunk => body += chunk);
                    req.on('end', () => {
                        try {
                            const raw = JSON.parse(body);
                            let cmd: MapCommand;
                            if (raw.action && raw.payload) {
                                cmd = raw;
                            } else if (raw.action) {
                                const { action, ...payload } = raw;
                                cmd = { action, payload };
                            } else if (raw.url) {
                                cmd = { action: 'addLayer', payload: raw };
                            } else if (raw.lat !== undefined && raw.lon !== undefined) {
                                cmd = { action: 'setCenter', payload: raw };
                            } else {
                                cmd = { action: 'clear', payload: raw };
                            }
                            this._onCommand.fire(cmd);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ ok: true }));
                        } catch (e) {
                            res.writeHead(400); res.end('Invalid JSON');
                        }
                    });
                });

                srv.on('error', (err: any) => {
                    if (err.code === 'EADDRINUSE') {
                        // Port in use (e.g. parent VS Code window is running GEE IDE)
                        // Try next port or fallback to port 0 (OS picks free port)
                        if (portToTry < preferredPort + 10) {
                            tryListen(portToTry + 1);
                        } else {
                            tryListen(0);
                        }
                    } else {
                        reject(err);
                    }
                });

                srv.listen(portToTry, '127.0.0.1', () => {
                    this.server = srv;
                    const addr = srv.address();
                    this.port = typeof addr === 'object' && addr ? addr.port : portToTry;
                    resolve(this.port);
                });
            };

            tryListen(preferredPort);
        });
    }

    stop(): void {
        this._onCommand.dispose();
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
