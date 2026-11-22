import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import pg from 'pg';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  const origLookup = dns.lookup.bind(dns);
  dns.lookup = function (hostname, options, callback) {
    let cb = callback;
    let opts = options;
    if (typeof options === 'function') {
      cb = options;
      opts = {};
    } else if (typeof options === 'number') {
      opts = { family: options };
    } else {
      opts = options || {};
    }
    if (typeof hostname === 'string' && hostname.endsWith('iecloudbase.com')) {
      dns.resolve4(hostname, (err, addresses) => {
        if (!err && Array.isArray(addresses) && addresses.length > 0) {
          if (opts.all) {
            return cb(null, addresses.map((a) => ({ address: a, family: 4 })));
          }
          return cb(null, addresses[0], 4);
        }
        return origLookup(hostname, options, callback);
      });
      return;
    }
    return origLookup(hostname, options, callback);
  };
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const API_BASE = (process.env.NAMECOM_API_BASE || 'https://api.dev.name.com').replace(/\/+$/, '');
const USERNAME = process.env.NAMECOM_USERNAME || '';
const TOKEN = process.env.NAMECOM_TOKEN || '';
const MARKUP_USD = parseFloat(process.env.MARKUP_USD || '3.00');
const PORT = parseInt(process.env.PORT || '4000', 10);

const AUTH_HEADER = 'Basic ' + Buffer.from(`${USERNAME}:${TOKEN}`).toString('base64');

const STALWART_BASE = (process.env.STALWART_API_BASE || 'https://mail-admin.iecloudbase.com').replace(/\/+$/, '');
const STALWART_AUTH =
  'Basic ' + Buffer.from(`${process.env.STALWART_ADMIN_USER || 'admin'}:${process.env.STALWART_ADMIN_PASS || ''}`).toString('base64');

const DOKPLOY_BASE = (process.env.DOKPLOY_API_BASE || 'https://paas.iecloudbase.com').replace(/\/+$/, '');
const DOKPLOY_KEY = process.env.DOKPLOY_API_KEY || '';
const DOKPLOY_APPS_DOMAIN = process.env.DOKPLOY_APPS_DOMAIN || 'apps.iecloudbase.com';
const COMPOSIO_KEY = process.env.COMPOSIO_API_KEY || '';
const COMPOSIO_BASE = 'https://backend.composio.dev/api/v3';
const COMPOSIO_USER_ID = 'iecloudbase-default';
const GIT_CONFIG_PATH = path.join(__dirname, '.git-config.json');

async function composioFetch(endpoint, options = {}) {
  if (!COMPOSIO_KEY) throw new Error('COMPOSIO_API_KEY is not configured');
  const res = await fetch(`${COMPOSIO_BASE}${endpoint}`, {
    ...options,
    headers: {
      'x-api-key': COMPOSIO_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getOrCreateComposioAuthConfig(toolkitSlug) {
  const existing = await composioFetch(`/auth_configs?toolkit_slug=${encodeURIComponent(toolkitSlug)}`);
  const active = (existing?.items || []).find((a) => !a.is_disabled);
  if (active?.id) return active.id;
  const created = await composioFetch('/auth_configs', {
    method: 'POST',
    body: JSON.stringify({
      toolkit: { slug: toolkitSlug },
      auth_config: {
        name: `ieCloudbase ${toolkitSlug}`,
        type: 'use_composio_managed_auth',
      },
    }),
  });
  return created?.auth_config?.id;
}

async function getActiveComposioAccount(toolkitSlug, userId = COMPOSIO_USER_ID) {
  if (!COMPOSIO_KEY) return null;
  try {
    const list = await composioFetch(`/connected_accounts?toolkit_slugs=${encodeURIComponent(toolkitSlug)}&statuses=ACTIVE&limit=20`);
    const items = list?.items || [];
    return items.find((c) => c.user_id === userId && c.status === 'ACTIVE') || null;
  } catch {
    return null;
  }
}

async function composioGitHubProxy(apiPath, connectedAccountId, userId = COMPOSIO_USER_ID) {
  const endpoint = apiPath.startsWith('http') ? apiPath : `https://api.github.com${apiPath}`;
  const resp = await composioFetch('/tools/execute/proxy', {
    method: 'POST',
    body: JSON.stringify({
      endpoint,
      method: 'GET',
      connected_account_id: connectedAccountId,
      user_id: userId,
      parameters: [
        { name: 'Accept', value: 'application/vnd.github+json', type: 'header' },
        { name: 'User-Agent', value: 'ieCloudbase-PaaS', type: 'header' },
      ],
    }),
  });
  if (resp?.status && resp.status >= 400) {
    const err = new Error(resp?.data?.message || `GitHub HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp?.data ?? resp;
}

const PRIVATE_LOCKS_PATH = path.join(__dirname, '.private-locks.json');
function readPrivateLocks() {
  try { return fs.existsSync(PRIVATE_LOCKS_PATH) ? JSON.parse(fs.readFileSync(PRIVATE_LOCKS_PATH, 'utf-8')) : {}; } catch { return {}; }
}
function writePrivateLocks(obj) {
  fs.writeFileSync(PRIVATE_LOCKS_PATH, JSON.stringify(obj, null, 2), 'utf-8');
}
function hashLockPassword(password, saltHex = null) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyLockPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function readGitConfig() {
  try {
    if (fs.existsSync(GIT_CONFIG_PATH)) return JSON.parse(fs.readFileSync(GIT_CONFIG_PATH, 'utf-8'));
  } catch {}
  return { provider: 'github', username: '', token: '', avatarUrl: '', publicRepos: 0, connected: false };
}

function writeGitConfig(cfg) {
  fs.writeFileSync(GIT_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

async function githubFetch(apiPath, token = '') {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ieCloudbase-PaaS',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${apiPath}`, { headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function parseRepoSlug(input) {
  const s = (input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  if (m) return m[1];
  if (/^[^/\s]+\/[^/\s]+$/.test(s)) return s;
  return '';
}

function parseBlueprintSummary(yamlText, filePath) {
  let doc;
  try {
    doc = yaml.load(yamlText || '');
  } catch (err) {
    const e = new Error(`Invalid YAML syntax in ${filePath}: ${err.message}`);
    e.status = 422;
    throw e;
  }
  if (!doc || typeof doc !== 'object') {
    const e = new Error(`Empty or invalid Blueprint YAML in ${filePath}`);
    e.status = 422;
    throw e;
  }

  const isCompose = /compose/i.test(filePath) || (doc.services && !Array.isArray(doc.services) && typeof doc.services === 'object');
  const items = [];
  const requiredEnvVars = [];

  if (isCompose) {
    for (const [name, def] of Object.entries(doc.services || {})) {
      const cfg = def && typeof def === 'object' ? def : {};
      let port = '';
      if (Array.isArray(cfg.ports) && cfg.ports.length > 0) {
        const first = String(cfg.ports[0]);
        const m = first.match(/:(\d+)/);
        port = m ? m[1] : first;
      }
      items.push({
        name,
        type: 'service',
        runtime: 'Docker Compose',
        image: cfg.image || (cfg.build ? `build: ${typeof cfg.build === 'string' ? cfg.build : cfg.build.context || '.'}` : ''),
        port,
      });
    }
    return { format: 'docker-compose', items, requiredEnvVars };
  }

  const parsed = parseRenderYaml(yamlText);
  for (const db of parsed.databases) {
    items.push({
      name: db.name,
      type: 'postgres',
      runtime: `PostgreSQL ${db.postgresMajorVersion || 16}`,
      image: `postgres:${db.postgresMajorVersion || 16}`,
      port: '5432',
    });
  }
  for (const svc of parsed.services) {
    items.push({
      name: svc.name || 'web-service',
      type: svc.type || 'web',
      runtime: svc.runtime || (svc.image ? 'image' : svc.dockerfilePath ? 'docker' : 'node'),
      image: svc.image || svc.dockerfilePath || svc.buildCommand || '',
      port: svc.port || '10000',
    });
    for (const ev of svc.envVars || []) {
      if (ev.sync === false) {
        requiredEnvVars.push({ service: svc.name || 'web-service', key: ev.key });
      }
    }
  }
  return { format: 'render-blueprint', items, requiredEnvVars };
}

function parseRenderYaml(yamlText) {
  const doc = yaml.load(yamlText || '') || {};
  const databases = (Array.isArray(doc.databases) ? doc.databases : []).map((db) => ({
    name: String(db?.name || '').trim(),
    databaseName: String(db?.databaseName || '').trim(),
    user: String(db?.user || '').trim(),
    postgresMajorVersion: db?.postgresMajorVersion ? String(db.postgresMajorVersion) : '16',
  })).filter((d) => d.name);

  const services = (Array.isArray(doc.services) ? doc.services : []).map((s) => {
    const rawEnvVars = Array.isArray(s?.envVars) ? s.envVars : [];
    const envVars = rawEnvVars.map((ev) => ({
      key: String(ev?.key || '').trim(),
      value: ev?.value !== undefined ? String(ev.value) : undefined,
      generateValue: Boolean(ev?.generateValue),
      sync: ev?.sync === false ? false : true,
      fromDatabase: ev?.fromDatabase ? {
        name: String(ev.fromDatabase.name || '').trim(),
        property: String(ev.fromDatabase.property || 'connectionString').trim(),
      } : null,
      fromService: ev?.fromService ? {
        name: String(ev.fromService.name || '').trim(),
        type: String(ev.fromService.type || 'web').trim(),
        property: String(ev.fromService.property || 'host').trim(),
      } : null,
    })).filter((e) => e.key);

    let port = '10000';
    const portEv = envVars.find((e) => e.key.toUpperCase() === 'PORT' && e.value);
    if (portEv) port = portEv.value;

    return {
      type: String(s?.type || 'web').trim(),
      name: String(s?.name || '').trim(),
      runtime: String(s?.runtime || s?.env || '').trim(),
      image: typeof s?.image === 'string' ? s.image.trim() : String(s?.image?.url || '').trim(),
      dockerfilePath: String(s?.dockerfilePath || '').trim(),
      dockerContext: String(s?.dockerContext || '.').trim(),
      buildCommand: String(s?.buildCommand || '').trim(),
      startCommand: String(s?.startCommand || '').trim(),
      healthCheckPath: String(s?.healthCheckPath || '').trim(),
      port,
      envVars,
    };
  });

  return { databases, services };
}

async function dokploy(endpoint, options = {}) {
  const res = await fetch(`${DOKPLOY_BASE}${endpoint}`, {
    ...options,
    headers: {
      'x-api-key': DOKPLOY_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const STALWART_IP = process.env.STALWART_ELASTIC_IP || '13.51.192.94';

function stalwartHttpsFetch(urlPath, { method = 'GET', headers = {}, body = null } = {}) {
  const parsed = new URL(`${STALWART_BASE}${urlPath}`);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        servername: parsed.hostname,
        headers: {
          Host: parsed.hostname,
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
        lookup: (_host, opts, cb) => {
          if (typeof opts === 'function') return opts(null, STALWART_IP, 4);
          if (opts && opts.all) return cb(null, [{ address: STALWART_IP, family: 4 }]);
          return cb(null, STALWART_IP, 4);
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let jsonData = null;
          try { jsonData = text ? JSON.parse(text) : null; } catch { jsonData = { raw: text }; }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage || '',
            text: async () => text,
            json: async () => jsonData,
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const RECALL_VAULT_PUBLIC_URL = (process.env.RECALL_VAULT_PUBLIC_URL || 'https://mail.iecloudbase.com').replace(/\/+$/, '');
const RECALL_VAULT_SECRET = process.env.RECALL_VAULT_SECRET || 'iecb_rcl_vlt_9f8a7c6d5e4b3a21';

function publicVaultRequest(urlPath, method = 'POST', payload = null) {
  const parsed = new URL(`${RECALL_VAULT_PUBLIC_URL}${urlPath}`);
  const body = payload ? JSON.stringify(payload) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        servername: parsed.hostname,
        headers: {
          Host: parsed.hostname,
          'X-Vault-Secret': RECALL_VAULT_SECRET,
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
        lookup: (_host, opts, cb) => {
          if (typeof opts === 'function') return opts(null, STALWART_IP, 4);
          if (opts && opts.all) return cb(null, [{ address: STALWART_IP, family: 4 }]);
          return cb(null, STALWART_IP, 4);
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let data = null;
          try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
          if (res.statusCode >= 400) return reject(new Error(data?.error || `Vault HTTP ${res.statusCode}`));
          resolve(data);
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const RECALL_VAULT_PATH = path.join(__dirname, '.recall-vault.json');
function readRecallVault() {
  try {
    if (fs.existsSync(RECALL_VAULT_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(RECALL_VAULT_PATH, 'utf-8'));
      return Array.isArray(parsed?.items) ? parsed : { items: [] };
    }
  } catch {}
  return { items: [] };
}
function writeRecallVault(vault) {
  fs.writeFileSync(RECALL_VAULT_PATH, JSON.stringify(vault, null, 2), 'utf-8');
}
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function stalwartJmap(methodCalls, extraUsing = []) {
  const res = await stalwartHttpsFetch('/jmap/', {
    method: 'POST',
    headers: {
      Authorization: STALWART_AUTH,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap', ...extraUsing],
      methodCalls,
    }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.detail || data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data?.methodResponses || [];
}

async function namecom(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: AUTH_HEADER,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.message || data?.details || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-User-Id',
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

const SANDBOX_API_BASE = (process.env.SANDBOX_API_BASE || 'https://sandbox.iecloudbase.com').replace(/\/+$/, '');
const SANDBOX_API_KEY = process.env.SANDBOX_API_KEY || '';
const SANDBOX_HOST = new URL(SANDBOX_API_BASE).hostname;

const TLDS = ['com', 'io', 'net', 'org', 'xyz', 'app'];

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-User-Id',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/sandbox-proxy')) {
      const targetPath = (pathname.slice('/sandbox-proxy'.length) || '/') + (url.search || '');
      const fwdHeaders = { Host: SANDBOX_HOST };
      const incomingApiKey = String(req.headers['x-api-key'] || '');
      const incomingAuth = String(req.headers['authorization'] || '');
      if (SANDBOX_API_KEY && (!incomingApiKey || incomingApiKey === 'env-managed')) {
        fwdHeaders['X-Api-Key'] = SANDBOX_API_KEY;
      } else if (incomingApiKey) {
        fwdHeaders['X-Api-Key'] = incomingApiKey;
      }
      if (SANDBOX_API_KEY && (!incomingAuth || incomingAuth === 'Bearer env-managed')) {
        fwdHeaders['Authorization'] = `Bearer ${SANDBOX_API_KEY}`;
      } else if (incomingAuth) {
        fwdHeaders['Authorization'] = incomingAuth;
      }
      if (req.headers['content-type']) fwdHeaders['Content-Type'] = req.headers['content-type'];
      if (req.headers['content-length']) fwdHeaders['Content-Length'] = req.headers['content-length'];
      if (req.headers['accept']) fwdHeaders['Accept'] = req.headers['accept'];

      const proxyReq = https.request(
        {
          hostname: SANDBOX_HOST,
          port: 443,
          path: targetPath,
          method: req.method,
          servername: SANDBOX_HOST,
          headers: fwdHeaders,
          lookup: (_host, opts, cb) => {
            if (typeof opts === 'function') return opts(null, STALWART_IP, 4);
            if (opts && opts.all) return cb(null, [{ address: STALWART_IP, family: 4 }]);
            return cb(null, STALWART_IP, 4);
          },
        },
        (proxyRes) => {
          const outHeaders = { ...proxyRes.headers };
          delete outHeaders['access-control-allow-origin'];
          delete outHeaders['access-control-allow-methods'];
          delete outHeaders['access-control-allow-headers'];
          outHeaders['Access-Control-Allow-Origin'] = '*';
          outHeaders['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
          outHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Api-Key, X-User-Id';
          res.writeHead(proxyRes.statusCode || 200, outHeaders);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', (err) => {
        if (!res.headersSent) sendJson(res, 502, { error: err.message });
        else res.end();
      });
      req.pipe(proxyReq);
      return;
    }

    if (req.method === 'GET' && pathname === '/healthz') {
      return sendJson(res, 200, { status: 'ok', mode: API_BASE.includes('dev') ? 'test' : 'production', markupUsd: MARKUP_USD, database: dbPool ? 'postgres' : 'local-json' });
    }

    // Search domain availability + apply markup
    if (req.method === 'GET' && pathname === '/reseller/search') {
      const rawQuery = (url.searchParams.get('q') || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!rawQuery) return sendJson(res, 400, { error: 'Query q is required' });

      const baseName = rawQuery.includes('.') ? rawQuery.split('.')[0] : rawQuery;
      const candidates = rawQuery.includes('.')
        ? [rawQuery, ...TLDS.map((t) => `${baseName}.${t}`).filter((d) => d !== rawQuery)]
        : TLDS.map((t) => `${baseName}.${t}`);

      const data = await namecom('/v4/domains:checkAvailability', {
        method: 'POST',
        body: JSON.stringify({ domainNames: candidates.slice(0, 6) }),
      });

      const results = (data?.results || []).map((r) => {
        const wholesale = typeof r.purchasePrice === 'number' ? r.purchasePrice : null;
        const retail = wholesale != null ? Number((wholesale + MARKUP_USD).toFixed(2)) : null;
        return {
          domainName: r.domainName,
          purchasable: Boolean(r.purchasable),
          premium: Boolean(r.premium),
          wholesalePrice: wholesale,
          markupUsd: MARKUP_USD,
          retailPrice: retail,
          renewalPrice: r.renewalPrice ?? null,
        };
      });

      return sendJson(res, 200, { results });
    }

    // List registered domains
    if (req.method === 'GET' && pathname === '/reseller/domains') {
      const data = await namecom('/v4/domains');
      return sendJson(res, 200, { domains: data?.domains || [] });
    }

    // Register a domain (Dev/Test environment)
    if (req.method === 'POST' && pathname === '/reseller/register') {
      const body = await readBody(req);
      if (!body.domainName) return sendJson(res, 400, { error: 'domainName is required' });
      const payload = {
        domain: { domainName: body.domainName },
        years: body.years || 1,
      };
      if (typeof body.purchasePrice === 'number') {
        payload.purchasePrice = body.purchasePrice;
      }
      const data = await namecom('/v4/domains', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return sendJson(res, 201, data);
    }

    // Complete Domain Cart Checkout (Verifies Payment Gateway -> Registers Domains)
    if (req.method === 'POST' && pathname === '/reseller/checkout') {
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return sendJson(res, 400, { error: 'Your cart is empty' });

      const gateway = (process.env.PAYMENT_GATEWAY || 'sandbox').toLowerCase();
      // Optional live payment gateway verification when configured in .env
      if (gateway === 'paystack' && process.env.PAYSTACK_SECRET_KEY && body.paymentReference) {
        const vr = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(body.paymentReference)}`, {
          headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        });
        const vd = await vr.json().catch(() => ({}));
        if (!vr.ok || vd?.data?.status !== 'success') {
          return sendJson(res, 402, { error: 'Payment verification failed with Paystack' });
        }
      } else if (gateway === 'stripe' && process.env.STRIPE_SECRET_KEY && body.paymentIntentId) {
        const vr = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(body.paymentIntentId)}`, {
          headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
        });
        const vd = await vr.json().catch(() => ({}));
        if (!vr.ok || vd?.status !== 'succeeded') {
          return sendJson(res, 402, { error: 'Payment verification failed with Stripe' });
        }
      } else if (gateway === 'flutterwave' && process.env.FLUTTERWAVE_SECRET_KEY && body.transactionId) {
        const vr = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(body.transactionId)}/verify`, {
          headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
        });
        const vd = await vr.json().catch(() => ({}));
        if (!vr.ok || vd?.data?.status !== 'successful') {
          return sendJson(res, 402, { error: 'Payment verification failed with Flutterwave' });
        }
      }

      const registeredDomains = [];
      for (const item of items) {
        const domainName = String(item.domainName || '').trim();
        if (!domainName) continue;
        const years = Math.max(1, Math.min(10, parseInt(item.years || '1', 10) || 1));
        const payload = {
          domain: { domainName },
          years,
        };
        if (typeof item.wholesalePrice === 'number') {
          payload.purchasePrice = item.wholesalePrice * years;
        }
        const regData = await namecom('/v4/domains', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        registeredDomains.push({
          domainName,
          years,
          domain: regData?.domain || { domainName },
        });
      }

      const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      return sendJson(res, 201, {
        ok: true,
        orderId,
        gateway,
        paymentMethod: body.paymentMethod || 'card',
        totalUsd: body.totalUsd || 0,
        registeredDomains,
        completedAt: new Date().toISOString(),
      });
    }

    if (req.method === 'POST' && pathname === '/reseller/brokerage-offer') {
      const body = await readBody(req);
      const domainName = (body.domainName || '').trim();
      const offerUsd = parseFloat(body.offerUsd || '0');
      if (!domainName || !(offerUsd > 0)) return sendJson(res, 400, { error: 'Valid domain and offer amount required' });
      return sendJson(res, 201, {
        ok: true,
        domainName,
        offerUsd,
        reference: 'BRK-' + Date.now().toString(36).toUpperCase(),
      });
    }

    // DNS Records: GET /reseller/domains/:domain/records
    const dnsListMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/records$/);
    if (dnsListMatch && req.method === 'GET') {
      const domain = decodeURIComponent(dnsListMatch[1]);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/records`);
      return sendJson(res, 200, { records: data?.records || [] });
    }

    // DNS Records: POST /reseller/domains/:domain/records
    if (dnsListMatch && req.method === 'POST') {
      const domain = decodeURIComponent(dnsListMatch[1]);
      const body = await readBody(req);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/records`, {
        method: 'POST',
        body: JSON.stringify({
          host: body.host ?? '',
          type: body.type || 'A',
          answer: body.answer,
          ttl: parseInt(body.ttl || '300', 10),
        }),
      });
      return sendJson(res, 201, data);
    }

    // DNS Records: PUT /reseller/domains/:domain/records/:id
    const dnsDelMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/records\/(\d+)$/);
    if (dnsDelMatch && req.method === 'PUT') {
      const domain = decodeURIComponent(dnsDelMatch[1]);
      const id = dnsDelMatch[2];
      const body = await readBody(req);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/records/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          host: body.host ?? '',
          type: body.type || 'A',
          answer: body.answer,
          ttl: parseInt(body.ttl || '300', 10),
          ...(body.priority != null ? { priority: parseInt(body.priority, 10) } : {}),
        }),
      });
      return sendJson(res, 200, data);
    }

    // DNS Records: DELETE /reseller/domains/:domain/records/:id
    if (dnsDelMatch && req.method === 'DELETE') {
      const domain = decodeURIComponent(dnsDelMatch[1]);
      const id = dnsDelMatch[2];
      await namecom(`/v4/domains/${encodeURIComponent(domain)}/records/${id}`, { method: 'DELETE' });
      return sendJson(res, 200, { deleted: true });
    }

    // Domain Details: GET /reseller/domains/:domain
    const domMatch = pathname.match(/^\/reseller\/domains\/([^/]+)$/);
    if (domMatch && req.method === 'GET') {
      const domain = decodeURIComponent(domMatch[1]);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}`);
      return sendJson(res, 200, data);
    }

    // Domain Actions: autorenew, whois privacy, lock, renew, authCode, nameservers, contacts
    const domActionMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/(enableAutorenew|disableAutorenew|enableWhoisPrivacy|disableWhoisPrivacy|lock|unlock|renew|getAuthCode|setNameservers|setContacts)$/);
    if (domActionMatch && (req.method === 'POST' || req.method === 'GET')) {
      const domain = decodeURIComponent(domActionMatch[1]);
      const action = domActionMatch[2];
      const body = req.method === 'POST' ? await readBody(req) : null;
      const endpoint = action === 'getAuthCode'
        ? `/v4/domains/${encodeURIComponent(domain)}:getAuthCode`
        : `/v4/domains/${encodeURIComponent(domain)}:${action}`;
      const data = await namecom(endpoint, {
        method: action === 'getAuthCode' ? 'GET' : 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return sendJson(res, 200, data || { ok: true });
    }

    // URL Forwarding: GET / POST / DELETE
    const urlFwdMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/url\/forwarding$/);
    if (urlFwdMatch && req.method === 'GET') {
      const domain = decodeURIComponent(urlFwdMatch[1]);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/url/forwarding`);
      return sendJson(res, 200, data || { urlForwarding: [] });
    }
    if (urlFwdMatch && req.method === 'POST') {
      const domain = decodeURIComponent(urlFwdMatch[1]);
      const body = await readBody(req);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/url/forwarding`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return sendJson(res, 201, data);
    }
    const urlFwdDelMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/url\/forwarding\/(.+)$/);
    if (urlFwdDelMatch && req.method === 'DELETE') {
      const domain = decodeURIComponent(urlFwdDelMatch[1]);
      const host = decodeURIComponent(urlFwdDelMatch[2]);
      await namecom(`/v4/domains/${encodeURIComponent(domain)}/url/forwarding/${encodeURIComponent(host)}`, { method: 'DELETE' });
      return sendJson(res, 200, { deleted: true });
    }

    // Email Forwarding: GET / POST / DELETE
    const emailFwdMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/email\/forwarding$/);
    if (emailFwdMatch && req.method === 'GET') {
      const domain = decodeURIComponent(emailFwdMatch[1]);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/email/forwarding`);
      return sendJson(res, 200, data || { emailForwarding: [] });
    }
    if (emailFwdMatch && req.method === 'POST') {
      const domain = decodeURIComponent(emailFwdMatch[1]);
      const body = await readBody(req);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/email/forwarding`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return sendJson(res, 201, data);
    }
    const emailFwdDelMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/email\/forwarding\/(.+)$/);
    if (emailFwdDelMatch && req.method === 'DELETE') {
      const domain = decodeURIComponent(emailFwdDelMatch[1]);
      const box = decodeURIComponent(emailFwdDelMatch[2]);
      await namecom(`/v4/domains/${encodeURIComponent(domain)}/email/forwarding/${encodeURIComponent(box)}`, { method: 'DELETE' });
      return sendJson(res, 200, { deleted: true });
    }

    // Vanity Nameservers (Nameserver Registration): GET / POST / DELETE
    const nsRegMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/vanity_nameservers$/);
    if (nsRegMatch && req.method === 'GET') {
      const domain = decodeURIComponent(nsRegMatch[1]);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/vanity_nameservers`);
      return sendJson(res, 200, data || { vanityNameservers: [] });
    }
    if (nsRegMatch && req.method === 'POST') {
      const domain = decodeURIComponent(nsRegMatch[1]);
      const body = await readBody(req);
      const data = await namecom(`/v4/domains/${encodeURIComponent(domain)}/vanity_nameservers`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return sendJson(res, 201, data);
    }
    const nsRegDelMatch = pathname.match(/^\/reseller\/domains\/([^/]+)\/vanity_nameservers\/(.+)$/);
    if (nsRegDelMatch && req.method === 'DELETE') {
      const domain = decodeURIComponent(nsRegDelMatch[1]);
      const host = decodeURIComponent(nsRegDelMatch[2]);
      await namecom(`/v4/domains/${encodeURIComponent(domain)}/vanity_nameservers/${encodeURIComponent(host)}`, { method: 'DELETE' });
      return sendJson(res, 200, { deleted: true });
    }

    // =========================================================================
    // MAIL HOSTING (Stalwart v1.1 JMAP Admin API)
    // =========================================================================
    // EMAIL HOSTING (Stalwart JMAP: Domains, DKIM, Outbound Mode, Mailboxes, Aliases)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/mail/overview') {
      const responses = await stalwartJmap([
        ['x:Domain/get', {}, 'd0'],
        ['x:Account/get', {}, 'a0'],
        ['x:DkimSignature/get', {}, 'k0'],
        ['x:MtaOutboundStrategy/get', { ids: ['singleton'] }, 's0'],
        ['x:MtaRoute/get', {}, 'r0'],
      ]);
      const rawDomains = responses[0]?.[1]?.list || [];
      const rawAccounts = (responses[1]?.[1]?.list || []).filter((a) => a['@type'] === 'User');
      const rawDkim = responses[2]?.[1]?.list || [];
      const strategy = (responses[3]?.[1]?.list || [])[0] || {};
      const routes = responses[4]?.[1]?.list || [];

      const routeElse = strategy?.route?.else || '';
      const mxRoute = routes.find((r) => r['@type'] === 'Mx' || r.name === 'mx');
      const relayRoute = routes.find((r) => r['@type'] === 'Relay' || r.name === 'brevo');
      const isDirectMode = routeElse === 'mx' || routeElse === mxRoute?.id || !relayRoute;

      const domainById = Object.fromEntries(rawDomains.map((d) => [d.id, d.name]));
      const mailboxes = rawAccounts.map((a) => {
        const domName = domainById[a.domainId] || 'iecloudbase.com';
        const addr = a.name.includes('@') ? a.name : `${a.name}@${domName}`;
        const allEmails = Array.isArray(a.emails) ? a.emails : [];
        const aliases = allEmails.filter((e) => e.toLowerCase() !== addr.toLowerCase());
        const quotaBytes = a.quotas?.maxDiskQuota || 10 * 1024 * 1024 * 1024;
        return {
          id: a.id,
          username: a.name,
          address: addr,
          displayName: a.description || a.name,
          domain: domName,
          domainId: a.domainId,
          quota: quotaBytes,
          quotaBytes,
          aliases,
          enabled: a.enable !== false,
        };
      });

      const domains = rawDomains.map((d) => {
        const rsaDkim = rawDkim.find((k) => k.domainId === d.id && k['@type'] === 'Dkim1RsaSha256') || rawDkim.find((k) => k.domainId === d.id);
        const selector = rsaDkim?.selector || 'default';
        const pubKey = rsaDkim?.publicKey || '';
        const count = mailboxes.filter((m) => m.domain.toLowerCase() === (d.name || '').toLowerCase()).length;
        return {
          id: d.id,
          domain: d.name,
          name: d.name,
          description: d.description || 'Managed Email Domain',
          enabled: d.enable !== false,
          mailboxCount: count,
          dkimSelector: selector,
          dkimPublicKey: pubKey,
          dnsRecords: [
            { label: 'MX (Inbound Mail)', type: 'MX', host: '@', value: 'mail.iecloudbase.com', answer: 'mail.iecloudbase.com', priority: 10, ttl: 300 },
            { label: 'SPF (Sender Policy)', type: 'TXT', host: '@', value: 'v=spf1 mx a ip4:13.51.192.94 ~all', answer: 'v=spf1 mx a ip4:13.51.192.94 ~all', ttl: 300 },
            ...(pubKey ? [{ label: `DKIM (${selector})`, type: 'TXT', host: `${selector}._domainkey`, value: `v=DKIM1; k=rsa; p=${pubKey}`, answer: `v=DKIM1; k=rsa; p=${pubKey}`, ttl: 300 }] : []),
            { label: 'DMARC (Authentication Policy)', type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:admin@${d.name}`, answer: `v=DMARC1; p=quarantine; rua=mailto:admin@${d.name}`, ttl: 300 },
          ],
        };
      });

      return sendJson(res, 200, {
        outbound: {
          mode: isDirectMode ? 'direct' : 'relay',
          routeTarget: isDirectMode ? 'mx' : 'brevo',
          ip: '13.51.192.94',
          ptrHost: 'mail.iecloudbase.com',
          ptrValid: true,
          serverHost: 'mail.iecloudbase.com',
          elasticIp: '13.51.192.94',
          reverseDns: 'mail.iecloudbase.com',
          relayHost: relayRoute?.host || null,
        },
        domains,
        mailboxes,
      });
    }

    if (req.method === 'POST' && pathname === '/mail/outbound-mode') {
      const body = await readBody(req);
      const mode = (body.mode || 'direct').toLowerCase(); // 'direct' | 'relay'
      const targetRoute = mode === 'direct' ? 'mx' : 'brevo';
      await stalwartJmap([
        [
          'x:MtaOutboundStrategy/set',
          {
            update: {
              singleton: {
                route: {
                  localDomains: 'local',
                  else: targetRoute,
                },
              },
            },
          },
          's1',
        ],
      ]);
      return sendJson(res, 200, { ok: true, mode });
    }

    if (req.method === 'POST' && pathname === '/mail/domains') {
      const body = await readBody(req);
      const domain = (body.domain || '').trim().toLowerCase();
      if (!domain || !domain.includes('.')) return sendJson(res, 400, { error: 'Valid domain name is required' });
      const domResp = await stalwartJmap([['x:Domain/get', {}, 'd0']]);
      const existing = (domResp[0]?.[1]?.list || []).find((d) => (d.name || '').toLowerCase() === domain);
      let domainId = existing?.id;
      if (!domainId) {
        const createResp = await stalwartJmap([
          ['x:Domain/set', { create: { d1: { name: domain, enable: true } } }, 'd1'],
        ]);
        domainId = createResp[0]?.[1]?.created?.d1?.id;
        if (!domainId) throw new Error('Failed to create domain in Stalwart');
      }
      return sendJson(res, 201, { created: true, id: domainId, domain });
    }

    const mailDomDel = pathname.match(/^\/mail\/domains\/([^/]+)$/);
    if (mailDomDel && req.method === 'DELETE') {
      const target = decodeURIComponent(mailDomDel[1]).toLowerCase();
      const [domResp, accResp] = await stalwartJmap([
        ['x:Domain/get', {}, 'd0'],
        ['x:Account/get', {}, 'a0'],
      ]);
      const allDoms = domResp?.[1]?.list || [];
      const domObj = allDoms.find((d) => String(d.id).toLowerCase() === target || String(d.name || '').toLowerCase() === target);
      if (!domObj) return sendJson(res, 200, { deleted: true });
      const domId = domObj.id;
      const accounts = (accResp?.[1]?.list || []).filter((a) => a.domainId === domId);
      if (accounts.length > 0) {
        await stalwartJmap([['x:Account/set', { destroy: accounts.map((a) => a.id) }, 'a1']]);
      }
      await stalwartJmap([['x:Domain/set', { destroy: [domId] }, 'd1']]);
      return sendJson(res, 200, { deleted: true });
    }

    const mailVerifyDns = pathname.match(/^\/mail\/domains\/([^/]+)\/verify-dns$/);
    if (mailVerifyDns && req.method === 'GET') {
      const domain = decodeURIComponent(mailVerifyDns[1]).toLowerCase();
      let selector = url.searchParams.get('selector') || '';
      if (!selector) {
        try {
          const [domResp, dkimResp] = await stalwartJmap([
            ['x:Domain/get', {}, 'd0'],
            ['x:DkimSignature/get', {}, 'k0'],
          ]);
          const domObj = (domResp?.[1]?.list || []).find((d) => String(d.name || '').toLowerCase() === domain);
          const dkimList = dkimResp?.[1]?.list || [];
          const rsaKey = dkimList.find((k) => k.domainId === domObj?.id && k['@type'] === 'Dkim1RsaSha256') || dkimList.find((k) => k.domainId === domObj?.id);
          selector = rsaKey?.selector || 'v1-rsa-20261119';
        } catch {
          selector = 'v1-rsa-20261119';
        }
      }
      async function dnsQuery(name, type) {
        try {
          const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`);
          const d = await r.json();
          return (d.Answer || []).map((a) => String(a.data || '').replace(/^"|"$/g, ''));
        } catch {
          return [];
        }
      }
      const [mxAns, txtAns, dkimAns, dmarcAns] = await Promise.all([
        dnsQuery(domain, 'MX'),
        dnsQuery(domain, 'TXT'),
        dnsQuery(`${selector}._domainkey.${domain}`, 'TXT'),
        dnsQuery(`_dmarc.${domain}`, 'TXT'),
      ]);
      const mxOk = mxAns.some((x) => x.toLowerCase().includes('mail.iecloudbase.com'));
      const spfOk = txtAns.some((x) => x.toLowerCase().includes('v=spf1'));
      const dkimOk = dkimAns.some((x) => x.includes('DKIM1') || x.includes('p=')) || txtAns.some((x) => x.includes('v=DKIM1'));
      const dmarcOk = dmarcAns.some((x) => x.toLowerCase().includes('v=dmarc1'));
      return sendJson(res, 200, {
        domain,
        allValid: mxOk && spfOk && dkimOk && dmarcOk,
        checks: {
          mx: { valid: mxOk },
          spf: { valid: spfOk },
          dkim: { valid: dkimOk },
          dmarc: { valid: dmarcOk },
        },
        answers: { mx: mxAns, txt: txtAns, dkim: dkimAns, dmarc: dmarcAns },
      });
    }

    const mailPassReset = pathname.match(/^\/mail\/mailboxes\/([^/]+)\/password$/);
    if (mailPassReset && req.method === 'POST') {
      const target = decodeURIComponent(mailPassReset[1]);
      const body = await readBody(req);
      const password = String(body.password || '');
      if (password.length < 4) return sendJson(res, 400, { error: 'Password must be at least 4 characters' });
      let accId = target;
      if (target.includes('@')) {
        const userPart = target.split('@')[0].toLowerCase();
        const accResp = await stalwartJmap([['x:Account/get', {}, 'a0']]);
        const found = (accResp[0]?.[1]?.list || []).find((a) => (a.name || '').toLowerCase() === userPart || (a.emails || []).some((e) => e.toLowerCase() === target.toLowerCase()));
        if (found?.id) accId = found.id;
      }
      await stalwartJmap([
        [
          'x:Account/set',
          {
            update: {
              [accId]: {
                credentials: {
                  '0': { '@type': 'Password', secret: password },
                },
              },
            },
          },
          'u1',
        ],
      ]);
      return sendJson(res, 200, { updated: true });
    }

    const mailAliasesSet = pathname.match(/^\/mail\/mailboxes\/([^/]+)\/aliases$/);
    if (mailAliasesSet && req.method === 'POST') {
      const target = decodeURIComponent(mailAliasesSet[1]);
      const body = await readBody(req);
      const aliases = Array.isArray(body.aliases) ? body.aliases.map((a) => String(a).trim().toLowerCase()).filter(Boolean) : [];
      const [domResp, accResp] = await stalwartJmap([
        ['x:Domain/get', {}, 'd0'],
        ['x:Account/get', {}, 'a0'],
      ]);
      const domainById = Object.fromEntries((domResp?.[1]?.list || []).map((d) => [d.id, d.name]));
      const accounts = accResp?.[1]?.list || [];
      const found = accounts.find((a) => String(a.id) === target || (a.name || '').toLowerCase() === target.split('@')[0].toLowerCase() || (a.emails || []).some((e) => e.toLowerCase() === target.toLowerCase()));
      if (!found) return sendJson(res, 404, { error: 'Mailbox not found' });
      const domName = domainById[found.domainId] || 'iecloudbase.com';
      const primaryAddr = found.name.includes('@') ? found.name.toLowerCase() : `${found.name}@${domName}`.toLowerCase();
      const allEmails = [...new Set([primaryAddr, ...aliases])];
      await stalwartJmap([
        [
          'x:Account/set',
          {
            update: {
              [found.id]: {
                emails: allEmails,
              },
            },
          },
          'u1',
        ],
      ]);
      return sendJson(res, 200, { updated: true, aliases });
    }

    if (req.method === 'GET' && pathname === '/mail/mailboxes') {
      const responses = await stalwartJmap([
        ['x:Domain/get', {}, 'd0'],
        ['x:Account/get', {}, 'a0'],
      ]);
      const domains = responses[0]?.[1]?.list || [];
      const domainById = Object.fromEntries(domains.map((d) => [d.id, d.name]));
      const accounts = (responses[1]?.[1]?.list || []).filter((a) => a['@type'] === 'User');
      const mailboxes = accounts.map((a) => ({
        id: a.id,
        address: a.domainId && domainById[a.domainId] ? `${a.name}@${domainById[a.domainId]}` : a.name,
        displayName: a.description || a.name,
        domain: domainById[a.domainId] || 'iecloudbase.com',
      }));
      return sendJson(res, 200, { mailboxes });
    }

    if (req.method === 'POST' && pathname === '/mail/mailboxes') {
      const body = await readBody(req);
      const { address, domain, displayName, password, quotaBytes } = body;
      if (!address || !domain || !password) {
        return sendJson(res, 400, { error: 'address, domain, and password are required' });
      }
      const localName = address.includes('@') ? address.split('@')[0] : address;

      // 1. Find or create the domain in Stalwart
      const domResp = await stalwartJmap([['x:Domain/get', {}, 'd0']]);
      const domains = domResp[0]?.[1]?.list || [];
      let domObj = domains.find((d) => (d.name || '').toLowerCase() === domain.toLowerCase());
      if (!domObj) {
        const createDomResp = await stalwartJmap([
          ['x:Domain/set', { create: { d1: { name: domain, enable: true } } }, 'd1'],
        ]);
        const createdDom = createDomResp[0]?.[1]?.created?.d1;
        if (!createdDom?.id) {
          throw new Error(JSON.stringify(createDomResp[0]?.[1]?.notCreated || 'Failed to create domain'));
        }
        domObj = { id: createdDom.id, name: domain };
      }

      // 2. Create the user mailbox in Stalwart
      const accResp = await stalwartJmap([
        [
          'x:Account/set',
          {
            create: {
              u1: {
                '@type': 'User',
                name: localName,
                domainId: domObj.id,
                description: displayName || localName,
                credentials: {
                  '0': {
                    '@type': 'Password',
                    secret: password,
                  },
                },
                quotas: {
                  maxDiskQuota: quotaBytes || 10 * 1024 * 1024 * 1024,
                },
              },
            },
          },
          'a1',
        ],
      ]);

      const createdAcc = accResp[0]?.[1]?.created?.u1;
      if (!createdAcc) {
        const notCreated = accResp[0]?.[1]?.notCreated?.u1;
        throw new Error(notCreated?.description || notCreated?.type || JSON.stringify(accResp));
      }
      return sendJson(res, 201, { created: true, id: createdAcc.id, address });
    }

    const mailDelMatch = pathname.match(/^\/mail\/mailboxes\/(.+)$/);
    if (mailDelMatch && req.method === 'DELETE') {
      const target = decodeURIComponent(mailDelMatch[1]);
      const localName = target.includes('@') ? target.split('@')[0] : target;
      const accResp = await stalwartJmap([['x:Account/get', {}, 'a0']]);
      const accounts = accResp[0]?.[1]?.list || [];
      const found = accounts.find((a) => a.id === target || a.name === localName);
      if (found) {
        await stalwartJmap([['x:Account/set', { destroy: [found.id] }, 'a1']]);
      }
      return sendJson(res, 200, { deleted: true });
    }

    // =========================================================================
    // CUSTOM WEBMAIL (RFC 8621 JMAP via Stalwart for any mailbox)
    // =========================================================================
    async function userJmapSession(email, password) {
      const auth = 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
      const res = await stalwartHttpsFetch('/jmap/session', {
        headers: { Authorization: auth },
      });
      if (!res.ok) {
        const err = new Error('Invalid email or password');
        err.status = 401;
        throw err;
      }
      const session = await res.json();
      const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'] || Object.keys(session.accounts || {})[0];
      return { auth, accountId };
    }

    async function userJmapCall(auth, methodCalls, extraUsing = []) {
      const res = await stalwartHttpsFetch('/jmap/', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', ...extraUsing],
          methodCalls,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `${res.status} ${res.statusText}`);
      return data.methodResponses || [];
    }

    async function userJmapUpload(auth, accountId, buffer, contentType = 'application/octet-stream') {
      const parsed = new URL(`${STALWART_BASE}/jmap/upload/${encodeURIComponent(accountId)}/`);
      return new Promise((resolve, reject) => {
        const req = https.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname,
            method: 'POST',
            servername: parsed.hostname,
            headers: {
              Host: parsed.hostname,
              Authorization: auth,
              'Content-Type': contentType,
              'Content-Length': buffer.length,
            },
            lookup: (_host, opts, cb) => {
              if (typeof opts === 'function') return opts(null, STALWART_IP, 4);
              if (opts && opts.all) return cb(null, [{ address: STALWART_IP, family: 4 }]);
              return cb(null, STALWART_IP, 4);
            },
          },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf-8');
              let data = null;
              try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
              if (res.statusCode >= 400) return reject(new Error(data?.detail || `Upload HTTP ${res.statusCode}`));
              resolve(data);
            });
          }
        );
        req.on('error', reject);
        req.write(buffer);
        req.end();
      });
    }

    if (req.method === 'POST' && pathname === '/webmail/login') {
      const { email, password } = await readBody(req);
      if (!email || !password) return sendJson(res, 400, { error: 'email and password required' });
      const { auth, accountId } = await userJmapSession(email, password);
      const responses = await userJmapCall(auth, [
        ['Mailbox/get', { accountId }, 'm0'],
      ]);
      const folders = (responses[0]?.[1]?.list || []).map((f) => ({
        id: f.id,
        name: f.name,
        role: f.role || null,
        totalEmails: f.totalEmails || 0,
        unreadEmails: f.unreadEmails || 0,
      }));
      return sendJson(res, 200, { accountId, email, folders });
    }

    if (req.method === 'POST' && pathname === '/webmail/messages') {
      const { email, password, mailboxId, query } = await readBody(req);
      if (!email || !password) return sendJson(res, 400, { error: 'email and password required' });
      const { auth, accountId } = await userJmapSession(email, password);
      const filter = {};
      if (mailboxId) filter.inMailbox = mailboxId;
      if (query) filter.text = query;

      const responses = await userJmapCall(auth, [
        ['Email/query', { accountId, filter, sort: [{ property: 'receivedAt', isAscending: false }], limit: 50 }, 'q0'],
        [
          'Email/get',
          {
            accountId,
            '#ids': { resultOf: 'q0', name: 'Email/query', path: '/ids' },
            properties: ['id', 'messageId', 'subject', 'from', 'to', 'receivedAt', 'preview', 'keywords', 'textBody', 'bodyValues'],
            fetchTextBodyValues: true,
          },
          'g0',
        ],
      ]);
      const vault = readRecallVault();
      const list = (responses[1]?.[1]?.list || []).map((m) => {
        const partId = m.textBody?.[0]?.partId;
        const body = (partId && m.bodyValues?.[partId]?.value) || m.preview || '';
        const msgHdrs = Array.isArray(m.messageId) ? m.messageId : [];
        const vaultMatch = vault.items.find(
          (v) =>
            v.sentEmailId === m.id ||
            (v.messageIdHeader && msgHdrs.includes(v.messageIdHeader)) ||
            (v.id && (body.includes(`/mail/secure/${v.id}`) || body.includes(`/vault/view/${v.id}`) || body.includes(`/vault/render/${v.id}.png`)))
        );
        return {
          id: m.id,
          messageIdHeader: msgHdrs[0] || null,
          subject: m.subject || '(No Subject)',
          from: m.from?.[0]?.email || m.from?.[0]?.name || 'Unknown',
          fromName: m.from?.[0]?.name || m.from?.[0]?.email || 'Unknown',
          to: (m.to || []).map((t) => t.email).join(', '),
          receivedAt: m.receivedAt,
          preview: m.preview || '',
          unread: !m.keywords?.['$seen'],
          body,
          recallInfo: vaultMatch
            ? {
                recallId: vaultMatch.id,
                recallable: Boolean(vaultMatch.recallable),
                recalled: Boolean(vaultMatch.recalled),
                recalledAt: vaultMatch.recalledAt || null,
                windowHours: vaultMatch.windowHours || 0,
              }
            : null,
        };
      });
      return sendJson(res, 200, { messages: list });
    }

    if (req.method === 'POST' && pathname === '/webmail/send') {
      const { email, password, to, subject, body, recallable = false, recallWindowHours = 0, recallMode = 'zero_cache', attachments = [] } = await readBody(req);
      if (!email || !password || !to) return sendJson(res, 400, { error: 'email, password, and to are required' });
      const { auth, accountId } = await userJmapSession(email, password);
      const setupResp = await userJmapCall(
        auth,
        [
          ['Mailbox/get', { accountId }, 'm0'],
          ['Identity/get', { accountId }, 'i0'],
        ],
        ['urn:ietf:params:jmap:submission'],
      );
      const folders = setupResp[0]?.[1]?.list || [];
      const sentBox = folders.find((f) => f.role === 'sent') || folders[0];
      const identities = setupResp[1]?.[1]?.list || [];
      const identityId = identities[0]?.id;

      const toList = to.split(',').map((addr) => ({ email: addr.trim() })).filter((x) => x.email);
      let hostedDomains = ['iecloudbase.com'];
      try {
        const domResp = await stalwartJmap([['x:Domain/get', {}, 'd0']]);
        hostedDomains = (domResp[0]?.[1]?.list || []).map((d) => String(d.name || '').toLowerCase()).filter(Boolean);
      } catch {}
      const hasExternalRecipient = toList.some((t) => {
        const dom = (t.email.split('@')[1] || '').toLowerCase();
        return dom && !hostedDomains.includes(dom);
      });

      const cleanAtts = Array.isArray(attachments)
        ? attachments
            .filter((a) => a && a.name && a.dataBase64)
            .map((a) => ({
              name: String(a.name),
              type: String(a.type || 'application/octet-stream'),
              size: Number(a.size || 0),
              dataBase64: String(a.dataBase64),
            }))
        : [];

      const recallId = 'rcl_' + crypto.randomBytes(8).toString('hex');
      const senderDomain = (email.split('@')[1] || 'iecloudbase.com').toLowerCase();
      const messageIdHeader = `<${recallId}@${senderDomain}>`;
      const windowHoursNum = Math.max(0, parseInt(recallWindowHours || '0', 10) || 0);

      let outgoingBody = body || '';
      let outgoingHtml = null;
      let jmapAttachments = [];
      const vaultEntryPayload = {
        id: recallId,
        from: email.toLowerCase(),
        to: toList.map((t) => t.email.toLowerCase()),
        subject: subject || '(No Subject)',
        body: recallable ? (body || '') : '',
        attachments: recallable && hasExternalRecipient ? cleanAtts : [],
        messageIdHeader,
        recallable: Boolean(recallable),
        recallMode,
        windowHours: windowHoursNum,
        createdAt: Date.now(),
        recalled: false,
        recalledAt: null,
      };

      if (recallable && hasExternalRecipient) {
        await publicVaultRequest('/vault/items', 'POST', vaultEntryPayload);
        const renderImgUrl = `${RECALL_VAULT_PUBLIC_URL}/vault/render/${recallId}.png`;
        const viewPageUrl = `${RECALL_VAULT_PUBLIC_URL}/vault/view/${recallId}`;
        const attLinksHtml = cleanAtts.length
          ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;">` +
            `<div style="font-size:11.5px;font-weight:700;color:#475569;margin-bottom:6px;text-transform:uppercase;">Recallable Attachments (${cleanAtts.length})</div>` +
            cleanAtts
              .map(
                (a, idx) =>
                  `<a href="${RECALL_VAULT_PUBLIC_URL}/vault/file/${recallId}/${idx}" style="display:inline-block;margin:0 6px 6px 0;padding:7px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:7px;color:#0f172a;text-decoration:none;font-size:12.5px;font-weight:600;">📎 ${escapeHtml(a.name)}</a>`
              )
              .join('') +
            `</div>`
          : '';
        const attText = cleanAtts.length
          ? '\nAttachments:\n' + cleanAtts.map((a, idx) => `- ${a.name}: ${RECALL_VAULT_PUBLIC_URL}/vault/file/${recallId}/${idx}`).join('\n')
          : '';

        outgoingBody =
          `You have received a Recallable Secure Message from ${email}.\n\n` +
          `Subject: ${subject || '(No Subject)'}\n` +
          `Read Secure Message: ${viewPageUrl}\n` +
          attText;

        if (recallMode === 'inline') {
          outgoingHtml =
            `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:8px 0;">` +
            `<img src="${renderImgUrl}" alt="Recallable Message from ${escapeHtml(email)}" style="display:block;max-width:100%;height:auto;border:1px solid #e2e8f0;border-radius:10px;" />` +
            attLinksHtml +
            `<div style="margin-top:8px;font-size:11.5px;color:#64748b;">` +
            `Protected by ieCloudbase Recallable Mail · <a href="${viewPageUrl}" style="color:#0f172a;">Open in browser</a>` +
            `</div></div>`;
        } else {
          outgoingHtml =
            `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">` +
            `<div style="font-size:11px;font-weight:700;color:#475569;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;">ieCloudbase Zero-Cache Recallable Mail</div>` +
            `<div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:6px;">${escapeHtml(subject || '(No Subject)')}</div>` +
            `<div style="font-size:13px;color:#64748b;margin-bottom:16px;">From: <strong style="color:#0f172a;">${escapeHtml(email)}</strong></div>` +
            `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;font-size:13px;color:#334155;margin-bottom:16px;">` +
            `This message${cleanAtts.length ? ` and ${cleanAtts.length} attached file(s)` : ''} are protected by <strong>Zero-Cache Recall</strong>. Click below to read directly from the sender's secure vault.` +
            `</div>` +
            `<a href="${viewPageUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:13.5px;font-weight:600;padding:10px 18px;border-radius:8px;">Read Secure Message →</a>` +
            attLinksHtml +
            `</div>`;
        }
      } else if (cleanAtts.length > 0) {
        for (const att of cleanAtts) {
          const buf = Buffer.from(att.dataBase64, 'base64');
          const up = await userJmapUpload(auth, accountId, buf, att.type);
          jmapAttachments.push({
            blobId: up.blobId,
            type: att.type,
            name: att.name,
            disposition: 'attachment',
          });
        }
      }

      const emailCreateObj = {
        mailboxIds: { [sentBox.id]: true },
        keywords: { $seen: true },
        messageId: [messageIdHeader],
        from: [{ email }],
        to: toList,
        subject: subject || '(No Subject)',
        ...(jmapAttachments.length > 0 ? { attachments: jmapAttachments } : {}),
        ...(outgoingHtml
          ? {
              bodyStructure: {
                type: 'multipart/alternative',
                subParts: [
                  { type: 'text/plain', partId: 'p1' },
                  { type: 'text/html', partId: 'h1' },
                ],
              },
              bodyValues: {
                p1: { value: outgoingBody },
                h1: { value: outgoingHtml },
              },
            }
          : {
              bodyStructure: { type: 'text/plain', partId: 'p1' },
              bodyValues: { p1: { value: outgoingBody } },
            }),
      };

      const sendResp = await userJmapCall(
        auth,
        [
          [
            'Email/set',
            {
              accountId,
              create: {
                e1: emailCreateObj,
              },
            },
            's0',
          ],
          [
            'EmailSubmission/set',
            {
              accountId,
              create: {
                sub1: {
                  emailId: '#e1',
                  ...(identityId ? { identityId } : {}),
                },
              },
            },
            's1',
          ],
        ],
        ['urn:ietf:params:jmap:submission'],
      );

      const notCreated = sendResp[1]?.[1]?.notCreated || sendResp[0]?.[1]?.notCreated;
      if (notCreated && Object.keys(notCreated).length > 0) {
        throw new Error(JSON.stringify(notCreated));
      }

      const sentEmailId = sendResp[0]?.[1]?.created?.e1?.id || null;
      const vault = readRecallVault();
      vault.items.unshift({
        ...vaultEntryPayload,
        attachments: cleanAtts.map((a) => ({ name: a.name, type: a.type, size: a.size })),
        sentEmailId,
      });
      if (vault.items.length > 500) vault.items = vault.items.slice(0, 500);
      writeRecallVault(vault);

      return sendJson(res, 200, { sent: true, recallId, sentEmailId, recallable: Boolean(recallable) });
    }

    if (req.method === 'POST' && pathname === '/webmail/recall') {
      const { email, password, messageId, recallId } = await readBody(req);
      if (!email || !password || !messageId) {
        return sendJson(res, 400, { error: 'email, password, and messageId are required' });
      }
      const { auth, accountId } = await userJmapSession(email, password);
      const msgResp = await userJmapCall(auth, [
        ['Email/get', { accountId, ids: [messageId], properties: ['id', 'messageId', 'subject', 'from', 'to', 'receivedAt'] }, 'g0'],
      ]);
      const msg = msgResp[0]?.[1]?.list?.[0];
      if (!msg) return sendJson(res, 404, { error: 'Sent message not found' });

      const msgHdrs = Array.isArray(msg.messageId) ? msg.messageId : [];
      const recipients = (msg.to || []).map((t) => String(t.email || '').trim().toLowerCase()).filter(Boolean);
      const vault = readRecallVault();
      let vaultEntry = vault.items.find(
        (v) =>
          (recallId && v.id === recallId) ||
          v.sentEmailId === messageId ||
          (v.messageIdHeader && msgHdrs.includes(v.messageIdHeader))
      );

      if (vaultEntry?.recalled) {
        return sendJson(res, 200, { ok: true, alreadyRecalled: true, recalled: true, extractedRecipients: [], vaultRevoked: true });
      }
      if (vaultEntry && vaultEntry.windowHours > 0) {
        const ageMs = Date.now() - (vaultEntry.createdAt || 0);
        if (ageMs > vaultEntry.windowHours * 3600 * 1000) {
          return sendJson(res, 400, { error: `Recall window of ${vaultEntry.windowHours} hour(s) has expired for this message.` });
        }
      }

      // 1. Physically extract & destroy the email from every hosted ieCloudbase recipient's mailbox
      const extractedRecipients = [];
      try {
        const adminData = await stalwartJmap([
          ['x:Domain/get', {}, 'd0'],
          ['x:Account/get', {}, 'a0'],
        ]);
        const domains = adminData[0]?.[1]?.list || [];
        const domainById = Object.fromEntries(domains.map((d) => [d.id, String(d.name || '').toLowerCase()]));
        const accounts = (adminData[1]?.[1]?.list || []).filter((a) => a['@type'] === 'User');

        for (const recAddr of recipients) {
          const recAcc = accounts.find((a) => {
            const primary = (a.emailAddress || `${a.name}@${domainById[a.domainId] || ''}`).toLowerCase();
            const aliases = Array.isArray(a.emails) ? a.emails.map((x) => x.toLowerCase()) : [];
            return primary === recAddr || aliases.includes(recAddr);
          });
          if (!recAcc) continue;

          let targetIds = [];
          for (const hdr of msgHdrs) {
            const qResp = await stalwartJmap(
              [['Email/query', { accountId: recAcc.id, filter: { header: ['Message-ID', hdr] }, limit: 20 }, 'q0']],
              ['urn:ietf:params:jmap:mail'],
            );
            const ids = qResp[0]?.[1]?.ids || [];
            targetIds.push(...ids);
          }

          if (targetIds.length === 0 && msg.subject) {
            const qFallback = await stalwartJmap(
              [['Email/query', { accountId: recAcc.id, filter: { from: email, subject: msg.subject }, limit: 10 }, 'q1']],
              ['urn:ietf:params:jmap:mail'],
            );
            targetIds.push(...(qFallback[0]?.[1]?.ids || []));
          }

          targetIds = [...new Set(targetIds)];
          if (targetIds.length > 0) {
            await stalwartJmap(
              [['Email/set', { accountId: recAcc.id, destroy: targetIds }, 'd1']],
              ['urn:ietf:params:jmap:mail'],
            );
            extractedRecipients.push(recAddr);
          }
        }
      } catch (extractErr) {
        console.error('Internal inbox extraction warning:', extractErr.message);
      }

      // 2. Revoke & wipe the Recallable Vault entry (local + public server)
      const recalledAt = new Date().toISOString();
      const targetRecallId = vaultEntry?.id || recallId;
      if (targetRecallId) {
        try {
          await publicVaultRequest(`/vault/items/${encodeURIComponent(targetRecallId)}/recall`, 'POST', { recalledAt });
        } catch (vaultErr) {
          console.error('Public vault recall warning:', vaultErr.message);
        }
      }
      if (vaultEntry) {
        vaultEntry.recalled = true;
        vaultEntry.recalledAt = recalledAt;
        vaultEntry.body = '';
      } else {
        vault.items.unshift({
          id: recallId || 'rcl_' + crypto.randomBytes(8).toString('hex'),
          from: email.toLowerCase(),
          to: recipients,
          subject: msg.subject || '(No Subject)',
          body: '',
          messageIdHeader: msgHdrs[0] || null,
          sentEmailId: messageId,
          recallable: true,
          windowHours: 0,
          createdAt: Date.now(),
          recalled: true,
          recalledAt,
        });
      }
      writeRecallVault(vault);

      return sendJson(res, 200, {
        ok: true,
        recalled: true,
        recalledAt,
        extractedRecipients,
        vaultRevoked: true,
      });
    }

    const secureMailMatch = pathname.match(/^\/mail\/secure\/([^/]+)$/);
    if (secureMailMatch && req.method === 'GET') {
      const id = decodeURIComponent(secureMailMatch[1]);
      const vault = readRecallVault();
      const entry = vault.items.find((v) => v.id === id);
      res.writeHead(entry ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      if (!entry) {
        return res.end(`<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:48px;text-align:center;"><div style="max-width:480px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;"><h2>Message Not Found</h2><p style="color:#64748b;">This secure message link is invalid or has been removed.</p></div></body></html>`);
      }
      const isExpired = entry.windowHours > 0 && (Date.now() - (entry.createdAt || 0)) > entry.windowHours * 3600 * 1000;
      if (entry.recalled) {
        return res.end(`<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:48px;text-align:center;"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #fecaca;border-radius:12px;padding:32px;"><div style="display:inline-block;background:#fef2f2;color:#b91c1c;font-weight:700;font-size:12px;padding:4px 10px;border-radius:999px;margin-bottom:12px;">MESSAGE RECALLED</div><h2 style="margin:0 0 8px;color:#0f172a;">This message was recalled by the sender</h2><p style="color:#64748b;font-size:14px;"><strong>${escapeHtml(entry.from)}</strong> took back this email on ${escapeHtml(new Date(entry.recalledAt || Date.now()).toLocaleString())}. Its contents are no longer available.</p></div></body></html>`);
      }
      if (isExpired) {
        return res.end(`<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:48px;text-align:center;"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;"><h2>Message Expired</h2><p style="color:#64748b;">The viewing window for this message has expired.</p></div></body></html>`);
      }
      return res.end(`<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:40px 16px;"><div style="max-width:640px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;"><div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">ieCloudbase Secure Recallable Mail</div><h2 style="margin:0 0 12px;color:#0f172a;">${escapeHtml(entry.subject)}</h2><div style="font-size:13px;color:#64748b;padding-bottom:14px;border-bottom:1px solid #e2e8f0;margin-bottom:18px;"><div><strong>From:</strong> ${escapeHtml(entry.from)}</div><div><strong>To:</strong> ${escapeHtml((entry.to || []).join(', '))}</div></div><div style="white-space:pre-wrap;font-size:14.5px;line-height:1.6;color:#0f172a;">${escapeHtml(entry.body)}</div></div></body></html>`);
    }

    if (req.method === 'POST' && pathname === '/webmail/delete') {
      const { email, password, messageId, permanent = false } = await readBody(req);
      if (!email || !password || !messageId) return sendJson(res, 400, { error: 'email, password, messageId required' });
      const { auth, accountId } = await userJmapSession(email, password);
      const infoResp = await userJmapCall(auth, [
        ['Mailbox/get', { accountId }, 'm0'],
        ['Email/get', { accountId, ids: [messageId], properties: ['id', 'mailboxIds'] }, 'g0'],
      ]);
      const folders = infoResp[0]?.[1]?.list || [];
      const msg = infoResp[1]?.[1]?.list?.[0];
      const trashBox = folders.find(
        (f) => f.role === 'trash' || (f.name || '').toLowerCase().includes('deleted') || (f.name || '').toLowerCase().includes('trash')
      );
      const alreadyInTrash = Boolean(trashBox && msg?.mailboxIds?.[trashBox.id]);

      if (permanent || !trashBox || alreadyInTrash) {
        await userJmapCall(auth, [
          ['Email/set', { accountId, destroy: [messageId] }, 'd0'],
        ]);
        return sendJson(res, 200, { deleted: true, permanent: true });
      }

      await userJmapCall(auth, [
        ['Email/set', { accountId, update: { [messageId]: { mailboxIds: { [trashBox.id]: true } } } }, 'u0'],
      ]);
      return sendJson(res, 200, { deleted: true, movedToTrash: true });
    }

    // =========================================================================
    // APP HOSTING (Dokploy PaaS REST API + Blueprints + Projects + Databases)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/paas/overview') {
      const projectsRaw = await dokploy('/api/project.all');
      const privateLocks = readPrivateLocks();
      const projects = [];
      const services = [];
      for (const proj of projectsRaw || []) {
        if (proj.name === '__iecloudbase_system__') continue;
        let projCount = 0;
        let projHealthy = true;
        const defaultEnv = (proj.environments || []).find((e) => e.isDefault) || proj.environments?.[0];
        for (const env of proj.environments || []) {
          for (const app of env.applications || []) {
            projCount++;
            const st = (app.applicationStatus || 'idle').toLowerCase();
            if (st === 'error') projHealthy = false;
            let domainUrl = `https://${(app.appName || app.name).toLowerCase().replace(/[^a-z0-9-]/g, '-')}.${DOKPLOY_APPS_DOMAIN}`;
            let port = 80;
            try {
              const doms = await dokploy(`/api/domain.byApplicationId?applicationId=${encodeURIComponent(app.applicationId)}`);
              if (Array.isArray(doms) && doms.length > 0) {
                const d = doms[0];
                domainUrl = `${d.https ? 'https' : 'http'}://${d.host}`;
                port = d.port || 80;
              }
            } catch {}
            services.push({
              id: app.applicationId,
              kind: 'web',
              name: app.name,
              project: proj.name,
              projectId: proj.projectId,
              url: domainUrl,
              source: app.sourceType || 'docker',
              runtime: app.sourceType === 'docker' ? 'Image' : app.sourceType === 'git' || app.sourceType === 'github' ? 'Git' : (app.buildType || 'Image'),
              region: 'eu-north-1',
              containerPort: port,
              status: st === 'done' ? 'deployed' : st,
              isPrivateLocked: Boolean(privateLocks[app.applicationId]?.locked),
              lockUsername: privateLocks[app.applicationId]?.username || null,
              updatedAt: app.createdAt || proj.createdAt || null,
            });
          }
          for (const cmp of env.compose || []) {
            projCount++;
            const st = (cmp.composeStatus || 'idle').toLowerCase();
            if (st === 'error') projHealthy = false;
            services.push({
              id: cmp.composeId,
              kind: 'blueprint',
              name: cmp.name,
              project: proj.name,
              projectId: proj.projectId,
              url: `https://${(cmp.appName || cmp.name).toLowerCase().replace(/[^a-z0-9-]/g, '-')}.${DOKPLOY_APPS_DOMAIN}`,
              source: 'blueprint',
              runtime: 'Blueprint',
              region: 'eu-north-1',
              containerPort: 80,
              status: st === 'done' ? 'deployed' : st,
              updatedAt: cmp.createdAt || proj.createdAt || null,
            });
          }
          for (const pg of env.postgres || []) {
            projCount++;
            let pgDetail = pg;
            try { pgDetail = await dokploy(`/api/postgres.one?postgresId=${encodeURIComponent(pg.postgresId)}`); } catch {}
            const st = (pgDetail.applicationStatus || pg.applicationStatus || 'idle').toLowerCase();
            if (st === 'error') projHealthy = false;
            services.push({
              id: pg.postgresId,
              kind: 'postgres',
              name: pgDetail.name || pg.name,
              project: proj.name,
              projectId: proj.projectId,
              url: `postgres://${pgDetail.databaseUser || 'postgres'}@${pgDetail.appName || pg.name}:5432/${pgDetail.databaseName || 'app'}`,
              source: 'postgres',
              runtime: 'PostgreSQL 16',
              region: 'eu-north-1',
              containerPort: 5432,
              status: st === 'done' ? 'available' : st,
              updatedAt: pgDetail.createdAt || proj.createdAt || null,
            });
          }
          for (const rd of env.redis || []) {
            projCount++;
            let rdDetail = rd;
            try { rdDetail = await dokploy(`/api/redis.one?redisId=${encodeURIComponent(rd.redisId)}`); } catch {}
            const st = (rdDetail.applicationStatus || rd.applicationStatus || 'idle').toLowerCase();
            if (st === 'error') projHealthy = false;
            services.push({
              id: rd.redisId,
              kind: 'redis',
              name: rdDetail.name || rd.name,
              project: proj.name,
              projectId: proj.projectId,
              url: `redis://${rdDetail.appName || rd.name}:6379`,
              source: 'redis',
              runtime: 'Key Value',
              region: 'eu-north-1',
              containerPort: 6379,
              status: st === 'done' ? 'available' : st,
              updatedAt: rdDetail.createdAt || proj.createdAt || null,
            });
          }
        }
        projects.push({
          id: proj.projectId,
          name: proj.name,
          description: proj.description || '',
          environmentId: defaultEnv?.environmentId || '',
          serviceCount: projCount,
          allHealthy: projHealthy,
          createdAt: proj.createdAt || null,
        });
      }
      return sendJson(res, 200, { projects, services });
    }

    if (req.method === 'POST' && pathname === '/paas/projects') {
      const body = await readBody(req);
      const name = (body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'Project name is required' });
      const created = await dokploy('/api/project.create', {
        method: 'POST',
        body: JSON.stringify({ name, description: (body.description || '').trim() }),
      });
      return sendJson(res, 201, { project: created });
    }

    const paasProjDel = pathname.match(/^\/paas\/projects\/([^/]+)$/);
    if (paasProjDel && req.method === 'DELETE') {
      const projectId = decodeURIComponent(paasProjDel[1]);
      const projects = await dokploy('/api/project.all');
      const target = (projects || []).find((p) => p.projectId === projectId);
      if (target) {
        for (const env of target.environments || []) {
          for (const app of env.applications || []) {
            try { await dokploy('/api/application.delete', { method: 'POST', body: JSON.stringify({ applicationId: app.applicationId }) }); } catch {}
          }
          for (const cmp of env.compose || []) {
            try { await dokploy('/api/compose.delete', { method: 'POST', body: JSON.stringify({ composeId: cmp.composeId, deleteVolumes: false }) }); } catch {}
          }
          for (const pg of env.postgres || []) {
            try { await dokploy('/api/postgres.remove', { method: 'POST', body: JSON.stringify({ postgresId: pg.postgresId }) }); } catch {}
          }
          for (const rd of env.redis || []) {
            try { await dokploy('/api/redis.remove', { method: 'POST', body: JSON.stringify({ redisId: rd.redisId }) }); } catch {}
          }
        }
      }
      await dokploy('/api/project.remove', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      });
      return sendJson(res, 200, { deleted: true, projectId });
    }

    if (req.method === 'POST' && pathname === '/paas/postgres') {
      const body = await readBody(req);
      const rawName = (body.name || '').trim();
      const safeSlug = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!safeSlug) return sendJson(res, 400, { error: 'Valid database name is required' });
      const projects = await dokploy('/api/project.all');
      const targetProj = (projects || []).find((p) => p.projectId === body.projectId) || (projects || []).find((p) => p.name.toLowerCase() === 'iecloudbase') || projects?.[0];
      const envObj = (targetProj?.environments || []).find((e) => e.environmentId === body.environmentId) || targetProj?.environments?.[0];
      const envId = envObj?.environmentId;
      if (!envId) return sendJson(res, 400, { error: 'No project environment found' });
      const randSuffix = Math.random().toString(36).slice(2, 7);
      const dbName = (body.databaseName || `${safeSlug.replace(/-/g, '_')}_${randSuffix}`).trim();
      const dbUser = (body.databaseUser || `pg_${randSuffix}`).trim();
      const dbPass = (body.databasePassword || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).trim();
      const pgVersion = String(body.version || '18').replace(/[^0-9]/g, '') || '18';
      const pg = await dokploy('/api/postgres.create', {
        method: 'POST',
        body: JSON.stringify({
          name: rawName,
          appName: safeSlug,
          databaseName: dbName,
          databaseUser: dbUser,
          databasePassword: dbPass,
          dockerImage: `postgres:${pgVersion}`,
          environmentId: envId,
        }),
      });
      await dokploy('/api/postgres.deploy', { method: 'POST', body: JSON.stringify({ postgresId: pg.postgresId }) });
      return sendJson(res, 201, { postgres: pg });
    }

    if (req.method === 'POST' && pathname === '/paas/redis') {
      const body = await readBody(req);
      const rawName = (body.name || '').trim();
      const safeSlug = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!safeSlug) return sendJson(res, 400, { error: 'Valid Key Value name is required' });
      const projects = await dokploy('/api/project.all');
      const targetProj = (projects || []).find((p) => p.projectId === body.projectId) || (projects || []).find((p) => p.name.toLowerCase() === 'iecloudbase') || projects?.[0];
      const envObj = (targetProj?.environments || []).find((e) => e.environmentId === body.environmentId) || targetProj?.environments?.[0];
      const envId = envObj?.environmentId;
      if (!envId) return sendJson(res, 400, { error: 'No project environment found' });
      const dbPass = (body.databasePassword || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).trim();
      const rd = await dokploy('/api/redis.create', {
        method: 'POST',
        body: JSON.stringify({
          name: rawName,
          appName: safeSlug,
          databasePassword: dbPass,
          environmentId: envId,
        }),
      });
      await dokploy('/api/redis.deploy', { method: 'POST', body: JSON.stringify({ redisId: rd.redisId }) });
      return sendJson(res, 201, { redis: rd });
    }

    // --- GitHub / Git Provider (Composio Managed OAuth + Fallback) & Blueprint Inspection ---
    if (req.method === 'POST' && pathname === '/paas/git/composio/initiate') {
      const body = await readBody(req);
      const provider = ['github', 'gitlab', 'bitbucket'].includes((body.provider || '').toLowerCase())
        ? body.provider.toLowerCase()
        : 'github';
      const authConfigId = await getOrCreateComposioAuthConfig(provider);
      const link = await composioFetch('/connected_accounts/link', {
        method: 'POST',
        body: JSON.stringify({
          auth_config_id: authConfigId,
          user_id: COMPOSIO_USER_ID,
          callback_url: `http://localhost:${PORT}/paas/git/composio/callback?provider=${encodeURIComponent(provider)}`,
        }),
      });
      return sendJson(res, 200, {
        provider,
        redirectUrl: link.redirect_url,
        connectedAccountId: link.connected_account_id,
      });
    }

    if (req.method === 'GET' && pathname === '/paas/git/composio/callback') {
      const provider = url.searchParams.get('provider') || 'github';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html>
<html><head><title>Connected — ieCloudbase</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#111827;">
  <div style="text-align:center;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
    <h2 style="margin:0 0 8px;">Connected ${provider.toUpperCase()}</h2>
    <p style="margin:0;color:#6b7280;font-size:14px;">Returning to ieCloudbase...</p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'iecloudbase-git-connected', provider: ${JSON.stringify(provider)} }, '*');
      }
    } catch {}
    setTimeout(() => { window.close(); }, 600);
  </script>
</body></html>`);
    }

    if (req.method === 'GET' && pathname === '/paas/git/config') {
      const [ghAcc, glAcc, bbAcc] = await Promise.all([
        getActiveComposioAccount('github'),
        getActiveComposioAccount('gitlab'),
        getActiveComposioAccount('bitbucket'),
      ]);
      const cfg = readGitConfig();
      let ghUsername = cfg.username || '';
      let ghAvatar = cfg.avatarUrl || '';
      let ghConnected = Boolean(cfg.connected && cfg.username);
      let ghVia = ghConnected ? 'manual' : '';
      let ghRepoCount = cfg.repoCount || 0;

      if (ghAcc?.id) {
        ghConnected = true;
        ghVia = 'composio';
        try {
          const me = await composioGitHubProxy('/user', ghAcc.id);
          if (me?.login) {
            ghUsername = me.login;
            ghAvatar = me.avatar_url || '';
            ghRepoCount = (me.public_repos || 0) + (me.total_private_repos || 0);
          }
        } catch {}
      }

      return sendJson(res, 200, {
        connected: ghConnected,
        provider: 'github',
        via: ghVia,
        composioEnabled: Boolean(COMPOSIO_KEY),
        username: ghUsername,
        avatarUrl: ghAvatar,
        repoCount: ghRepoCount,
        hasToken: Boolean(cfg.token || ghAcc?.id),
        providers: {
          github: { connected: ghConnected, username: ghUsername, via: ghVia, accountId: ghAcc?.id || null },
          gitlab: { connected: Boolean(glAcc?.id), accountId: glAcc?.id || null },
          bitbucket: { connected: Boolean(bbAcc?.id), accountId: bbAcc?.id || null },
        },
      });
    }

    if (req.method === 'POST' && pathname === '/paas/git/connect') {
      const body = await readBody(req);
      const token = (body.token || '').trim();
      let username = (body.username || '').trim().replace(/^@/, '');
      if (!token && !username) return sendJson(res, 400, { error: 'Provide a GitHub username or Personal Access Token' });
      let profile;
      if (token) {
        profile = await githubFetch('/user', token);
        username = profile.login;
      } else {
        profile = await githubFetch(`/users/${encodeURIComponent(username)}`);
      }
      const repos = token
        ? await githubFetch('/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member', token)
        : await githubFetch(`/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=100`);
      const cfg = {
        provider: 'github',
        username,
        token,
        avatarUrl: profile.avatar_url || '',
        repoCount: Array.isArray(repos) ? repos.length : (profile.public_repos || 0),
        connected: true,
      };
      writeGitConfig(cfg);
      return sendJson(res, 200, {
        connected: true,
        username: cfg.username,
        avatarUrl: cfg.avatarUrl,
        repoCount: cfg.repoCount,
        hasToken: Boolean(token),
      });
    }

    if (req.method === 'DELETE' && pathname === '/paas/git/connect') {
      const provider = (url.searchParams.get('provider') || 'github').toLowerCase();
      const acc = await getActiveComposioAccount(provider);
      if (acc?.id) {
        try { await composioFetch(`/connected_accounts/${encodeURIComponent(acc.id)}`, { method: 'DELETE' }); } catch {}
      }
      if (provider === 'github') {
        writeGitConfig({ provider: 'github', username: '', token: '', avatarUrl: '', repoCount: 0, connected: false });
      }
      return sendJson(res, 200, { disconnected: true });
    }

    if (req.method === 'GET' && pathname === '/paas/git/repos') {
      const ghAcc = await getActiveComposioAccount('github');
      const cfg = readGitConfig();
      let raw = [];
      let username = cfg.username || '';
      if (ghAcc?.id) {
        raw = await composioGitHubProxy('/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member', ghAcc.id);
        if (!username && Array.isArray(raw) && raw[0]?.owner?.login) username = raw[0].owner.login;
      } else if (cfg.connected && cfg.username) {
        raw = cfg.token
          ? await githubFetch('/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member', cfg.token)
          : await githubFetch(`/users/${encodeURIComponent(cfg.username)}/repos?sort=updated&per_page=100`);
      } else {
        return sendJson(res, 200, { connected: false, repos: [] });
      }
      const repos = (Array.isArray(raw) ? raw : []).map((r) => ({
        id: r.id,
        fullName: r.full_name,
        owner: r.owner?.login || username,
        name: r.name,
        private: Boolean(r.private),
        defaultBranch: r.default_branch || 'main',
        updatedAt: r.pushed_at || r.updated_at,
        cloneUrl: r.clone_url,
        htmlUrl: r.html_url,
      }));
      return sendJson(res, 200, { connected: true, username, repoCount: repos.length, repos });
    }

    if (req.method === 'GET' && pathname === '/paas/git/branches') {
      const slug = parseRepoSlug(url.searchParams.get('repo') || '');
      if (!slug) return sendJson(res, 400, { error: 'Valid repo (owner/repo) required' });
      const ghAcc = await getActiveComposioAccount('github');
      const cfg = readGitConfig();
      try {
        const list = ghAcc?.id
          ? await composioGitHubProxy(`/repos/${slug}/branches?per_page=50`, ghAcc.id)
          : await githubFetch(`/repos/${slug}/branches?per_page=50`, cfg.token || '');
        return sendJson(res, 200, { branches: (Array.isArray(list) ? list : []).map((b) => b.name) });
      } catch {
        return sendJson(res, 200, { branches: ['main', 'master'] });
      }
    }

    if (req.method === 'POST' && pathname === '/paas/blueprints/inspect') {
      const body = await readBody(req);
      const slug = parseRepoSlug(body.repo || '');
      const branch = (body.branch || 'main').trim();
      const filePath = (body.path || 'render.yaml').trim().replace(/^\/+/, '');
      if (!slug) return sendJson(res, 400, { error: 'Valid GitHub repository (owner/repo or URL) is required' });
      const ghAcc = await getActiveComposioAccount('github');
      const cfg = readGitConfig();
      const apiPath = `/repos/${slug}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`;
      try {
        const fileData = ghAcc?.id
          ? await composioGitHubProxy(apiPath, ghAcc.id)
          : await githubFetch(apiPath, cfg.token || '');
        const yamlText = fileData.encoding === 'base64'
          ? Buffer.from(fileData.content || '', 'base64').toString('utf-8')
          : (fileData.content || '');
        const summary = parseBlueprintSummary(yamlText, filePath);
        return sendJson(res, 200, {
          found: true,
          repo: slug,
          branch,
          path: filePath,
          format: summary.format,
          services: summary.items,
          requiredEnvVars: summary.requiredEnvVars || [],
          yaml: yamlText,
        });
      } catch (err) {
        return sendJson(res, 200, {
          found: false,
          repo: slug,
          branch,
          path: filePath,
          message: `Blueprint file ${filePath} not found on ${branch} branch.`,
          details: err.message,
        });
      }
    }

    if (req.method === 'POST' && pathname === '/paas/blueprints/deploy') {
      const body = await readBody(req);
      const rawName = (body.name || '').trim();
      const safeSlug = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!safeSlug) return sendJson(res, 400, { error: 'Blueprint Name is required' });
      const slug = parseRepoSlug(body.repo || '');
      const branch = (body.branch || 'main').trim();
      const filePath = (body.path || 'render.yaml').trim();
      const yamlToDeploy = (body.yaml || '').trim();
      const projects = await dokploy('/api/project.all');
      const targetProj = (projects || []).find((p) => p.projectId === body.projectId) || (projects || []).find((p) => p.name.toLowerCase() === 'iecloudbase') || projects?.[0];
      const envId = targetProj?.environments?.[0]?.environmentId;
      if (!envId) return sendJson(res, 400, { error: 'No Dokploy project/environment found' });

      // 1. Render Blueprint (render.yaml): translate databases + services into real Dokploy Postgres & Applications
      if (body.format === 'render-blueprint' && yamlToDeploy) {
        const parsed = parseRenderYaml(yamlToDeploy);
        const dbConnections = {};
        const createdResources = [];

        // Provision databases first
        for (const db of parsed.databases) {
          const dbSlug = (db.name || `${safeSlug}-db`).toLowerCase().replace(/[^a-z0-9-]/g, '');
          const dbName = db.databaseName || dbSlug.replace(/-/g, '_');
          const dbUser = db.user || 'iecloud';
          const dbPass = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
          const pg = await dokploy('/api/postgres.create', {
            method: 'POST',
            body: JSON.stringify({
              name: db.name || dbSlug,
              appName: dbSlug,
              databaseName: dbName,
              databaseUser: dbUser,
              databasePassword: dbPass,
              environmentId: envId,
            }),
          });
          await dokploy('/api/postgres.deploy', { method: 'POST', body: JSON.stringify({ postgresId: pg.postgresId }) });
          const pgHost = pg.appName || dbSlug;
          dbConnections[db.name] = {
            connectionString: `postgres://${dbUser}:${dbPass}@${pgHost}:5432/${dbName}`,
            host: pgHost,
            port: '5432',
            database: dbName,
            user: dbUser,
            password: dbPass,
          };
          createdResources.push({ kind: 'postgres', id: pg.postgresId, name: db.name });
        }

        // Provision web / worker services
        let primaryUrl = `https://${safeSlug}.${DOKPLOY_APPS_DOMAIN}`;
        for (let i = 0; i < parsed.services.length; i++) {
          const svc = parsed.services[i];
          const svcName = svc.name || rawName;
          const svcSlug = (parsed.services.length === 1 ? safeSlug : svcName.toLowerCase().replace(/[^a-z0-9-]/g, '')) || safeSlug;
          const app = await dokploy('/api/application.create', {
            method: 'POST',
            body: JSON.stringify({
              name: svcName,
              appName: svcSlug,
              environmentId: envId,
            }),
          });
          const applicationId = app.applicationId;

          if (svc.runtime === 'image' || svc.image) {
            await dokploy('/api/application.saveDockerProvider', {
              method: 'POST',
              body: JSON.stringify({
                applicationId,
                dockerImage: svc.image || 'nginxdemos/hello',
                username: null,
                password: null,
                registryUrl: null,
              }),
            });
          } else {
            if (slug) {
              await dokploy('/api/application.saveGitProvider', {
                method: 'POST',
                body: JSON.stringify({
                  applicationId,
                  customGitUrl: `https://github.com/${slug}.git`,
                  customGitBranch: branch,
                  customGitBuildPath: '/',
                  watchPaths: null,
                }),
              });
            }

            if (svc.runtime === 'docker' || svc.dockerfilePath) {
              await dokploy('/api/application.saveBuildType', {
                method: 'POST',
                body: JSON.stringify({
                  applicationId,
                  buildType: 'dockerfile',
                  dockerfile: svc.dockerfilePath || './Dockerfile',
                  dockerContextPath: svc.dockerContext || '.',
                  dockerBuildStage: '',
                  herokuVersion: null,
                  railpackVersion: null,
                }),
              });
            }
          }

          // Resolve envVars (static values, generateValue, fromDatabase properties, and default PORT=10000)
          const envLines = [];
          let port = 10000;
          let hasPort = false;
          for (const ev of svc.envVars || []) {
            if (!ev.key) continue;
            if (ev.key.toUpperCase() === 'PORT') {
              hasPort = true;
              const pNum = parseInt(ev.value || '10000', 10);
              if (!Number.isNaN(pNum)) port = pNum;
            }
            if (ev.fromDatabase?.name && dbConnections[ev.fromDatabase.name]) {
              const prop = ev.fromDatabase.property || 'connectionString';
              const resolved = dbConnections[ev.fromDatabase.name][prop] ?? dbConnections[ev.fromDatabase.name].connectionString;
              envLines.push(`${ev.key}=${resolved}`);
            } else if (ev.generateValue) {
              const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
              envLines.push(`${ev.key}=${rand}`);
            } else if (ev.sync === false && body.envOverrides?.[ev.key] !== undefined) {
              envLines.push(`${ev.key}=${body.envOverrides[ev.key]}`);
            } else if (ev.value !== undefined) {
              const overrideVal = body.envOverrides?.[ev.key];
              envLines.push(`${ev.key}=${overrideVal !== undefined ? overrideVal : ev.value}`);
            }
          }
          // Apply any additional user-supplied envOverrides not already in render.yaml
          const existingKeys = new Set(envLines.map((l) => l.split('=')[0]));
          for (const [k, v] of Object.entries(body.envOverrides || {})) {
            if (k && !existingKeys.has(k)) envLines.push(`${k}=${v}`);
          }
          if (!hasPort) envLines.push(`PORT=${port}`);

          if (envLines.length > 0) {
            await dokploy('/api/application.saveEnvironment', {
              method: 'POST',
              body: JSON.stringify({
                applicationId,
                env: envLines.join('\n'),
                buildArgs: null,
                buildSecrets: null,
                createEnvFile: true,
              }),
            });
          }

          const host = `${svcSlug}.${DOKPLOY_APPS_DOMAIN}`;
          if (i === 0) primaryUrl = `https://${host}`;
          if (svc.type === 'web' || svc.type === 'static' || !svc.type) {
            await dokploy('/api/domain.create', {
              method: 'POST',
              body: JSON.stringify({
                applicationId,
                host,
                port,
                https: true,
                certificateType: 'letsencrypt',
                domainType: 'application',
              }),
            });
          }

          await dokploy('/api/application.deploy', {
            method: 'POST',
            body: JSON.stringify({ applicationId }),
          });
          createdResources.push({ kind: 'web', id: applicationId, name: svcName, url: `https://${host}` });
        }

        return sendJson(res, 201, {
          blueprint: {
            name: rawName,
            repo: slug,
            branch,
            path: filePath,
            url: primaryUrl,
            resources: createdResources,
          },
        });
      }

      // 2. Docker Compose Blueprint (docker-compose.yml / compose.yaml)
      const cmp = await dokploy('/api/compose.create', {
        method: 'POST',
        body: JSON.stringify({
          name: rawName,
          appName: safeSlug,
          environmentId: envId,
          composeType: 'docker-compose',
        }),
      });
      if (yamlToDeploy) {
        await dokploy('/api/compose.update', {
          method: 'POST',
          body: JSON.stringify({ composeId: cmp.composeId, composeFile: yamlToDeploy }),
        });
      } else if (slug) {
        await dokploy('/api/compose.update', {
          method: 'POST',
          body: JSON.stringify({
            composeId: cmp.composeId,
            sourceType: 'git',
            customGitUrl: `https://github.com/${slug}.git`,
            customGitBranch: branch,
            composePath: `./${filePath.replace(/^\.\//, '')}`,
          }),
        });
      }
      await dokploy('/api/compose.deploy', {
        method: 'POST',
        body: JSON.stringify({ composeId: cmp.composeId }),
      });
      return sendJson(res, 201, {
        blueprint: {
          id: cmp.composeId,
          name: rawName,
          repo: slug,
          branch,
          path: filePath,
          url: `https://${safeSlug}.${DOKPLOY_APPS_DOMAIN}`,
        },
      });
    }

    const paasDepLogs = pathname.match(/^\/paas\/deployments\/([^/]+)\/logs$/);
    if (paasDepLogs && req.method === 'GET') {
      const depId = decodeURIComponent(paasDepLogs[1]);
      const raw = await dokploy(`/api/deployment.readLogs?deploymentId=${encodeURIComponent(depId)}`);
      const text = typeof raw === 'string' ? raw : (raw?.raw ?? JSON.stringify(raw ?? '', null, 2));
      return sendJson(res, 200, { deploymentId: depId, logs: text });
    }

    const paasSvcLogs = pathname.match(/^\/paas\/services\/(web|blueprint|postgres|redis)\/([^/]+)\/logs$/);
    if (paasSvcLogs && req.method === 'GET') {
      const kind = paasSvcLogs[1];
      const id = decodeURIComponent(paasSvcLogs[2]);
      const tail = parseInt(url.searchParams.get('tail') || '200', 10);
      let raw = '';
      if (kind === 'web') raw = await dokploy(`/api/application.readLogs?applicationId=${encodeURIComponent(id)}&tail=${tail}`);
      else if (kind === 'postgres') raw = await dokploy(`/api/postgres.readLogs?postgresId=${encodeURIComponent(id)}&tail=${tail}`);
      else if (kind === 'redis') raw = await dokploy(`/api/redis.readLogs?redisId=${encodeURIComponent(id)}&tail=${tail}`);
      else if (kind === 'blueprint') raw = await dokploy(`/api/compose.readLogs?composeId=${encodeURIComponent(id)}&tail=${tail}`);
      const text = typeof raw === 'string' ? raw : (raw?.raw ?? JSON.stringify(raw ?? '', null, 2));
      return sendJson(res, 200, { id, kind, logs: text });
    }

    const paasSvcGet = pathname.match(/^\/paas\/services\/(web|blueprint|postgres|redis)\/([^/]+)$/);
    if (paasSvcGet && req.method === 'GET') {
      const kind = paasSvcGet[1];
      const id = decodeURIComponent(paasSvcGet[2]);
      let containers = [];
      try {
        const allC = await dokploy('/api/docker.getContainers');
        if (Array.isArray(allC)) containers = allC;
      } catch {}

      if (kind === 'web') {
        const one = await dokploy(`/api/application.one?applicationId=${encodeURIComponent(id)}`);
        let domains = one.domains || [];
        try {
          const doms = await dokploy(`/api/domain.byApplicationId?applicationId=${encodeURIComponent(id)}`);
          if (Array.isArray(doms)) domains = doms;
        } catch {}
        const deployments = [...(one.deployments || [])].sort(
          (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
        );
        const envList = (one.env || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#') && l.includes('='))
          .map((l) => {
            const idx = l.indexOf('=');
            return { key: l.slice(0, idx).trim(), value: l.slice(idx + 1) };
          });
        const matchedContainers = containers.filter((c) => one.appName && (c.name || '').includes(one.appName));
        const primaryUrl = domains[0]
          ? `${domains[0].https ? 'https' : 'http'}://${domains[0].host}`
          : `https://${(one.appName || one.name).toLowerCase().replace(/[^a-z0-9-]/g, '-')}.${DOKPLOY_APPS_DOMAIN}`;
        return sendJson(res, 200, {
          service: {
            id: one.applicationId,
            kind: 'web',
            name: one.name,
            appName: one.appName,
            status: (one.applicationStatus || 'idle').toLowerCase() === 'done' ? 'deployed' : (one.applicationStatus || 'idle').toLowerCase(),
            sourceType: one.sourceType || 'docker',
            buildType: one.buildType || 'dockerfile',
            dockerImage: one.dockerImage || '',
            gitUrl: one.customGitUrl || '',
            gitBranch: one.customGitBranch || 'main',
            dockerfile: one.dockerfile || '',
            url: primaryUrl,
            domains,
            env: envList,
            envRaw: one.env || '',
            deployments,
            containers: matchedContainers,
          },
        });
      }

      if (kind === 'postgres') {
        const one = await dokploy(`/api/postgres.one?postgresId=${encodeURIComponent(id)}`);
        const matchedContainers = containers.filter((c) => one.appName && (c.name || '').includes(one.appName));
        const connStr = `postgres://${one.databaseUser}:${one.databasePassword}@${one.appName}:5432/${one.databaseName}`;
        return sendJson(res, 200, {
          service: {
            id: one.postgresId,
            kind: 'postgres',
            name: one.name,
            appName: one.appName,
            status: (one.applicationStatus || 'idle').toLowerCase() === 'done' ? 'available' : (one.applicationStatus || 'idle').toLowerCase(),
            runtime: 'PostgreSQL 16',
            host: one.appName,
            port: 5432,
            databaseName: one.databaseName,
            databaseUser: one.databaseUser,
            databasePassword: one.databasePassword,
            connectionString: connStr,
            containers: matchedContainers,
          },
        });
      }

      if (kind === 'redis') {
        const one = await dokploy(`/api/redis.one?redisId=${encodeURIComponent(id)}`);
        const matchedContainers = containers.filter((c) => one.appName && (c.name || '').includes(one.appName));
        const connStr = `redis://:${one.databasePassword}@${one.appName}:6379`;
        return sendJson(res, 200, {
          service: {
            id: one.redisId,
            kind: 'redis',
            name: one.name,
            appName: one.appName,
            status: (one.applicationStatus || 'idle').toLowerCase() === 'done' ? 'available' : (one.applicationStatus || 'idle').toLowerCase(),
            runtime: 'Key Value (Redis)',
            host: one.appName,
            port: 6379,
            databasePassword: one.databasePassword,
            connectionString: connStr,
            containers: matchedContainers,
          },
        });
      }

      const one = await dokploy(`/api/compose.one?composeId=${encodeURIComponent(id)}`);
      const deployments = [...(one.deployments || [])].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      );
      return sendJson(res, 200, {
        service: {
          id: one.composeId,
          kind: 'blueprint',
          name: one.name,
          appName: one.appName,
          status: (one.composeStatus || 'idle').toLowerCase() === 'done' ? 'deployed' : (one.composeStatus || 'idle').toLowerCase(),
          runtime: 'Blueprint (Compose)',
          composeFile: one.composeFile || '',
          deployments,
          containers: containers.filter((c) => one.appName && (c.name || '').includes(one.appName)),
        },
      });
    }

    const paasSvcEnv = pathname.match(/^\/paas\/services\/web\/([^/]+)\/env$/);
    if (paasSvcEnv && req.method === 'POST') {
      const id = decodeURIComponent(paasSvcEnv[1]);
      const body = await readBody(req);
      let envText = typeof body.envRaw === 'string' ? body.envRaw : '';
      if (Array.isArray(body.env)) {
        envText = body.env
          .filter((e) => e && e.key && e.key.trim())
          .map((e) => `${e.key.trim()}=${e.value ?? ''}`)
          .join('\n');
      }
      await dokploy('/api/application.saveEnvironment', {
        method: 'POST',
        body: JSON.stringify({
          applicationId: id,
          env: envText,
          buildArgs: null,
          buildSecrets: null,
          createEnvFile: true,
        }),
      });
      if (body.redeploy) {
        await dokploy('/api/application.deploy', { method: 'POST', body: JSON.stringify({ applicationId: id }) });
      }
      return sendJson(res, 200, { saved: true, redeployed: Boolean(body.redeploy) });
    }

    const paasSvcDomainAdd = pathname.match(/^\/paas\/services\/web\/([^/]+)\/domains$/);
    if (paasSvcDomainAdd && req.method === 'POST') {
      const id = decodeURIComponent(paasSvcDomainAdd[1]);
      const body = await readBody(req);
      const host = (body.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!host) return sendJson(res, 400, { error: 'Valid domain host is required' });
      const created = await dokploy('/api/domain.create', {
        method: 'POST',
        body: JSON.stringify({
          applicationId: id,
          host,
          port: parseInt(body.port || '80', 10),
          https: body.https !== false,
          certificateType: body.https === false ? 'none' : 'letsencrypt',
          domainType: 'application',
        }),
      });
      return sendJson(res, 201, { domain: created });
    }

    const paasSvcDomainDel = pathname.match(/^\/paas\/services\/web\/([^/]+)\/domains\/([^/]+)$/);
    if (paasSvcDomainDel && req.method === 'DELETE') {
      const domainId = decodeURIComponent(paasSvcDomainDel[2]);
      await dokploy('/api/domain.delete', { method: 'POST', body: JSON.stringify({ domainId }) });
      return sendJson(res, 200, { deleted: true });
    }

    const paasSvcRestart = pathname.match(/^\/paas\/services\/(web|blueprint|postgres|redis)\/([^/]+)\/restart$/);
    if (paasSvcRestart && req.method === 'POST') {
      const kind = paasSvcRestart[1];
      const id = decodeURIComponent(paasSvcRestart[2]);
      if (kind === 'web') await dokploy('/api/application.reload', { method: 'POST', body: JSON.stringify({ applicationId: id }) });
      else if (kind === 'postgres') await dokploy('/api/postgres.reload', { method: 'POST', body: JSON.stringify({ postgresId: id }) });
      else if (kind === 'redis') await dokploy('/api/redis.reload', { method: 'POST', body: JSON.stringify({ redisId: id }) });
      else if (kind === 'blueprint') await dokploy('/api/compose.deploy', { method: 'POST', body: JSON.stringify({ composeId: id }) });
      return sendJson(res, 200, { restarted: true });
    }

    const paasSvcRedeploy = pathname.match(/^\/paas\/services\/(web|blueprint|postgres|redis)\/([^/]+)\/redeploy$/);
    if (paasSvcRedeploy && req.method === 'POST') {
      const kind = paasSvcRedeploy[1];
      const id = decodeURIComponent(paasSvcRedeploy[2]);
      if (kind === 'web') await dokploy('/api/application.deploy', { method: 'POST', body: JSON.stringify({ applicationId: id }) });
      else if (kind === 'blueprint') await dokploy('/api/compose.deploy', { method: 'POST', body: JSON.stringify({ composeId: id }) });
      else if (kind === 'postgres') await dokploy('/api/postgres.deploy', { method: 'POST', body: JSON.stringify({ postgresId: id }) });
      else if (kind === 'redis') await dokploy('/api/redis.deploy', { method: 'POST', body: JSON.stringify({ redisId: id }) });
      return sendJson(res, 200, { deployed: true });
    }

    const paasSvcDel = pathname.match(/^\/paas\/services\/(web|blueprint|postgres|redis)\/([^/]+)$/);
    if (paasSvcDel && req.method === 'DELETE') {
      const kind = paasSvcDel[1];
      const id = decodeURIComponent(paasSvcDel[2]);
      if (kind === 'web') await dokploy('/api/application.delete', { method: 'POST', body: JSON.stringify({ applicationId: id }) });
      else if (kind === 'blueprint') await dokploy('/api/compose.delete', { method: 'POST', body: JSON.stringify({ composeId: id, deleteVolumes: false }) });
      else if (kind === 'postgres') await dokploy('/api/postgres.remove', { method: 'POST', body: JSON.stringify({ postgresId: id }) });
      else if (kind === 'redis') await dokploy('/api/redis.remove', { method: 'POST', body: JSON.stringify({ redisId: id }) });
      return sendJson(res, 200, { deleted: true });
    }

    if (req.method === 'POST' && pathname === '/paas/static-sites') {
      const body = await readBody(req);
      const rawName = (body.name || '').trim();
      const safeSlug = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!safeSlug) return sendJson(res, 400, { error: 'Valid static site name is required' });

      const repoInput = (body.repoUrl || body.repo || '').trim();
      if (!repoInput) return sendJson(res, 400, { error: 'A Git repository is required' });
      const gitUrl = repoInput.startsWith('http')
        ? (repoInput.endsWith('.git') ? repoInput : `${repoInput.replace(/\/+$/, '')}.git`)
        : `https://github.com/${parseRepoSlug(repoInput) || repoInput}.git`;

      const projects = await dokploy('/api/project.all');
      const targetProj = (projects || []).find((p) => p.projectId === body.projectId) || (projects || []).find((p) => p.name.toLowerCase() === 'iecloudbase') || projects?.[0];
      const envId = targetProj?.environments?.[0]?.environmentId;
      if (!envId) return sendJson(res, 400, { error: 'No project environment found' });

      const branch = (body.branch || 'main').trim();
      const rootDir = (body.rootDirectory || '').trim();
      const buildPath = rootDir ? (rootDir.startsWith('/') ? rootDir : `/${rootDir}`) : '/';
      const buildCmd = (body.buildCommand || '').trim();
      const publishDir = (body.publishDirectory || '').trim() || (buildCmd ? 'dist' : '.');
      const includedPaths = Array.isArray(body.includedPaths) ? body.includedPaths.filter(Boolean) : [];

      // 1. Create Dokploy application (optionally pinned to a Remote Server region)
      const created = await dokploy('/api/application.create', {
        method: 'POST',
        body: JSON.stringify({
          name: rawName,
          appName: safeSlug,
          environmentId: envId,
          ...(body.serverId ? { serverId: body.serverId } : {}),
        }),
      });
      const applicationId = created.applicationId;

      // 2. Configure Git repository, branch, root directory, and watch paths
      await dokploy('/api/application.saveGitProvider', {
        method: 'POST',
        body: JSON.stringify({
          applicationId,
          customGitUrl: gitUrl,
          customGitBranch: branch,
          customGitBuildPath: buildPath,
          watchPaths: includedPaths.length > 0 ? includedPaths : null,
        }),
      });

      // 3. Configure static / nixpacks build with publishDirectory + SPA routing
      await dokploy('/api/application.saveBuildType', {
        method: 'POST',
        body: JSON.stringify({
          applicationId,
          buildType: buildCmd ? 'nixpacks' : 'static',
          dockerfile: null,
          dockerContextPath: null,
          dockerBuildStage: null,
          herokuVersion: null,
          railpackVersion: null,
          publishDirectory: publishDir,
          isStaticSpa: true,
        }),
      });

      // 4. Configure Auto-Deploy setting
      try {
        await dokploy('/api/application.update', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            autoDeploy: body.autoDeploy !== false,
          }),
        });
      } catch {}

      // 5. Save Environment Variables (plus NIXPACKS_BUILD_CMD if custom buildCommand given)
      const envLines = [];
      if (Array.isArray(body.env)) {
        for (const item of body.env) {
          if (item?.key && item.key.trim()) envLines.push(`${item.key.trim()}=${item.value ?? ''}`);
        }
      } else if (body.env && typeof body.env === 'object') {
        for (const [k, v] of Object.entries(body.env)) {
          if (k && k.trim()) envLines.push(`${k.trim()}=${v ?? ''}`);
        }
      }
      if (buildCmd && !envLines.some((l) => l.startsWith('NIXPACKS_BUILD_CMD='))) {
        envLines.push(`NIXPACKS_BUILD_CMD=${buildCmd}`);
      }
      if (envLines.length > 0) {
        await dokploy('/api/application.saveEnvironment', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            env: envLines.join('\n'),
            buildArgs: null,
            buildSecrets: null,
            createEnvFile: true,
          }),
        });
      }

      // 6. Attach automatic HTTPS domain (<slug>.apps.iecloudbase.com)
      const host = `${safeSlug}.${DOKPLOY_APPS_DOMAIN}`;
      await dokploy('/api/domain.create', {
        method: 'POST',
        body: JSON.stringify({
          applicationId,
          host,
          port: 80,
          https: true,
          certificateType: 'letsencrypt',
          domainType: 'application',
        }),
      });

      // 7. Trigger deployment
      await dokploy('/api/application.deploy', {
        method: 'POST',
        body: JSON.stringify({ applicationId }),
      });

      return sendJson(res, 201, {
        site: {
          id: applicationId,
          name: rawName,
          url: `https://${host}`,
          branch,
          publishDirectory: publishDir,
        },
      });
    }

    const REG_CREDS_PATH = path.join(__dirname, '.registry-creds.json');
    const REGISTRY_URLS = {
      github: 'ghcr.io',
      gitlab: 'registry.gitlab.com',
      docker: 'docker.io',
      'google-artifact': 'gcr.io',
      'aws-ecr': 'amazonaws.com',
    };
    const readRegCreds = () => {
      try { return fs.existsSync(REG_CREDS_PATH) ? JSON.parse(fs.readFileSync(REG_CREDS_PATH, 'utf-8')) : []; } catch { return []; }
    };
    const writeRegCreds = (arr) => fs.writeFileSync(REG_CREDS_PATH, JSON.stringify(arr, null, 2), 'utf-8');

    if (req.method === 'GET' && pathname === '/paas/registry-credentials') {
      const list = readRegCreds().map((c) => ({
        id: c.id,
        name: c.name,
        registry: c.registry,
        registryLabel: c.registryLabel,
        registryUrl: c.registryUrl,
        username: c.username,
        createdAt: c.createdAt,
      }));
      return sendJson(res, 200, { credentials: list });
    }

    if (req.method === 'POST' && pathname === '/paas/registry-credentials') {
      const body = await readBody(req);
      const name = (body.name || '').trim();
      const registry = (body.registry || '').trim().toLowerCase();
      const username = (body.username || '').trim();
      const token = (body.token || '').trim();
      if (!name || !registry || !username || !token) {
        return sendJson(res, 400, { error: 'Name, Registry, Username, and Personal Access Token are required' });
      }
      const labels = {
        github: 'GitHub',
        gitlab: 'GitLab',
        docker: 'Docker',
        'google-artifact': 'Google Artifact',
        'aws-ecr': 'AWS ECR',
      };
      const entry = {
        id: 'reg_' + Math.random().toString(36).slice(2, 11),
        name,
        registry,
        registryLabel: labels[registry] || registry,
        registryUrl: (body.registryUrl || '').trim() || REGISTRY_URLS[registry] || null,
        username,
        token,
        createdAt: new Date().toISOString(),
      };
      const all = readRegCreds();
      all.push(entry);
      writeRegCreds(all);
      return sendJson(res, 201, {
        credential: {
          id: entry.id,
          name: entry.name,
          registry: entry.registry,
          registryLabel: entry.registryLabel,
          registryUrl: entry.registryUrl,
          username: entry.username,
          createdAt: entry.createdAt,
        },
      });
    }

    const regCredDel = pathname.match(/^\/paas\/registry-credentials\/([^/]+)$/);
    if (regCredDel && req.method === 'DELETE') {
      const id = decodeURIComponent(regCredDel[1]);
      writeRegCreds(readRegCreds().filter((c) => c.id !== id));
      return sendJson(res, 200, { deleted: true });
    }

    if (req.method === 'GET' && pathname === '/paas/regions') {
      let remoteServers = [];
      try {
        const srvs = await dokploy('/api/server.all');
        if (Array.isArray(srvs)) remoteServers = srvs;
      } catch {}
      const regions = [
        { id: 'eu-north-1', label: 'Stockholm', location: 'EU North', serverId: null, active: true },
        ...remoteServers.map((s) => ({
          id: s.serverId,
          label: s.name || s.ipAddress,
          location: s.description || s.ipAddress || 'Remote Server',
          serverId: s.serverId,
          active: true,
        })),
        { id: 'eu-central-1', label: 'Frankfurt', location: 'EU Central', serverId: null, active: false },
        { id: 'us-east-2', label: 'Ohio', location: 'US East', serverId: null, active: false },
        { id: 'us-west-2', label: 'Oregon', location: 'US West', serverId: null, active: false },
        { id: 'ap-southeast-1', label: 'Singapore', location: 'Southeast Asia', serverId: null, active: false },
        { id: 'us-east-1', label: 'Virginia', location: 'US East', serverId: null, active: false },
      ];
      return sendJson(res, 200, { regions });
    }

    if (req.method === 'POST' && pathname === '/paas/web-services') {
      const body = await readBody(req);
      const rawName = (body.name || '').trim();
      const safeSlug = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!safeSlug) return sendJson(res, 400, { error: 'Valid web service name is required' });

      const projects = await dokploy('/api/project.all');
      const targetProj = (projects || []).find((p) => p.projectId === body.projectId) || (projects || []).find((p) => p.name.toLowerCase() === 'iecloudbase') || projects?.[0];
      const envId = targetProj?.environments?.[0]?.environmentId;
      if (!envId) return sendJson(res, 400, { error: 'No project environment found' });

      const sourceMode = (body.sourceMode || 'git').toLowerCase(); // 'git' | 'image'
      const language = (body.language || 'Node').trim();
      const branch = (body.branch || 'main').trim();
      const rootDir = (body.rootDirectory || '').trim();
      const buildPath = rootDir ? (rootDir.startsWith('/') ? rootDir : `/${rootDir}`) : '/';
      const buildCmd = (body.buildCommand || '').trim();
      const startCmd = (body.startCommand || '').trim();
      const includedPaths = Array.isArray(body.includedPaths) ? body.includedPaths.filter(Boolean) : [];

      // 1. Create Dokploy application (optionally pinned to a Remote Server region)
      const created = await dokploy('/api/application.create', {
        method: 'POST',
        body: JSON.stringify({
          name: rawName,
          appName: safeSlug,
          environmentId: envId,
          ...(body.serverId ? { serverId: body.serverId } : {}),
        }),
      });
      const applicationId = created.applicationId;

      // 2. Configure Source (Existing Image OR Git Repo)
      if (sourceMode === 'image') {
        const dockerImage = (body.imageUrl || '').trim();
        if (!dockerImage) return sendJson(res, 400, { error: 'Docker Image URL is required' });
        let regUser = body.registryUser || null;
        let regPass = body.registryPass || null;
        let regUrl = body.registryUrl || null;
        if (body.credentialId) {
          const saved = readRegCreds().find((c) => c.id === body.credentialId);
          if (saved) {
            regUser = saved.username;
            regPass = saved.token;
            regUrl = saved.registryUrl || null;
          }
        }
        await dokploy('/api/application.saveDockerProvider', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            dockerImage,
            username: regUser,
            password: regPass,
            registryUrl: regUrl,
          }),
        });
      } else {
        const repoInput = (body.repoUrl || body.repo || '').trim();
        if (!repoInput) return sendJson(res, 400, { error: 'A Git repository is required' });
        const gitUrl = repoInput.startsWith('http')
          ? (repoInput.endsWith('.git') ? repoInput : `${repoInput.replace(/\/+$/, '')}.git`)
          : `https://github.com/${parseRepoSlug(repoInput) || repoInput}.git`;

        await dokploy('/api/application.saveGitProvider', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            customGitUrl: gitUrl,
            customGitBranch: branch,
            customGitBuildPath: buildPath,
            watchPaths: includedPaths.length > 0 ? includedPaths : null,
          }),
        });

        if (language.toLowerCase() === 'docker') {
          await dokploy('/api/application.saveBuildType', {
            method: 'POST',
            body: JSON.stringify({
              applicationId,
              buildType: 'dockerfile',
              dockerfile: (body.dockerfilePath || './Dockerfile').trim(),
              dockerContextPath: rootDir || '.',
              dockerBuildStage: '',
              herokuVersion: null,
              railpackVersion: null,
            }),
          });
        } else {
          await dokploy('/api/application.saveBuildType', {
            method: 'POST',
            body: JSON.stringify({
              applicationId,
              buildType: 'nixpacks',
              dockerfile: null,
              dockerContextPath: null,
              dockerBuildStage: null,
              herokuVersion: null,
              railpackVersion: null,
            }),
          });
        }
      }

      // 3. Auto-deploy & optional command
      try {
        await dokploy('/api/application.update', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            autoDeploy: body.autoDeploy !== false,
            ...(startCmd && sourceMode === 'image' ? { command: startCmd } : {}),
          }),
        });
      } catch {}

      // 4. Environment variables & container port
      const envLines = [];
      let port = parseInt(body.containerPort || (sourceMode === 'image' ? '80' : '3000'), 10);
      if (Number.isNaN(port) || port <= 0) port = 3000;
      let hasPortEnv = false;

      if (Array.isArray(body.env)) {
        for (const item of body.env) {
          if (item?.key && item.key.trim()) {
            const k = item.key.trim();
            const v = String(item.value ?? '');
            if (k.toUpperCase() === 'PORT') {
              hasPortEnv = true;
              const p = parseInt(v, 10);
              if (!Number.isNaN(p) && p > 0) port = p;
            }
            envLines.push(`${k}=${v}`);
          }
        }
      }
      if (!hasPortEnv && sourceMode !== 'image') envLines.push(`PORT=${port}`);
      if (buildCmd && sourceMode !== 'image' && language.toLowerCase() !== 'docker' && !envLines.some((l) => l.startsWith('NIXPACKS_BUILD_CMD='))) {
        envLines.push(`NIXPACKS_BUILD_CMD=${buildCmd}`);
      }
      if (startCmd && sourceMode !== 'image' && language.toLowerCase() !== 'docker' && !envLines.some((l) => l.startsWith('NIXPACKS_START_CMD='))) {
        envLines.push(`NIXPACKS_START_CMD=${startCmd}`);
      }
      if (envLines.length > 0) {
        await dokploy('/api/application.saveEnvironment', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            env: envLines.join('\n'),
            buildArgs: null,
            buildSecrets: null,
            createEnvFile: true,
          }),
        });
      }

      // 4B. Mount Persistent Disk (Docker volume) if attached
      if (body.disk && body.disk.mountPath && body.disk.mountPath.trim() && body.disk.mountPath.trim() !== '/') {
        try {
          await dokploy('/api/mounts.create', {
            method: 'POST',
            body: JSON.stringify({
              type: 'volume',
              volumeName: `${safeSlug}-disk`,
              mountPath: body.disk.mountPath.trim(),
              serviceType: 'application',
              serviceId: applicationId,
            }),
          });
        } catch {}
      }

      // 4C. Mount Secret Files at /etc/secrets/<filename>
      if (Array.isArray(body.secretFiles)) {
        for (const sf of body.secretFiles) {
          if (!sf?.name || !sf.name.trim()) continue;
          try {
            await dokploy('/api/mounts.create', {
              method: 'POST',
              body: JSON.stringify({
                type: 'file',
                mountPath: '/etc/secrets',
                filePath: sf.name.trim(),
                content: String(sf.content ?? ''),
                serviceType: 'application',
                serviceId: applicationId,
              }),
            });
          } catch {}
        }
      }

      // 5. Attach automatic HTTPS domain (<slug>.apps.iecloudbase.com)
      const isPrivate = (body.serviceKind || 'web') === 'private';
      const host = `${safeSlug}.${DOKPLOY_APPS_DOMAIN}`;
      await dokploy('/api/domain.create', {
        method: 'POST',
        body: JSON.stringify({
          applicationId,
          host,
          port,
          https: true,
          certificateType: 'letsencrypt',
          domainType: 'application',
        }),
      });

      // 6. Trigger deployment
      await dokploy('/api/application.deploy', {
        method: 'POST',
        body: JSON.stringify({ applicationId }),
      });

      return sendJson(res, 201, {
        service: {
          id: applicationId,
          name: rawName,
          url: `https://${host}`,
          port,
          sourceMode,
          serviceKind: isPrivate ? 'private' : 'web',
          requiresLock: isPrivate,
        },
      });
    }

    const paasPrivLock = pathname.match(/^\/paas\/services\/private\/([^/]+)\/lock$/);
    if (paasPrivLock && req.method === 'POST') {
      const applicationId = decodeURIComponent(paasPrivLock[1]);
      const body = await readBody(req);
      const username = (body.username || 'admin').trim();
      const password = String(body.password || '');
      if (password.length < 4) {
        return sendJson(res, 400, { error: 'Password must be at least 4 characters' });
      }
      // 1. Store scrypt-hashed lock record locally
      const { salt, hash } = hashLockPassword(password);
      const locks = readPrivateLocks();
      locks[applicationId] = {
        locked: true,
        username,
        salt,
        hash,
        lockedAt: new Date().toISOString(),
      };
      writePrivateLocks(locks);

      // 2. Configure Traefik dynamic router to route through iecloudbase-auth-gate:8099 (HTML Authorization Password Gate)
      const one = await dokploy(`/api/application.one?applicationId=${encodeURIComponent(applicationId)}`);
      const appName = one.appName;
      const dom = (one.domains || [])[0];
      const host = dom?.host || `${(appName || one.name).toLowerCase().replace(/[^a-z0-9-]/g, '-')}.${DOKPLOY_APPS_DOMAIN}`;
      const port = dom?.port || 3000;
      const keyNum = dom?.uniqueConfigKey || 1;
      const mwName = `ie-gate-${appName}`;
      const traefikYaml = [
        'http:',
        '  middlewares:',
        `    ${mwName}:`,
        '      headers:',
        '        customRequestHeaders:',
        `          X-IE-Target: "http://${appName}:${port}"`,
        `          X-IE-Name: "${(one.name || appName).replace(/"/g, '')}"`,
        `          X-IE-Salt: "${salt}"`,
        `          X-IE-Hash: "${hash}"`,
        '  routers:',
        `    ${appName}-router-${keyNum}:`,
        `      rule: Host(\`${host}\`)`,
        `      service: ${appName}-service-${keyNum}`,
        '      middlewares:',
        '        - redirect-to-https',
        `        - ${mwName}`,
        '      entryPoints:',
        '        - web',
        `    ${appName}-router-websecure-${keyNum}:`,
        `      rule: Host(\`${host}\`)`,
        `      service: ${appName}-service-${keyNum}`,
        '      middlewares:',
        `        - ${mwName}`,
        '      entryPoints:',
        '        - websecure',
        '      tls:',
        '        certResolver: letsencrypt',
        '  services:',
        `    ${appName}-service-${keyNum}:`,
        '      loadBalancer:',
        '        servers:',
        '          - url: http://iecloudbase-auth-gate:8099',
        '        passHostHeader: true',
        '',
      ].join('\n');
      await dokploy('/api/application.updateTraefikConfig', {
        method: 'POST',
        body: JSON.stringify({ applicationId, traefikConfig: traefikYaml }),
      });

      return sendJson(res, 200, { locked: true, applicationId, username });
    }

    const paasPrivUnlock = pathname.match(/^\/paas\/services\/private\/([^/]+)\/unlock$/);
    if (paasPrivUnlock && req.method === 'POST') {
      const applicationId = decodeURIComponent(paasPrivUnlock[1]);
      const body = await readBody(req);
      const password = String(body.password || '');
      const locks = readPrivateLocks();
      const rec = locks[applicationId];
      if (!rec || !rec.locked) return sendJson(res, 200, { unlocked: true });
      if (!verifyLockPassword(password, rec.salt, rec.hash)) {
        return sendJson(res, 401, { error: 'Incorrect password. Access denied.' });
      }
      return sendJson(res, 200, { unlocked: true, username: rec.username });
    }

    if (req.method === 'GET' && pathname === '/paas/apps') {
      const projects = await dokploy('/api/project.all');
      const apps = [];
      for (const proj of projects || []) {
        for (const env of proj.environments || []) {
          for (const app of env.applications || []) {
            let domainUrl = `https://${(app.appName || app.name).toLowerCase().replace(/[^a-z0-9-]/g, '-')}.${DOKPLOY_APPS_DOMAIN}`;
            let port = 80;
            try {
              const doms = await dokploy(`/api/domain.byApplicationId?applicationId=${encodeURIComponent(app.applicationId)}`);
              if (Array.isArray(doms) && doms.length > 0) {
                const d = doms[0];
                domainUrl = `${d.https ? 'https' : 'http'}://${d.host}`;
                port = d.port || 80;
              }
            } catch {}
            apps.push({
              id: app.applicationId,
              name: app.name,
              project: proj.name,
              url: domainUrl,
              source: app.sourceType || 'docker',
              image: app.dockerImage || app.customGitUrl || '',
              containerPort: port,
              status: app.applicationStatus || 'idle',
            });
          }
          for (const cmp of env.compose || []) {
            apps.push({
              id: cmp.composeId,
              name: cmp.name,
              project: proj.name,
              url: `https://${(cmp.appName || cmp.name).toLowerCase().replace(/[^a-z0-9-]/g, '-')}.${DOKPLOY_APPS_DOMAIN}`,
              source: 'blueprint',
              image: 'Compose Blueprint',
              containerPort: 80,
              status: cmp.composeStatus || 'idle',
            });
          }
        }
      }
      return sendJson(res, 200, { apps });
    }

    if (req.method === 'POST' && pathname === '/paas/apps') {
      const body = await readBody(req);
      const rawName = (body.name || '').trim();
      const safeSlug = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!safeSlug) return sendJson(res, 400, { error: 'Valid service name is required' });

      const projects = await dokploy('/api/project.all');
      const targetProj = (projects || []).find((p) => p.projectId === body.projectId) || (projects || []).find((p) => p.name.toLowerCase() === 'iecloudbase') || projects?.[0];
      const envId = targetProj?.environments?.[0]?.environmentId;
      if (!envId) return sendJson(res, 400, { error: 'No Dokploy project/environment found' });

      const containerPort = parseInt(body.containerPort || '80', 10);
      const host = `${safeSlug}.${DOKPLOY_APPS_DOMAIN}`;

      if (body.source === 'blueprint') {
        const cmp = await dokploy('/api/compose.create', {
          method: 'POST',
          body: JSON.stringify({
            name: rawName,
            appName: safeSlug,
            environmentId: envId,
            composeType: 'docker-compose',
          }),
        });
        if (body.blueprintYaml) {
          await dokploy('/api/compose.update', {
            method: 'POST',
            body: JSON.stringify({ composeId: cmp.composeId, composeFile: body.blueprintYaml }),
          });
        }
        await dokploy('/api/compose.deploy', {
          method: 'POST',
          body: JSON.stringify({ composeId: cmp.composeId }),
        });
        return sendJson(res, 201, { app: { id: cmp.composeId, name: rawName, url: `https://${host}` } });
      }

      // 1. Create Dokploy application (optionally pinned to a Remote Server region)
      const created = await dokploy('/api/application.create', {
        method: 'POST',
        body: JSON.stringify({
          name: rawName,
          appName: safeSlug,
          environmentId: envId,
          ...(body.serverId ? { serverId: body.serverId } : {}),
        }),
      });
      const applicationId = created.applicationId;

      // 2. Configure source (Docker Image or Git Repo)
      if (body.source === 'git') {
        await dokploy('/api/application.saveGitProvider', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            customGitUrl: body.repoUrl,
            customGitBranch: body.branch || 'main',
            customGitBuildPath: '/',
            watchPaths: null,
          }),
        });
      } else {
        await dokploy('/api/application.saveDockerProvider', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            dockerImage: body.image || 'nginxdemos/hello',
            username: body.registryUser || null,
            password: body.registryPass || null,
            registryUrl: body.registryUrl || null,
          }),
        });
      }

      // 3. Save environment variables if provided
      const envEntries = Object.entries(body.env || {});
      if (envEntries.length > 0) {
        const envText = envEntries.map(([k, v]) => `${k}=${v}`).join('\n');
        await dokploy('/api/application.saveEnvironment', {
          method: 'POST',
          body: JSON.stringify({
            applicationId,
            env: envText,
            buildArgs: null,
            buildSecrets: null,
            createEnvFile: true,
          }),
        });
      }

      // 4. Create automatic HTTPS domain (<slug>.apps.iecloudbase.com)
      await dokploy('/api/domain.create', {
        method: 'POST',
        body: JSON.stringify({
          applicationId,
          host,
          port: containerPort,
          https: true,
          certificateType: 'letsencrypt',
          domainType: 'application',
        }),
      });

      // 5. Trigger deployment
      await dokploy('/api/application.deploy', {
        method: 'POST',
        body: JSON.stringify({ applicationId }),
      });

      return sendJson(res, 201, { app: { id: applicationId, name: rawName, url: `https://${host}` } });
    }

    const paasRedeployMatch = pathname.match(/^\/paas\/apps\/([^/]+)\/redeploy$/);
    if (paasRedeployMatch && req.method === 'POST') {
      const id = decodeURIComponent(paasRedeployMatch[1]);
      await dokploy('/api/application.deploy', { method: 'POST', body: JSON.stringify({ applicationId: id }) });
      return sendJson(res, 200, { deployed: true });
    }

    const paasDelMatch = pathname.match(/^\/paas\/apps\/([^/]+)$/);
    if (paasDelMatch && req.method === 'DELETE') {
      const id = decodeURIComponent(paasDelMatch[1]);
      await dokploy('/api/application.delete', { method: 'POST', body: JSON.stringify({ applicationId: id }) });
      return sendJson(res, 200, { deleted: true });
    }

    if (tryServeStatic(req, res, pathname)) return;
    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message, details: e.data || null });
  }
});

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || '';
let dbPool = null;
if (DATABASE_URL) {
  dbPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });
  dbPool.query(
    'CREATE TABLE IF NOT EXISTS iecloudbase_kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())'
  ).then(() => {
    console.log('Connected to PostgreSQL database (iecloudbase_kv ready)');
  }).catch((err) => {
    console.error('PostgreSQL init warning:', err.message);
  });
}

const DIST_DIR = path.resolve(__dirname, '../playground/dist');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function tryServeStatic(req, res, pathname) {
  if (req.method !== 'GET' || !fs.existsSync(DIST_DIR)) return false;
  const apiPrefixes = ['/healthz', '/reseller/', '/mail/', '/webmail/', '/paas/', '/sandbox-proxy'];
  if (apiPrefixes.some((p) => pathname === p || pathname.startsWith(p))) return false;
  let relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.join(DIST_DIR, relPath);
  if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

server.listen(PORT, () => {
  console.log(`ieCloudBase Reseller API (${API_BASE}) listening on http://localhost:${PORT}`);
});
