import * as https from 'https';
import * as dns from 'dns';

try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

import { CLIENT_ID, CLIENT_SECRET } from './config';

export async function exchangeCodeForToken(code: string, redirectUri: string = 'urn:ietf:wg:oauth:2.0:oob'): Promise<any> {
    const data = new URLSearchParams({
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    }).toString();

    return makeTokenRequest(data);
}

export async function refreshAccessToken(refreshToken: string): Promise<any> {
    const data = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token'
    }).toString();

    try {
        return await makeTokenRequest(data);
    } catch (err: any) {
        await new Promise(r => setTimeout(r, 800));
        return await makeTokenRequest(data);
    }
}

async function makeTokenRequest(data: string): Promise<any> {
    try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: data
        });

        const bodyText = await response.text();
        const json = JSON.parse(bodyText);
        if (response.ok) {
            return { ...json, client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
        } else {
            throw new Error(`Google error ${response.status}: ${bodyText}`);
        }
    } catch (e: any) {
        if (e.message && e.message.startsWith('Google error')) {
            throw e;
        }
        // Fallback to standard Node https with IPv4 to bypass undici/macOS DNS IPv6 timeouts
        return makeTokenRequestHttps(data);
    }
}

function makeTokenRequestHttps(data: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const postData = Buffer.from(data, 'utf8');
        const req = https.request({
            hostname: 'oauth2.googleapis.com',
            port: 443,
            path: '/token',
            method: 'POST',
            family: 4,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length
            },
            timeout: 15000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ ...json, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
                    } else {
                        reject(new Error(`Google error ${res.statusCode}: ${body}`));
                    }
                } catch (err: any) {
                    reject(new Error(`Parse error: ${err.message}`));
                }
            });
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout connecting to oauth2.googleapis.com'));
        });
        req.write(postData);
        req.end();
    });
}

export async function getUserInfo(accessToken: string): Promise<any> {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (response.ok) {
            return await response.json();
        }
    } catch (e) {}
    return null;
}

export async function getAvailableCloudProjects(accessToken: string): Promise<Array<{ projectId: string; name: string }>> {
    try {
        const response = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (response.ok) {
            const data: any = await response.json();
            if (data.projects && Array.isArray(data.projects)) {
                return data.projects
                    .filter((p: any) => p.lifecycleState === 'ACTIVE')
                    .map((p: any) => ({ projectId: p.projectId, name: p.name || p.projectId }));
            }
        }
    } catch (e) {}
    return [];
}

export async function verifyCloudProject(accessToken: string, projectId: string): Promise<boolean> {
    if (!projectId) return false;
    try {
        const response = await fetch(`https://earthengine.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/algorithms?prettyPrint=false`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

export async function autoDetectCloudProject(
    accessToken: string,
    assetRoots: Array<{ id: string }>,
    email?: string
): Promise<string | null> {
    const candidates: string[] = [];

    // 1. Candidate from legacy user roots: users/robles -> ee-robles
    for (const root of assetRoots) {
        if (root.id.startsWith('users/')) {
            const username = root.id.split('/')[1];
            if (username) {
                const cand = `ee-${username.toLowerCase()}`;
                if (!candidates.includes(cand)) candidates.push(cand);
            }
        }
    }

    // 2. Candidate from email: albert.physik@gmail.com -> ee-albertphysik
    if (email) {
        const cleanEmail = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanEmail) {
            const cand = `ee-${cleanEmail}`;
            if (!candidates.includes(cand)) candidates.push(cand);
        }
    }

    // 3. Candidates from Google Cloud Resource Manager API
    try {
        const gcpProjects = await getAvailableCloudProjects(accessToken);
        for (const p of gcpProjects) {
            if (!candidates.includes(p.projectId)) {
                candidates.push(p.projectId);
            }
        }
    } catch (e) {}

    // Verify candidates against the Earth Engine API to find the valid one
    for (const cand of candidates) {
        const isValid = await verifyCloudProject(accessToken, cand);
        if (isValid) {
            return cand;
        }
    }

    // Fallback: if network is restricted during verify, return the primary candidate
    if (candidates.length > 0) {
        return candidates[0];
    }

    return null;
}

