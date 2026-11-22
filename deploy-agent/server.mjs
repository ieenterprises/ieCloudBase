import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.DEPLOY_PORT || '4100', 10);
const API_KEY = process.env.DEPLOY_API_KEY || 'iecloudbase-deploy-secret';
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'iecloudbase.com';
const APPS_DIR = process.env.APPS_DIR || '/opt/iecloudbase-apps';
const STATE_FILE = path.join(APPS_DIR, 'apps.json');
const CADDY_APPS_DIR = process.env.CADDY_APPS_DIR || '/etc/caddy/apps.d';

fs.mkdirSync(APPS_DIR, { recursive: true });

function loadApps() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveApps(apps) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(apps, null, 2));
}

function nextFreePort(apps) {
  const used = new Set(apps.map((a) => a.hostPort));
  let p = 3100;
  while (used.has(p)) p++;
  return p;
}

async function runCmd(cmd, args, cwd = undefined) {
  const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return `${stdout}${stderr}`.trim();
}

async function writeCaddyRoute(name, domain, hostPort) {
  try {
    fs.mkdirSync(CADDY_APPS_DIR, { recursive: true });
    const conf = `${domain} {\n    reverse_proxy localhost:${hostPort}\n}\n`;
    fs.writeFileSync(path.join(CADDY_APPS_DIR, `${name}.caddy`), conf);
    await runCmd('sudo', ['systemctl', 'reload', 'caddy']);
  } catch (e) {
    console.warn('Caddy reload warning:', e.message);
  }
}

async function removeCaddyRoute(name) {
  try {
    const file = path.join(CADDY_APPS_DIR, `${name}.caddy`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await runCmd('sudo', ['systemctl', 'reload', 'caddy']);
  } catch {}
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/healthz') {
    return sendJson(res, 200, { status: 'ok', baseDomain: BASE_DOMAIN });
  }

  if (req.headers['x-api-key'] !== API_KEY) {
    return sendJson(res, 401, { error: 'Unauthorized: invalid X-Api-Key' });
  }

  try {
    // List deployed apps
    if (req.method === 'GET' && pathname === '/apps') {
      return sendJson(res, 200, { apps: loadApps() });
    }

    // Deploy new app (docker | git | blueprint)
    if (req.method === 'POST' && pathname === '/apps') {
      const body = await readBody(req);
      const safeName = (body.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!safeName) return sendJson(res, 400, { error: 'Valid app name (a-z, 0-9, -) is required' });

      const apps = loadApps();
      const existing = apps.find((a) => a.name === safeName);
      const hostPort = existing ? existing.hostPort : nextFreePort(apps);
      const containerPort = parseInt(body.containerPort || '80', 10);
      const domain = `${safeName}.${BASE_DOMAIN}`;
      const containerName = `ieapp-${safeName}`;
      const envFlags = [];
      for (const [k, v] of Object.entries(body.env || {})) {
        if (k) envFlags.push('-e', `${k}=${v}`);
      }

      // Stop/remove old container if redeploying
      await runCmd('docker', ['rm', '-f', containerName]).catch(() => {});

      let imageToRun = body.image || '';
      const appDir = path.join(APPS_DIR, safeName);

      if (body.source === 'git') {
        if (!body.repoUrl) return sendJson(res, 400, { error: 'repoUrl is required for git deploy' });
        fs.rmSync(appDir, { recursive: true, force: true });
        await runCmd('git', ['clone', '--depth', '1', '--branch', body.branch || 'main', body.repoUrl, appDir]);
        const dfPath = path.join(appDir, 'Dockerfile');
        if (!fs.existsSync(dfPath)) {
          // Auto-generate a simple Node.js or static Nginx Dockerfile
          if (fs.existsSync(path.join(appDir, 'package.json'))) {
            fs.writeFileSync(
              dfPath,
              `FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\n${body.buildCmd ? `RUN ${body.buildCmd}\n` : ''}EXPOSE ${containerPort}\nCMD ${body.startCmd ? `["sh","-c","${body.startCmd}"]` : '["npm","start"]'}\n`,
            );
          } else {
            fs.writeFileSync(dfPath, `FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\n`);
          }
        }
        imageToRun = `iecloudbase/${safeName}:latest`;
        await runCmd('docker', ['build', '-t', imageToRun, '.'], appDir);
      } else if (body.source === 'blueprint') {
        if (!body.blueprintYaml) return sendJson(res, 400, { error: 'blueprintYaml is required' });
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, 'compose.yaml'), body.blueprintYaml);
        await runCmd('docker', ['compose', 'up', '-d'], appDir);
      } else {
        if (!imageToRun) return sendJson(res, 400, { error: 'Docker image is required' });
        await runCmd('docker', ['pull', imageToRun]);
      }

      if (body.source !== 'blueprint') {
        await runCmd('docker', [
          'run', '-d',
          '--name', containerName,
          '--restart', 'unless-stopped',
          '-p', `127.0.0.1:${hostPort}:${containerPort}`,
          ...envFlags,
          imageToRun,
        ]);
      }

      await writeCaddyRoute(safeName, domain, hostPort);

      const record = {
        name: safeName,
        url: `https://${domain}`,
        source: body.source || 'docker',
        repoUrl: body.repoUrl || null,
        branch: body.branch || null,
        image: imageToRun || null,
        hostPort,
        containerPort,
        status: 'live',
        updatedAt: Math.floor(Date.now() / 1000),
      };

      const nextApps = [...apps.filter((a) => a.name !== safeName), record];
      saveApps(nextApps);
      return sendJson(res, 201, { app: record });
    }

    // Logs: GET /apps/:name/logs
    const logsMatch = pathname.match(/^\/apps\/([^/]+)\/logs$/);
    if (logsMatch && req.method === 'GET') {
      const name = decodeURIComponent(logsMatch[1]);
      const logs = await runCmd('docker', ['logs', '--tail', '100', `ieapp-${name}`]).catch((e) => e.message);
      return sendJson(res, 200, { logs });
    }

    // Delete app: DELETE /apps/:name
    const delMatch = pathname.match(/^\/apps\/([^/]+)$/);
    if (delMatch && req.method === 'DELETE') {
      const name = decodeURIComponent(delMatch[1]);
      await runCmd('docker', ['rm', '-f', `ieapp-${name}`]).catch(() => {});
      await removeCaddyRoute(name);
      const nextApps = loadApps().filter((a) => a.name !== name);
      saveApps(nextApps);
      return sendJson(res, 200, { deleted: true });
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`ieCloudbase Deploy Agent listening on http://127.0.0.1:${PORT} (*.${BASE_DOMAIN})`);
});
