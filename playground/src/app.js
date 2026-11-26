import './sdk-browser-setup.js';
import { SandboxClient } from '@n8n/sandbox-client';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const EYE_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.77 21.77 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a21.77 21.77 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// --- DOM refs ---
const SANDBOX_BASE_URL = 'https://sandbox.iecloudbase.com';
const SANDBOX_ENV_KEY = 'env-managed';
const connDot = $('#conn-dot');
const statusEl = $('#status');
const topbarPageTitle = $('#topbar-page-title');
const navSandboxCount = $('#nav-sandbox-count');

// Sandboxes view
const sandboxesTbody = $('#sandboxes-tbody');
const tableCountLabel = $('#table-count-label');
const sandboxSearchInput = $('#sandbox-search');
const sidebarSearchInput = $('#sidebar-search-input');
const filterStatusSelect = $('#filter-status');
const filterEgressSelect = $('#filter-egress');
const refreshBtn = $('#refresh-btn');

// Create drawer
const createDrawerBackdrop = $('#create-drawer-backdrop');
const openCreateDrawerBtn = $('#open-create-drawer-btn');
const closeDrawerBtn = $('#close-drawer-btn');
const drawerCancelBtn = $('#drawer-cancel-btn');
const drawerSubmitBtn = $('#drawer-submit-btn');
const drawerSandboxNameInput = $('#drawer-sandbox-name');
const drawerSourceButtons = $$('#drawer-source-toggle .seg-btn');
const sourceSnapshotFields = $('#source-snapshot-fields');
const sourceImageFields = $('#source-image-fields');
const drawerSnapshotSelect = $('#drawer-snapshot-select');
const drawerImageInput = $('#drawer-image-input');
const drawerVcpuInput = $('#drawer-vcpu');
const drawerMemoryInput = $('#drawer-memory');
const drawerStorageInput = $('#drawer-storage');
const drawerGpusInput = $('#drawer-gpus');
const gpuMinusBtn = $('#gpu-minus-btn');
const gpuPlusBtn = $('#gpu-plus-btn');
const drawerRegionSelect = $('#drawer-region-select');
const drawerAutoStopInput = $('#drawer-auto-stop');
const drawerAutoArchiveInput = $('#drawer-auto-archive');
const drawerAutoDeleteInput = $('#drawer-auto-delete');
const drawerEphemeralCheckbox = $('#drawer-ephemeral');
const envVarsList = $('#env-vars-list');
const addEnvBtn = $('#add-env-btn');
const envFileInput = $('#env-file-input');
const importEnvTrigger = $('#import-env-trigger');
const labelsList = $('#labels-list');
const addLabelBtn = $('#add-label-btn');
const drawerPublicPreviewCheckbox = $('#drawer-public-preview');
const drawerBlockNetworkCheckbox = $('#drawer-block-network');

// Playground view
const playgroundSandboxSelect = $('#playground-sandbox-select');
const backToSandboxesBtn = $('#back-to-sandboxes-btn');
const createBtn = $('#create-btn');
const output = $('#output');
const cmdInput = $('#cmd-input');
const inlinePromptRow = $('#inline-prompt-row');

// --- State ---
let allSandboxes = [];
let selectedSandboxId = null;
let drawerSource = 'snapshot';
let sandboxMetaMap = JSON.parse(localStorage.getItem('iesandbox-meta') || '{}');
let pausedSandboxes = new Set(JSON.parse(localStorage.getItem('iesandbox-paused') || '[]'));
let currentCwd = '/home/user';
let commandHistory = [];
let historyIndex = -1;
let currentAbortController = null;
let client = null;

const VIEW_TITLES = {
  sandboxes: 'Sandboxes',
  apps: 'App Hosting',
  details: 'Sandbox Details',
  playground: 'Playground',
  domains: 'Domains & Routes',
  reseller: 'Search Domains',
  email: 'Email Hosting',
  webmail: 'Webmail Inbox',
  apikeys: 'API Keys',
  snapshots: 'Snapshots',
};

// Details view refs
const detailsCloseBtn = $('#details-close-btn');
const detName = $('#det-name');
const detUuid = $('#det-uuid');
const detStatusBadge = $('#det-status-badge');
const detStartStopBtn = $('#det-start-stop-btn');
const detDeleteBtn = $('#det-delete-btn');
const detRegion = $('#det-region');
const detSnapshot = $('#det-snapshot');
const detPreview = $('#det-preview');
const detEgress = $('#det-egress');
const detResources = $('#det-resources');
const detAutostop = $('#det-autostop');
const detAutoarchive = $('#det-autoarchive');
const detAutodelete = $('#det-autodelete');
const detTerminalStopped = $('#det-terminal-stopped');
const detTerminalRunning = $('#det-terminal-running');
const detEmptyStartBtn = $('#det-empty-start-btn');
const promptLabel = $('#prompt-label');
const rowActionDropdown = $('#row-action-dropdown');
const menuToggleStateBtn = $('#menu-toggle-state');
let dropdownSandbox = null;

// --- Navigation ---
function switchView(viewName) {
  $$('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });
  $$('.view-container').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });
  topbarPageTitle.textContent = VIEW_TITLES[viewName] || 'ieCloudbase';
  if (viewName === 'playground' && selectedSandboxId) {
    cmdInput.focus();
  } else if (viewName === 'apikeys') {
    refreshApiKeys();
  } else if (viewName === 'domains') {
    renderDomainsTable();
  } else if (viewName === 'reseller') {
    // Ready for search or domain listing
  } else if (viewName === 'email') {
    loadMailboxesFromServer();
  } else if (viewName === 'apps') {
    loadHostedApps();
  }
}

$$('.nav-item').forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

const sidebarEl = $('#sidebar');
const sidebarToggleBtn = $('#sidebar-toggle-btn');
if (sidebarEl && localStorage.getItem('iecloudbase-sidebar-collapsed') === '1') {
  sidebarEl.classList.add('collapsed');
}
sidebarToggleBtn?.addEventListener('click', () => {
  if (!sidebarEl) return;
  const collapsed = sidebarEl.classList.toggle('collapsed');
  localStorage.setItem('iecloudbase-sidebar-collapsed', collapsed ? '1' : '0');
});

backToSandboxesBtn.addEventListener('click', () => switchView('sandboxes'));

// Ctrl+K quick search
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    switchView('sandboxes');
    sandboxSearchInput.focus();
  }
});

sidebarSearchInput.addEventListener('input', () => {
  sandboxSearchInput.value = sidebarSearchInput.value;
  switchView('sandboxes');
  renderSandboxesTable();
});

// --- SDK Client ---
function getClient() {
  if (!client || client._baseUrl !== SANDBOX_BASE_URL || client._apiKey !== SANDBOX_ENV_KEY) {
    client = new SandboxClient({ baseUrl: SANDBOX_BASE_URL, apiKey: SANDBOX_ENV_KEY });
    client._baseUrl = SANDBOX_BASE_URL;
    client._apiKey = SANDBOX_ENV_KEY;
  }
  return client;
}

// --- Persistence ---
function loadSettings() {
  refreshSandboxes();
}

// --- Helpers ---
function setStatus(msg, state = null, updateSandboxConn = false) {
  statusEl.textContent = msg;
  if (updateSandboxConn && connDot) {
    if (state === 'connected') {
      connDot.textContent = 'Connected';
      connDot.className = 'badge badge-running conn-dot connected';
    } else if (state === 'error') {
      connDot.textContent = 'Reconnecting...';
      connDot.className = 'badge badge-neutral conn-dot';
    }
  }
}

function isSandboxRunning(sb) {
  if (!sb || pausedSandboxes.has(sb.id)) return false;
  const s = (sb.status || '').toLowerCase();
  return s === 'running' || s === 'ready';
}

function savePausedState() {
  localStorage.setItem('iesandbox-paused', JSON.stringify([...pausedSandboxes]));
}

function formatRelativeTime(unixSeconds) {
  if (!unixSeconds) return '—';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function copyText(text, btn) {
  navigator.clipboard?.writeText(text);
  const prev = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = prev; }, 1200);
}

// --- Sandboxes List & Table ---
async function refreshSandboxes() {
  try {
    setStatus('Loading sandboxes...');
    const res = await fetch(`${SANDBOX_BASE_URL}/sandboxes`, {
      headers: { 'X-Api-Key': SANDBOX_ENV_KEY },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    allSandboxes = Array.isArray(data) ? data : [];
    navSandboxCount.textContent = allSandboxes.length;
    renderSandboxesTable();
    renderPlaygroundSelect();
    setStatus(`Connected · ${allSandboxes.length} sandbox(es)`, 'connected', true);
  } catch (e) {
    setStatus(`Error: ${e.message}`, 'error', true);
    renderEmptyTable('Connection failed', e.message);
  }
}

function getFilteredSandboxes() {
  const q = sandboxSearchInput.value.trim().toLowerCase();
  const statusFilter = filterStatusSelect.value;
  const egressFilter = filterEgressSelect.value;

  return allSandboxes.filter((sb) => {
    const id = (sb.id || '').toLowerCase();
    const tenant = (sb.tenant_id || sb.tenantId || '__admin__').toLowerCase();
    const status = (sb.status || '').toLowerCase();
    const egress = (sb.egress || 'public').toLowerCase();

    if (q && !id.includes(q) && !tenant.includes(q)) return false;
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (egressFilter !== 'all' && egress !== egressFilter) return false;
    return true;
  });
}

function renderEmptyTable(title, message, showCreate = false) {
  sandboxesTbody.innerHTML = `
    <tr>
      <td colspan="8">
        <div class="empty-box">
          <h3>${title}</h3>
          <p>${message}</p>
          ${showCreate ? '<button class="btn btn-primary" id="empty-create-btn">+ Create Sandbox</button>' : ''}
        </div>
      </td>
    </tr>
  `;
  const emptyCreate = $('#empty-create-btn');
  if (emptyCreate) {
    emptyCreate.addEventListener('click', openCreateDrawer);
  }
}

function renderSandboxesTable() {
  const filtered = getFilteredSandboxes();
  tableCountLabel.textContent = `${filtered.length} of ${allSandboxes.length} sandbox(es)`;

  if (allSandboxes.length === 0) {
    renderEmptyTable(
      'No sandboxes yet',
      'Create your first isolated ieSandbox environment to run code and manage files.',
      true,
    );
    return;
  }

  if (filtered.length === 0) {
    renderEmptyTable('No matching sandboxes', 'Try clearing your search or filters.');
    return;
  }

  sandboxesTbody.innerHTML = '';
  filtered.forEach((sb) => {
    const tr = document.createElement('tr');
    const meta = sandboxMetaMap[sb.id] || {};
    const displayName = meta.name || sb.id;
    const isRunning = isSandboxRunning(sb);
    const status = isRunning ? 'running' : 'stopped';
    const egress = sb.egress || 'public';
    const snapshotLabel = meta.snapshot || 'iesandbox/sandbox:latest';
    const regionLabel = meta.region || 'eu';
    const vcpu = meta.vcpu || 1;
    const memory = meta.memory || 1;
    const storage = meta.storage || 3;
    const createdAt = sb.created_at ?? sb.createdAt;
    const lastActiveAt = sb.last_active_at ?? sb.lastActiveAt;

    // Name / ID cell
    const tdName = document.createElement('td');
    const idWrap = document.createElement('div');
    idWrap.className = 'mono-id';
    const idText = document.createElement('span');
    idText.textContent = displayName;
    idText.title = sb.id;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => copyText(sb.id, copyBtn));
    idWrap.appendChild(idText);
    idWrap.appendChild(copyBtn);
    tdName.appendChild(idWrap);

    // State cell
    const tdStatus = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = `badge ${status === 'running' || status === 'ready' ? 'badge-running' : 'badge-stopped'}`;
    statusBadge.textContent = status;
    tdStatus.appendChild(statusBadge);
    if (egress === 'none') {
      const netBadge = document.createElement('span');
      netBadge.className = 'badge badge-neutral';
      netBadge.style.marginLeft = '6px';
      netBadge.textContent = 'no-net';
      tdStatus.appendChild(netBadge);
    }
    if (sb.ephemeral) {
      const ephBadge = document.createElement('span');
      ephBadge.className = 'badge badge-ephemeral';
      ephBadge.style.marginLeft = '6px';
      ephBadge.textContent = 'ephemeral';
      tdStatus.appendChild(ephBadge);
    }

    // Snapshot cell
    const tdSnap = document.createElement('td');
    tdSnap.style.fontFamily = 'var(--mono)';
    tdSnap.style.fontSize = '12px';
    tdSnap.style.color = 'var(--text-secondary)';
    tdSnap.textContent = snapshotLabel;

    // Region cell
    const tdRegion = document.createElement('td');
    tdRegion.style.color = 'var(--text-secondary)';
    tdRegion.textContent = regionLabel;

    // Resources cell
    const tdRes = document.createElement('td');
    tdRes.innerHTML = `<span class="res-pills"><span class="res-pill">${vcpu} vCPU</span><span class="res-pill">${memory} GiB</span><span class="res-pill">${storage} GiB</span></span>`;

    // Last Event
    const tdLast = document.createElement('td');
    tdLast.style.color = 'var(--text-secondary)';
    tdLast.textContent = formatRelativeTime(lastActiveAt);

    // Created
    const tdCreated = document.createElement('td');
    tdCreated.style.color = 'var(--text-secondary)';
    tdCreated.textContent = formatRelativeTime(createdAt);

    // Actions (3 buttons: Start/Stop, Terminal >_, Three-dots menu ...)
    const tdActions = document.createElement('td');
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'row-actions';

    const stateBtn = document.createElement('button');
    stateBtn.className = 'icon-btn';
    stateBtn.textContent = isRunning ? '□' : '▷';
    stateBtn.title = isRunning ? 'Stop Sandbox' : 'Start Sandbox';
    stateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSandboxState(sb);
    });

    const termBtn = document.createElement('button');
    termBtn.className = 'icon-btn';
    termBtn.textContent = '>_';
    termBtn.title = 'Open Terminal';
    termBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSandboxDetails(sb, 'terminal');
    });

    const moreBtn = document.createElement('button');
    moreBtn.className = 'icon-btn';
    moreBtn.textContent = '⋯';
    moreBtn.title = 'More actions';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowDropdown(sb, moreBtn);
    });

    actionsWrap.append(stateBtn, termBtn, moreBtn);
    tdActions.appendChild(actionsWrap);

    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => openSandboxDetails(sb, 'terminal'));

    tr.append(tdName, tdStatus, tdSnap, tdRegion, tdRes, tdLast, tdCreated, tdActions);
    sandboxesTbody.appendChild(tr);
  });
}

function renderPlaygroundSelect() {
  const prev = selectedSandboxId;
  playgroundSandboxSelect.innerHTML = '<option value="">Select a sandbox...</option>';
  allSandboxes.forEach((sb) => {
    const opt = document.createElement('option');
    opt.value = sb.id;
    opt.textContent = `${sb.id.slice(0, 16)} (${sb.status || 'unknown'})`;
    if (sb.id === prev) opt.selected = true;
    playgroundSandboxSelect.appendChild(opt);
  });
}

playgroundSandboxSelect.addEventListener('change', () => {
  const id = playgroundSandboxSelect.value;
  const sb = allSandboxes.find((s) => s.id === id);
  if (sb) openSandboxDetails(sb, 'terminal');
});

sandboxSearchInput.addEventListener('input', renderSandboxesTable);
filterStatusSelect.addEventListener('change', renderSandboxesTable);
filterEgressSelect.addEventListener('change', renderSandboxesTable);

// --- Sandbox Details & Start/Stop & Dropdown ---
function openRowDropdown(sb, anchorBtn) {
  dropdownSandbox = sb;
  const isRunning = isSandboxRunning(sb);
  menuToggleStateBtn.textContent = isRunning ? 'Stop' : 'Start';
  const rect = anchorBtn.getBoundingClientRect();
  rowActionDropdown.style.top = `${rect.bottom + 6}px`;
  rowActionDropdown.style.left = `${Math.max(8, rect.right - 190)}px`;
  rowActionDropdown.classList.add('open');
}

document.addEventListener('click', () => {
  rowActionDropdown.classList.remove('open');
});

rowActionDropdown.querySelectorAll('button[data-action]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    rowActionDropdown.classList.remove('open');
    if (!dropdownSandbox) return;
    const action = btn.dataset.action;
    if (action === 'toggle-state') toggleSandboxState(dropdownSandbox);
    else if (action === 'delete') deleteSandbox(dropdownSandbox.id);
    else setStatus(`${btn.textContent}: coming soon in ieSandbox`);
  });
});

async function toggleSandboxState(sb) {
  const isRunning = isSandboxRunning(sb);
  if (!isRunning) {
    try {
      setStatus(`Starting ${sb.id.slice(0, 12)}...`);
      pausedSandboxes.delete(sb.id);
      savePausedState();
      await getClient().exec(sb.id, { command: 'true', timeoutMs: 30000 });
      await refreshSandboxes();
      const updated = allSandboxes.find((s) => s.id === sb.id) || { ...sb, status: 'running' };
      if (selectedSandboxId === sb.id) openSandboxDetails(updated, 'terminal');
      setStatus(`Started: ${sb.id.slice(0, 12)}`, 'connected');
    } catch (e) {
      setStatus(`Start failed: ${e.message}`, 'error');
    }
  } else {
    pausedSandboxes.add(sb.id);
    savePausedState();
    renderSandboxesTable();
    if (selectedSandboxId === sb.id) {
      openSandboxDetails(sb, 'terminal');
    }
    setStatus(`Stopped: ${sb.id.slice(0, 12)}`);
  }
}

function switchDetailsTab(tabName) {
  $$('.details-tab').forEach((t) => t.classList.toggle('active', t.dataset.dtab === tabName));
  $$('.details-tab-pane').forEach((p) => p.classList.toggle('active', p.id === `dtab-${tabName}`));
  if (tabName === 'terminal' && !cmdInput.disabled) {
    setTimeout(() => cmdInput.focus(), 20);
  }
}

$$('.details-tab').forEach((t) => {
  t.addEventListener('click', () => switchDetailsTab(t.dataset.dtab));
});

detailsCloseBtn.addEventListener('click', () => switchView('sandboxes'));

function updatePromptLabel() {
  const shortCwd = currentCwd === '/home/user' ? '~' : currentCwd;
  promptLabel.textContent = `iesandbox:${shortCwd}$`;
}

function openSandboxDetails(sb, tab = 'terminal') {
  selectSandbox(sb);
  const meta = sandboxMetaMap[sb.id] || {};
  const isRunning = isSandboxRunning(sb);

  detName.textContent = meta.name || sb.id;
  detUuid.textContent = sb.id;
  detStatusBadge.className = `badge ${isRunning ? 'badge-running' : 'badge-stopped'}`;
  detStatusBadge.textContent = isRunning ? 'Started' : 'Stopped';
  detStartStopBtn.textContent = isRunning ? '□ Stop' : '▷ Start';
  detRegion.textContent = meta.region || 'eu';
  detSnapshot.textContent = meta.snapshot || 'iesandbox/sandbox:latest';
  detPreview.textContent = meta.publicPreview ? 'Public' : 'Private';
  detEgress.textContent = sb.egress || 'public';
  detResources.innerHTML = `<span class="res-pill">${meta.vcpu || 1} vCPU</span><span class="res-pill">${meta.memory || 1} GiB</span><span class="res-pill">${meta.storage || 3} GiB</span>`;
  detAutostop.textContent = `${meta.autoStop || 15}m`;
  detAutoarchive.textContent = `${meta.autoArchive || 10080}m`;
  detAutodelete.textContent = meta.autoDelete || 'Disabled';

  detTerminalStopped.style.display = isRunning ? 'none' : 'flex';
  detTerminalRunning.style.display = isRunning ? 'flex' : 'none';
  updatePromptLabel();

  switchDetailsTab(tab);
  switchView('details');
}

detStartStopBtn.addEventListener('click', () => {
  const sb = allSandboxes.find((s) => s.id === selectedSandboxId);
  if (sb) toggleSandboxState(sb);
});

detEmptyStartBtn.addEventListener('click', () => {
  const sb = allSandboxes.find((s) => s.id === selectedSandboxId);
  if (sb) toggleSandboxState(sb);
});

detDeleteBtn.addEventListener('click', async () => {
  if (!selectedSandboxId) return;
  await deleteSandbox(selectedSandboxId);
  switchView('sandboxes');
});

// --- Select Sandbox ---
function selectSandbox(sb) {
  if (selectedSandboxId !== sb.id) {
    currentCwd = '/home/user';
    output.innerHTML = '';
  }
  selectedSandboxId = sb.id;
  playgroundSandboxSelect.value = sb.id;
  const isRunning = isSandboxRunning(sb);
  cmdInput.disabled = !isRunning;
  updatePromptLabel();
  setStatus(`Selected: ${sb.id.slice(0, 12)}`, 'connected');
  if (isRunning) browseFiles('/');
}

// --- Create Sandbox Drawer ---
function openCreateDrawer() {
  createDrawerBackdrop.classList.add('open');
  drawerSandboxNameInput.focus();
}

function closeCreateDrawer() {
  createDrawerBackdrop.classList.remove('open');
}

openCreateDrawerBtn.addEventListener('click', openCreateDrawer);
closeDrawerBtn.addEventListener('click', closeCreateDrawer);
drawerCancelBtn.addEventListener('click', closeCreateDrawer);
createDrawerBackdrop.addEventListener('click', (e) => {
  if (e.target === createDrawerBackdrop) closeCreateDrawer();
});

// Source tabs (Snapshot / Image)
drawerSourceButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    drawerSource = btn.dataset.source;
    drawerSourceButtons.forEach((b) => b.classList.toggle('active', b === btn));
    sourceSnapshotFields.style.display = drawerSource === 'snapshot' ? 'block' : 'none';
    sourceImageFields.style.display = drawerSource === 'image' ? 'flex' : 'none';
  });
});

// GPU stepper
gpuMinusBtn.addEventListener('click', () => {
  const val = Math.max(0, parseInt(drawerGpusInput.value, 10) - 1);
  drawerGpusInput.value = String(val);
});

gpuPlusBtn.addEventListener('click', () => {
  const val = Math.min(8, parseInt(drawerGpusInput.value, 10) + 1);
  drawerGpusInput.value = String(val);
  if (val > 0) drawerEphemeralCheckbox.checked = true;
});

// Key-Value row helper (for Env Vars & Labels)
function addKvRow(container, keyVal = '', valVal = '', parseEnvOnPaste = false) {
  const row = document.createElement('div');
  row.className = 'kv-row';
  const kInput = document.createElement('input');
  kInput.type = 'text';
  kInput.className = 'input';
  kInput.placeholder = 'KEY';
  kInput.value = keyVal;

  const vInput = document.createElement('input');
  vInput.type = 'text';
  vInput.className = 'input';
  vInput.placeholder = 'VALUE';
  vInput.value = valVal;

  if (parseEnvOnPaste) {
    kInput.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') || '';
      if (text.includes('=') && text.includes('\n')) {
        e.preventDefault();
        row.remove();
        parseEnvText(text).forEach(([k, v]) => addKvRow(envVarsList, k, v, true));
      }
    });
  }

  const rmBtn = document.createElement('button');
  rmBtn.type = 'button';
  rmBtn.className = 'kv-remove';
  rmBtn.textContent = '×';
  rmBtn.addEventListener('click', () => row.remove());

  row.append(kInput, vInput, rmBtn);
  container.appendChild(row);
}

function parseEnvText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')];
    });
}

function collectKvRows(container) {
  const result = {};
  container.querySelectorAll('.kv-row').forEach((row) => {
    const inputs = row.querySelectorAll('input');
    const k = inputs[0]?.value.trim();
    const v = inputs[1]?.value ?? '';
    if (k) result[k] = v;
  });
  return result;
}

addEnvBtn.addEventListener('click', () => addKvRow(envVarsList, '', '', true));
addLabelBtn.addEventListener('click', () => addKvRow(labelsList));
importEnvTrigger.addEventListener('click', () => envFileInput.click());
envFileInput.addEventListener('change', async () => {
  const file = envFileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  parseEnvText(text).forEach(([k, v]) => addKvRow(envVarsList, k, v, true));
  envFileInput.value = '';
});

async function createSandboxFromOptions(options, meta = null) {
  setStatus('Creating sandbox...');
  appendOutput('Creating sandbox...', 'info');
  const t0 = performance.now();
  const sb = await getClient().createSandbox(options);
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

  if (meta) {
    sandboxMetaMap[sb.id] = meta;
    localStorage.setItem('iesandbox-meta', JSON.stringify(sandboxMetaMap));
    const envEntries = Object.entries(meta.env || {});
    if (envEntries.length > 0) {
      const envContent = envEntries.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      await getClient().writeFile(sb.id, '/home/user/.env', envContent).catch(() => {});
    }
  }

  appendOutput(`Sandbox created: ${sb.id} (${sb.status}) in ${elapsed}s`, 'info');
  setStatus(`Created: ${sb.id.slice(0, 12)} (${elapsed}s)`, 'connected');
  await refreshSandboxes();
  selectSandbox(sb);
  return sb;
}

drawerSubmitBtn.addEventListener('click', async () => {
  drawerSubmitBtn.disabled = true;
  drawerSubmitBtn.textContent = 'Creating...';
  try {
    const egress = drawerBlockNetworkCheckbox.checked ? 'none' : 'public';
    const opts = {
      egress,
      ephemeral: drawerEphemeralCheckbox.checked,
    };

    const snapshotName =
      drawerSource === 'image'
        ? drawerImageInput.value.trim() || 'ubuntu:22.04'
        : drawerSnapshotSelect.value === 'default'
          ? 'iesandbox/sandbox:latest'
          : drawerSnapshotSelect.value;

    const meta = {
      name: drawerSandboxNameInput.value.trim() || undefined,
      source: drawerSource,
      snapshot: snapshotName,
      region: drawerRegionSelect.value,
      vcpu: parseInt(drawerVcpuInput.value, 10) || 1,
      memory: parseInt(drawerMemoryInput.value, 10) || 1,
      storage: parseInt(drawerStorageInput.value, 10) || 3,
      gpus: parseInt(drawerGpusInput.value, 10) || 0,
      autoStop: drawerAutoStopInput.value,
      autoArchive: drawerAutoArchiveInput.value,
      autoDelete: drawerAutoDeleteInput.value,
      publicPreview: drawerPublicPreviewCheckbox.checked,
      env: collectKvRows(envVarsList),
      labels: collectKvRows(labelsList),
    };

    await createSandboxFromOptions(opts, meta);
    drawerSandboxNameInput.value = '';
    drawerEphemeralCheckbox.checked = false;
    drawerBlockNetworkCheckbox.checked = false;
    drawerPublicPreviewCheckbox.checked = false;
    envVarsList.innerHTML = '';
    labelsList.innerHTML = '';
    closeCreateDrawer();
  } catch (e) {
    appendOutput(`Error creating sandbox: ${e.message}`, 'error');
    setStatus(`Create failed: ${e.message}`, 'error');
  } finally {
    drawerSubmitBtn.disabled = false;
    drawerSubmitBtn.textContent = 'Create';
  }
});

createBtn.addEventListener('click', async () => {
  createBtn.disabled = true;
  try {
    await createSandboxFromOptions({ egress: 'public' });
  } catch (e) {
    appendOutput(`Error creating sandbox: ${e.message}`, 'error');
    setStatus(`Create failed: ${e.message}`, 'error');
  } finally {
    createBtn.disabled = false;
  }
});

// --- Delete sandbox ---
async function deleteSandbox(id) {
  try {
    setStatus(`Deleting ${id.slice(0, 12)}...`);
    const t0 = performance.now();
    await getClient().deleteSandbox(id);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    if (selectedSandboxId === id) {
      selectedSandboxId = null;
      cmdInput.disabled = true;
    }
    pausedSandboxes.delete(id);
    savePausedState();
    appendOutput(`Sandbox deleted: ${id} (${elapsed}s)`, 'info');
    await refreshSandboxes();
  } catch (e) {
    appendOutput(`Error deleting sandbox: ${e.message}`, 'error');
    setStatus(`Delete failed: ${e.message}`, 'error');
  }
}

// --- Output & Inline Terminal Execution ---
detTerminalRunning.addEventListener('click', () => {
  if (!cmdInput.disabled) cmdInput.focus();
});

function appendOutput(text, cls) {
  const div = document.createElement('div');
  div.className = `term-line term-${cls}`;
  div.textContent = text;
  output.appendChild(div);
  detTerminalRunning.scrollTop = detTerminalRunning.scrollHeight;
}

function appendPromptEcho(cmd) {
  const div = document.createElement('div');
  div.className = 'term-line';
  const p = document.createElement('span');
  p.className = 'term-prompt';
  p.textContent = promptLabel.textContent;
  const c = document.createElement('span');
  c.className = 'term-cmd';
  c.textContent = cmd;
  div.append(p, c);
  output.appendChild(div);
  detTerminalRunning.scrollTop = detTerminalRunning.scrollHeight;
}

async function executeCommand() {
  const cmd = cmdInput.value.trim();
  if (!cmd || !selectedSandboxId) return;

  commandHistory.push(cmd);
  historyIndex = commandHistory.length;
  cmdInput.value = '';

  if (cmd === 'clear' || cmd === 'cls') {
    output.innerHTML = '';
    return;
  }

  appendPromptEcho(cmd);
  inlinePromptRow.style.display = 'none';
  cmdInput.disabled = true;
  currentAbortController = new AbortController();

  try {
    // Track cd across commands by printing pwd when command contains cd
    const wrapped = `cd "${currentCwd}" && ${cmd}; __ec=$?; pwd > /tmp/.iesb_cwd; exit $__ec`;
    const result = await getClient().exec(selectedSandboxId, {
      command: wrapped,
      timeoutMs: 300000,
      abortSignal: currentAbortController.signal,
      onStdout: (data) => appendOutput(data.replace(/\n$/, ''), 'stdout'),
      onStderr: (data) => appendOutput(data.replace(/\n$/, ''), 'stderr'),
    });

    try {
      const cwdBuf = await getClient().readFile(selectedSandboxId, '/tmp/.iesb_cwd');
      const nextCwd = cwdBuf.toString('utf-8').trim();
      if (nextCwd) {
        currentCwd = nextCwd;
        updatePromptLabel();
      }
    } catch {}

    if (result.exitCode !== 0) {
      appendOutput(`[exit ${result.exitCode}]`, 'stderr');
    }
  } catch (e) {
    if (!currentAbortController.signal.aborted && e.name !== 'AbortError') {
      appendOutput(`Error: ${e.message}`, 'stderr');
    }
  } finally {
    currentAbortController = null;
    inlinePromptRow.style.display = 'flex';
    cmdInput.disabled = false;
    cmdInput.focus();
    detTerminalRunning.scrollTop = detTerminalRunning.scrollHeight;
  }
}

cmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeCommand();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      cmdInput.value = commandHistory[historyIndex];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      cmdInput.value = commandHistory[historyIndex];
    } else {
      historyIndex = commandHistory.length;
      cmdInput.value = '';
    }
  } else if (e.key === 'l' && e.ctrlKey) {
    e.preventDefault();
    output.innerHTML = '';
  } else if (e.key === 'c' && e.ctrlKey) {
    if (currentAbortController) {
      currentAbortController.abort();
      appendOutput('^C', 'stderr');
    }
  }
});

// --- File browser ---
const filePathInput = $('#file-path-input');
const fileGoBtn = $('#file-go-btn');
const fileRefreshBtn = $('#file-refresh-btn');
const fileListEl = $('#file-list');
const fileViewer = $('#file-viewer');
const fileViewerName = $('#file-viewer-name');
const fileContentEl = $('#file-content');
const fileEditBtn = $('#file-edit-btn');
const fileCloseBtn = $('#file-close-btn');
const fileEditor = $('#file-editor');
const fileEditorTextarea = $('#file-editor-textarea');
const fileSaveBtn = $('#file-save-btn');
const fileCancelBtn = $('#file-cancel-btn');
const newFilePathInput = $('#new-file-path');
const newFileBtn = $('#new-file-btn');

let currentViewingFile = null;

function normalizePath(p) {
  return p.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

async function browseFiles(dir) {
  if (!selectedSandboxId) return;
  dir = normalizePath(dir || '/');
  filePathInput.value = dir;

  try {
    const files = await getClient().listFiles(selectedSandboxId, { path: dir });
    renderFileList(dir, files);
  } catch (e) {
    fileListEl.innerHTML = `<li style="color:#dc2626; padding:8px 12px; font-size:12px;">Error: ${e.message}</li>`;
  }
}

function renderFileList(dir, files) {
  fileListEl.innerHTML = '';

  if (dir !== '/') {
    const parentLi = document.createElement('li');
    parentLi.innerHTML = '<span class="file-icon">..</span><span class="file-entry-name">..</span>';
    parentLi.addEventListener('click', () => {
      const parent = dir.split('/').slice(0, -1).join('/') || '/';
      browseFiles(parent);
    });
    fileListEl.appendChild(parentLi);
  }

  if (!files || files.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.style.color = '#64748b';
    emptyLi.textContent = '(empty)';
    fileListEl.appendChild(emptyLi);
    return;
  }

  files.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const f of files) {
    const li = document.createElement('li');

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = f.isDir ? '\u{1F4C1}' : '\u{1F4C4}';

    const name = document.createElement('span');
    name.className = 'file-entry-name';
    name.textContent = f.name;

    li.appendChild(icon);
    li.appendChild(name);

    if (!f.isDir) {
      const size = document.createElement('span');
      size.className = 'file-entry-size';
      size.textContent = formatSize(f.size);
      li.appendChild(size);
    }

    const fullPath = normalizePath(dir + '/' + f.name);
    if (f.isDir) {
      li.addEventListener('click', () => browseFiles(fullPath));
    } else {
      li.addEventListener('click', () => viewFile(fullPath));
    }
    fileListEl.appendChild(li);
  }
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function viewFile(filePath) {
  if (!selectedSandboxId) return;
  currentViewingFile = filePath;
  fileViewerName.textContent = filePath;
  fileViewerName.title = filePath;
  fileContentEl.textContent = 'Loading...';
  fileEditor.classList.remove('active');
  fileViewer.classList.add('active');

  try {
    const buf = await getClient().readFile(selectedSandboxId, filePath);
    fileContentEl.textContent = buf.toString('utf-8');
  } catch (e) {
    fileContentEl.textContent = `Error loading file: ${e.message}`;
  }
}

function startEditing() {
  if (!currentViewingFile) return;
  fileEditorTextarea.value = fileContentEl.textContent;
  fileEditor.classList.add('active');
  fileContentEl.style.display = 'none';
  fileEditorTextarea.focus();
}

function cancelEditing() {
  fileEditor.classList.remove('active');
  fileContentEl.style.display = '';
}

async function saveFile() {
  if (!selectedSandboxId || !currentViewingFile) return;
  const content = fileEditorTextarea.value;
  fileSaveBtn.disabled = true;

  try {
    await getClient().writeFile(selectedSandboxId, currentViewingFile, content);
    fileContentEl.textContent = content;
    cancelEditing();
    setStatus(`Saved: ${currentViewingFile}`, 'connected');
  } catch (e) {
    setStatus(`Save failed: ${e.message}`, 'error');
  } finally {
    fileSaveBtn.disabled = false;
  }
}

async function createNewFile() {
  if (!selectedSandboxId) return;
  const filePath = newFilePathInput.value.trim();
  if (!filePath) return;

  const fullPath = filePath.startsWith('/') ? filePath : normalizePath(filePathInput.value + '/' + filePath);
  try {
    await getClient().writeFile(selectedSandboxId, fullPath, '');
    newFilePathInput.value = '';
    setStatus(`Created: ${fullPath}`, 'connected');
    browseFiles(filePathInput.value);
    viewFile(fullPath);
  } catch (e) {
    setStatus(`Create failed: ${e.message}`, 'error');
  }
}

function closeFileViewer() {
  fileViewer.classList.remove('active');
  fileEditor.classList.remove('active');
  fileContentEl.style.display = '';
  currentViewingFile = null;
}

fileGoBtn.addEventListener('click', () => browseFiles(filePathInput.value));
fileRefreshBtn.addEventListener('click', () => browseFiles(filePathInput.value));
filePathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') browseFiles(filePathInput.value); });
fileEditBtn.addEventListener('click', startEditing);
fileCloseBtn.addEventListener('click', closeFileViewer);
fileSaveBtn.addEventListener('click', saveFile);
fileCancelBtn.addEventListener('click', cancelEditing);
newFileBtn.addEventListener('click', createNewFile);
newFilePathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createNewFile(); });

refreshBtn.addEventListener('click', refreshSandboxes);

// --- File panel resize ---
(function () {
  const resizer = document.getElementById('file-panel-resizer');
  const panel = document.getElementById('file-panel');
  if (!resizer || !panel) return;
  const MIN_WIDTH = 220;
  const MAX_WIDTH = 760;
  let startX, startWidth;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    resizer.classList.add('dragging');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  function onMouseMove(e) {
    const delta = startX - e.clientX;
    panel.style.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)) + 'px';
  }

  function onMouseUp() {
    resizer.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
})();

// --- Init ---
loadSettings();

// ============================================================================
// --- API KEYS & TENANTS (Admin API) ---
// ============================================================================
const navKeysCount = $('#nav-keys-count');
const keysTbody = $('#keys-tbody');
const keysCountLabel = $('#keys-count-label');
const keysSearchInput = $('#keys-search');
const keysTenantFilter = $('#keys-tenant-filter');
const keysRefreshBtn = $('#keys-refresh-btn');

// Create API Key drawer
const keyDrawerBackdrop = $('#key-drawer-backdrop');
const openKeyDrawerBtn = $('#open-key-drawer-btn');
const closeKeyDrawerBtn = $('#close-key-drawer-btn');
const keyDrawerCancelBtn = $('#key-drawer-cancel-btn');
const keyDrawerSubmitBtn = $('#key-drawer-submit-btn');
const keyModeButtons = $$('#key-mode-toggle .seg-btn');
const keyPermButtons = $$('#key-perm-toggle .seg-btn');
const permInfoFull = $('#perm-info-full');
const permInfoSandboxes = $('#perm-info-sandboxes');
const permInfoRestricted = $('#perm-info-restricted');
const keyNewTenantFields = $('#key-new-tenant-fields');
const keyExistingTenantFields = $('#key-existing-tenant-fields');
const keyTenantNameInput = $('#key-tenant-name');
const keyExpiresInput = $('#key-expires-input');
const keyMaxSandboxesInput = $('#key-max-sandboxes');
const keyExistingTenantSelect = $('#key-existing-tenant-select');
const keyRevealBox = $('#key-reveal-box');
const keyRevealValue = $('#key-reveal-value');
const keyRevealCopyBtn = $('#key-reveal-copy-btn');

let allTenants = [];
let allApiKeys = [];
let keyDrawerMode = 'new';
let keyPermissionMode = 'Full Access';
let keyMetaMap = JSON.parse(localStorage.getItem('iesandbox-key-meta') || '{}');

async function adminFetch(path, options = {}) {
  const res = await fetch(`${SANDBOX_BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-Api-Key': SANDBOX_ENV_KEY,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(errText || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

async function refreshApiKeys() {
  try {
    const tenants = await adminFetch('/admin/tenants');
    allTenants = Array.isArray(tenants) ? tenants : [];

    const keyGroups = await Promise.all(
      allTenants.map(async (t) => {
        try {
          const keys = await adminFetch(`/admin/tenants/${t.id}/keys`);
          return (Array.isArray(keys) ? keys : []).map((k) => ({
            ...k,
            tenantName: t.name || t.id.slice(0, 12),
            maxSandboxes: t.max_sandboxes,
          }));
        } catch {
          return [];
        }
      }),
    );

    allApiKeys = keyGroups.flat();
    navKeysCount.textContent = allApiKeys.filter((k) => !k.revoked_at).length;
    renderTenantDropdowns();
    renderApiKeysTable();
  } catch (e) {
    if (e.status === 403) {
      keysTbody.innerHTML = `
        <tr><td colspan="6"><div class="empty-box">
          <h3>Admin Key Required</h3>
          <p>You are currently connected with a tenant key. Enter your Admin Key (<code>SANDBOX_API_KEYS</code>) to create workspaces and manage API keys.</p>
        </div></td></tr>`;
    } else {
      keysTbody.innerHTML = `
        <tr><td colspan="6"><div class="empty-box">
          <h3>Unable to load API keys</h3>
          <p>${e.message}</p>
        </div></td></tr>`;
    }
  }
}

function renderTenantDropdowns() {
  const prevFilter = keysTenantFilter.value;
  keysTenantFilter.innerHTML = '<option value="all">Workspace: All</option>';
  keyExistingTenantSelect.innerHTML = '';

  allTenants.forEach((t) => {
    const label = t.name ? `${t.name} (${t.id.slice(0, 8)})` : t.id;
    const opt1 = document.createElement('option');
    opt1.value = t.id;
    opt1.textContent = label;
    if (t.id === prevFilter) opt1.selected = true;
    keysTenantFilter.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = t.id;
    opt2.textContent = label;
    keyExistingTenantSelect.appendChild(opt2);
  });
}

function renderApiKeysTable() {
  const q = keysSearchInput.value.trim().toLowerCase();
  const tenantFilter = keysTenantFilter.value;

  const filtered = allApiKeys.filter((k) => {
    const name = (k.tenantName || '').toLowerCase();
    const prefix = (k.prefix || '').toLowerCase();
    if (tenantFilter !== 'all' && k.tenant_id !== tenantFilter) return false;
    if (q && !name.includes(q) && !prefix.includes(q)) return false;
    return true;
  });

  keysCountLabel.textContent = `${filtered.length} of ${allApiKeys.length} key(s)`;

  if (allApiKeys.length === 0) {
    keysTbody.innerHTML = `
      <tr><td colspan="7"><div class="empty-box">
        <h3>No API keys yet</h3>
        <p>Create your first workspace and generate a scoped <code>sbk_...</code> API key for ieAutom8n or your users.</p>
        <button class="btn btn-primary" id="empty-create-key-btn">+ Create API Key</button>
      </div></td></tr>`;
    $('#empty-create-key-btn')?.addEventListener('click', openKeyDrawer);
    return;
  }

  if (filtered.length === 0) {
    keysTbody.innerHTML = `<tr><td colspan="7"><div class="empty-box"><h3>No matching keys</h3><p>Try clearing your search or workspace filter.</p></div></td></tr>`;
    return;
  }

  keysTbody.innerHTML = '';
  filtered.forEach((k) => {
    const tr = document.createElement('tr');
    const isRevoked = Boolean(k.revoked_at);
    const meta = keyMetaMap[k.id] || {};
    const permLabel = meta.permission || 'Full Access';
    const expiresLabel = meta.expires || '-';

    const tdName = document.createElement('td');
    tdName.style.fontWeight = '600';
    tdName.textContent = meta.name || k.tenantName;

    const tdKey = document.createElement('td');
    tdKey.innerHTML = `<span class="mono-id">sbk_${k.prefix || '••••••••'}_••••••••••••</span>`;

    const tdPerm = document.createElement('td');
    tdPerm.innerHTML = isRevoked
      ? '<span class="badge badge-stopped">Revoked</span>'
      : `<span class="badge badge-ephemeral">${permLabel}</span>`;

    const tdCreated = document.createElement('td');
    tdCreated.style.color = 'var(--text-secondary)';
    tdCreated.textContent = formatRelativeTime(k.created_at);

    const tdLastUsed = document.createElement('td');
    tdLastUsed.style.color = 'var(--text-secondary)';
    tdLastUsed.textContent = k.last_used_at ? formatRelativeTime(k.last_used_at) : '-';

    const tdExpires = document.createElement('td');
    tdExpires.style.color = 'var(--text-secondary)';
    tdExpires.textContent = expiresLabel;

    const tdActions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'row-actions';
    if (!isRevoked) {
      const revokeBtn = document.createElement('button');
      revokeBtn.className = 'btn btn-danger-ghost btn-sm';
      revokeBtn.textContent = 'Revoke';
      revokeBtn.addEventListener('click', () => revokeApiKey(k.tenant_id, k.id));
      wrap.appendChild(revokeBtn);
    }
    tdActions.appendChild(wrap);

    tr.append(tdName, tdKey, tdPerm, tdCreated, tdLastUsed, tdExpires, tdActions);
    keysTbody.appendChild(tr);
  });
}

async function revokeApiKey(tenantId, keyId) {
  try {
    setStatus('Revoking API key...');
    await adminFetch(`/admin/tenants/${tenantId}/keys/${keyId}`, { method: 'DELETE' });
    setStatus('API key revoked', 'connected');
    await refreshApiKeys();
  } catch (e) {
    setStatus(`Revoke failed: ${e.message}`, 'error');
  }
}

function openKeyDrawer() {
  keyRevealBox.style.display = 'none';
  keyRevealValue.value = '';
  keyDrawerBackdrop.classList.add('open');
  keyTenantNameInput.focus();
}

function closeKeyDrawer() {
  keyDrawerBackdrop.classList.remove('open');
}

openKeyDrawerBtn.addEventListener('click', openKeyDrawer);
closeKeyDrawerBtn.addEventListener('click', closeKeyDrawer);
keyDrawerCancelBtn.addEventListener('click', closeKeyDrawer);
keyDrawerBackdrop.addEventListener('click', (e) => {
  if (e.target === keyDrawerBackdrop) closeKeyDrawer();
});

keyModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    keyDrawerMode = btn.dataset.kmode;
    keyModeButtons.forEach((b) => b.classList.toggle('active', b === btn));
    keyNewTenantFields.style.display = keyDrawerMode === 'new' ? 'block' : 'none';
    keyExistingTenantFields.style.display = keyDrawerMode === 'existing' ? 'block' : 'none';
  });
});

keyPermButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    keyPermissionMode = btn.dataset.perm;
    keyPermButtons.forEach((b) => b.classList.toggle('active', b === btn));
    permInfoFull.style.display = keyPermissionMode === 'Full Access' ? 'block' : 'none';
    permInfoSandboxes.style.display = keyPermissionMode === 'Sandboxes' ? 'block' : 'none';
    permInfoRestricted.style.display = keyPermissionMode === 'Restricted' ? 'flex' : 'none';
  });
});

$$('#perm-info-restricted .perm-chip').forEach((chip) => {
  chip.addEventListener('click', () => chip.classList.toggle('active'));
});

keyRevealCopyBtn.addEventListener('click', () => copyText(keyRevealValue.value, keyRevealCopyBtn));

keyDrawerSubmitBtn.addEventListener('click', async () => {
  keyDrawerSubmitBtn.disabled = true;
  keyDrawerSubmitBtn.textContent = 'Creating...';
  try {
    let createdKeyObj = null;
    const keyName = keyTenantNameInput.value.trim() || 'workspace';
    if (keyDrawerMode === 'new') {
      const payload = {
        name: keyName,
        max_sandboxes: parseInt(keyMaxSandboxesInput.value, 10) || 0,
        create_key: true,
      };
      const res = await adminFetch('/admin/tenants', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      createdKeyObj = res?.key;
    } else {
      const tenantId = keyExistingTenantSelect.value;
      if (!tenantId) throw new Error('Select an existing workspace first');
      createdKeyObj = await adminFetch(`/admin/tenants/${tenantId}/keys`, { method: 'POST' });
    }

    if (createdKeyObj?.id) {
      keyMetaMap[createdKeyObj.id] = {
        name: keyName,
        permission: keyPermissionMode,
        expires: keyExpiresInput.value || '-',
      };
      localStorage.setItem('iesandbox-key-meta', JSON.stringify(keyMetaMap));
    }

    if (createdKeyObj?.api_key) {
      keyRevealValue.value = createdKeyObj.api_key;
      keyRevealBox.style.display = 'block';
    }
    keyTenantNameInput.value = '';
    keyExpiresInput.value = '';
    setStatus('API key created', 'connected');
    await refreshApiKeys();
  } catch (e) {
    setStatus(`Create key failed: ${e.message}`, 'error');
  } finally {
    keyDrawerSubmitBtn.disabled = false;
    keyDrawerSubmitBtn.textContent = 'Create';
  }
});

keysSearchInput.addEventListener('input', renderApiKeysTable);
keysTenantFilter.addEventListener('change', renderApiKeysTable);
keysRefreshBtn.addEventListener('click', refreshApiKeys);

// ============================================================================
// --- DOMAINS & ROUTES ---
// ============================================================================
const navDomainsCount = $('#nav-domains-count');
const domainsTbody = $('#domains-tbody');
const domainsCountLabel = $('#domains-count-label');
const domainsSearchInput = $('#domains-search');
const domainsTypeFilter = $('#domains-type-filter');
const copyCaddyfileBtn = $('#copy-caddyfile-btn');

const domainDrawerBackdrop = $('#domain-drawer-backdrop');
const openDomainDrawerBtn = $('#open-domain-drawer-btn');
const closeDomainDrawerBtn = $('#close-domain-drawer-btn');
const domainDrawerCancelBtn = $('#domain-drawer-cancel-btn');
const domainDrawerSubmitBtn = $('#domain-drawer-submit-btn');
const domainModeButtons = $$('#domain-mode-toggle .seg-btn');
const domainSubdomainFields = $('#domain-subdomain-fields');
const domainCustomFields = $('#domain-custom-fields');
const domSubInput = $('#dom-sub-input');
const domBaseInput = $('#dom-base-input');
const domPreviewUrl = $('#dom-preview-url');
const domCustomInput = $('#dom-custom-input');
const domTargetInput = $('#dom-target-input');

const DEFAULT_ROUTES = [
  { domain: 'sandbox.iecloudbase.com', type: 'system', target: 'localhost:8080' },
  { domain: 'app1.iecloudbase.com', type: 'subdomain', target: 'localhost:3001' },
  { domain: 'app2.iecloudbase.com', type: 'subdomain', target: 'localhost:3002' },
];

let domainRoutes = JSON.parse(localStorage.getItem('iesandbox-routes-v2') || 'null') || DEFAULT_ROUTES;
let domainDrawerMode = 'subdomain';

function saveDomainRoutes() {
  localStorage.setItem('iesandbox-routes-v2', JSON.stringify(domainRoutes));
  navDomainsCount.textContent = domainRoutes.length;
}

function renderDomainsTable() {
  navDomainsCount.textContent = domainRoutes.length;
  const q = domainsSearchInput.value.trim().toLowerCase();
  const typeFilter = domainsTypeFilter.value;

  const filtered = domainRoutes.filter((r) => {
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    if (q && !r.domain.toLowerCase().includes(q) && !r.target.toLowerCase().includes(q)) return false;
    return true;
  });

  domainsCountLabel.textContent = `${filtered.length} of ${domainRoutes.length} route(s)`;

  if (filtered.length === 0) {
    domainsTbody.innerHTML = `<tr><td colspan="5"><div class="empty-box"><h3>No matching routes</h3><p>Add a subdomain or custom domain route.</p></div></td></tr>`;
    return;
  }

  domainsTbody.innerHTML = '';
  filtered.forEach((r) => {
    const tr = document.createElement('tr');

    const tdDom = document.createElement('td');
    tdDom.innerHTML = `<div class="mono-id"><a href="https://${r.domain}" target="_blank" style="color:var(--text-primary); text-decoration:none; font-weight:600;">https://${r.domain}</a></div>`;

    const tdType = document.createElement('td');
    const typeLabel = r.type === 'system' ? 'System API' : r.type === 'custom' ? 'Custom Domain' : 'Subdomain';
    tdType.innerHTML = `<span class="badge badge-neutral">${typeLabel}</span>`;

    const tdTarget = document.createElement('td');
    tdTarget.innerHTML = `<span class="mono-id">${r.target}</span>`;

    const tdSsl = document.createElement('td');
    tdSsl.innerHTML = '<span class="badge badge-running">HTTPS Active</span>';

    const tdActions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'row-actions';

    const openLink = document.createElement('a');
    openLink.href = `https://${r.domain}`;
    openLink.target = '_blank';
    openLink.className = 'btn btn-secondary btn-sm';
    openLink.style.textDecoration = 'none';
    openLink.textContent = 'Open ↗';
    wrap.appendChild(openLink);

    if (r.type !== 'system') {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger-ghost btn-sm';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        domainRoutes = domainRoutes.filter((item) => item.domain !== r.domain);
        saveDomainRoutes();
        renderDomainsTable();
      });
      wrap.appendChild(delBtn);
    }

    tdActions.appendChild(wrap);
    tr.append(tdDom, tdType, tdTarget, tdSsl, tdActions);
    domainsTbody.appendChild(tr);
  });
}

function updateDomainPreview() {
  const sub = domSubInput.value.trim() || 'app3';
  const base = domBaseInput.value.trim() || 'iecloudbase.com';
  domPreviewUrl.textContent = `https://${sub}.${base}`;
}

domSubInput.addEventListener('input', updateDomainPreview);
domBaseInput.addEventListener('input', updateDomainPreview);

function openDomainDrawer() {
  updateDomainPreview();
  domainDrawerBackdrop.classList.add('open');
  domSubInput.focus();
}

function closeDomainDrawer() {
  domainDrawerBackdrop.classList.remove('open');
}

openDomainDrawerBtn.addEventListener('click', openDomainDrawer);
closeDomainDrawerBtn.addEventListener('click', closeDomainDrawer);
domainDrawerCancelBtn.addEventListener('click', closeDomainDrawer);
domainDrawerBackdrop.addEventListener('click', (e) => {
  if (e.target === domainDrawerBackdrop) closeDomainDrawer();
});

domainModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    domainDrawerMode = btn.dataset.dmode;
    domainModeButtons.forEach((b) => b.classList.toggle('active', b === btn));
    domainSubdomainFields.style.display = domainDrawerMode === 'subdomain' ? 'flex' : 'none';
    domainCustomFields.style.display = domainDrawerMode === 'custom' ? 'block' : 'none';
  });
});

domainDrawerSubmitBtn.addEventListener('click', () => {
  const target = domTargetInput.value.trim() || 'localhost:3003';
  let domain = '';
  if (domainDrawerMode === 'subdomain') {
    const sub = domSubInput.value.trim();
    const base = domBaseInput.value.trim() || 'iecloudbase.com';
    if (!sub) {
      setStatus('Enter a subdomain name', 'error');
      return;
    }
    domain = `${sub}.${base}`;
  } else {
    domain = domCustomInput.value.trim();
    if (!domain) {
      setStatus('Enter a custom domain', 'error');
      return;
    }
  }

  domainRoutes.push({ domain, type: domainDrawerMode, target });
  saveDomainRoutes();
  renderDomainsTable();
  domSubInput.value = '';
  domCustomInput.value = '';
  closeDomainDrawer();
  setStatus(`Route added: ${domain} -> ${target} (click Copy Caddyfile to apply on EC2)`, 'connected');
});

copyCaddyfileBtn.addEventListener('click', () => {
  const blocks = domainRoutes
    .map((r) => `${r.domain} {\n    reverse_proxy ${r.target}\n}`)
    .join('\n\n');
  const cmd = `sudo tee /etc/caddy/Caddyfile <<'EOF'\n${blocks}\nEOF\nsudo systemctl reload caddy`;
  copyText(cmd, copyCaddyfileBtn);
  setStatus('Copied Caddyfile update command to clipboard', 'connected');
});

domainsSearchInput.addEventListener('input', renderDomainsTable);
domainsTypeFilter.addEventListener('change', renderDomainsTable);
renderDomainsTable();

// ============================================================================
// --- DOMAIN RESELLER (Name.com Test API via http://localhost:4000) ---
// ============================================================================
const RESELLER_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:4000' : '';
const resellerTabSearchBtn = $('#reseller-tab-search-btn');
const resellerTabMyDomainsBtn = $('#reseller-tab-mydomains-btn');
const resellerSearchPane = $('#reseller-search-pane');
const resellerMyDomainsPane = $('#reseller-mydomains-pane');

const resellerSearchInput = $('#reseller-search-input');
const resellerSearchBtn = $('#reseller-search-btn');
const resellerSearchTbody = $('#reseller-search-tbody');

const resellerRefreshDomainsBtn = $('#reseller-refresh-domains-btn');
const resellerDomainsTbody = $('#reseller-domains-tbody');
const resellerDnsPanel = $('#reseller-dns-panel');
const domBackListBtn = $('#dom-back-list-btn');
const dnsDomainTitle = $('#dns-domain-title');
const domRenewsBadge = $('#dom-renews-badge');
const qaAutorenewToggle = $('#qa-autorenew-toggle');
const qaPrivacyToggle = $('#qa-privacy-toggle');
const qaLockToggle = $('#qa-lock-toggle');
const qaLockHint = $('#qa-lock-hint');
const qaRenewPrice = $('#qa-renew-price');
const qaRenewBtn = $('#qa-renew-btn');
const domAuthcodeBtn = $('#dom-authcode-btn');
const domAuthcodeBox = $('#dom-authcode-box');

const dnsTypeSelect = $('#dns-type-select');
const dnsHostInput = $('#dns-host-input');
const dnsAnswerInput = $('#dns-answer-input');
const dnsTtlInput = $('#dns-ttl-input');
const dnsPrioInput = $('#dns-prio-input');
const dnsAddBtn = $('#dns-add-btn');
const dnsPointEc2Btn = $('#dns-point-ec2-btn');
const dnsDeleteSelectedBtn = $('#dns-delete-selected-btn');
const dnsExportCsvBtn = $('#dns-export-csv-btn');
const dnsSelectAll = $('#dns-select-all');
const dnsTypeHelp = $('#dns-type-help');
const dnsRecordsTbody = $('#dns-records-tbody');

let activeDnsDomain = null;
let activeDomainDetails = null;
let activeDnsRecords = [];

let domainCart = []; // [{ domainName, retailPrice, wholesalePrice, renewalPrice, years: 1 }]
let domAddonSafePro = false;
let domAddonEmail = false;
let domPromoDiscountPct = 0;
let lastSearchResults = [];
let activeOfferDomain = '';

function showDomainStep(step) {
  ['search', 'addons', 'cart', 'payment', 'confirmation'].forEach((s) => {
    const el = $(`#dom-step-${s}`);
    if (el) el.style.display = s === step ? 'block' : 'none';
  });
  if (step === 'addons' || step === 'cart' || step === 'payment') {
    renderDomainCheckoutState();
  }
}

function updateDomCartBadge() {
  const count = domainCart.length + (domAddonSafePro ? 1 : 0) + (domAddonEmail ? 1 : 0);
  if ($('#dom-cart-badge')) $('#dom-cart-badge').textContent = String(count);
}

function switchResellerTab(tab) {
  resellerSearchPane.style.display = tab === 'search' ? 'block' : 'none';
  resellerMyDomainsPane.style.display = tab === 'mydomains' ? 'block' : 'none';
  if (tab === 'search') showDomainStep('search');
  if (tab === 'mydomains') loadResellerDomains();
}

resellerTabSearchBtn.addEventListener('click', () => switchResellerTab('search'));
resellerTabMyDomainsBtn.addEventListener('click', () => switchResellerTab('mydomains'));
$('#reseller-open-cart-btn')?.addEventListener('click', () => {
  resellerSearchPane.style.display = 'block';
  resellerMyDomainsPane.style.display = 'none';
  if (domainCart.length === 0) {
    setStatus('Your domain cart is empty — search and add a domain first', 'error');
    showDomainStep('search');
  } else {
    showDomainStep('cart');
  }
});

async function resellerFetch(path, options = {}) {
  const res = await fetch(`${RESELLER_API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function renderSearchTableRows() {
  if (lastSearchResults.length === 0) {
    resellerSearchTbody.innerHTML = '<tr><td colspan="5"><div class="empty-box"><h3>No results</h3></div></td></tr>';
    return;
  }
  resellerSearchTbody.innerHTML = '';
  lastSearchResults.forEach((r) => {
    const tr = document.createElement('tr');
    const inCart = domainCart.some((c) => c.domainName === r.domainName);
    const availBadge = r.purchasable
      ? '<span class="badge badge-running">Available</span>'
      : '<span class="badge badge-stopped">Taken</span>';
    const priceVal = r.retailPrice != null ? r.retailPrice : 12.99;
    const renewalVal = r.renewalPrice != null ? r.renewalPrice + (r.markupUsd || 0) : priceVal + 3;
    const priceStr = r.purchasable ? `<strong>$${priceVal.toFixed(2)}</strong>` : '—';
    const renewalStr = r.purchasable ? `Renewal $${renewalVal.toFixed(2)}` : '—';

    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="mono-id" style="font-weight:700; font-size:13.5px;">${r.domainName}</span>
          ${r.purchasable ? '<span class="badge badge-neutral" style="font-size:10.5px;">Free SSL + DNS</span>' : ''}
        </div>
      </td>
      <td>${availBadge}</td>
      <td>${priceStr}</td>
      <td style="color:var(--text-secondary); font-size:12.5px;">${renewalStr}</td>
      <td style="text-align:right;"></td>
    `;

    if (r.purchasable) {
      const btn = document.createElement('button');
      if (inCart) {
        btn.className = 'btn btn-primary btn-sm';
        btn.innerHTML = 'Continue to Cart &nbsp;✓';
        btn.addEventListener('click', () => showDomainStep('addons'));
      } else {
        btn.className = 'btn btn-secondary btn-sm';
        btn.style.fontWeight = '700';
        btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>Add to Cart</span>`;
        btn.addEventListener('click', () => {
          domainCart.push({
            domainName: r.domainName,
            retailPrice: priceVal,
            wholesalePrice: r.wholesalePrice ?? undefined,
            renewalPrice: renewalVal,
            years: 1,
          });
          updateDomCartBadge();
          setStatus(`Added ${r.domainName} to cart`, 'connected');
          renderSearchTableRows();
        });
      }
      tr.lastElementChild.appendChild(btn);
    } else {
      const offerBtn = document.createElement('button');
      offerBtn.className = 'btn btn-secondary btn-sm';
      offerBtn.textContent = 'Make Offer';
      offerBtn.addEventListener('click', () => {
        activeOfferDomain = r.domainName;
        $('#dom-offer-domain-label').textContent = r.domainName;
        $('#dom-make-offer-modal-backdrop')?.classList.add('open');
      });
      tr.lastElementChild.appendChild(offerBtn);
    }

    resellerSearchTbody.appendChild(tr);
  });
}

async function searchResellerDomains() {
  const q = resellerSearchInput.value.trim();
  if (!q) {
    resetResellerSearchResults();
    return;
  }
  resellerSearchBtn.disabled = true;
  resellerSearchBtn.textContent = 'Searching...';
  try {
    const data = await resellerFetch(`/reseller/search?q=${encodeURIComponent(q)}`);
    lastSearchResults = data.results || [];
    renderSearchTableRows();
  } catch (e) {
    setStatus(`Search error: ${e.message}`, 'error');
  } finally {
    resellerSearchBtn.disabled = false;
    resellerSearchBtn.textContent = 'Search';
  }
}

function resetResellerSearchResults() {
  lastSearchResults = [];
  resellerSearchTbody.innerHTML = `
    <tr>
      <td colspan="5">
        <div class="empty-box">
          <h3>Search for a domain name</h3>
          <p>Type any name above to check availability and add domains to your cart.</p>
        </div>
      </td>
    </tr>
  `;
}

function computeCartTotals() {
  let domainsRetail = 0;
  let domainsOriginal = 0;
  let totalYears = 0;
  for (const item of domainCart) {
    const yrs = item.years || 1;
    totalYears += yrs;
    domainsRetail += item.retailPrice * yrs;
    domainsOriginal += Math.max(item.renewalPrice || item.retailPrice + 5, item.retailPrice + 5) * yrs;
  }
  const addonSafeCost = domAddonSafePro ? 7.99 : 0;
  const addonEmailCost = domAddonEmail ? 2.99 : 0;
  const subtotal = domainsOriginal + addonSafeCost + addonEmailCost;
  const baseSavings = Math.max(0, domainsOriginal - domainsRetail);
  const icann = Number((0.20 * Math.max(1, totalYears)).toFixed(2));
  const prePromoTotal = domainsRetail + addonSafeCost + addonEmailCost + icann;
  const promoDiscount = Number(((prePromoTotal * domPromoDiscountPct) / 100).toFixed(2));
  const savings = baseSavings + promoDiscount;
  const total = Math.max(0, Number((prePromoTotal - promoDiscount).toFixed(2)));
  const itemCount = domainCart.length + (domAddonSafePro ? 1 : 0) + (domAddonEmail ? 1 : 0);
  return { subtotal, savings, icann, total, itemCount };
}

function renderDomainCheckoutState() {
  updateDomCartBadge();
  const primaryDomain = domainCart[0]?.domainName || 'yourdomain.com';
  if ($('#dom-addons-headline-domain')) $('#dom-addons-headline-domain').textContent = primaryDomain;

  const safeBtn = $('#dom-addon-safepro-btn');
  if (safeBtn) {
    safeBtn.textContent = domAddonSafePro ? 'Added to Cart ✓' : 'Add to Cart';
    safeBtn.className = domAddonSafePro ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm';
  }
  const mailBtn = $('#dom-addon-email-btn');
  if (mailBtn) {
    mailBtn.textContent = domAddonEmail ? 'Added to Cart ✓' : 'Add to Cart';
    mailBtn.className = domAddonEmail ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm';
  }

  if ($('#dom-cart-safepro-banner')) {
    $('#dom-cart-safepro-banner').style.display = domAddonSafePro ? 'none' : 'flex';
  }
  if ($('#dom-prot-pro-checkbox')) $('#dom-prot-pro-checkbox').checked = domAddonSafePro;
  if ($('#dom-prot-free-card')) $('#dom-prot-free-card').style.border = domAddonSafePro ? '1px solid var(--border)' : '1.5px solid #111827';
  if ($('#dom-prot-pro-card')) $('#dom-prot-pro-card').style.border = domAddonSafePro ? '1.5px solid #111827' : '1px solid #fde68a';

  // Render cart items list
  const listEl = $('#dom-cart-items-list');
  if (listEl) {
    listEl.innerHTML = '';
    domainCart.forEach((item, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid; grid-template-columns:1fr 130px 110px 32px; gap:10px; align-items:center; padding:12px 0; border-bottom:1px solid #f1f5f9;';
      const origPrice = Math.max(item.renewalPrice || item.retailPrice + 5, item.retailPrice + 5) * item.years;
      const nowPrice = item.retailPrice * item.years;
      row.innerHTML = `
        <div>
          <div style="font-size:14px; font-weight:700; font-family:var(--mono);">${item.domainName}</div>
          <div style="font-size:12px; color:var(--text-secondary);">Domain Registration</div>
        </div>
        <select class="select dom-yr-sel" style="height:34px; font-size:12.5px;">
          ${[1, 2, 3, 5].map((y) => `<option value="${y}" ${item.years === y ? 'selected' : ''}>${y} year${y > 1 ? 's' : ''}</option>`).join('')}
        </select>
        <div style="text-align:right; font-size:13.5px;">
          <span style="text-decoration:line-through; color:var(--text-secondary); font-size:12px; margin-right:4px;">$${origPrice.toFixed(2)}</span>
          <strong>$${nowPrice.toFixed(2)}</strong>
        </div>
        <button type="button" class="icon-btn" title="Remove from cart" style="width:28px;height:28px;color:#dc2626;">✕</button>
      `;
      row.querySelector('.dom-yr-sel').addEventListener('change', (e) => {
        domainCart[idx].years = parseInt(e.target.value, 10) || 1;
        renderDomainCheckoutState();
      });
      row.querySelector('button').addEventListener('click', () => {
        domainCart.splice(idx, 1);
        renderSearchTableRows();
        if (domainCart.length === 0) showDomainStep('search');
        else renderDomainCheckoutState();
      });
      listEl.appendChild(row);
    });
  }

  const t = computeCartTotals();
  // Step 2 summary
  if ($('#dom-addons-item-count')) $('#dom-addons-item-count').textContent = String(t.itemCount);
  if ($('#dom-addons-subtotal')) $('#dom-addons-subtotal').textContent = `$${t.subtotal.toFixed(2)}`;
  if ($('#dom-addons-savings')) $('#dom-addons-savings').textContent = `-$${t.savings.toFixed(2)}`;
  if ($('#dom-addons-total')) $('#dom-addons-total').textContent = `$${t.total.toFixed(2)}`;
  // Step 3 summary
  if ($('#dom-cart-summary-count')) $('#dom-cart-summary-count').textContent = String(t.itemCount);
  if ($('#dom-cart-subtotal')) $('#dom-cart-subtotal').textContent = `$${t.subtotal.toFixed(2)}`;
  if ($('#dom-cart-savings')) $('#dom-cart-savings').textContent = `-$${t.savings.toFixed(2)}`;
  if ($('#dom-cart-icann')) $('#dom-cart-icann').textContent = `$${t.icann.toFixed(2)}`;
  if ($('#dom-cart-total')) $('#dom-cart-total').textContent = `$${t.total.toFixed(2)}`;
  // Step 4 summary
  if ($('#dom-pay-summary-count')) $('#dom-pay-summary-count').textContent = String(t.itemCount);
  if ($('#dom-pay-subtotal')) $('#dom-pay-subtotal').textContent = `$${t.subtotal.toFixed(2)}`;
  if ($('#dom-pay-savings')) $('#dom-pay-savings').textContent = `-$${t.savings.toFixed(2)}`;
  if ($('#dom-pay-icann')) $('#dom-pay-icann').textContent = `$${t.icann.toFixed(2)}`;
  if ($('#dom-pay-total')) $('#dom-pay-total').textContent = `$${t.total.toFixed(2)}`;
}

// Step navigation & add-on handlers
$('#dom-addons-back-search')?.addEventListener('click', () => { renderSearchTableRows(); showDomainStep('search'); });
$('#dom-addons-top-continue')?.addEventListener('click', () => showDomainStep('cart'));
$('#dom-addons-continue-btn')?.addEventListener('click', () => showDomainStep('cart'));
$('#dom-cart-back-addons')?.addEventListener('click', () => showDomainStep('addons'));
$('#dom-cart-next-payment-btn')?.addEventListener('click', () => showDomainStep('payment'));
$('#dom-pay-back-cart')?.addEventListener('click', () => showDomainStep('cart'));
$('#dom-pay-back-cart-link')?.addEventListener('click', () => showDomainStep('cart'));

$('#dom-addon-safepro-btn')?.addEventListener('click', () => { domAddonSafePro = !domAddonSafePro; renderDomainCheckoutState(); });
$('#dom-addon-email-btn')?.addEventListener('click', () => { domAddonEmail = !domAddonEmail; renderDomainCheckoutState(); });
$('#dom-cart-banner-add-safepro')?.addEventListener('click', () => { domAddonSafePro = true; renderDomainCheckoutState(); });
$('#dom-prot-free-card')?.addEventListener('click', () => { domAddonSafePro = false; renderDomainCheckoutState(); });
$('#dom-prot-pro-card')?.addEventListener('click', () => { domAddonSafePro = !domAddonSafePro; renderDomainCheckoutState(); });

$('#dom-promo-toggle-btn')?.addEventListener('click', () => {
  const b = $('#dom-promo-box');
  if (b) b.style.display = b.style.display === 'none' ? 'flex' : 'none';
});
$('#dom-promo-apply-btn')?.addEventListener('click', () => {
  const code = ($('#dom-promo-input')?.value || '').trim().toUpperCase();
  if (!code) return;
  domPromoDiscountPct = 10;
  setStatus(`Applied promo code ${code} (10% discount)`, 'connected');
  renderDomainCheckoutState();
});

$$('input[name="dom-pay-method"]').forEach((rad) => {
  rad.addEventListener('change', (e) => {
    const isCard = e.target.value === 'card';
    if ($('#dom-card-fields')) $('#dom-card-fields').style.display = isCard ? 'grid' : 'none';
  });
});

$('#dom-billing-edit-btn')?.addEventListener('click', () => {
  const f = $('#dom-billing-form');
  if (f) f.style.display = f.style.display === 'none' ? 'flex' : 'none';
});
$('#dom-billing-save-btn')?.addEventListener('click', () => {
  $('#dom-bill-name-txt').textContent = $('#dom-bill-name-inp').value;
  $('#dom-bill-addr-txt').textContent = $('#dom-bill-addr-inp').value;
  $('#dom-bill-city-txt').textContent = $('#dom-bill-city-inp').value;
  $('#dom-bill-phone-txt').textContent = $('#dom-bill-phone-inp').value;
  $('#dom-billing-form').style.display = 'none';
});

async function submitDomainCheckout() {
  if (domainCart.length === 0) return setStatus('Your cart is empty', 'error');
  const leftBtn = $('#dom-pay-complete-left-btn');
  const rightBtn = $('#dom-pay-complete-right-btn');
  const payMethod = document.querySelector('input[name="dom-pay-method"]:checked')?.value || 'card';
  const totals = computeCartTotals();
  if (leftBtn) { leftBtn.disabled = true; leftBtn.textContent = 'Processing Payment...'; }
  if (rightBtn) { rightBtn.disabled = true; rightBtn.textContent = 'Processing Payment...'; }
  try {
    const res = await resellerFetch('/reseller/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: domainCart,
        addons: { safePro: domAddonSafePro, customEmail: domAddonEmail },
        paymentMethod: payMethod,
        totalUsd: totals.total,
      }),
    });
    const regList = res.registeredDomains || [];
    if ($('#dom-confirm-order-meta')) {
      $('#dom-confirm-order-meta').textContent = `Order ${res.orderId} · Paid $${totals.total.toFixed(2)} USD via ${payMethod.toUpperCase()}`;
    }
    if ($('#dom-confirm-domains-box')) {
      $('#dom-confirm-domains-box').innerHTML = regList.map((d) => `
        <div class="bp-service-preview">
          <div>
            <div style="font-size:14px; font-weight:700; font-family:var(--mono);">${d.domainName}</div>
            <div style="font-size:12px; color:var(--text-secondary);">Registered for ${d.years} year${d.years > 1 ? 's' : ''} · Auto-Renew &amp; WHOIS Privacy Active</div>
          </div>
          <span class="paas-health-pill ok" style="margin:0;">✓ Registered</span>
        </div>
      `).join('');
    }
    domainCart = [];
    domAddonSafePro = false;
    domAddonEmail = false;
    domPromoDiscountPct = 0;
    updateDomCartBadge();
    renderSearchTableRows();
    showDomainStep('confirmation');
    setStatus(`Order ${res.orderId} complete — ${regList.map((d) => d.domainName).join(', ')} registered!`, 'connected');
  } catch (e) {
    setStatus(`Checkout failed: ${e.message}`, 'error');
  } finally {
    if (leftBtn) { leftBtn.disabled = false; leftBtn.textContent = 'Complete Order'; }
    if (rightBtn) { rightBtn.disabled = false; rightBtn.textContent = 'Complete Order'; }
  }
}

$('#dom-pay-complete-left-btn')?.addEventListener('click', submitDomainCheckout);
$('#dom-pay-complete-right-btn')?.addEventListener('click', submitDomainCheckout);
$('#dom-confirm-goto-mydomains')?.addEventListener('click', () => switchResellerTab('mydomains'));
$('#dom-confirm-search-more')?.addEventListener('click', () => showDomainStep('search'));

// Make Offer modal handlers
$('#dom-offer-close-btn')?.addEventListener('click', () => $('#dom-make-offer-modal-backdrop')?.classList.remove('open'));
$('#dom-make-offer-modal-backdrop')?.addEventListener('click', (e) => {
  if (e.target === $('#dom-make-offer-modal-backdrop')) $('#dom-make-offer-modal-backdrop')?.classList.remove('open');
});
$('#dom-offer-submit-btn')?.addEventListener('click', async () => {
  const btn = $('#dom-offer-submit-btn');
  const amt = parseFloat($('#dom-offer-amount-input')?.value || '0');
  if (!activeOfferDomain || !(amt > 0)) return setStatus('Enter a valid offer amount', 'error');
  btn.disabled = true;
  btn.textContent = 'Submitting Offer...';
  try {
    const res = await resellerFetch('/reseller/brokerage-offer', {
      method: 'POST',
      body: JSON.stringify({ domainName: activeOfferDomain, offerUsd: amt }),
    });
    $('#dom-make-offer-modal-backdrop')?.classList.remove('open');
    setStatus(`Submitted $${amt.toFixed(2)} brokerage offer for ${activeOfferDomain} (Ref: ${res.reference})`, 'connected');
  } catch (e) {
    setStatus(`Offer failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Brokerage Offer';
  }
});

resellerSearchBtn.addEventListener('click', searchResellerDomains);
resellerSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchResellerDomains(); });
resellerSearchInput.addEventListener('input', () => {
  if (!resellerSearchInput.value.trim()) {
    resetResellerSearchResults();
  }
});

async function loadResellerDomains() {
  try {
    const data = await resellerFetch('/reseller/domains');
    const domains = data.domains || [];
    if (domains.length === 0) {
      resellerDomainsTbody.innerHTML = '<tr><td colspan="4"><div class="empty-box"><h3>No registered domains yet</h3><p>Search and register a domain in the Search &amp; Register tab.</p></div></td></tr>';
      return;
    }
    resellerDomainsTbody.innerHTML = '';
    domains.forEach((d) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono-id">${d.domainName}</span></td>
        <td style="color:var(--text-secondary);">${(d.createDate || '').slice(0, 10) || '—'}</td>
        <td style="color:var(--text-secondary);">${(d.expireDate || '').slice(0, 10) || '—'}</td>
        <td style="text-align:right;"></td>
      `;
      const dnsBtn = document.createElement('button');
      dnsBtn.className = 'btn btn-secondary btn-sm';
      dnsBtn.textContent = 'Manage';
      dnsBtn.addEventListener('click', () => openDnsPanel(d.domainName));
      tr.lastElementChild.appendChild(dnsBtn);
      resellerDomainsTbody.appendChild(tr);
    });
  } catch (e) {
    setStatus(`Load domains failed: ${e.message}`, 'error');
  }
}

resellerRefreshDomainsBtn.addEventListener('click', loadResellerDomains);

domBackListBtn.addEventListener('click', () => {
  resellerDnsPanel.style.display = 'none';
});

function switchDomTab(tab) {
  $$('.dom-action-btn').forEach((b) => b.classList.toggle('active', b.dataset.domtab === tab));
  $$('.dom-subpage').forEach((p) => p.classList.toggle('active', p.id === `domsub-${tab}`));
  if (tab === 'urlfwd') loadUrlForwarding();
  else if (tab === 'emailfwd') loadEmailForwarding();
  else if (tab === 'nsreg') loadVanityNameservers();
}

$$('.dom-action-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchDomTab(btn.dataset.domtab));
});

$$('[data-jump-domtab]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    switchDomTab(el.dataset.jumpDomtab);
  });
});

$('#sec-monitor-toggle')?.addEventListener('click', (e) => {
  e.currentTarget.classList.toggle('on');
});

async function openDnsPanel(domain) {
  activeDnsDomain = domain;
  dnsDomainTitle.textContent = domain;
  domAuthcodeBox.style.display = 'none';
  resellerDnsPanel.style.display = 'block';
  switchDomTab('overview');
  await Promise.all([loadDomainDetails(), refreshDnsRecords()]);
}

async function loadDomainDetails() {
  if (!activeDnsDomain) return;
  try {
    const d = await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}`);
    activeDomainDetails = d;
    domRenewsBadge.textContent = d.expireDate ? `Renews ${d.expireDate.slice(0, 10)}` : 'Active';
    qaAutorenewToggle.classList.toggle('on', Boolean(d.autorenewEnabled));
    qaPrivacyToggle.classList.toggle('on', Boolean(d.privacyEnabled));
    qaLockToggle.classList.toggle('on', Boolean(d.locked));
    qaLockHint.textContent = d.locked ? 'Your domain is protected.' : 'Unlocked for transfer.';
    qaRenewPrice.textContent = d.renewalPrice ? `Renew for $${Number(d.renewalPrice).toFixed(2)}` : 'Renew domain';
    renderNameserverInputs(d.nameservers || ['ns1.iecloudbase.com', 'ns2.iecloudbase.com', 'ns3.iecloudbase.com', 'ns4.iecloudbase.com']);
    const reg = d.contacts?.registrant || {};
    $('#cnt-first').value = reg.firstName || '';
    $('#cnt-last').value = reg.lastName || '';
    $('#cnt-org').value = reg.companyName || '';
    $('#cnt-email').value = reg.email || '';
    $('#cnt-phone').value = reg.phone || '';
    $('#cnt-addr1').value = reg.address1 || '';
    $('#cnt-addr2').value = reg.address2 || '';
    $('#cnt-city').value = reg.city || '';
    $('#cnt-state').value = reg.state || '';
    $('#cnt-zip').value = reg.zip || '';
    $('#cnt-country').value = reg.country || '';
  } catch (e) {
    setStatus(`Load domain details: ${e.message}`, 'error');
  }
}

qaAutorenewToggle.addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  const action = qaAutorenewToggle.classList.contains('on') ? 'disableAutorenew' : 'enableAutorenew';
  await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/${action}`, { method: 'POST', body: '{}' });
  await loadDomainDetails();
});

qaPrivacyToggle.addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  const action = qaPrivacyToggle.classList.contains('on') ? 'disableWhoisPrivacy' : 'enableWhoisPrivacy';
  await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/${action}`, { method: 'POST', body: '{}' });
  await loadDomainDetails();
});

qaLockToggle.addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  const action = qaLockToggle.classList.contains('on') ? 'unlock' : 'lock';
  await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/${action}`, { method: 'POST', body: '{}' });
  await loadDomainDetails();
});

qaRenewBtn.addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  try {
    await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/renew`, { method: 'POST', body: JSON.stringify({ years: 1 }) });
    setStatus(`Renewed ${activeDnsDomain}`, 'connected');
    await loadDomainDetails();
  } catch (e) {
    setStatus(`Renew failed: ${e.message}`, 'error');
  }
});

domAuthcodeBtn.addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  try {
    const res = await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/getAuthCode`);
    domAuthcodeBox.textContent = `Auth Code: ${res.authCode || 'N/A'}`;
    domAuthcodeBox.style.display = 'block';
  } catch (e) {
    setStatus(`Auth code failed: ${e.message}`, 'error');
  }
});

const DNS_HELP = {
  A: 'An A record points a hostname to an IPv4 address. Leave Host blank for root, or * for all subdomains.',
  MX: 'An MX record directs email to your mail server. Set Prio (e.g. 10) and Answer (mail hostname).',
  CNAME: 'A CNAME aliases a subdomain (e.g. www) to another hostname.',
  TXT: 'A TXT record stores arbitrary text (used for SPF, DKIM, and domain verification).',
  SRV: 'An SRV record specifies host/port for specific services.',
  AAAA: 'An AAAA record points a hostname to an IPv6 address.',
  NS: 'An NS record delegates a subdomain to another nameserver.',
  ANAME: 'An ANAME maps root or subdomain to another hostname.',
};

dnsTypeSelect.addEventListener('change', () => {
  const t = dnsTypeSelect.value;
  dnsTypeHelp.innerHTML = `<strong style="color:var(--text-primary);">${t} Records</strong>${DNS_HELP[t] || ''}`;
  const srvBox = $('#dns-srv-fields');
  if (srvBox) srvBox.style.display = t === 'SRV' ? 'flex' : 'none';
  if (t === 'MX' || t === 'SRV') {
    if (!dnsPrioInput.value) dnsPrioInput.value = '10';
  }
});

async function refreshDnsRecords() {
  if (!activeDnsDomain) return;
  try {
    const data = await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/records`);
    activeDnsRecords = data.records || [];
    if (activeDnsRecords.length === 0) {
      dnsRecordsTbody.innerHTML = '<tr><td colspan="7"><div class="empty-box"><p>No DNS records yet.</p></div></td></tr>';
      return;
    }
    dnsRecordsTbody.innerHTML = '';
    activeDnsRecords.forEach((rec) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="dns-row-cb" data-id="${rec.id}" /></td>
        <td><span class="badge badge-neutral">${rec.type}</span></td>
        <td><span class="mono-id">${rec.fqdn || rec.host || activeDnsDomain}</span></td>
        <td><span class="mono-id">${rec.answer}</span></td>
        <td style="color:var(--text-secondary);">${rec.ttl || 300}</td>
        <td style="color:var(--text-secondary);">${rec.priority ?? 'N/A'}</td>
        <td style="text-align:right;"></td>
      `;
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.style.marginRight = '4px';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        dnsTypeSelect.value = rec.type;
        dnsHostInput.value = rec.host || '';
        dnsAnswerInput.value = rec.answer || '';
        dnsTtlInput.value = rec.ttl || 300;
        dnsPrioInput.value = rec.priority ?? '';
        dnsHostInput.focus();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger-ghost btn-sm';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/records/${rec.id}`, { method: 'DELETE' });
        await refreshDnsRecords();
      });
      tr.lastElementChild.append(editBtn, delBtn);
      dnsRecordsTbody.appendChild(tr);
    });
  } catch (e) {
    setStatus(`DNS load failed: ${e.message}`, 'error');
  }
}

dnsSelectAll.addEventListener('change', () => {
  $$('.dns-row-cb').forEach((cb) => { cb.checked = dnsSelectAll.checked; });
});

dnsDeleteSelectedBtn.addEventListener('click', async () => {
  const ids = [...$$('.dns-row-cb:checked')].map((cb) => cb.dataset.id);
  for (const id of ids) {
    await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/records/${id}`, { method: 'DELETE' });
  }
  await refreshDnsRecords();
});

dnsExportCsvBtn.addEventListener('click', () => {
  const rows = [['Type', 'Host', 'Answer', 'TTL', 'Prio'], ...activeDnsRecords.map((r) => [r.type, r.host || '@', r.answer, r.ttl || 300, r.priority ?? ''])];
  const csv = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${activeDnsDomain}-dns.csv`;
  a.click();
});

dnsAddBtn.addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  const answer = dnsAnswerInput.value.trim();
  if (!answer) return;
  try {
    await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/records`, {
      method: 'POST',
      body: JSON.stringify({
        type: dnsTypeSelect.value,
        host: dnsHostInput.value.trim(),
        answer,
        ttl: parseInt(dnsTtlInput.value || '300', 10),
        ...(dnsPrioInput.value ? { priority: parseInt(dnsPrioInput.value, 10) } : {}),
      }),
    });
    dnsHostInput.value = '';
    dnsAnswerInput.value = '';
    await refreshDnsRecords();
    setStatus('DNS record added', 'connected');
  } catch (e) {
    setStatus(`Add DNS failed: ${e.message}`, 'error');
  }
});

dnsPointEc2Btn.addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  try {
    await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/records`, {
      method: 'POST',
      body: JSON.stringify({ type: 'A', host: '', answer: '13.51.192.94', ttl: 300 }),
    });
    await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/records`, {
      method: 'POST',
      body: JSON.stringify({ type: 'A', host: '*', answer: '13.51.192.94', ttl: 300 }),
    });
    await refreshDnsRecords();
    setStatus(`Pointed @ and * on ${activeDnsDomain} to 13.51.192.94`, 'connected');
  } catch (e) {
    setStatus(`Point to EC2 failed: ${e.message}`, 'error');
  }
});

// 2. Nameservers
function renderNameserverInputs(list) {
  const wrap = $('#ns-inputs-list');
  wrap.innerHTML = '';
  list.forEach((ns) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:6px;';
    row.innerHTML = `<input class="input ns-val-input" value="${ns}" style="margin-bottom:0;" /><button type="button" class="kv-remove">−</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    wrap.appendChild(row);
  });
}
$('#ns-add-row-btn').addEventListener('click', () => {
  const wrap = $('#ns-inputs-list');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:6px;';
  row.innerHTML = `<input class="input ns-val-input" placeholder="ns1.example.com" style="margin-bottom:0;" /><button type="button" class="kv-remove">−</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  wrap.appendChild(row);
});
$('#ns-use-default-btn').addEventListener('click', () => renderNameserverInputs(['ns1.iecloudbase.com', 'ns2.iecloudbase.com', 'ns3.iecloudbase.com', 'ns4.iecloudbase.com']));
$('#ns-clear-btn').addEventListener('click', () => { $('#ns-inputs-list').innerHTML = ''; });
$('#ns-save-btn').addEventListener('click', async () => {
  const nameservers = [...$$('.ns-val-input')].map((i) => i.value.trim()).filter(Boolean);
  await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/setNameservers`, { method: 'POST', body: JSON.stringify({ nameservers }) });
  setStatus('Nameservers saved', 'connected');
});

// 3. URL Forwarding
async function loadUrlForwarding() {
  if (!activeDnsDomain) return;
  try {
    const res = await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/url/forwarding`);
    const list = res.urlForwarding || [];
    const tb = $('#urlfwd-tbody');
    tb.innerHTML = list.length ? '' : '<tr><td colspan="4"><div class="empty-box"><p>No URL forwarding rules.</p></div></td></tr>';
    list.forEach((f) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${f.host}</td><td>${f.forwardsTo}</td><td>${f.type}</td><td style="text-align:right;"><button class="btn btn-danger-ghost btn-sm">Delete</button></td>`;
      tr.querySelector('button').addEventListener('click', async () => {
        await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/url/forwarding/${encodeURIComponent(f.host)}`, { method: 'DELETE' });
        loadUrlForwarding();
      });
      tb.appendChild(tr);
    });
  } catch {}
}
$$('.social-fwd-btn').forEach((b) => b.addEventListener('click', () => { $('#urlfwd-to').value = b.dataset.url; }));
$('#urlfwd-create-btn').addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  const sub = $('#urlfwd-sub').value.trim();
  const host = sub ? `${sub}.${activeDnsDomain}` : activeDnsDomain;
  await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/url/forwarding`, {
    method: 'POST',
    body: JSON.stringify({ host, forwardsTo: $('#urlfwd-to').value.trim(), type: $('#urlfwd-type').value }),
  });
  loadUrlForwarding();
});

// 4. Email Forwarding
async function loadEmailForwarding() {
  if (!activeDnsDomain) return;
  try {
    const res = await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/email/forwarding`);
    const list = res.emailForwarding || [];
    const tb = $('#emailfwd-tbody');
    tb.innerHTML = list.length ? '' : '<tr><td colspan="3"><div class="empty-box"><p>No email forwarding rules.</p></div></td></tr>';
    list.forEach((f) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${f.emailBox}@${activeDnsDomain}</td><td>${f.emailTo}</td><td style="text-align:right;"><button class="btn btn-danger-ghost btn-sm">Delete</button></td>`;
      tr.querySelector('button').addEventListener('click', async () => {
        await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/email/forwarding/${encodeURIComponent(f.emailBox)}`, { method: 'DELETE' });
        loadEmailForwarding();
      });
      tb.appendChild(tr);
    });
  } catch {}
}
$('#emailfwd-add-btn').addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/email/forwarding`, {
    method: 'POST',
    body: JSON.stringify({ emailBox: $('#emailfwd-box').value.trim(), emailTo: $('#emailfwd-to').value.trim() }),
  });
  $('#emailfwd-box').value = '';
  $('#emailfwd-to').value = '';
  loadEmailForwarding();
});

// 5. Dynamic DNS
$('#ddns-gen-btn').addEventListener('click', () => {
  const box = $('#ddns-creds-box');
  box.textContent = `DDNS Username: ${activeDnsDomain}-ddns | Key: ddns_${Math.random().toString(36).slice(2, 14)}`;
  box.style.display = 'block';
});

// 6. Vanity Nameserver Registration
async function loadVanityNameservers() {
  if (!activeDnsDomain) return;
  try {
    const res = await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/vanity_nameservers`);
    const list = res.vanityNameservers || [];
    const tb = $('#nsreg-tbody');
    tb.innerHTML = list.length ? '' : '<tr><td colspan="3"><div class="empty-box"><p>No custom nameservers registered.</p></div></td></tr>';
    list.forEach((v) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${v.hostname}</td><td>${(v.ips || []).join(', ')}</td><td style="text-align:right;"><button class="btn btn-danger-ghost btn-sm">Delete</button></td>`;
      tr.querySelector('button').addEventListener('click', async () => {
        await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/vanity_nameservers/${encodeURIComponent(v.hostname)}`, { method: 'DELETE' });
        loadVanityNameservers();
      });
      tb.appendChild(tr);
    });
  } catch {}
}
$('#nsreg-add-btn').addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  const host = $('#nsreg-host').value.trim();
  const hostname = host.includes('.') ? host : `${host}.${activeDnsDomain}`;
  await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/vanity_nameservers`, {
    method: 'POST',
    body: JSON.stringify({ hostname, ips: [$('#nsreg-ip').value.trim()] }),
  });
  loadVanityNameservers();
});

// 7. Contacts
$('#cnt-save-btn').addEventListener('click', async () => {
  if (!activeDnsDomain) return;
  const contact = {
    firstName: $('#cnt-first').value.trim(),
    lastName: $('#cnt-last').value.trim(),
    companyName: $('#cnt-org').value.trim(),
    email: $('#cnt-email').value.trim(),
    phone: $('#cnt-phone').value.trim(),
    address1: $('#cnt-addr1').value.trim(),
    address2: $('#cnt-addr2').value.trim(),
    city: $('#cnt-city').value.trim(),
    state: $('#cnt-state').value.trim(),
    zip: $('#cnt-zip').value.trim(),
    country: $('#cnt-country').value.trim(),
  };
  await resellerFetch(`/reseller/domains/${encodeURIComponent(activeDnsDomain)}/setContacts`, {
    method: 'POST',
    body: JSON.stringify({ contacts: { registrant: contact, admin: contact, tech: contact, billing: contact } }),
  });
  setStatus('Domain contacts saved', 'connected');
});

// 8. Account Transfer
$('#transfer-submit-btn').addEventListener('click', () => {
  const code = $('#transfer-code-input').value.trim();
  if (!code) return setStatus('Enter an Account Code first', 'error');
  setStatus(`Account transfer request queued for ${activeDnsDomain} -> ${code}`, 'connected');
});

// ============================================================================
// --- EMAIL HOSTING (STALWART PAAS CONTROL PLANE) ---
// ============================================================================
const navEmailCount = $('#nav-email-count');
const emailTbody = $('#email-tbody');
const emailCountLabel = $('#email-count-label');
const emailSearchInput = $('#email-search-input');
const emailDomainFilter = $('#email-domain-filter');

const mailEngineIp = $('#mail-engine-ip');
const mailEnginePtr = $('#mail-engine-ptr');
const mailOutboundModeBtns = $$('#mail-outbound-mode-tabs .paas-status-tab');
const mailOpenWebmailTabBtn = $('#mail-open-webmail-tab-btn');

const mailDomainsGrid = $('#mail-domains-grid');
const mailClearDomainFilterBtn = $('#mail-clear-domain-filter');
const mailRefreshBtn = $('#mail-refresh-btn');
const mailToggleDnsBtn = $('#mail-toggle-dns-btn');
const mailDeleteDomainBtn = $('#mail-delete-domain-btn');
const mailSectionTitle = $('#mail-mailboxes-heading');

const mailDnsInspectorCard = $('#mail-dns-inspector-card');
const mailDnsDomainBadge = $('#mail-dns-domain-title');
const mailDnsBadgesRow = $('#mail-dns-badges-row');
const mailDnsTbody = $('#mail-dns-records-tbody');
const mailVerifyDnsBtn = $('#mail-verify-dns-btn');
const mailAutoconfigDnsBtn = $('#mail-autopush-dns-btn');

const mailAddDomainModalBackdrop = $('#mail-add-domain-modal-backdrop');
const mailNewDomainInput = $('#mail-dom-modal-input');
const mailNewDomainAutodns = $('#mail-dom-modal-autodns');
const mailAddDomainSubmitBtn = $('#mail-dom-modal-submit');

const mailResetPassModalBackdrop = $('#mail-reset-pass-modal-backdrop');
const mailResetPassAddr = $('#mail-pass-modal-addr');
const mailResetPassInput = $('#mail-pass-modal-input');
const mailResetPassEyeBtn = $('#mail-pass-modal-eye');
const mailResetPassSubmitBtn = $('#mail-pass-modal-submit');

const mailAliasesModalBackdrop = $('#mail-aliases-modal-backdrop');
const mailAliasesAddr = $('#mail-alias-modal-addr');
const mailAliasesList = $('#mail-alias-list');
const mailNewAliasUser = $('#mail-alias-new-input');
const mailAddAliasBtn = $('#mail-alias-add-btn');
const mailSaveAliasesBtn = $('#mail-alias-modal-submit');

mailOpenWebmailTabBtn?.addEventListener('click', () => switchView('webmail'));
mailClearDomainFilterBtn?.addEventListener('click', () => {
  selectedMailDomain = null;
  emailDomainFilter.value = 'all';
  renderMailDomainsGrid();
  renderEmailTable();
  loadMailGroupsFromServer();
  if (mailDnsInspectorCard && mailDnsInspectorCard.style.display !== 'none') {
    renderMailDnsInspector();
  }
});

const emailDrawerBackdrop = $('#email-drawer-backdrop');
const openEmailDrawerBtn = $('#open-email-drawer-btn');
const closeEmailDrawerBtn = $('#close-email-drawer-btn');
const emailDrawerCancelBtn = $('#email-drawer-cancel-btn');
const emailDrawerSubmitBtn = $('#email-drawer-submit-btn');
const emailModeButtons = $$('#email-mode-toggle .seg-btn');
const emailCustomDomainGroup = $('#email-custom-domain-group');
const emailCustomDomainInput = $('#email-custom-domain-input');
const emailUsernameInput = $('#email-username-input');
const emailPreviewAddr = $('#email-preview-addr');
const emailDisplaynameInput = $('#email-displayname-input');
const emailPasswordInput = $('#email-password-input');
const emailGenPassBtn = $('#email-gen-pass-btn');
const emailQuotaSelect = $('#email-quota-select');
const emailAutodnsGroup = $('#email-autodns-group');
const emailAutodnsCheckbox = $('#email-autodns-checkbox');

let emailDrawerMode = 'free';
let mailOutboundState = { mode: 'direct', routeTarget: 'mx', ip: '13.51.192.94', ptrHost: 'mail.iecloudbase.com', ptrValid: true };
let mailDomains = [];
let selectedMailDomain = null; // null = All Domains, or domain name string e.g. 'iecloudbase.com'
let mailDnsVerificationCache = {}; // domain -> verification checks
let activeResetPassMailbox = null;
let activeAliasesMailbox = null;
let editingAliases = [];
let mailboxes = JSON.parse(localStorage.getItem('iecloudbase-mailboxes') || '[]');

function formatQuotaBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return '10 GB';
  const gb = Math.round(b / (1024 * 1024 * 1024));
  return `${gb || 10} GB`;
}

async function loadMailboxesFromServer() {
  try {
    const data = await resellerFetch('/mail/overview');
    if (data.outbound) {
      mailOutboundState = data.outbound;
      renderMailOutboundBanner();
    }
    if (Array.isArray(data.domains)) {
      mailDomains = data.domains;
    }
    const serverList = data.mailboxes || [];
    const byAddr = Object.fromEntries(mailboxes.map((m) => [m.address, m]));
    mailboxes = serverList.map((s) => ({
      id: s.id,
      address: s.address,
      displayName: s.displayName || s.address,
      domain: s.domain || 'iecloudbase.com',
      quota: s.quota ? formatQuotaBytes(s.quota) : (byAddr[s.address]?.quota || '10 GB'),
      aliases: Array.isArray(s.aliases) ? s.aliases : [],
      dnsConfigured: true,
    }));
    saveMailboxes();
  } catch {
    // Fallback to legacy endpoint if needed
    try {
      const data = await resellerFetch('/mail/mailboxes');
      const serverList = data.mailboxes || [];
      mailboxes = serverList.map((s) => ({
        id: s.id,
        address: s.address,
        displayName: s.displayName || s.address,
        domain: s.domain || 'iecloudbase.com',
        quota: '10 GB',
        aliases: [],
        dnsConfigured: true,
      }));
      saveMailboxes();
    } catch {}
  }
  renderMailDomainsGrid();
  renderEmailTable();
  loadMailGroupsFromServer();
  if (mailDnsInspectorCard && mailDnsInspectorCard.style.display !== 'none') {
    renderMailDnsInspector();
  }
}

function renderMailOutboundBanner() {
  if (mailEngineIp) mailEngineIp.textContent = mailOutboundState.ip || mailOutboundState.elasticIp || '13.51.192.94';
  if (mailEnginePtr) mailEnginePtr.textContent = mailOutboundState.ptrHost || mailOutboundState.reverseDns || 'mail.iecloudbase.com';
  mailOutboundModeBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mailmode === mailOutboundState.mode);
  });
}

mailOutboundModeBtns.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mailmode;
    if (!mode || mode === mailOutboundState.mode) return;
    btn.disabled = true;
    try {
      setStatus(`Switching outbound mail engine to ${mode === 'direct' ? 'Direct Port 25 (Zero Relay)' : 'SMTP Relay Fallback'}...`, 'connected');
      await resellerFetch('/mail/outbound-mode', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      mailOutboundState.mode = mode;
      mailOutboundState.routeTarget = mode === 'direct' ? 'mx' : 'brevo';
      renderMailOutboundBanner();
      setStatus(`Outbound delivery switched to ${mode === 'direct' ? 'Direct Port 25 (Zero Relay)' : 'SMTP Relay Fallback'}`, 'connected');
    } catch (e) {
      setStatus(`Switch outbound mode failed: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });
});

function renderMailDomainsGrid() {
  if (!mailDomainsGrid) return;
  if (mailClearDomainFilterBtn) {
    mailClearDomainFilterBtn.style.display = selectedMailDomain ? 'inline-flex' : 'none';
  }
  const domainsToRender = mailDomains.length > 0
    ? mailDomains
    : [{ id: 'default', domain: 'iecloudbase.com', mailboxCount: mailboxes.filter((m) => m.domain === 'iecloudbase.com').length, dkimSelector: null, dnsRecords: [] }];

  mailDomainsGrid.innerHTML = '';

  domainsToRender.forEach((d) => {
    const domName = d.domain || d.name || 'iecloudbase.com';
    const isSelected = selectedMailDomain === domName;
    const card = document.createElement('div');
    card.style.cssText = `background:${isSelected ? '#f8fafc' : '#fff'}; border:${isSelected ? '2px solid #0f172a' : '1px solid var(--border-subtle)'}; border-radius:10px; padding:14px 16px; cursor:pointer; transition:all 0.15s ease; display:flex; flex-direction:column; justify-content:space-between; gap:10px;`;

    const dkimBadge = d.dkimPublicKey
      ? '<span class="badge badge-running" style="font-size:11px;">DKIM RSA-2048 + Ed25519</span>'
      : '<span class="badge badge-neutral" style="font-size:11px;">DKIM Active</span>';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div>
          <div style="font-weight:700; font-size:14.5px; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
            <span>${domName}</span>
            ${domName === 'iecloudbase.com' ? '<span class="badge badge-neutral" style="font-size:10px;">Primary</span>' : ''}
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${d.description || 'Managed Email Domain'}</div>
        </div>
        ${domName !== 'iecloudbase.com' ? `<button class="btn btn-danger-ghost btn-sm mail-card-del-btn" title="Delete domain" style="padding:2px 7px; font-size:11px;">✕</button>` : ''}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; padding-top:6px; border-top:1px solid var(--border-subtle);">
        <span style="font-size:12px; font-weight:600; color:var(--text-secondary);">${d.mailboxCount || 0} mailbox(es)</span>
        <div style="display:flex; align-items:center; gap:6px;">
          ${dkimBadge}
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.mail-card-del-btn')) return;
      selectedMailDomain = selectedMailDomain === domName ? null : domName;
      emailDomainFilter.value = selectedMailDomain || 'all';
      renderMailDomainsGrid();
      renderEmailTable();
      if (mailDnsInspectorCard && mailDnsInspectorCard.style.display !== 'none') {
        renderMailDnsInspector();
      }
    });

    const delBtn = card.querySelector('.mail-card-del-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteMailDomain(d);
      });
    }

    mailDomainsGrid.appendChild(card);
  });

  // "+ Add Email Domain" card
  const addCard = document.createElement('div');
  addCard.style.cssText = 'background:#fafafa; border:1px dashed var(--border-strong); border-radius:10px; padding:14px 16px; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; min-height:92px; color:var(--text-secondary); transition:all 0.15s ease;';
  addCard.innerHTML = `
    <div style="font-weight:600; font-size:13.5px; color:var(--text-primary);">+ Add Email Domain</div>
    <div style="font-size:11.5px; color:var(--text-muted);">Auto-generate DKIM, SPF &amp; DMARC</div>
  `;
  addCard.addEventListener('click', openAddMailDomainModal);
  mailDomainsGrid.appendChild(addCard);
}

async function deleteMailDomain(domObj) {
  const domName = domObj?.domain || domObj?.name;
  if (!domObj || domName === 'iecloudbase.com') return;
  try {
    setStatus(`Deleting email domain ${domName}...`, 'connected');
    await resellerFetch(`/mail/domains/${encodeURIComponent(domObj.id || domName)}`, { method: 'DELETE' });
    if (selectedMailDomain === domName) {
      selectedMailDomain = null;
      emailDomainFilter.value = 'all';
    }
    await loadMailboxesFromServer();
    setStatus(`Email domain deleted: ${domName}`, 'connected');
  } catch (e) {
    setStatus(`Delete email domain failed: ${e.message}`, 'error');
  }
}

function getActiveInspectorDomainObj() {
  const targetName = selectedMailDomain || (emailDomainFilter.value !== 'all' ? emailDomainFilter.value : 'iecloudbase.com');
  return mailDomains.find((d) => (d.domain || d.name) === targetName) || mailDomains[0] || {
    domain: targetName,
    dnsRecords: [
      { label: 'MX (Inbound Mail)', type: 'MX', host: '@', value: 'mail.iecloudbase.com', priority: 10 },
      { label: 'SPF (Sender Policy)', type: 'TXT', host: '@', value: 'v=spf1 mx a ip4:13.51.192.94 ~all' },
      { label: 'DKIM (v1-rsa-20261119)', type: 'TXT', host: 'v1-rsa-20261119._domainkey', value: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...' },
      { label: 'DMARC (Authentication Policy)', type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:admin@${targetName}` },
    ],
  };
}

function renderMailDnsInspector() {
  if (!mailDnsTbody) return;
  const domObj = getActiveInspectorDomainObj();
  const domName = domObj.domain || domObj.name || 'iecloudbase.com';
  if (mailDnsDomainBadge) mailDnsDomainBadge.textContent = domName;
  const checks = mailDnsVerificationCache[domName]?.checks || null;

  if (mailDnsBadgesRow) {
    if (!checks) {
      mailDnsBadgesRow.innerHTML = `<span class="badge badge-neutral">Click "Verify Live DNS" to test live MX, SPF, DKIM &amp; DMARC records on ${domName}</span>`;
    } else {
      const pill = (name, ok) =>
        `<span class="badge ${ok ? 'badge-running' : 'badge-ephemeral'}">${ok ? '✓ Verified Live:' : 'Pending:'} ${name}</span>`;
      mailDnsBadgesRow.innerHTML = [
        pill('MX (mail.iecloudbase.com)', !!(checks.mx?.valid ?? checks.mx)),
        pill('SPF (13.51.192.94)', !!(checks.spf?.valid ?? checks.spf)),
        pill('DKIM (RSA-2048)', !!(checks.dkim?.valid ?? checks.dkim)),
        pill('DMARC (_dmarc)', !!(checks.dmarc?.valid ?? checks.dmarc)),
      ].join('');
    }
  }

  const records = (domObj.dnsRecords && domObj.dnsRecords.length > 0)
    ? domObj.dnsRecords
    : [
        { label: 'MX (Inbound Mail)', type: 'MX', host: '@', value: 'mail.iecloudbase.com', priority: 10 },
        { label: 'SPF (Sender Policy)', type: 'TXT', host: '@', value: 'v=spf1 mx a ip4:13.51.192.94 ~all' },
        { label: 'DMARC (Authentication Policy)', type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:admin@${domName}` },
      ];
  mailDnsTbody.innerHTML = '';

  records.forEach((rec) => {
    const val = rec.value || rec.answer || '';
    const label = rec.label || (rec.type === 'MX' ? 'MX' : rec.host.includes('_domainkey') ? 'DKIM' : rec.host === '_dmarc' ? 'DMARC' : 'SPF');
    let statusHtml = '';
    if (checks) {
      let ok = false;
      if (rec.type === 'MX') ok = !!(checks.mx?.valid ?? checks.mx);
      else if (label.includes('SPF') || val.includes('v=spf1')) ok = !!(checks.spf?.valid ?? checks.spf);
      else if (label.includes('DKIM') || rec.host.includes('_domainkey')) ok = !!(checks.dkim?.valid ?? checks.dkim);
      else if (label.includes('DMARC') || rec.host === '_dmarc') ok = !!(checks.dmarc?.valid ?? checks.dmarc);
      statusHtml = ok
        ? '<span class="badge badge-running" style="margin-left:6px;">✓ Verified Live</span>'
        : '<span class="badge badge-ephemeral" style="margin-left:6px;">Pending</span>';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap;"><span class="badge badge-neutral">${rec.type}</span> <strong style="font-size:12px; margin-left:4px;">${label}</strong>${statusHtml}</td>
      <td><code style="font-size:11.5px;">${rec.host}</code></td>
      <td style="max-width:260px; width:260px;">
        <div style="font-family:var(--mono); font-size:11px; background:#f8fafc; border:1px solid var(--border); border-radius:6px; padding:5px 7px; word-break:break-all; white-space:normal; max-height:48px; overflow-y:auto;">${val}</div>
      </td>
      <td>${rec.priority || '—'}</td>
      <td style="text-align:right;">
        <button type="button" class="btn btn-secondary btn-sm mail-copy-dns-btn">Copy</button>
      </td>
    `;
    tr.querySelector('.mail-copy-dns-btn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(val);
      setStatus(`Copied ${label} record value to clipboard`, 'connected');
    });
    mailDnsTbody.appendChild(tr);
  });
}

if (mailToggleDnsBtn) {
  mailToggleDnsBtn.addEventListener('click', () => {
    const isHidden = mailDnsInspectorCard.style.display === 'none';
    mailDnsInspectorCard.style.display = isHidden ? 'block' : 'none';
    if (isHidden) renderMailDnsInspector();
  });
}
if (mailVerifyDnsBtn) {
  mailVerifyDnsBtn.addEventListener('click', async () => {
    const domObj = getActiveInspectorDomainObj();
    const domName = domObj.domain || domObj.name || 'iecloudbase.com';
    mailVerifyDnsBtn.disabled = true;
    mailVerifyDnsBtn.textContent = 'Verifying...';
    try {
      const res = await resellerFetch(`/mail/domains/${encodeURIComponent(domName)}/verify-dns`);
      mailDnsVerificationCache[domName] = res;
      renderMailDnsInspector();
      setStatus(res.allValid ? `All DNS & DKIM records verified for ${domName}!` : `Verified live DNS for ${domName}`, 'connected');
    } catch (e) {
      setStatus(`DNS verification failed: ${e.message}`, 'error');
    } finally {
      mailVerifyDnsBtn.disabled = false;
      mailVerifyDnsBtn.textContent = 'Verify Live DNS';
    }
  });
}
if (mailAutoconfigDnsBtn) {
  mailAutoconfigDnsBtn.addEventListener('click', async () => {
    const domObj = getActiveInspectorDomainObj();
    const domName = domObj.domain || domObj.name || 'iecloudbase.com';
    mailAutoconfigDnsBtn.disabled = true;
    mailAutoconfigDnsBtn.textContent = 'Configuring...';
    try {
      for (const rec of (domObj.dnsRecords || [])) {
        await resellerFetch(`/reseller/domains/${encodeURIComponent(domName)}/records`, {
          method: 'POST',
          body: JSON.stringify({
            type: rec.type,
            host: rec.host === '@' ? '' : rec.host,
            answer: rec.value || rec.answer,
            ttl: 3600,
            ...(rec.priority ? { priority: rec.priority } : {}),
          }),
        });
      }
      setStatus(`Auto-configured MX, SPF, DKIM & DMARC records on ${domName}`, 'connected');
      mailVerifyDnsBtn?.click();
    } catch (e) {
      setStatus(`Auto-configure DNS failed: ${e.message}`, 'error');
    } finally {
      mailAutoconfigDnsBtn.disabled = false;
      mailAutoconfigDnsBtn.textContent = 'Auto-Configure DNS';
    }
  });
}

function openAddMailDomainModal() {
  if (!mailAddDomainModalBackdrop) return;
  if (mailNewDomainInput) mailNewDomainInput.value = '';
  mailAddDomainModalBackdrop.classList.add('open');
  mailNewDomainInput?.focus();
}
function closeAddMailDomainModal() {
  mailAddDomainModalBackdrop?.classList.remove('open');
}
$('#mail-dom-modal-close')?.addEventListener('click', closeAddMailDomainModal);
$('#mail-dom-modal-cancel')?.addEventListener('click', closeAddMailDomainModal);

mailAddDomainSubmitBtn?.addEventListener('click', async () => {
  const domain = (mailNewDomainInput?.value || '').trim().toLowerCase();
  if (!domain || !domain.includes('.')) {
    setStatus('Enter a valid domain name (e.g. acme.com)', 'error');
    return;
  }
  mailAddDomainSubmitBtn.disabled = true;
  mailAddDomainSubmitBtn.textContent = 'Adding...';
  try {
    await resellerFetch('/mail/domains', {
      method: 'POST',
      body: JSON.stringify({ domain }),
    });
    selectedMailDomain = domain;
    await loadMailboxesFromServer();
    if (mailNewDomainAutodns?.checked) {
      const createdObj = mailDomains.find((d) => (d.domain || d.name) === domain);
      if (createdObj) {
        for (const rec of (createdObj.dnsRecords || [])) {
          try {
            await resellerFetch(`/reseller/domains/${encodeURIComponent(domain)}/records`, {
              method: 'POST',
              body: JSON.stringify({
                type: rec.type,
                host: rec.host === '@' ? '' : rec.host,
                answer: rec.value || rec.answer,
                ttl: 3600,
                ...(rec.priority ? { priority: rec.priority } : {}),
              }),
            });
          } catch {}
        }
      }
    }
    closeAddMailDomainModal();
    mailDnsInspectorCard.style.display = 'block';
    renderMailDnsInspector();
    setStatus(`Email domain ${domain} added with RSA-2048 & Ed25519 DKIM keys`, 'connected');
  } catch (e) {
    setStatus(`Add email domain failed: ${e.message}`, 'error');
  } finally {
    mailAddDomainSubmitBtn.disabled = false;
    mailAddDomainSubmitBtn.textContent = 'Add Domain';
  }
});

mailRefreshBtn?.addEventListener('click', async () => {
  setStatus('Refreshing Email Hosting & DKIM state...', 'connected');
  await loadMailboxesFromServer();
  setStatus('Email Hosting state refreshed', 'connected');
});

mailDeleteDomainBtn?.addEventListener('click', async () => {
  if (!selectedMailDomain || selectedMailDomain === 'iecloudbase.com') return;
  const domObj = mailDomains.find((d) => (d.domain || d.name) === selectedMailDomain);
  if (domObj) await deleteMailDomain(domObj);
});

// Reset Mailbox Password Modal
if (mailResetPassEyeBtn) {
  mailResetPassEyeBtn.innerHTML = EYE_ICON_SVG;
  mailResetPassEyeBtn.addEventListener('click', () => {
    const isPw = mailResetPassInput.type === 'password';
    mailResetPassInput.type = isPw ? 'text' : 'password';
    mailResetPassEyeBtn.innerHTML = isPw ? EYE_OFF_ICON_SVG : EYE_ICON_SVG;
  });
}
function openResetPassModal(mailbox) {
  activeResetPassMailbox = mailbox;
  if (mailResetPassAddr) mailResetPassAddr.textContent = mailbox.address;
  if (mailResetPassInput) {
    mailResetPassInput.value = '';
    mailResetPassInput.type = 'password';
  }
  if (mailResetPassEyeBtn) mailResetPassEyeBtn.innerHTML = EYE_ICON_SVG;
  mailResetPassModalBackdrop?.classList.add('open');
  mailResetPassInput?.focus();
}
function closeResetPassModal() {
  mailResetPassModalBackdrop?.classList.remove('open');
  activeResetPassMailbox = null;
}
$('#mail-pass-modal-close')?.addEventListener('click', closeResetPassModal);
$('#mail-pass-modal-cancel')?.addEventListener('click', closeResetPassModal);
mailResetPassSubmitBtn?.addEventListener('click', async () => {
  if (!activeResetPassMailbox) return;
  const password = (mailResetPassInput?.value || '').trim();
  if (!password) {
    setStatus('Enter a new password', 'error');
    return;
  }
  mailResetPassSubmitBtn.disabled = true;
  mailResetPassSubmitBtn.textContent = 'Updating...';
  try {
    await resellerFetch(`/mail/mailboxes/${encodeURIComponent(activeResetPassMailbox.id || activeResetPassMailbox.address)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setStatus(`Password updated for ${activeResetPassMailbox.address}`, 'connected');
    closeResetPassModal();
  } catch (e) {
    setStatus(`Password update failed: ${e.message}`, 'error');
  } finally {
    mailResetPassSubmitBtn.disabled = false;
    mailResetPassSubmitBtn.textContent = 'Update Password';
  }
});

// Mailbox Aliases Modal
function renderEditingAliases() {
  if (!mailAliasesList) return;
  if (editingAliases.length === 0) {
    mailAliasesList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px 0;">No aliases configured yet. Add one above (e.g. <code>support@iecloudbase.com</code>).</div>';
    return;
  }
  mailAliasesList.innerHTML = '';
  editingAliases.forEach((alias) => {
    const pill = document.createElement('div');
    pill.style.cssText = 'display:inline-flex; align-items:center; justify-content:space-between; gap:6px; background:#f1f5f9; border:1px solid var(--border); border-radius:8px; padding:6px 10px; font-size:12px; font-family:var(--mono);';
    pill.innerHTML = `<span>${alias}</span><button type="button" style="border:none; background:none; cursor:pointer; color:var(--text-secondary); font-weight:700;">✕</button>`;
    pill.querySelector('button')?.addEventListener('click', () => {
      editingAliases = editingAliases.filter((a) => a !== alias);
      renderEditingAliases();
    });
    mailAliasesList.appendChild(pill);
  });
}
function openAliasesModal(mailbox) {
  activeAliasesMailbox = mailbox;
  editingAliases = [...(mailbox.aliases || [])];
  if (mailAliasesAddr) mailAliasesAddr.textContent = mailbox.address;
  if (mailNewAliasUser) mailNewAliasUser.value = '';
  renderEditingAliases();
  mailAliasesModalBackdrop?.classList.add('open');
  mailNewAliasUser?.focus();
}
function closeAliasesModal() {
  mailAliasesModalBackdrop?.classList.remove('open');
  activeAliasesMailbox = null;
}
$('#mail-alias-modal-close')?.addEventListener('click', closeAliasesModal);
$('#mail-alias-modal-cancel')?.addEventListener('click', closeAliasesModal);
mailAddAliasBtn?.addEventListener('click', () => {
  if (!activeAliasesMailbox) return;
  let raw = (mailNewAliasUser?.value || '').trim().toLowerCase();
  if (!raw) return;
  const dom = activeAliasesMailbox.domain || 'iecloudbase.com';
  const full = raw.includes('@') ? raw : `${raw.replace(/[^a-z0-9._-]/g, '')}@${dom}`;
  if (!editingAliases.includes(full) && full !== activeAliasesMailbox.address) {
    editingAliases.push(full);
    mailNewAliasUser.value = '';
    renderEditingAliases();
  }
});
mailSaveAliasesBtn?.addEventListener('click', async () => {
  if (!activeAliasesMailbox) return;
  mailSaveAliasesBtn.disabled = true;
  mailSaveAliasesBtn.textContent = 'Saving...';
  try {
    await resellerFetch(`/mail/mailboxes/${encodeURIComponent(activeAliasesMailbox.id || activeAliasesMailbox.address)}/aliases`, {
      method: 'POST',
      body: JSON.stringify({ aliases: editingAliases }),
    });
    activeAliasesMailbox.aliases = [...editingAliases];
    saveMailboxes();
    renderEmailTable();
    setStatus(`Saved ${editingAliases.length} alias(es) for ${activeAliasesMailbox.address}`, 'connected');
    closeAliasesModal();
  } catch (e) {
    setStatus(`Save aliases failed: ${e.message}`, 'error');
  } finally {
    mailSaveAliasesBtn.disabled = false;
    mailSaveAliasesBtn.textContent = 'Save Aliases';
  }
});

function saveMailboxes() {
  localStorage.setItem('iecloudbase-mailboxes', JSON.stringify(mailboxes));
  navEmailCount.textContent = mailboxes.length;
}

function updateEmailDomainFilter() {
  const prev = selectedMailDomain || emailDomainFilter.value;
  const domains = [...new Set(['iecloudbase.com', ...mailDomains.map((d) => d.domain || d.name), ...mailboxes.map((m) => m.domain)])];
  emailDomainFilter.innerHTML = '<option value="all">Domain: All</option>';
  domains.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    if (d === prev) opt.selected = true;
    emailDomainFilter.appendChild(opt);
  });
}

function renderEmailTable() {
  navEmailCount.textContent = mailboxes.length;
  updateEmailDomainFilter();
  const q = emailSearchInput.value.trim().toLowerCase();
  const dom = selectedMailDomain || emailDomainFilter.value;

  if (mailSectionTitle) {
    mailSectionTitle.textContent = selectedMailDomain ? `Mailboxes in ${selectedMailDomain}` : 'All Mailboxes';
  }
  if (mailDeleteDomainBtn) {
    mailDeleteDomainBtn.style.display = (selectedMailDomain && selectedMailDomain !== 'iecloudbase.com') ? 'inline-flex' : 'none';
  }

  const filtered = mailboxes.filter((m) => {
    if (dom && dom !== 'all' && m.domain !== dom) return false;
    if (q && !m.address.toLowerCase().includes(q) && !(m.displayName || '').toLowerCase().includes(q)) return false;
    return true;
  });

  emailCountLabel.textContent = `${filtered.length} of ${mailboxes.length} mailbox(es)`;

  if (mailboxes.length === 0) {
    emailTbody.innerHTML = `
      <tr><td colspan="7"><div class="empty-box">
        <h3>No mailboxes yet</h3>
        <p>Create your first <code>@iecloudbase.com</code> account or custom business email.</p>
        <button class="btn btn-primary" id="empty-create-email-btn">+ Create Mailbox</button>
      </div></td></tr>`;
    $('#empty-create-email-btn')?.addEventListener('click', openEmailDrawer);
    return;
  }

  if (filtered.length === 0) {
    emailTbody.innerHTML = '<tr><td colspan="7"><div class="empty-box"><h3>No matching mailboxes</h3></div></td></tr>';
    return;
  }

  emailTbody.innerHTML = '';
  filtered.forEach((m) => {
    const tr = document.createElement('tr');
    const aliasList = Array.isArray(m.aliases) ? m.aliases : [];
    const aliasesHtml = aliasList.length > 0
      ? `<span class="badge badge-neutral" title="${aliasList.join(', ')}">${aliasList.length} alias${aliasList.length > 1 ? 'es' : ''}</span>`
      : '<span style="color:var(--text-muted); font-size:12px;">None</span>';
    const linkedGroup = (typeof mailGroupsList !== 'undefined' && Array.isArray(mailGroupsList))
      ? mailGroupsList.find((g) => g.address.toLowerCase() === m.address.toLowerCase())
      : null;
    const groupBadgeHtml = linkedGroup
      ? ` <span class="badge badge-running" style="margin-left:4px; font-size:10.5px;" title="${(linkedGroup.members || []).length} member(s)">Group (${(linkedGroup.members || []).length})</span>`
      : '';

    tr.innerHTML = `
      <td><span class="mono-id" style="font-weight:600;">${m.address}</span>${groupBadgeHtml}</td>
      <td>${m.displayName || '—'}</td>
      <td><span class="badge badge-neutral">${m.domain}</span></td>
      <td style="color:var(--text-secondary);">${m.quota}</td>
      <td>${aliasesHtml}</td>
      <td><span class="badge badge-running">Active</span></td>
      <td style="text-align:right;"></td>
    `;

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.style.cssText = 'display:inline-flex; gap:4px; align-items:center;';

    const webmailBtn = document.createElement('button');
    webmailBtn.className = 'btn btn-secondary btn-sm';
    webmailBtn.style.cssText = 'padding:4px 8px; font-size:11.5px;';
    webmailBtn.textContent = 'Inbox';
    webmailBtn.addEventListener('click', () => {
      $('#wm-email-input').value = m.address;
      switchView('webmail');
    });

    const groupBtn = document.createElement('button');
    groupBtn.className = 'btn btn-secondary btn-sm';
    groupBtn.style.cssText = 'padding:4px 8px; font-size:11.5px;';
    groupBtn.textContent = linkedGroup ? 'Edit Group' : 'Group Mail';
    groupBtn.addEventListener('click', () => openMailGroupModalForMailbox(m));

    const aliasBtn = document.createElement('button');
    aliasBtn.className = 'btn btn-secondary btn-sm';
    aliasBtn.style.cssText = 'padding:4px 8px; font-size:11.5px;';
    aliasBtn.textContent = 'Aliases';
    aliasBtn.addEventListener('click', () => openAliasesModal(m));

    const passBtn = document.createElement('button');
    passBtn.className = 'btn btn-secondary btn-sm';
    passBtn.style.cssText = 'padding:4px 8px; font-size:11.5px;';
    passBtn.textContent = 'Password';
    passBtn.addEventListener('click', () => openResetPassModal(m));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger-ghost btn-sm';
    delBtn.style.cssText = 'padding:4px 8px; font-size:11.5px;';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      try {
        await resellerFetch(`/mail/mailboxes/${encodeURIComponent(m.address)}`, { method: 'DELETE' });
      } catch {}
      mailboxes = mailboxes.filter((item) => item.address !== m.address);
      saveMailboxes();
      await loadMailboxesFromServer();
      setStatus(`Mailbox deleted: ${m.address}`, 'connected');
    });

    actions.append(webmailBtn, groupBtn, aliasBtn, passBtn, delBtn);
    tr.lastElementChild.appendChild(actions);
    emailTbody.appendChild(tr);
  });
}

function updateEmailPreview() {
  const rawUser = emailUsernameInput.value.trim();
  const user = (rawUser.includes('@') ? rawUser.split('@')[0] : rawUser) || 'hello';
  const typedDomain = rawUser.includes('@') ? rawUser.split('@')[1] : '';
  const domain = emailDrawerMode === 'free'
    ? 'iecloudbase.com'
    : (emailCustomDomainInput.value.trim() || typedDomain || 'yourdomain.com');
  emailPreviewAddr.textContent = `${user}@${domain}`;
}

let emailDrawerPurpose = 'mailbox';
let drawerGroupMembers = [];

function renderDrawerGroupMembers() {
  const listEl = $('#email-drawer-group-members-list');
  if (!listEl) return;
  if (drawerGroupMembers.length === 0) {
    listEl.innerHTML = '<span style="font-size:12px; color:var(--text-muted);">No members yet. Add member emails above.</span>';
    return;
  }
  listEl.innerHTML = '';
  drawerGroupMembers.forEach((m) => {
    const pill = document.createElement('span');
    pill.className = 'badge badge-neutral';
    pill.style.cssText = 'display:inline-flex; align-items:center; gap:5px; padding:4px 8px; font-size:11.5px;';
    pill.innerHTML = `<span>${m}</span><button type="button" style="border:none; background:none; cursor:pointer; font-weight:700; color:var(--text-muted); padding:0 2px;">×</button>`;
    pill.querySelector('button').addEventListener('click', () => {
      drawerGroupMembers = drawerGroupMembers.filter((x) => x !== m);
      renderDrawerGroupMembers();
    });
    listEl.appendChild(pill);
  });
}

function setEmailDrawerPurpose(purpose) {
  emailDrawerPurpose = purpose === 'group' ? 'group' : 'mailbox';
  $$('#email-purpose-toggle .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.epurpose === emailDrawerPurpose));
  const isGrp = emailDrawerPurpose === 'group';
  const personalFields = $('#email-personal-fields');
  const groupFields = $('#email-group-fields');
  const dispLabel = $('#email-displayname-label');
  if (personalFields) personalFields.style.display = isGrp ? 'none' : 'block';
  if (groupFields) groupFields.style.display = isGrp ? 'block' : 'none';
  if (dispLabel) dispLabel.textContent = isGrp ? 'Group Name' : 'Display Name';
  if (emailDisplaynameInput) emailDisplaynameInput.placeholder = isGrp ? 'e.g. Engineering Team' : 'e.g. John Doe';
  emailDrawerSubmitBtn.textContent = isGrp ? 'Create Group Mail' : 'Create Mailbox';
}

$$('#email-purpose-toggle .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => setEmailDrawerPurpose(btn.dataset.epurpose));
});

$('#email-drawer-group-add-member-btn')?.addEventListener('click', () => {
  const inp = $('#email-drawer-group-member-input');
  const val = (inp?.value || '').trim().toLowerCase();
  if (!val || !val.includes('@')) return setStatus('Enter a valid member email address', 'error');
  if (!drawerGroupMembers.includes(val)) {
    drawerGroupMembers.push(val);
    inp.value = '';
    renderDrawerGroupMembers();
  }
});

function openEmailDrawer() {
  setEmailDrawerPurpose('mailbox');
  drawerGroupMembers = [];
  renderDrawerGroupMembers();
  if (selectedMailDomain && selectedMailDomain !== 'iecloudbase.com') {
    emailDrawerMode = 'business';
    emailModeButtons.forEach((b) => b.classList.toggle('active', b.dataset.emode === 'business'));
    emailCustomDomainGroup.style.display = 'block';
    emailAutodnsGroup.style.display = 'block';
    emailCustomDomainInput.value = selectedMailDomain;
  }
  updateEmailPreview();
  emailDrawerBackdrop.classList.add('open');
  emailUsernameInput.focus();
}

function closeEmailDrawer() {
  emailDrawerBackdrop.classList.remove('open');
}

openEmailDrawerBtn.addEventListener('click', openEmailDrawer);
closeEmailDrawerBtn.addEventListener('click', closeEmailDrawer);
emailDrawerCancelBtn.addEventListener('click', closeEmailDrawer);
emailDrawerBackdrop.addEventListener('click', (e) => {
  if (e.target === emailDrawerBackdrop) closeEmailDrawer();
});

emailModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    emailDrawerMode = btn.dataset.emode;
    emailModeButtons.forEach((b) => b.classList.toggle('active', b === btn));
    const isBiz = emailDrawerMode === 'business';
    emailCustomDomainGroup.style.display = isBiz ? 'block' : 'none';
    emailAutodnsGroup.style.display = isBiz ? 'block' : 'none';
    updateEmailPreview();
  });
});

emailUsernameInput.addEventListener('input', updateEmailPreview);
emailCustomDomainInput.addEventListener('input', updateEmailPreview);

emailGenPassBtn.addEventListener('click', () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let pw = '';
  for (let i = 0; i < 14; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  emailPasswordInput.value = pw;
});

emailDrawerSubmitBtn.addEventListener('click', async () => {
  const rawUser = emailUsernameInput.value.trim().toLowerCase();
  const userPart = rawUser.includes('@') ? rawUser.split('@')[0] : rawUser;
  const typedDom = rawUser.includes('@') ? rawUser.split('@')[1] : '';
  const user = userPart.replace(/[^a-z0-9._-]/g, '');
  const domain = emailDrawerMode === 'free'
    ? 'iecloudbase.com'
    : (emailCustomDomainInput.value.trim().toLowerCase() || typedDom);
  const password = emailPasswordInput.value.trim();

  if (emailDrawerPurpose === 'group') {
    if (!user || !domain) {
      setStatus('Enter group username and domain', 'error');
      return;
    }
    emailDrawerSubmitBtn.disabled = true;
    emailDrawerSubmitBtn.textContent = 'Creating...';
    const address = `${user}@${domain}`;
    try {
      await resellerFetch('/mail/groups', {
        method: 'POST',
        body: JSON.stringify({
          username: user,
          domain,
          name: emailDisplaynameInput.value.trim() || user,
          members: drawerGroupMembers,
          deliveryMode: $('#email-drawer-group-delivery')?.value || 'all_members',
          replyMode: $('#email-drawer-group-reply')?.value || 'group',
          postPermission: $('#email-drawer-group-perm')?.value || 'anyone',
        }),
      });
      if (emailDrawerMode === 'business' && emailAutodnsCheckbox.checked) {
        try {
          await resellerFetch(`/reseller/domains/${encodeURIComponent(domain)}/records`, {
            method: 'POST',
            body: JSON.stringify({ type: 'MX', host: '', answer: 'mail.iecloudbase.com', ttl: 3600, priority: 10 }),
          });
          await resellerFetch(`/reseller/domains/${encodeURIComponent(domain)}/records`, {
            method: 'POST',
            body: JSON.stringify({ type: 'TXT', host: '', answer: 'v=spf1 mx a ip4:13.51.192.94 ~all', ttl: 3600 }),
          });
        } catch {}
      }
      await loadMailGroupsFromServer();
      emailUsernameInput.value = '';
      emailDisplaynameInput.value = '';
      drawerGroupMembers = [];
      renderDrawerGroupMembers();
      closeEmailDrawer();
      setStatus(`Group Mail created: ${address}`, 'connected');
    } catch (e) {
      setStatus(`Create Group Mail failed: ${e.message}`, 'error');
    } finally {
      emailDrawerSubmitBtn.disabled = false;
      emailDrawerSubmitBtn.textContent = 'Create Group Mail';
    }
    return;
  }

  if (!user || !domain || !password) {
    setStatus('Enter username, domain, and password', 'error');
    return;
  }

  emailDrawerSubmitBtn.disabled = true;
  emailDrawerSubmitBtn.textContent = 'Creating...';
  const address = `${user}@${domain}`;
  const quotaGb = parseInt(emailQuotaSelect.value, 10) || 10;

  try {
    await resellerFetch('/mail/mailboxes', {
      method: 'POST',
      body: JSON.stringify({
        address,
        domain,
        displayName: emailDisplaynameInput.value.trim() || user,
        password,
        quotaBytes: quotaGb * 1024 * 1024 * 1024,
      }),
    });

    if (emailDrawerMode === 'business' && emailAutodnsCheckbox.checked) {
      try {
        await resellerFetch(`/reseller/domains/${encodeURIComponent(domain)}/records`, {
          method: 'POST',
          body: JSON.stringify({ type: 'MX', host: '', answer: 'mail.iecloudbase.com', ttl: 3600, priority: 10 }),
        });
        await resellerFetch(`/reseller/domains/${encodeURIComponent(domain)}/records`, {
          method: 'POST',
          body: JSON.stringify({ type: 'TXT', host: '', answer: 'v=spf1 mx a ip4:13.51.192.94 ~all', ttl: 3600 }),
        });
      } catch {}
    }

    await loadMailboxesFromServer();

    emailUsernameInput.value = '';
    emailDisplaynameInput.value = '';
    emailPasswordInput.value = '';
    closeEmailDrawer();
    setStatus(`Mailbox provisioned in Stalwart: ${address}`, 'connected');
  } catch (e) {
    setStatus(`Create mailbox failed: ${e.message}`, 'error');
  } finally {
    emailDrawerSubmitBtn.disabled = false;
    emailDrawerSubmitBtn.textContent = 'Create Mailbox';
  }
});

emailSearchInput.addEventListener('input', renderEmailTable);
emailDomainFilter.addEventListener('change', () => {
  selectedMailDomain = emailDomainFilter.value === 'all' ? null : emailDomainFilter.value;
  renderMailDomainsGrid();
  renderEmailTable();
});
renderEmailTable();

// ============================================================================
// --- CUSTOM WEBMAIL INBOX (RFC 8621 JMAP via http://localhost:4000) ---
// ============================================================================
const wmLoginScreen = $('#wm-login-screen');
const wmAppScreen = $('#wm-app-screen');
const wmEmailInput = $('#wm-email-input');
const wmPassInput = $('#wm-pass-input');
const wmLoginBtn = $('#wm-login-btn');
const wmLoginErr = $('#wm-login-err');
const wmSignedEmail = $('#wm-signed-email');
const wmLogoutBtn = $('#wm-logout-btn');
const wmFoldersList = $('#wm-folders-list');
const wmSearchInput = $('#wm-search-input');
const wmRefreshBtn = $('#wm-refresh-btn');
const wmMessagesList = $('#wm-messages-list');
const wmReaderPane = $('#wm-reader-pane');

const wmComposeBtn = $('#wm-compose-btn');
const wmComposeBackdrop = $('#wm-compose-backdrop');
const wmComposeCloseBtn = $('#wm-compose-close-btn');
const wmComposeCancelBtn = $('#wm-compose-cancel-btn');
const wmComposeSendBtn = $('#wm-compose-send-btn');
const wmComposeTo = $('#wm-compose-to');
const wmComposeSubject = $('#wm-compose-subject');
const wmComposeBody = $('#wm-compose-body');
const wmComposeRecallable = $('#wm-compose-recallable');
const wmComposeRecallMode = $('#wm-compose-recall-mode');
const wmComposeRecallWindow = $('#wm-compose-recall-window');
const wmComposeAttachBtn = $('#wm-compose-attach-btn');
const wmComposeFileInput = $('#wm-compose-file-input');
const wmComposeFilesList = $('#wm-compose-files-list');

let wmComposeAttachments = []; // [{ name, type, size, dataBase64 }]

function renderWmComposeAttachments() {
  if (!wmComposeFilesList) return;
  wmComposeFilesList.innerHTML = '';
  wmComposeAttachments.forEach((att, idx) => {
    const kb = att.size < 1024 ? `${att.size} B` : att.size < 1048576 ? `${(att.size / 1024).toFixed(1)} KB` : `${(att.size / 1048576).toFixed(2)} MB`;
    const pill = document.createElement('div');
    pill.style.cssText = 'display:inline-flex; align-items:center; gap:6px; background:#f1f5f9; border:1px solid var(--border); border-radius:6px; padding:4px 8px; font-size:12px;';
    pill.innerHTML = `<span>📎 ${att.name}</span><span style="color:var(--text-muted);">(${kb})</span><button type="button" style="border:none;background:none;cursor:pointer;font-weight:700;color:var(--text-secondary);">✕</button>`;
    pill.querySelector('button')?.addEventListener('click', () => {
      wmComposeAttachments.splice(idx, 1);
      renderWmComposeAttachments();
    });
    wmComposeFilesList.appendChild(pill);
  });
}

wmComposeAttachBtn?.addEventListener('click', () => wmComposeFileInput?.click());
wmComposeFileInput?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      setStatus(`File ${file.name} exceeds 10 MB limit`, 'error');
      continue;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    wmComposeAttachments.push({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      dataBase64: btoa(binary),
    });
  }
  e.target.value = '';
  renderWmComposeAttachments();
});

wmComposeRecallable?.addEventListener('change', () => {
  const dis = !wmComposeRecallable.checked;
  if (wmComposeRecallWindow) wmComposeRecallWindow.disabled = dis;
  if (wmComposeRecallMode) wmComposeRecallMode.disabled = dis;
});

let wmSession = null; // { email, password, folders }
let wmActiveFolderId = null;
let wmMessages = [];
let wmSelectedMsgId = null;

function formatMailDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function wmSignIn(email, password) {
  wmLoginBtn.disabled = true;
  wmLoginBtn.textContent = 'Signing in...';
  wmLoginErr.style.display = 'none';
  try {
    const data = await resellerFetch('/webmail/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    wmSession = { email, password, folders: data.folders || [] };
    sessionStorage.setItem('iecloudbase-wm', JSON.stringify({ email, password }));
    wmSignedEmail.textContent = email;
    wmLoginScreen.style.display = 'none';
    wmAppScreen.style.display = 'grid';
    renderWmFolders();
    const inbox = wmSession.folders.find((f) => f.role === 'inbox') || wmSession.folders[0];
    if (inbox) {
      wmActiveFolderId = inbox.id;
      renderWmFolders();
      await loadWmMessages();
    }
    loadWmContactGroups();
    setStatus(`Webmail: ${email}`, 'connected');
  } catch (e) {
    wmLoginErr.textContent = e.message;
    wmLoginErr.style.display = 'block';
  } finally {
    wmLoginBtn.disabled = false;
    wmLoginBtn.textContent = 'Sign In to Inbox';
  }
}

// Webmail Sign In / Create Account tabs & signup handler
(function initWmAuthTabs() {
  const tabIn = $('#wm-auth-tab-signin');
  const tabUp = $('#wm-auth-tab-signup');
  const formIn = $('#wm-signin-form');
  const formUp = $('#wm-signup-form');
  const sub = $('#wm-auth-subtitle');
  const signupBtn = $('#wm-signup-btn');
  if (!tabIn || !tabUp || !formIn || !formUp) return;

  function setAuthMode(mode) {
    const isUp = mode === 'signup';
    tabIn.classList.toggle('active', !isUp);
    tabUp.classList.toggle('active', isUp);
    formIn.style.display = isUp ? 'none' : 'block';
    formUp.style.display = isUp ? 'block' : 'none';
    if (sub) {
      sub.textContent = isUp
        ? 'Create your free @iecloudbase.com email address'
        : 'Sign in with any @iecloudbase.com or custom domain mailbox';
    }
    if (wmLoginErr) wmLoginErr.style.display = 'none';
  }

  tabIn.addEventListener('click', () => setAuthMode('signin'));
  tabUp.addEventListener('click', () => setAuthMode('signup'));

  signupBtn?.addEventListener('click', async () => {
    const displayName = ($('#wm-signup-name')?.value || '').trim();
    const username = ($('#wm-signup-user')?.value || '').trim().toLowerCase();
    const password = $('#wm-signup-pass')?.value || '';
    const password2 = $('#wm-signup-pass2')?.value || '';
    wmLoginErr.style.display = 'none';

    if (!username || username.length < 2) {
      wmLoginErr.textContent = 'Choose a username (at least 2 characters).';
      wmLoginErr.style.display = 'block';
      return;
    }
    if (password.length < 6) {
      wmLoginErr.textContent = 'Password must be at least 6 characters.';
      wmLoginErr.style.display = 'block';
      return;
    }
    if (password !== password2) {
      wmLoginErr.textContent = 'Passwords do not match.';
      wmLoginErr.style.display = 'block';
      return;
    }

    signupBtn.disabled = true;
    signupBtn.textContent = 'Creating account...';
    try {
      const data = await resellerFetch('/webmail/signup', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, password }),
      });
      if ($('#wm-email-input')) $('#wm-email-input').value = data.address;
      if ($('#wm-pass-input')) $('#wm-pass-input').value = password;
      setAuthMode('signin');
      await wmSignIn(data.address, password);
      setStatus(`Welcome! Created ${data.address}`, 'connected');
    } catch (e) {
      wmLoginErr.textContent = e.message || 'Sign up failed';
      wmLoginErr.style.display = 'block';
    } finally {
      signupBtn.disabled = false;
      signupBtn.textContent = 'Create @iecloudbase.com Account';
    }
  });
})();

wmLoginBtn.addEventListener('click', () => {
  const email = wmEmailInput.value.trim();
  const pass = wmPassInput.value;
  if (!email || !pass) return;
  wmSignIn(email, pass);
});

wmPassInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') wmLoginBtn.click();
});

wmLogoutBtn.addEventListener('click', () => {
  wmSession = null;
  wmActiveFolderId = null;
  wmMessages = [];
  wmSelectedMsgId = null;
  sessionStorage.removeItem('iecloudbase-wm');
  wmAppScreen.style.display = 'none';
  wmLoginScreen.style.display = 'flex';
  wmPassInput.value = '';
});

function renderWmFolders() {
  if (!wmSession) return;
  const order = { inbox: 1, sent: 2, drafts: 3, junk: 4, trash: 5 };
  const sorted = [...wmSession.folders].sort((a, b) => (order[a.role] || 99) - (order[b.role] || 99));
  wmFoldersList.innerHTML = '';
  sorted.forEach((f) => {
    const btn = document.createElement('button');
    btn.className = `wm-folder-btn ${f.id === wmActiveFolderId ? 'active' : ''}`;
    btn.innerHTML = `<span>${f.name}</span>${f.unreadEmails > 0 ? `<span class="nav-pill">${f.unreadEmails}</span>` : ''}`;
    btn.addEventListener('click', async () => {
      wmActiveFolderId = f.id;
      wmSelectedMsgId = null;
      renderWmFolders();
      await loadWmMessages();
    });
    wmFoldersList.appendChild(btn);
  });
}

async function loadWmMessages() {
  if (!wmSession) return;
  wmMessagesList.innerHTML = '<div class="empty-box"><p>Loading messages...</p></div>';
  try {
    const data = await resellerFetch('/webmail/messages', {
      method: 'POST',
      body: JSON.stringify({
        email: wmSession.email,
        password: wmSession.password,
        mailboxId: wmActiveFolderId,
        query: wmSearchInput.value.trim() || undefined,
      }),
    });
    wmMessages = data.messages || [];
    renderWmMessages();
  } catch (e) {
    wmMessagesList.innerHTML = `<div class="empty-box"><p style="color:var(--danger);">${e.message}</p></div>`;
  }
}

function renderWmMessages() {
  if (wmMessages.length === 0) {
    wmMessagesList.innerHTML = '<div class="empty-box"><h3>No messages</h3><p>This folder is empty.</p></div>';
    return;
  }
  wmMessagesList.innerHTML = '';
  wmMessages.forEach((m) => {
    const div = document.createElement('div');
    div.className = `wm-msg-item ${m.unread ? 'unread' : ''} ${m.id === wmSelectedMsgId ? 'active' : ''}`;
    const recalledBadge = m.recallInfo?.recalled
      ? '<span class="badge badge-ephemeral" style="font-size:10px; padding:1px 6px; margin-left:6px;">Recalled</span>'
      : '';
    div.innerHTML = `
      <div class="wm-msg-top">
        <span class="wm-msg-sender">${m.fromName}${recalledBadge}</span>
        <span class="wm-msg-date">${formatMailDate(m.receivedAt)}</span>
      </div>
      <div class="wm-msg-subj">${m.subject}</div>
      <div class="wm-msg-prev">${m.preview}</div>
    `;
    div.addEventListener('click', () => {
      wmSelectedMsgId = m.id;
      renderWmMessages();
      renderWmReader(m);
    });
    wmMessagesList.appendChild(div);
  });
}

function renderWmReader(m) {
  wmReaderPane.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'wm-reader-head';

  const subj = document.createElement('div');
  subj.className = 'wm-reader-subject';
  subj.textContent = m.subject;
  if (m.recallInfo?.recalled) {
    const tag = document.createElement('span');
    tag.className = 'badge badge-ephemeral';
    tag.style.cssText = 'margin-left:10px; font-size:11px; vertical-align:middle;';
    tag.textContent = 'Recalled';
    subj.appendChild(tag);
  }

  const meta = document.createElement('div');
  meta.className = 'wm-reader-meta';

  const info = document.createElement('div');
  info.innerHTML = `<div><strong>From:</strong> ${m.from}</div><div><strong>To:</strong> ${m.to || wmSession.email} · ${formatMailDate(m.receivedAt)}</div>`;

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;';

  const activeFolder = (wmSession?.folders || []).find((f) => f.id === wmActiveFolderId);
  const isSentMessage =
    activeFolder?.role === 'sent' ||
    (m.from || '').toLowerCase() === (wmSession?.email || '').toLowerCase();

  if (isSentMessage) {
    const recallBtn = document.createElement('button');
    const isRecalled = Boolean(m.recallInfo?.recalled);
    recallBtn.className = isRecalled ? 'btn btn-secondary btn-sm' : 'btn btn-danger-ghost btn-sm';
    recallBtn.textContent = isRecalled ? 'Recalled ✓' : '↩ Recall Email';
    recallBtn.disabled = isRecalled;
    if (!isRecalled) {
      recallBtn.addEventListener('click', async () => {
        recallBtn.disabled = true;
        recallBtn.textContent = 'Recalling...';
        try {
          const res = await resellerFetch('/webmail/recall', {
            method: 'POST',
            body: JSON.stringify({
              email: wmSession.email,
              password: wmSession.password,
              messageId: m.id,
              recallId: m.recallInfo?.recallId || undefined,
            }),
          });
          m.recallInfo = {
            ...(m.recallInfo || {}),
            recalled: true,
            recalledAt: res.recalledAt || new Date().toISOString(),
          };
          const extracted = Array.isArray(res.extractedRecipients) && res.extractedRecipients.length > 0
            ? `Removed from ${res.extractedRecipients.join(', ')}`
            : 'Vault access revoked';
          setStatus(`Email recalled — ${extracted}`, 'connected');
          renderWmMessages();
          renderWmReader(m);
        } catch (e) {
          setStatus(`Recall failed: ${e.message}`, 'error');
          recallBtn.disabled = false;
          recallBtn.textContent = '↩ Recall Email';
        }
      });
    }
    btns.appendChild(recallBtn);
  }

  const replyBtn = document.createElement('button');
  replyBtn.className = 'btn btn-secondary btn-sm';
  replyBtn.textContent = 'Reply';
  replyBtn.addEventListener('click', () => {
    wmComposeTo.value = m.from;
    wmComposeSubject.value = m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`;
    wmComposeBody.value = `\n\n--- Original Message ---\n${m.body}`;
    wmComposeBackdrop.classList.add('open');
    wmComposeBody.focus();
  });

  const isTrashFolder =
    activeFolder?.role === 'trash' ||
    (activeFolder?.name || '').toLowerCase().includes('deleted') ||
    (activeFolder?.name || '').toLowerCase().includes('trash');

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger-ghost btn-sm';
  delBtn.textContent = isTrashFolder ? 'Delete Forever' : 'Delete';
  delBtn.addEventListener('click', async () => {
    const res = await resellerFetch('/webmail/delete', {
      method: 'POST',
      body: JSON.stringify({
        email: wmSession.email,
        password: wmSession.password,
        messageId: m.id,
        permanent: isTrashFolder,
      }),
    });
    wmSelectedMsgId = null;
    wmReaderPane.innerHTML = `<div class="empty-box" style="margin:auto;"><h3>${res?.movedToTrash ? 'Moved to Deleted Items' : 'Message permanently deleted'}</h3></div>`;
    setStatus(res?.movedToTrash ? 'Moved message to Deleted Items' : 'Message permanently deleted', 'connected');
    await loadWmMessages();
  });

  btns.append(replyBtn, delBtn);
  meta.append(info, btns);
  head.append(subj, meta);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'wm-reader-body';
  bodyEl.textContent = m.body;

  wmReaderPane.append(head, bodyEl);
}

wmRefreshBtn.addEventListener('click', loadWmMessages);
wmSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadWmMessages(); });

function openWmCompose() {
  wmComposeTo.value = '';
  wmComposeSubject.value = '';
  wmComposeBody.value = '';
  wmComposeAttachments = [];
  renderWmComposeAttachments();
  if (wmComposeRecallable) wmComposeRecallable.checked = true;
  if (wmComposeRecallMode) {
    wmComposeRecallMode.value = 'zero_cache';
    wmComposeRecallMode.disabled = false;
  }
  if (wmComposeRecallWindow) {
    wmComposeRecallWindow.value = '0';
    wmComposeRecallWindow.disabled = false;
  }
  loadWmContactGroups();
  wmComposeBackdrop.classList.add('open');
  wmComposeTo.focus();
}

function closeWmCompose() {
  wmComposeBackdrop.classList.remove('open');
}

wmComposeBtn.addEventListener('click', openWmCompose);
wmComposeCloseBtn.addEventListener('click', closeWmCompose);
wmComposeCancelBtn.addEventListener('click', closeWmCompose);
wmComposeBackdrop.addEventListener('click', (e) => { if (e.target === wmComposeBackdrop) closeWmCompose(); });

wmComposeSendBtn.addEventListener('click', async () => {
  if (!wmSession) return;
  const to = wmComposeTo.value.trim();
  if (!to) return;
  wmComposeSendBtn.disabled = true;
  wmComposeSendBtn.textContent = 'Sending...';
  try {
    await resellerFetch('/webmail/send', {
      method: 'POST',
      body: JSON.stringify({
        email: wmSession.email,
        password: wmSession.password,
        to,
        subject: wmComposeSubject.value.trim(),
        body: wmComposeBody.value,
        attachments: wmComposeAttachments,
        recallable: wmComposeRecallable ? wmComposeRecallable.checked : false,
        recallMode: wmComposeRecallMode ? wmComposeRecallMode.value : 'zero_cache',
        recallWindowHours: wmComposeRecallWindow ? parseInt(wmComposeRecallWindow.value, 10) || 0 : 0,
      }),
    });
    closeWmCompose();
    setStatus(`Email sent to ${to}`, 'connected');
    await loadWmMessages();
  } catch (e) {
    setStatus(`Send failed: ${e.message}`, 'error');
  } finally {
    wmComposeSendBtn.disabled = false;
    wmComposeSendBtn.textContent = 'Send Email';
  }
});

// Restore webmail session if already signed in this browser tab
try {
  const savedWm = JSON.parse(sessionStorage.getItem('iecloudbase-wm') || 'null');
  if (savedWm?.email && savedWm?.password) {
    wmEmailInput.value = savedWm.email;
    wmPassInput.value = savedWm.password;
  }
} catch {}

// ============================================================================
// --- APP HOSTING (Render-Style Overview, Projects, Blueprints & Databases) ---
// ============================================================================
const navAppsCount = $('#nav-apps-count');
const paasConnBadge = $('#paas-conn-badge');
const appsRefreshBtn = $('#apps-refresh-btn');
const appsSearchInput = $('#apps-search-input');
const appsSourceFilter = $('#apps-source-filter');
const appsTbody = $('#apps-tbody');
const appsCountLabel = $('#apps-count-label');
const appLogsCard = $('#app-logs-card');
const appLogsCloseBtn = $('#app-logs-close-btn');

const paasViewOverview = $('#paas-view-overview');
const paasViewBpStep1 = $('#paas-view-bp-step1');
const paasViewBpStep2 = $('#paas-view-bp-step2');
const paasNewDropdownBtn = $('#paas-new-dropdown-btn');
const paasNewMenu = $('#paas-new-menu');
const paasProjectsGrid = $('#paas-projects-grid');
const paasClearProjectFilter = $('#paas-clear-project-filter');
const paasServicesHeading = $('#paas-services-heading');
const paasStatusTabs = $$('#paas-status-tabs .paas-status-tab');
const paasTabActiveCount = $('#paas-tab-active-count');
const paasTabSuspendedCount = $('#paas-tab-suspended-count');
const paasTabAllCount = $('#paas-tab-all-count');
const paasTableBadgeCount = $('#paas-table-badge-count');

const appDrawerBackdrop = $('#app-drawer-backdrop');
const openAppDrawerBtn = $('#open-app-drawer-btn');
const closeAppDrawerBtn = $('#close-app-drawer-btn');
const appDrawerCancelBtn = $('#app-drawer-cancel-btn');
const appDrawerSubmitBtn = $('#app-drawer-submit-btn');
const appNameInput = $('#app-name-input');
const appUrlPreview = $('#app-url-preview');
const appSourceButtons = $$('#app-source-toggle .seg-btn');
const appSrcGit = $('#app-src-git');
const appSrcDocker = $('#app-src-docker');
const appSrcBlueprint = $('#app-src-blueprint');
const appGitUrlInput = $('#app-git-url');
const appGitBranchInput = $('#app-git-branch');
const appBuildCmdInput = $('#app-build-cmd');
const appStartCmdInput = $('#app-start-cmd');
const appDockerImageInput = $('#app-docker-image');
const appBlueprintYamlInput = $('#app-blueprint-yaml');
const appPortInput = $('#app-port-input');
const appEnvInput = $('#app-env-input');

const paasQuickModalBackdrop = $('#paas-quick-modal-backdrop');
const paasQuickModalTitle = $('#paas-quick-modal-title');
const paasQuickModalBody = $('#paas-quick-modal-body');
const paasQuickModalClose = $('#paas-quick-modal-close');
const paasQuickModalCancel = $('#paas-quick-modal-cancel');
const paasQuickModalSubmit = $('#paas-quick-modal-submit');

// Blueprint Step 1 & Step 2 elements
const bpBackOverviewBtn = $('#bp-back-overview-btn');
const bpBackStep1Btn = $('#bp-back-step1-btn');
const bpRepoSearch = $('#bp-repo-search');
const bpRepoList = $('#bp-repo-list');
const bpPublicRepoInput = $('#bp-public-repo-input');
const bpPublicRepoContinue = $('#bp-public-repo-continue');
const bpGhStatus = $('#bp-gh-status');
const bpGhConfigBtn = $('#bp-gh-config-btn');
const bpGhConnectBox = $('#bp-gh-connect-box');
const bpGhUsernameInput = $('#bp-gh-username-input');
const bpGhTokenInput = $('#bp-gh-token-input');
const bpGhSaveBtn = $('#bp-gh-save-btn');
const bpGhCancelBtn = $('#bp-gh-cancel-btn');
const bpGhDisconnectBtn = $('#bp-gh-disconnect-btn');
const bpSelectedRepoLabel = $('#bp-selected-repo-label');
const bpReviewRepoLabel = $('#bp-review-repo-label');
const bpNameInput = $('#bp-name-input');
const bpBranchSelect = $('#bp-branch-select');
const bpPathInput = $('#bp-path-input');
const bpReviewArea = $('#bp-review-area');

let paasProjects = [];
let hostedApps = [];
let selectedProjectId = null;
let paasStatusTab = 'active';
let appDrawerSource = 'git';
let paasQuickModalMode = null;

// Blueprint state
let bpRepos = [];
let bpGitConfig = { connected: false, username: '', repoCount: 0, hasToken: false };
let bpSelectedRepo = null;
let bpLastInspect = null;

function paasTimeAgo(iso) {
  if (!iso) return 'Just now';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function showPaasSubview(which) {
  paasViewOverview?.classList.toggle('active', which === 'overview');
  paasViewBpStep1?.classList.toggle('active', which === 'bp-step1');
  paasViewBpStep2?.classList.toggle('active', which === 'bp-step2');
  $('#paas-view-service-detail')?.classList.toggle('active', which === 'service-detail');
  $('#paas-view-static-new')?.classList.toggle('active', which === 'static-new');
  $('#paas-view-web-new')?.classList.toggle('active', which === 'web-new');
  $('#paas-view-postgres-new')?.classList.toggle('active', which === 'postgres-new');
  $('#paas-view-kv-new')?.classList.toggle('active', which === 'kv-new');
}

function paasServiceIcon(kind) {
  if (kind === 'postgres') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--text-secondary); flex-shrink:0;"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/></svg>';
  if (kind === 'redis') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--text-secondary); flex-shrink:0;"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';
  if (kind === 'blueprint') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--text-secondary); flex-shrink:0;"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>';
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--text-secondary); flex-shrink:0;"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
}

const paasDeleteProjectBtn = $('#paas-delete-project-btn');

async function deletePaasProject(proj) {
  if (!proj) return;
  const msg = proj.serviceCount > 0
    ? `Delete project "${proj.name}" and ALL ${proj.serviceCount} service(s) inside it? This cannot be undone.`
    : `Delete project "${proj.name}"? This cannot be undone.`;
  if (!window.confirm(msg)) return;
  try {
    setStatus(`Deleting project ${proj.name}...`, 'connected');
    await resellerFetch(`/paas/projects/${encodeURIComponent(proj.id)}`, { method: 'DELETE' });
    if (selectedProjectId === proj.id) selectedProjectId = null;
    setStatus(`Deleted project: ${proj.name}`, 'connected');
    await loadHostedApps();
  } catch (e) {
    setStatus(`Delete project failed: ${e.message}`, 'error');
  }
}

paasDeleteProjectBtn?.addEventListener('click', () => {
  const proj = paasProjects.find((p) => p.id === selectedProjectId);
  if (proj) deletePaasProject(proj);
});

function syncSelectedProjectHeader() {
  const proj = paasProjects.find((p) => p.id === selectedProjectId);
  if (paasClearProjectFilter) paasClearProjectFilter.style.display = proj ? 'inline-flex' : 'none';
  if (paasDeleteProjectBtn) paasDeleteProjectBtn.style.display = proj ? 'inline-flex' : 'none';
  if (paasServicesHeading) paasServicesHeading.textContent = proj ? `Services in ${proj.name}` : 'All Services';
}

async function loadHostedApps() {
  try {
    const data = await resellerFetch('/paas/overview');
    paasProjects = data.projects || [];
    hostedApps = data.services || [];
    navAppsCount.textContent = hostedApps.length;
    if (paasConnBadge) {
      paasConnBadge.textContent = 'Connected';
      paasConnBadge.className = 'badge badge-running';
    }
    if (selectedProjectId && !paasProjects.some((p) => p.id === selectedProjectId)) {
      selectedProjectId = null;
    }
    if (!selectedProjectId && paasProjects.length > 0) {
      const def = paasProjects.find((p) => p.serviceCount > 0) || paasProjects[0];
      selectedProjectId = def.id;
    }
    syncSelectedProjectHeader();
    renderPaasProjects();
    renderHostedAppsTable();
    setStatus(`App Hosting · ${hostedApps.length} service(s)`, 'connected');
  } catch (e) {
    if (paasConnBadge) {
      paasConnBadge.textContent = 'Error';
      paasConnBadge.className = 'badge badge-stopped';
    }
    appsTbody.innerHTML = `
      <tr><td colspan="6"><div class="empty-box">
        <h3>Unable to load services</h3>
        <p>${e.message}</p>
      </div></td></tr>`;
    appsCountLabel.textContent = '0 services';
  }
}

function renderPaasProjects() {
  if (!paasProjectsGrid) return;
  paasProjectsGrid.innerHTML = '';
  paasProjects.forEach((p) => {
    const card = document.createElement('div');
    card.className = `paas-project-card${selectedProjectId === p.id ? ' selected' : ''}`;
    const healthHtml = p.allHealthy
      ? `<span class="paas-health-pill ok">✓ ${p.serviceCount > 0 ? 'All services are up and running' : 'Ready for services'}</span>`
      : `<span class="paas-health-pill err">! Attention needed</span>`;
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="font-size:14.5px; font-weight:700; color:var(--text-primary);">${p.name}</div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="badge badge-neutral">${p.serviceCount}</span>
          <button type="button" class="icon-btn paas-proj-del-x" title="Delete project &amp; its services" style="width:24px;height:24px;font-size:12px;color:var(--text-secondary);">✕</button>
        </div>
      </div>
      ${healthHtml}
    `;
    card.querySelector('.paas-proj-del-x')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deletePaasProject(p);
    });
    card.addEventListener('click', () => {
      selectedProjectId = p.id;
      syncSelectedProjectHeader();
      renderPaasProjects();
      renderHostedAppsTable();
    });
    paasProjectsGrid.appendChild(card);
  });

  const addCard = document.createElement('button');
  addCard.type = 'button';
  addCard.className = 'paas-project-card-add';
  addCard.innerHTML = '+ Create new project';
  addCard.addEventListener('click', () => openPaasQuickModal('project'));
  paasProjectsGrid.appendChild(addCard);
}

paasClearProjectFilter?.addEventListener('click', () => {
  selectedProjectId = null;
  syncSelectedProjectHeader();
  renderPaasProjects();
  renderHostedAppsTable();
});

function renderHostedAppsTable() {
  const q = appsSearchInput.value.trim().toLowerCase();
  const src = appsSourceFilter.value;

  const projectScoped = selectedProjectId ? hostedApps.filter((a) => a.projectId === selectedProjectId) : hostedApps;
  const activeCount = projectScoped.filter((a) => a.status !== 'suspended').length;
  const suspendedCount = projectScoped.filter((a) => a.status === 'suspended').length;
  if (paasTabActiveCount) paasTabActiveCount.textContent = activeCount;
  if (paasTabSuspendedCount) paasTabSuspendedCount.textContent = suspendedCount;
  if (paasTabAllCount) paasTabAllCount.textContent = projectScoped.length;

  const filtered = projectScoped.filter((a) => {
    if (paasStatusTab === 'active' && a.status === 'suspended') return false;
    if (paasStatusTab === 'suspended' && a.status !== 'suspended') return false;
    if (src !== 'all' && a.kind !== src && a.source !== src) return false;
    if (q && !a.name.toLowerCase().includes(q) && !(a.url || '').toLowerCase().includes(q) && !(a.runtime || '').toLowerCase().includes(q)) return false;
    return true;
  });

  appsCountLabel.textContent = `${filtered.length} of ${projectScoped.length} service(s)`;
  if (paasTableBadgeCount) paasTableBadgeCount.textContent = filtered.length;

  if (filtered.length === 0) {
    appsTbody.innerHTML = `
      <tr><td colspan="6"><div class="empty-box">
        <h3>${projectScoped.length === 0 ? 'No services deployed yet' : 'No matching services'}</h3>
        <p>Use <strong>+ New</strong> to deploy a Blueprint, Web Service, Postgres database, or Key Value store.</p>
        <div style="display:flex; gap:8px; justify-content:center; margin-top:10px;">
          <button class="btn btn-primary" id="empty-new-bp-btn">+ New Blueprint</button>
          <button class="btn btn-secondary" id="empty-deploy-app-btn">+ New Web Service</button>
        </div>
      </div></td></tr>`;
    $('#empty-new-bp-btn')?.addEventListener('click', openBlueprintStep1);
    $('#empty-deploy-app-btn')?.addEventListener('click', openAppDrawer);
    return;
  }

  appsTbody.innerHTML = '';
  filtered.forEach((a) => {
    const tr = document.createElement('tr');
    const st = (a.status || 'idle').toLowerCase();
    const isOk = st === 'deployed' || st === 'available' || st === 'done' || st === 'running';
    const statusHtml = isOk
      ? `<span class="paas-health-pill ok" style="margin:0;">✓ ${st === 'available' ? 'Available' : 'Deployed'}</span>`
      : st === 'error'
      ? `<span class="paas-health-pill err" style="margin:0;">! Error</span>`
      : `<span class="badge badge-ephemeral">${st}</span>`;

    const isHttp = (a.url || '').startsWith('http');
    const lockBadge = a.isPrivateLocked
      ? `<span class="badge badge-neutral" title="Password-protected Private Service" style="margin-left:6px; display:inline-flex; align-items:center; gap:3px; font-size:10.5px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Locked</span>`
      : '';
    const nameHtml = `<button type="button" class="paas-svc-open-detail" style="background:none;border:none;padding:0;color:var(--text-primary);font-weight:600;font-size:13.5px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;">${a.name}</button>${lockBadge}`;

    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:9px;">
          ${paasServiceIcon(a.kind)}
          <div>
            <div>${nameHtml}</div>
            <div style="font-size:11.5px; color:var(--text-secondary); font-family:var(--mono); max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${a.url || ''}">${a.url || ''}</div>
          </div>
        </div>
      </td>
      <td>${statusHtml}</td>
      <td><span class="paas-runtime-pill">${a.runtime || a.source}</span></td>
      <td style="color:var(--text-secondary); font-size:13px;">${a.region || 'eu-north-1'}</td>
      <td style="color:var(--text-secondary); font-size:13px;">${paasTimeAgo(a.updatedAt)}</td>
      <td style="text-align:right;"></td>
    `;

    tr.querySelector('.paas-svc-open-detail')?.addEventListener('click', () => {
      if (a.isPrivateLocked && !unlockedPrivateServiceIds.has(a.id)) {
        openPrivateUnlockModal(a);
      } else {
        openServiceDetail(a.kind || 'web', a.id);
      }
    });

    const wrap = document.createElement('div');
    wrap.className = 'row-actions';

    if (isHttp) {
      const openA = document.createElement('a');
      openA.href = a.url;
      openA.target = '_blank';
      openA.className = 'btn btn-secondary btn-sm';
      openA.style.textDecoration = 'none';
      openA.textContent = 'Open ↗';
      wrap.appendChild(openA);
    }

    const redeployBtn = document.createElement('button');
    redeployBtn.className = 'btn btn-secondary btn-sm';
    redeployBtn.textContent = 'Redeploy';
    redeployBtn.addEventListener('click', async () => {
      redeployBtn.disabled = true;
      redeployBtn.textContent = 'Deploying...';
      try {
        await resellerFetch(`/paas/services/${encodeURIComponent(a.kind || 'web')}/${encodeURIComponent(a.id)}/redeploy`, { method: 'POST', body: '{}' });
        setStatus(`Triggered redeploy for ${a.name}`, 'connected');
        await loadHostedApps();
      } catch (err) {
        setStatus(`Redeploy failed: ${err.message}`, 'error');
      } finally {
        redeployBtn.disabled = false;
        redeployBtn.textContent = 'Redeploy';
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger-ghost btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      await resellerFetch(`/paas/services/${encodeURIComponent(a.kind || 'web')}/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      setStatus(`Deleted service: ${a.name}`, 'connected');
      await loadHostedApps();
    });

    wrap.append(redeployBtn, delBtn);
    tr.lastElementChild.appendChild(wrap);
    appsTbody.appendChild(tr);
  });
}

paasStatusTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    paasStatusTab = tab.dataset.pstatus;
    paasStatusTabs.forEach((t) => t.classList.toggle('active', t === tab));
    renderHostedAppsTable();
  });
});

// --- + New Dropdown Menu ---
paasNewDropdownBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  paasNewMenu?.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (paasNewMenu && !paasNewMenu.contains(e.target) && e.target !== paasNewDropdownBtn) {
    paasNewMenu.classList.remove('open');
  }
});

$$('#paas-new-menu .paas-new-item').forEach((item) => {
  item.addEventListener('click', () => {
    paasNewMenu?.classList.remove('open');
    const action = item.dataset.paasNew;
    if (action === 'static') return openNewStaticSiteView();
    if (action === 'web') return openNewWebServiceView('web');
    if (action === 'private') return openNewWebServiceView('private');
    if (action === 'worker') return openNewWebServiceView('worker');
    if (action === 'cron') return openNewWebServiceView('cron');
    if (action === 'blueprint') return openBlueprintStep1();
    if (action === 'project') return openPaasQuickModal('project');
    if (action === 'postgres') return openNewPostgresView();
    if (action === 'redis') return openNewKeyValueView();
    openAppDrawer();
  });
});

// --- Quick Modal (Project / Postgres / Key Value) ---
function openPaasQuickModal(mode) {
  paasQuickModalMode = mode;
  const projOpts = paasProjects.map((p) => `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`).join('');
  if (mode === 'project') {
    paasQuickModalTitle.textContent = 'Create New Project';
    paasQuickModalSubmit.textContent = 'Create Project';
    paasQuickModalBody.innerHTML = `
      <div class="field"><label>Project Name</label><input class="input" id="pqm-name" placeholder="e.g. Production App" /></div>
      <div class="field"><label>Description (Optional)</label><input class="input" id="pqm-desc" placeholder="Web services and databases" /></div>
    `;
  } else if (mode === 'postgres') {
    paasQuickModalTitle.textContent = 'New PostgreSQL Database';
    paasQuickModalSubmit.textContent = 'Create Database';
    paasQuickModalBody.innerHTML = `
      <div class="field"><label>Database Service Name</label><input class="input" id="pqm-name" placeholder="e.g. myapp-db" /></div>
      <div class="field"><label>Project</label><select class="select" id="pqm-project" style="width:100%;">${projOpts}</select></div>
      <div class="field"><label>Database Name</label><input class="input" id="pqm-dbname" placeholder="myapp" /></div>
      <div class="field"><label>Username</label><input class="input" id="pqm-dbuser" value="iecloud" /></div>
    `;
  } else if (mode === 'redis') {
    paasQuickModalTitle.textContent = 'New Key Value Store (Redis)';
    paasQuickModalSubmit.textContent = 'Create Key Value';
    paasQuickModalBody.innerHTML = `
      <div class="field"><label>Service Name</label><input class="input" id="pqm-name" placeholder="e.g. myapp-cache" /></div>
      <div class="field"><label>Project</label><select class="select" id="pqm-project" style="width:100%;">${projOpts}</select></div>
    `;
  }
  paasQuickModalBackdrop.classList.add('open');
  $('#pqm-name')?.focus();
}

function closePaasQuickModal() {
  paasQuickModalBackdrop?.classList.remove('open');
}
paasQuickModalClose?.addEventListener('click', closePaasQuickModal);
paasQuickModalCancel?.addEventListener('click', closePaasQuickModal);
paasQuickModalBackdrop?.addEventListener('click', (e) => { if (e.target === paasQuickModalBackdrop) closePaasQuickModal(); });

paasQuickModalSubmit?.addEventListener('click', async () => {
  const name = ($('#pqm-name')?.value || '').trim();
  if (!name) return setStatus('Enter a name', 'error');
  paasQuickModalSubmit.disabled = true;
  try {
    if (paasQuickModalMode === 'project') {
      await resellerFetch('/paas/projects', { method: 'POST', body: JSON.stringify({ name, description: $('#pqm-desc')?.value || '' }) });
      setStatus(`Created project: ${name}`, 'connected');
    } else if (paasQuickModalMode === 'postgres') {
      await resellerFetch('/paas/postgres', {
        method: 'POST',
        body: JSON.stringify({
          name,
          projectId: $('#pqm-project')?.value || '',
          databaseName: ($('#pqm-dbname')?.value || '').trim() || name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          databaseUser: ($('#pqm-dbuser')?.value || 'iecloud').trim(),
        }),
      });
      setStatus(`Deployed PostgreSQL database: ${name}`, 'connected');
    } else if (paasQuickModalMode === 'redis') {
      await resellerFetch('/paas/redis', {
        method: 'POST',
        body: JSON.stringify({ name, projectId: $('#pqm-project')?.value || '' }),
      });
      setStatus(`Deployed Key Value store: ${name}`, 'connected');
    }
    closePaasQuickModal();
    await loadHostedApps();
  } catch (e) {
    setStatus(`Create failed: ${e.message}`, 'error');
  } finally {
    paasQuickModalSubmit.disabled = false;
  }
});

// --- BLUEPRINT INSTANCE: STEP 1 (Connect a repository) ---
async function openBlueprintStep1() {
  showPaasSubview('bp-step1');
  await loadBlueprintGitRepos();
}

let bpOAuthPollTimer = null;

window.addEventListener('message', (ev) => {
  if (ev.data && ev.data.type === 'iecloudbase-git-connected') {
    if (bpOAuthPollTimer) { clearInterval(bpOAuthPollTimer); bpOAuthPollTimer = null; }
    setStatus(`Connected ${ev.data.provider || 'Git'} account`, 'connected');
    loadBlueprintGitRepos();
  }
});

async function startComposioOAuth(provider = 'github') {
  try {
    setStatus(`Opening ${provider} sign-in popup...`, 'connected');
    const res = await resellerFetch('/paas/git/composio/initiate', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    });
    if (!res.redirectUrl) throw new Error('No OAuth redirect URL returned');
    const w = 620, h = 760;
    const left = Math.max(0, Math.floor((window.screen.width - w) / 2));
    const top = Math.max(0, Math.floor((window.screen.height - h) / 2));
    const popup = window.open(
      res.redirectUrl,
      `iecloudbase_oauth_${provider}`,
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!popup) {
      window.open(res.redirectUrl, '_blank');
    }
    if (bpOAuthPollTimer) clearInterval(bpOAuthPollTimer);
    let ticks = 0;
    bpOAuthPollTimer = setInterval(async () => {
      ticks++;
      if (ticks > 90) { clearInterval(bpOAuthPollTimer); bpOAuthPollTimer = null; return; }
      try {
        const cfg = await resellerFetch('/paas/git/config');
        const isNowConnected = provider === 'github' ? cfg.connected : cfg.providers?.[provider]?.connected;
        if (isNowConnected) {
          clearInterval(bpOAuthPollTimer);
          bpOAuthPollTimer = null;
          setStatus(`Connected ${provider} account`, 'connected');
          await loadBlueprintGitRepos();
        } else if (popup && popup.closed && ticks > 2) {
          clearInterval(bpOAuthPollTimer);
          bpOAuthPollTimer = null;
          await loadBlueprintGitRepos();
        }
      } catch {}
    }, 2000);
  } catch (e) {
    setStatus(`OAuth connect failed: ${e.message}`, 'error');
  }
}

async function loadBlueprintGitRepos() {
  try {
    bpGitConfig = await resellerFetch('/paas/git/config');
    const glBtn = $('#bp-gitlab-btn');
    const bbBtn = $('#bp-bitbucket-btn');
    if (glBtn) glBtn.textContent = bpGitConfig.providers?.gitlab?.connected ? 'Connected ✓ (Reconnect)' : 'Connect account +';
    if (bbBtn) bbBtn.textContent = bpGitConfig.providers?.bitbucket?.connected ? 'Connected ✓ (Reconnect)' : 'Connect account +';

    if (bpGitConfig.connected) {
      bpGhStatus.innerHTML = `<span style="color:var(--text-primary); font-weight:600;">@${bpGitConfig.username || 'GitHub'}</span> · ${bpGitConfig.repoCount || 0} repos`;
      bpGhConfigBtn.textContent = 'Configure account';
      if (bpGhDisconnectBtn) bpGhDisconnectBtn.style.display = 'inline-flex';
      bpGhUsernameInput.value = bpGitConfig.username || '';
      bpRepoList.innerHTML = `<div class="empty-box" style="padding:28px;">Loading repositories...</div>`;
      const data = await resellerFetch('/paas/git/repos');
      bpRepos = data.repos || [];
      const u = data.username || bpGitConfig.username || 'GitHub';
      bpGhStatus.innerHTML = `<span style="color:var(--text-primary); font-weight:600;">@${u}</span> · ${bpRepos.length} repos`;
      renderBlueprintRepoList();
    } else {
      bpGitConfig = { connected: false, composioEnabled: bpGitConfig.composioEnabled, username: '', repoCount: 0, hasToken: false };
      bpRepos = [];
      bpGhStatus.textContent = 'Not connected';
      bpGhConfigBtn.textContent = 'Connect account +';
      if (bpGhDisconnectBtn) bpGhDisconnectBtn.style.display = 'none';
      bpRepoList.innerHTML = `
        <div class="empty-box" style="padding:36px 20px;">
          <h3>Connect your GitHub account</h3>
          <p>Sign in with GitHub to browse your public and private repositories, or paste a public repository URL below.</p>
          <button class="btn btn-primary" id="bp-empty-gh-oauth-btn" style="margin-top:8px;">Sign in with GitHub</button>
        </div>`;
      $('#bp-empty-gh-oauth-btn')?.addEventListener('click', () => startComposioOAuth('github'));
    }
  } catch (e) {
    bpRepoList.innerHTML = `<div class="empty-box" style="padding:28px;"><p>${e.message}</p></div>`;
  }
}

function renderBlueprintRepoList() {
  const q = (bpRepoSearch?.value || '').trim().toLowerCase();
  const filtered = bpRepos.filter((r) => !q || r.fullName.toLowerCase().includes(q));
  if (filtered.length === 0) {
    bpRepoList.innerHTML = `<div class="empty-box" style="padding:28px;"><p>No matching repositories found.</p></div>`;
    return;
  }
  bpRepoList.innerHTML = '';
  filtered.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'bp-repo-row';
    const lockSvg = r.private
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-secondary);"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '';
    row.innerHTML = `
      <div class="bp-repo-meta">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.07.78 2.15v3.19c0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>
        <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.owner} / ${r.name}</span>
        ${lockSvg}
        <span class="muted">· ${paasTimeAgo(r.updatedAt)}</span>
      </div>
      <button class="btn btn-primary btn-sm">Connect</button>
    `;
    row.querySelector('button').addEventListener('click', () => openBlueprintStep2(r.fullName, r.defaultBranch || 'main'));
    bpRepoList.appendChild(row);
  });
}

bpRepoSearch?.addEventListener('input', renderBlueprintRepoList);
bpBackOverviewBtn?.addEventListener('click', () => showPaasSubview('overview'));
bpBackStep1Btn?.addEventListener('click', () => showPaasSubview('bp-step1'));

bpGhConfigBtn?.addEventListener('click', () => {
  if (!bpGitConfig.connected && bpGitConfig.composioEnabled !== false) {
    return startComposioOAuth('github');
  }
  bpGhConnectBox.style.display = bpGhConnectBox.style.display === 'none' ? 'block' : 'none';
});
bpGhCancelBtn?.addEventListener('click', () => { bpGhConnectBox.style.display = 'none'; });

bpGhSaveBtn?.addEventListener('click', async () => {
  const username = bpGhUsernameInput.value.trim();
  const token = bpGhTokenInput.value.trim();
  if (!username && !token) return setStatus('Enter a GitHub username or token', 'error');
  bpGhSaveBtn.disabled = true;
  bpGhSaveBtn.textContent = 'Syncing...';
  try {
    await resellerFetch('/paas/git/connect', { method: 'POST', body: JSON.stringify({ username, token }) });
    bpGhConnectBox.style.display = 'none';
    bpGhTokenInput.value = '';
    setStatus('GitHub account connected', 'connected');
    await loadBlueprintGitRepos();
  } catch (e) {
    setStatus(`GitHub connect failed: ${e.message}`, 'error');
  } finally {
    bpGhSaveBtn.disabled = false;
    bpGhSaveBtn.textContent = 'Save & Sync';
  }
});

bpGhDisconnectBtn?.addEventListener('click', async () => {
  await resellerFetch('/paas/git/connect?provider=github', { method: 'DELETE' });
  bpGhConnectBox.style.display = 'none';
  await loadBlueprintGitRepos();
});

bpPublicRepoContinue?.addEventListener('click', () => {
  const raw = (bpPublicRepoInput.value || '').trim();
  if (!raw) return setStatus('Enter a public GitHub repository URL or owner/repo', 'error');
  const slug = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  openBlueprintStep2(slug, 'main');
});

$('#bp-gitlab-btn')?.addEventListener('click', () => startComposioOAuth('gitlab'));
$('#bp-bitbucket-btn')?.addEventListener('click', () => startComposioOAuth('bitbucket'));

// --- BLUEPRINT INSTANCE: STEP 2 (Configure & Review Blueprint) ---
async function openBlueprintStep2(repoSlug, defaultBranch = 'main') {
  bpSelectedRepo = repoSlug;
  bpLastInspect = null;
  bpSelectedRepoLabel.textContent = repoSlug;
  bpReviewRepoLabel.textContent = repoSlug;
  const repoShort = repoSlug.split('/').pop() || 'blueprint';
  bpNameInput.value = repoShort.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  bpPathInput.value = 'render.yaml';
  bpBranchSelect.innerHTML = `<option value="${defaultBranch}">${defaultBranch}</option>`;
  showPaasSubview('bp-step2');

  // Load branches in background
  try {
    const bData = await resellerFetch(`/paas/git/branches?repo=${encodeURIComponent(repoSlug)}`);
    const branches = (bData.branches || []).length ? bData.branches : [defaultBranch];
    bpBranchSelect.innerHTML = branches.map((b) => `<option value="${b}" ${b === defaultBranch ? 'selected' : ''}>${b}</option>`).join('');
  } catch {}

  await inspectBlueprintFile();
}

async function inspectBlueprintFile() {
  if (!bpSelectedRepo) return;
  const branch = bpBranchSelect.value || 'main';
  const filePath = (bpPathInput.value || '').trim() || 'render.yaml';
  bpReviewArea.innerHTML = `<p style="font-size:13px; color:var(--text-secondary);">Checking <code>${filePath}</code> on <code>${branch}</code> branch...</p>`;
  try {
    const res = await resellerFetch('/paas/blueprints/inspect', {
      method: 'POST',
      body: JSON.stringify({ repo: bpSelectedRepo, branch, path: filePath }),
    });
    bpLastInspect = res;
    if (!res.found) {
      bpReviewArea.innerHTML = `
        <p style="font-size:13.5px; color:var(--text-primary); margin-bottom:14px;">
          Blueprint file <code>${res.path}</code> not found on <code>${res.branch}</code> branch.
        </p>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-primary" id="bp-retry-btn">Retry</button>
          ${res.path !== 'docker-compose.yml' ? '<button class="btn btn-secondary" id="bp-try-compose-btn">Try docker-compose.yml</button>' : ''}
        </div>
      `;
      $('#bp-retry-btn')?.addEventListener('click', inspectBlueprintFile);
      $('#bp-try-compose-btn')?.addEventListener('click', () => {
        bpPathInput.value = 'docker-compose.yml';
        inspectBlueprintFile();
      });
      return;
    }

    const svcCards = (res.services || []).map((s) => `
      <div class="bp-service-preview">
        <div>
          <div style="font-size:13.5px; font-weight:700; color:var(--text-primary);">${s.name || 'service'}</div>
          <div style="font-size:12px; color:var(--text-secondary);">${s.image || s.type || 'Blueprint service'}${s.port ? ` · Port ${s.port}` : ''}</div>
        </div>
        <span class="paas-runtime-pill">${s.runtime || s.type}</span>
      </div>
    `).join('');

    bpReviewArea.innerHTML = `
      <div class="paas-health-pill ok" style="margin:0 0 12px;">✓ Found ${res.path} (${res.format})</div>
      ${svcCards || '<p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;">Blueprint file loaded and ready to deploy.</p>'}
      <details style="margin:12px 0 16px;">
        <summary style="cursor:pointer; font-size:12.5px; font-weight:600; color:var(--text-secondary);">Preview ${res.path}</summary>
        <pre style="margin-top:8px; background:#0c0f17; color:#cbd5e1; padding:12px; border-radius:8px; font-size:12px; font-family:var(--mono); max-height:240px; overflow:auto;">${res.yaml.replace(/</g, '&lt;')}</pre>
      </details>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-primary" id="bp-deploy-btn">Apply & Deploy Blueprint</button>
        <button class="btn btn-secondary" id="bp-rescan-btn">Re-check File</button>
      </div>
    `;
    $('#bp-rescan-btn')?.addEventListener('click', inspectBlueprintFile);
    $('#bp-deploy-btn')?.addEventListener('click', async () => {
      const btn = $('#bp-deploy-btn');
      const name = bpNameInput.value.trim();
      if (!name) return setStatus('Enter a Blueprint Name', 'error');
      btn.disabled = true;
      btn.textContent = 'Deploying Blueprint...';
      try {
        await resellerFetch('/paas/blueprints/deploy', {
          method: 'POST',
          body: JSON.stringify({
            name,
            repo: bpSelectedRepo,
            branch,
            path: res.path,
            format: res.format,
            yaml: res.yaml,
            projectId: selectedProjectId || '',
          }),
        });
        setStatus(`Blueprint deployed: ${name}`, 'connected');
        showPaasSubview('overview');
        await loadHostedApps();
      } catch (err) {
        setStatus(`Blueprint deploy failed: ${err.message}`, 'error');
        btn.disabled = false;
        btn.textContent = 'Apply & Deploy Blueprint';
      }
    });
  } catch (e) {
    bpReviewArea.innerHTML = `<p style="font-size:13px; color:#dc2626;">${e.message}</p><button class="btn btn-primary" id="bp-retry-btn">Retry</button>`;
    $('#bp-retry-btn')?.addEventListener('click', inspectBlueprintFile);
  }
}

bpBranchSelect?.addEventListener('change', inspectBlueprintFile);
let bpPathDebounce = null;
bpPathInput?.addEventListener('input', () => {
  clearTimeout(bpPathDebounce);
  bpPathDebounce = setTimeout(inspectBlueprintFile, 450);
});
$$('.bp-path-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    bpPathInput.value = chip.dataset.path;
    inspectBlueprintFile();
  });
});

appLogsCloseBtn?.addEventListener('click', () => { appLogsCard.style.display = 'none'; });

function updateAppUrlPreview() {
  const safe = (appNameInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'my-website');
  appUrlPreview.textContent = `https://${safe}.apps.iecloudbase.com`;
}

appNameInput?.addEventListener('input', updateAppUrlPreview);

function openAppDrawer() {
  updateAppUrlPreview();
  appDrawerBackdrop.classList.add('open');
  appNameInput.focus();
}

function closeAppDrawer() {
  appDrawerBackdrop.classList.remove('open');
}

openAppDrawerBtn?.addEventListener('click', openAppDrawer);
closeAppDrawerBtn?.addEventListener('click', closeAppDrawer);
appDrawerCancelBtn?.addEventListener('click', closeAppDrawer);
appDrawerBackdrop?.addEventListener('click', (e) => { if (e.target === appDrawerBackdrop) closeAppDrawer(); });

appSourceButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    appDrawerSource = btn.dataset.asrc;
    appSourceButtons.forEach((b) => b.classList.toggle('active', b === btn));
    appSrcGit.style.display = appDrawerSource === 'git' ? 'flex' : 'none';
    appSrcDocker.style.display = appDrawerSource === 'docker' ? 'flex' : 'none';
    appSrcBlueprint.style.display = appDrawerSource === 'blueprint' ? 'flex' : 'none';
    if (appDrawerSource === 'docker') appPortInput.value = '80';
    else if (appDrawerSource === 'git') appPortInput.value = '3000';
  });
});

appDrawerSubmitBtn?.addEventListener('click', async () => {
  const name = appNameInput.value.trim();
  if (!name) return setStatus('Enter a service name', 'error');

  const env = {};
  for (const [k, v] of parseEnvText(appEnvInput.value || '')) env[k] = v;

  appDrawerSubmitBtn.disabled = true;
  appDrawerSubmitBtn.textContent = 'Deploying...';
  try {
    const payload = {
      name,
      projectId: selectedProjectId || '',
      source: appDrawerSource,
      containerPort: parseInt(appPortInput.value || '80', 10),
      env,
    };
    if (appDrawerSource === 'git') {
      payload.repoUrl = appGitUrlInput.value.trim();
      payload.branch = appGitBranchInput.value.trim() || 'main';
      payload.buildCmd = appBuildCmdInput.value.trim();
      payload.startCmd = appStartCmdInput.value.trim();
    } else if (appDrawerSource === 'docker') {
      payload.image = appDockerImageInput.value.trim();
    } else {
      payload.blueprintYaml = appBlueprintYamlInput.value;
    }

    const res = await resellerFetch('/paas/apps', { method: 'POST', body: JSON.stringify(payload) });
    closeAppDrawer();
    appNameInput.value = '';
    setStatus(`Deployed live: ${res.app?.url}`, 'connected');
    await loadHostedApps();
  } catch (e) {
    setStatus(`Deploy failed: ${e.message}`, 'error');
  } finally {
    appDrawerSubmitBtn.disabled = false;
    appDrawerSubmitBtn.textContent = 'Deploy Web Service';
  }
});

appsRefreshBtn?.addEventListener('click', loadHostedApps);
appsSearchInput?.addEventListener('input', renderHostedAppsTable);
appsSourceFilter?.addEventListener('change', renderHostedAppsTable);

// ============================================================================
// --- RENDER-STYLE SERVICE DETAIL PAGE (Events, Env, Domains, Connection) ---
// ============================================================================
let currentServiceDetail = null;
let sdEnvMasked = true;
let sdEnvItems = [];

const sdBackBtn = $('#sd-back-overview-btn');
const sdRefreshBtn = $('#sd-refresh-btn');
const sdRestartBtn = $('#sd-restart-btn');
const sdRedeployBtn = $('#sd-redeploy-btn');
const sdDeleteBtn = $('#sd-delete-btn');
const sdTabs = $$('#sd-tabs .paas-status-tab');

sdBackBtn?.addEventListener('click', () => {
  showPaasSubview('overview');
  loadHostedApps();
});

let sdLogMode = 'runtime';
let sdRawLogs = '';
let sdLogTimer = null;

function stopSdLogAutoRefresh() {
  if (sdLogTimer) { clearInterval(sdLogTimer); sdLogTimer = null; }
  const cb = $('#sd-log-autorefresh');
  if (cb) cb.checked = false;
}

function switchServiceDetailTab(tabName) {
  sdTabs.forEach((t) => t.classList.toggle('active', t.dataset.sdtab === tabName));
  $$('.sd-panel').forEach((p) => { p.style.display = 'none'; });
  const target = $(`#sd-panel-${tabName}`);
  if (target) target.style.display = 'block';
  if (tabName === 'logs') loadServiceDetailLogs();
  else stopSdLogAutoRefresh();
  if (tabName === 'records' && typeof openRecordsStudio === 'function') openRecordsStudio();
}

function renderFilteredSdLogs() {
  const pre = $('#sd-logs-pre');
  if (!pre) return;
  const q = ($('#sd-log-search')?.value || '').trim().toLowerCase();
  const text = sdRawLogs || '(No logs available yet)';
  const lines = q ? text.split(/\r?\n/).filter((l) => l.toLowerCase().includes(q)) : text.split(/\r?\n/);
  pre.textContent = lines.length ? lines.join('\n') : `(No log lines matching "${q}")`;
  pre.scrollTop = pre.scrollHeight;
}

async function loadServiceDetailLogs() {
  if (!currentServiceDetail) return;
  const pre = $('#sd-logs-pre');
  const depSelect = $('#sd-log-deploy-select');
  if (pre && !sdRawLogs) pre.textContent = 'Loading logs...';
  try {
    if (sdLogMode === 'build') {
      const depId = depSelect?.value;
      if (!depId) {
        sdRawLogs = 'No build/deployment logs recorded for this service yet.';
        return renderFilteredSdLogs();
      }
      const res = await resellerFetch(`/paas/deployments/${encodeURIComponent(depId)}/logs`);
      sdRawLogs = res.logs || '(Empty build log)';
    } else {
      const res = await resellerFetch(`/paas/services/${encodeURIComponent(currentServiceDetail.kind)}/${encodeURIComponent(currentServiceDetail.id)}/logs?tail=250`);
      sdRawLogs = res.logs || '(No runtime logs yet)';
    }
    renderFilteredSdLogs();
  } catch (e) {
    sdRawLogs = `Error loading logs: ${e.message}`;
    renderFilteredSdLogs();
  }
}

$$('#sd-log-mode-tabs .paas-status-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    sdLogMode = btn.dataset.logmode;
    $$('#sd-log-mode-tabs .paas-status-tab').forEach((b) => b.classList.toggle('active', b === btn));
    const depSelect = $('#sd-log-deploy-select');
    if (depSelect) depSelect.style.display = sdLogMode === 'build' ? 'inline-block' : 'none';
    sdRawLogs = '';
    loadServiceDetailLogs();
  });
});

$('#sd-log-deploy-select')?.addEventListener('change', () => { sdRawLogs = ''; loadServiceDetailLogs(); });
$('#sd-log-search')?.addEventListener('input', renderFilteredSdLogs);
$('#sd-log-refresh-btn')?.addEventListener('click', () => { loadServiceDetailLogs(); });
$('#sd-log-copy-btn')?.addEventListener('click', () => {
  navigator.clipboard?.writeText(sdRawLogs || '');
  setStatus('Copied logs to clipboard', 'connected');
});
$('#sd-log-autorefresh')?.addEventListener('change', (e) => {
  if (e.target.checked) {
    if (sdLogTimer) clearInterval(sdLogTimer);
    sdLogTimer = setInterval(loadServiceDetailLogs, 5000);
  } else {
    stopSdLogAutoRefresh();
  }
});

sdBackBtn?.addEventListener('click', stopSdLogAutoRefresh);

sdTabs.forEach((t) => {
  t.addEventListener('click', () => switchServiceDetailTab(t.dataset.sdtab));
});

async function openServiceDetail(kind, id) {
  showPaasSubview('service-detail');
  $('#sd-title').textContent = 'Loading...';
  $('#sd-breadcrumb-name').textContent = '...';
  $('#sd-containers-list').innerHTML = '<p style="font-size:13px; color:var(--text-secondary);">Loading live runtime state...</p>';
  $('#sd-deployments-list').innerHTML = '';
  try {
    const data = await resellerFetch(`/paas/services/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
    currentServiceDetail = data.service;
    renderServiceDetail(currentServiceDetail);
  } catch (e) {
    setStatus(`Failed to load service: ${e.message}`, 'error');
    $('#sd-containers-list').innerHTML = `<p style="color:#dc2626; font-size:13px;">${e.message}</p>`;
  }
}

function renderServiceDetail(svc) {
  if (!svc) return;
  $('#sd-title').textContent = svc.name;
  $('#sd-breadcrumb-name').textContent = svc.name;
  $('#sd-runtime-pill').textContent = svc.runtime || (svc.sourceType === 'docker' ? 'Image' : svc.sourceType || svc.kind);
  $('#sd-meta-right').innerHTML = `ID: ${svc.id}<br/>App: ${svc.appName || svc.name}`;

  const st = (svc.status || 'idle').toLowerCase();
  const isOk = st === 'deployed' || st === 'available' || st === 'done' || st === 'running';
  const pill = $('#sd-status-pill');
  pill.className = isOk ? 'paas-health-pill ok' : st === 'error' ? 'paas-health-pill err' : 'badge badge-ephemeral';
  pill.textContent = isOk ? `✓ ${st === 'available' ? 'Available' : 'Deployed'}` : st === 'error' ? '! Error' : st;

  const urlRow = $('#sd-url-row');
  if (svc.url && svc.url.startsWith('http')) {
    urlRow.innerHTML = `<a href="${svc.url}" target="_blank" style="color:var(--text-primary); font-family:var(--mono); text-decoration:underline; text-underline-offset:3px;">${svc.url} ↗</a>`;
  } else if (svc.connectionString) {
    urlRow.innerHTML = `<span style="font-family:var(--mono); color:var(--text-secondary);">${svc.host}:${svc.port}</span>`;
  } else {
    urlRow.innerHTML = '';
  }

  const isWeb = svc.kind === 'web';
  const isDb = svc.kind === 'postgres' || svc.kind === 'redis';
  const showRecords = svc.kind === 'postgres' || svc.kind === 'web' || svc.kind === 'blueprint';
  $('#sd-tab-btn-env').style.display = isWeb ? 'inline-block' : 'none';
  $('#sd-tab-btn-domains').style.display = isWeb ? 'inline-block' : 'none';
  $('#sd-tab-btn-connect').style.display = isDb ? 'inline-block' : 'none';
  if ($('#sd-tab-btn-records')) $('#sd-tab-btn-records').style.display = showRecords ? 'inline-block' : 'none';
  if ($('#sd-records-btn')) $('#sd-records-btn').style.display = showRecords ? 'inline-flex' : 'none';
  switchServiceDetailTab(isDb ? 'connect' : 'events');

  // 1. Live Containers
  const cList = $('#sd-containers-list');
  const containers = svc.containers || [];
  if (containers.length === 0) {
    cList.innerHTML = '<p style="font-size:13px; color:var(--text-secondary);">No active containers found for this service yet.</p>';
  } else {
    cList.innerHTML = containers.map((c) => {
      const running = (c.state || '').toLowerCase() === 'running';
      return `
        <div class="bp-service-preview">
          <div>
            <div style="font-size:13px; font-weight:600; font-family:var(--mono);">${c.name}</div>
            <div style="font-size:12px; color:var(--text-secondary);">${c.image || ''} · ${c.status || ''} ${c.ports ? `· ${c.ports}` : ''}</div>
          </div>
          <span class="${running ? 'paas-health-pill ok' : 'paas-health-pill err'}" style="margin:0;">${running ? 'Running' : c.state || 'Exited'}</span>
        </div>`;
    }).join('');
  }

  // 2. Deployment History + populate Build Log dropdown
  const dList = $('#sd-deployments-list');
  const deps = svc.deployments || [];
  const depSelect = $('#sd-log-deploy-select');
  const buildModeBtn = $('#sd-log-mode-build-btn');
  if (buildModeBtn) buildModeBtn.style.display = deps.length > 0 ? 'inline-block' : 'none';
  if (depSelect) {
    depSelect.innerHTML = deps.slice(0, 20).map((d, i) => {
      const lbl = `${i === 0 ? '[Latest] ' : ''}${d.title || 'Deploy'} (${d.status || 'idle'} · ${paasTimeAgo(d.createdAt)})`;
      return `<option value="${d.deploymentId}">${lbl}</option>`;
    }).join('');
  }
  if (deps.length === 0) {
    dList.innerHTML = '<p style="font-size:13px; color:var(--text-secondary);">No deployments recorded yet.</p>';
  } else {
    dList.innerHTML = '';
    deps.slice(0, 15).forEach((d) => {
      const dst = (d.status || 'idle').toLowerCase();
      const cls = dst === 'done' ? 'paas-health-pill ok' : dst === 'error' ? 'paas-health-pill err' : 'badge badge-ephemeral';
      const row = document.createElement('div');
      row.className = 'bp-service-preview';
      row.innerHTML = `
        <div>
          <div style="font-size:13px; font-weight:600;">${d.title || 'Deployment'}</div>
          <div style="font-size:12px; color:var(--text-secondary);">${d.description ? `${d.description} · ` : ''}${paasTimeAgo(d.createdAt)} ${d.errorMessage ? `· <span style="color:#dc2626;">${d.errorMessage}</span>` : ''}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button type="button" class="btn btn-secondary btn-sm sd-view-build-log-btn">View Build Log</button>
          <span class="${cls}" style="margin:0;">${dst === 'done' ? '✓ Live' : dst}</span>
        </div>`;
      row.querySelector('.sd-view-build-log-btn')?.addEventListener('click', () => {
        sdLogMode = 'build';
        $$('#sd-log-mode-tabs .paas-status-tab').forEach((b) => b.classList.toggle('active', b.dataset.logmode === 'build'));
        if (depSelect) {
          depSelect.style.display = 'inline-block';
          depSelect.value = d.deploymentId;
        }
        sdRawLogs = '';
        switchServiceDetailTab('logs');
      });
      dList.appendChild(row);
    });
  }

  // 3. Environment Variables (Web)
  if (isWeb) {
    sdEnvItems = (svc.env || []).map((e) => ({ key: e.key, value: e.value }));
    sdEnvMasked = true;
    $('#sd-env-toggle-mask').textContent = 'Reveal Values';
    renderSdEnvRows();

    // 4. Domains & Source
    const domList = $('#sd-domains-list');
    const doms = svc.domains || [];
    if (doms.length === 0) {
      domList.innerHTML = '<p style="font-size:13px; color:var(--text-secondary);">No domains attached yet.</p>';
    } else {
      domList.innerHTML = '';
      doms.forEach((d) => {
        const row = document.createElement('div');
        row.className = 'bp-service-preview';
        const fullUrl = `${d.https ? 'https' : 'http'}://${d.host}`;
        row.innerHTML = `
          <div>
            <a href="${fullUrl}" target="_blank" style="font-size:13.5px; font-weight:600; color:var(--text-primary); font-family:var(--mono); text-decoration:underline;">${fullUrl} ↗</a>
            <div style="font-size:12px; color:var(--text-secondary);">Port ${d.port || 80} · ${d.certificateType === 'letsencrypt' ? "Let's Encrypt HTTPS" : 'HTTP'}</div>
          </div>
          <button class="btn btn-danger-ghost btn-sm">Remove</button>
        `;
        row.querySelector('button').addEventListener('click', async () => {
          await resellerFetch(`/paas/services/web/${encodeURIComponent(svc.id)}/domains/${encodeURIComponent(d.domainId)}`, { method: 'DELETE' });
          setStatus(`Removed domain ${d.host}`, 'connected');
          await openServiceDetail('web', svc.id);
        });
        domList.appendChild(row);
      });
    }
    if (doms[0]?.port) $('#sd-new-domain-port').value = doms[0].port;
    $('#sd-source-info').innerHTML = `
      <div><strong>Source Type:</strong> <code>${svc.sourceType}</code></div>
      ${svc.dockerImage ? `<div><strong>Docker Image:</strong> <code>${svc.dockerImage}</code></div>` : ''}
      ${svc.gitUrl ? `<div><strong>Git Repository:</strong> <code>${svc.gitUrl}</code> (branch: <code>${svc.gitBranch || 'main'}</code>)</div>` : ''}
      ${svc.dockerfile ? `<div><strong>Dockerfile Path:</strong> <code>${svc.dockerfile}</code></div>` : ''}
      <div><strong>Build Type:</strong> <code>${svc.buildType}</code></div>
    `;
  }

  // 5. Connection Info (Postgres / Redis)
  if (isDb) {
    const card = $('#sd-connect-card');
    card.innerHTML = `
      <h3 style="margin:0 0 12px; font-size:15px;">Internal Network Connection</h3>
      <p style="font-size:12.5px; color:var(--text-secondary); margin:0 0 14px;">Use these credentials from any Web Service or Blueprint deployed in your ieCloudbase workspace.</p>
      <div style="display:grid; grid-template-columns:140px 1fr; gap:10px; font-size:13px; align-items:center;">
        <strong>Internal Host</strong><code style="background:#f3f4f6; padding:6px 10px; border-radius:6px;">${svc.host}</code>
        <strong>Port</strong><code style="background:#f3f4f6; padding:6px 10px; border-radius:6px;">${svc.port}</code>
        ${svc.databaseName ? `<strong>Database</strong><code style="background:#f3f4f6; padding:6px 10px; border-radius:6px;">${svc.databaseName}</code>` : ''}
        ${svc.databaseUser ? `<strong>Username</strong><code style="background:#f3f4f6; padding:6px 10px; border-radius:6px;">${svc.databaseUser}</code>` : ''}
        <strong>Connection URL</strong>
        <div style="display:flex; gap:8px;">
          <input type="text" class="input" readonly value="${svc.connectionString || ''}" style="font-family:var(--mono); font-size:12px; flex:1;" />
          <button class="btn btn-secondary btn-sm" id="sd-copy-conn-btn">Copy</button>
        </div>
      </div>
    `;
    $('#sd-copy-conn-btn')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(svc.connectionString || '');
      setStatus('Copied connection string to clipboard', 'connected');
    });
  }
}

function renderSdEnvRows() {
  const container = $('#sd-env-rows');
  if (!container) return;
  container.innerHTML = '';
  if (sdEnvItems.length === 0) {
    container.innerHTML = '<p style="font-size:13px; color:var(--text-secondary);">No environment variables configured. Click <strong>+ Add Variable</strong> to add one.</p>';
    return;
  }
  sdEnvItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:center;';
    row.innerHTML = `
      <input type="text" class="input sd-env-k" placeholder="KEY" value="${(item.key || '').replace(/"/g, '&quot;')}" style="width:240px; font-family:var(--mono); font-size:12.5px;" />
      <input type="${sdEnvMasked ? 'password' : 'text'}" class="input sd-env-v" placeholder="value" value="${(item.value || '').replace(/"/g, '&quot;')}" style="flex:1; font-family:var(--mono); font-size:12.5px;" />
      <button type="button" class="btn btn-danger-ghost btn-sm">✕</button>
    `;
    row.querySelector('.sd-env-k').addEventListener('input', (e) => { sdEnvItems[idx].key = e.target.value; });
    row.querySelector('.sd-env-v').addEventListener('input', (e) => { sdEnvItems[idx].value = e.target.value; });
    row.querySelector('button').addEventListener('click', () => {
      sdEnvItems.splice(idx, 1);
      renderSdEnvRows();
    });
    container.appendChild(row);
  });
}

$('#sd-env-toggle-mask')?.addEventListener('click', () => {
  sdEnvMasked = !sdEnvMasked;
  $('#sd-env-toggle-mask').textContent = sdEnvMasked ? 'Reveal Values' : 'Hide Values';
  renderSdEnvRows();
});

$('#sd-env-add-btn')?.addEventListener('click', () => {
  sdEnvItems.push({ key: '', value: '' });
  sdEnvMasked = false;
  $('#sd-env-toggle-mask').textContent = 'Hide Values';
  renderSdEnvRows();
});

async function saveSdEnv(redeploy) {
  if (!currentServiceDetail || currentServiceDetail.kind !== 'web') return;
  const btn = redeploy ? $('#sd-env-save-redeploy-btn') : $('#sd-env-save-only-btn');
  btn.disabled = true;
  try {
    await resellerFetch(`/paas/services/web/${encodeURIComponent(currentServiceDetail.id)}/env`, {
      method: 'POST',
      body: JSON.stringify({ env: sdEnvItems, redeploy }),
    });
    setStatus(redeploy ? 'Saved environment & triggered redeploy' : 'Saved environment variables', 'connected');
    await openServiceDetail('web', currentServiceDetail.id);
  } catch (e) {
    setStatus(`Save failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

$('#sd-env-save-redeploy-btn')?.addEventListener('click', () => saveSdEnv(true));
$('#sd-env-save-only-btn')?.addEventListener('click', () => saveSdEnv(false));

$('#sd-add-domain-btn')?.addEventListener('click', async () => {
  if (!currentServiceDetail || currentServiceDetail.kind !== 'web') return;
  const host = ($('#sd-new-domain-host')?.value || '').trim();
  const port = parseInt($('#sd-new-domain-port')?.value || '80', 10);
  if (!host) return setStatus('Enter a domain name', 'error');
  try {
    await resellerFetch(`/paas/services/web/${encodeURIComponent(currentServiceDetail.id)}/domains`, {
      method: 'POST',
      body: JSON.stringify({ host, port, https: true }),
    });
    $('#sd-new-domain-host').value = '';
    setStatus(`Added HTTPS domain: https://${host}`, 'connected');
    await openServiceDetail('web', currentServiceDetail.id);
  } catch (e) {
    setStatus(`Add domain failed: ${e.message}`, 'error');
  }
});

sdRefreshBtn?.addEventListener('click', () => {
  if (currentServiceDetail) openServiceDetail(currentServiceDetail.kind, currentServiceDetail.id);
});

sdRestartBtn?.addEventListener('click', async () => {
  if (!currentServiceDetail) return;
  sdRestartBtn.disabled = true;
  try {
    await resellerFetch(`/paas/services/${encodeURIComponent(currentServiceDetail.kind)}/${encodeURIComponent(currentServiceDetail.id)}/restart`, { method: 'POST', body: '{}' });
    setStatus(`Restarted ${currentServiceDetail.name}`, 'connected');
    await openServiceDetail(currentServiceDetail.kind, currentServiceDetail.id);
  } catch (e) {
    setStatus(`Restart failed: ${e.message}`, 'error');
  } finally {
    sdRestartBtn.disabled = false;
  }
});

sdRedeployBtn?.addEventListener('click', async () => {
  if (!currentServiceDetail) return;
  sdRedeployBtn.disabled = true;
  sdRedeployBtn.textContent = 'Deploying...';
  try {
    await resellerFetch(`/paas/services/${encodeURIComponent(currentServiceDetail.kind)}/${encodeURIComponent(currentServiceDetail.id)}/redeploy`, { method: 'POST', body: '{}' });
    setStatus(`Triggered manual deploy for ${currentServiceDetail.name}`, 'connected');
    await openServiceDetail(currentServiceDetail.kind, currentServiceDetail.id);
  } catch (e) {
    setStatus(`Deploy failed: ${e.message}`, 'error');
  } finally {
    sdRedeployBtn.disabled = false;
    sdRedeployBtn.textContent = 'Manual Deploy';
  }
});

sdDeleteBtn?.addEventListener('click', async () => {
  if (!currentServiceDetail) return;
  await resellerFetch(`/paas/services/${encodeURIComponent(currentServiceDetail.kind)}/${encodeURIComponent(currentServiceDetail.id)}`, { method: 'DELETE' });
  setStatus(`Deleted ${currentServiceDetail.name}`, 'connected');
  showPaasSubview('overview');
  await loadHostedApps();
});

// ============================================================================
// --- RENDER-STYLE NEW STATIC SITE FLOW ---
// ============================================================================
let stSelectedRepo = null;
let stReposCache = [];
let stEnvRowsData = [{ key: '', value: '', masked: true }];
let stSecretFilesData = [];
let stIncludedPathsData = [];
let stIgnoredPathsData = [];

const stBackOverviewBtn = $('#st-back-overview-btn');
const stSourcePicker = $('#st-source-picker');
const stSourceSelected = $('#st-source-selected');
const stConfigForm = $('#st-config-form');
const stRepoList = $('#st-repo-list');
const stRepoSearch = $('#st-repo-search');
const stCredsBtn = $('#st-creds-btn');
const stCredsMenu = $('#st-creds-menu');
const stNameInput = $('#st-name-input');
const stUrlPreview = $('#st-url-preview');
const stProjectSelect = $('#st-project-select');
const stBranchSelect = $('#st-branch-select');
const stRootDirInput = $('#st-root-dir-input');
const stBuildCmdInput = $('#st-build-cmd-input');
const stPublishDirInput = $('#st-publish-dir-input');

stBackOverviewBtn?.addEventListener('click', () => showPaasSubview('overview'));

function updateStUrlPreview() {
  const safe = (stNameInput?.value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'my-static-site';
  if (stUrlPreview) stUrlPreview.textContent = `https://${safe}.apps.iecloudbase.com`;
}
stNameInput?.addEventListener('input', updateStUrlPreview);

async function openNewStaticSiteView() {
  stSelectedRepo = null;
  stEnvRowsData = [{ key: '', value: '', masked: true }];
  stSecretFilesData = [];
  stIncludedPathsData = [];
  stIgnoredPathsData = [];
  if (stSourcePicker) stSourcePicker.style.display = 'block';
  if (stSourceSelected) stSourceSelected.style.display = 'none';
  if (stConfigForm) stConfigForm.style.display = 'none';
  if ($('#st-advanced-body')) $('#st-advanced-body').style.display = 'none';
  if ($('#st-advanced-chevron')) $('#st-advanced-chevron').textContent = '›';

  // Populate project dropdown
  if (stProjectSelect) {
    stProjectSelect.innerHTML = `<option value="">Select a project...</option>` +
      paasProjects.map((p) => `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`).join('');
  }
  renderStEnvRows();
  renderStSecretFiles();
  renderStPathList('included');
  renderStPathList('ignored');
  showPaasSubview('static-new');
  await loadStaticSiteRepos();
}

async function loadStaticSiteRepos() {
  if (!stRepoList) return;
  stRepoList.innerHTML = '<div class="empty-box" style="padding:24px;">Loading repositories...</div>';
  try {
    const cfg = await resellerFetch('/paas/git/config');
    let count = 0;
    if (cfg.connected) count++;
    if (cfg.providers?.gitlab?.connected) count++;
    if (cfg.providers?.bitbucket?.connected) count++;
    if ($('#st-creds-count')) $('#st-creds-count').textContent = count;
    if ($('#st-cred-gh')) $('#st-cred-gh').textContent = cfg.connected ? `@${cfg.username || 'Connected'}` : 'Connect +';
    if ($('#st-cred-gl')) $('#st-cred-gl').textContent = cfg.providers?.gitlab?.connected ? 'Connected ✓' : 'Connect +';
    if ($('#st-cred-bb')) $('#st-cred-bb').textContent = cfg.providers?.bitbucket?.connected ? 'Connected ✓' : 'Connect +';

    if (!cfg.connected) {
      stReposCache = [];
      stRepoList.innerHTML = `
        <div class="empty-box" style="padding:30px 18px;">
          <h3>Connect your Git Provider</h3>
          <p>Sign in with GitHub via <strong>Credentials</strong> to list your repositories, or switch to <strong>Public Git Repository</strong>.</p>
          <button type="button" class="btn btn-primary btn-sm" id="st-empty-gh-btn" style="margin-top:8px;">Sign in with GitHub</button>
        </div>`;
      $('#st-empty-gh-btn')?.addEventListener('click', () => startComposioOAuth('github'));
      return;
    }
    const data = await resellerFetch('/paas/git/repos');
    stReposCache = data.repos || [];
    renderStaticSiteRepoList();
  } catch (e) {
    stRepoList.innerHTML = `<div class="empty-box" style="padding:24px;"><p>${e.message}</p></div>`;
  }
}

function renderStaticSiteRepoList() {
  if (!stRepoList) return;
  const q = (stRepoSearch?.value || '').trim().toLowerCase();
  const filtered = stReposCache.filter((r) => !q || r.fullName.toLowerCase().includes(q));
  if (filtered.length === 0) {
    stRepoList.innerHTML = '<div class="empty-box" style="padding:24px;"><p>No matching repositories found.</p></div>';
    return;
  }
  stRepoList.innerHTML = '';
  filtered.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'bp-repo-row';
    row.style.cursor = 'pointer';
    const lockSvg = r.private
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-secondary);"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '';
    row.innerHTML = `
      <div class="bp-repo-meta">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.07.78 2.15v3.19c0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>
        <span style="font-weight:600;">${r.owner} / ${r.name}</span>
        ${lockSvg}
        <span class="muted">${paasTimeAgo(r.updatedAt)}</span>
      </div>
      <span style="font-size:12px; color:var(--text-secondary);">Select →</span>
    `;
    row.addEventListener('click', () => selectStaticSiteRepo(r.fullName, r.defaultBranch || 'main', paasTimeAgo(r.updatedAt)));
    stRepoList.appendChild(row);
  });
}

stRepoSearch?.addEventListener('input', renderStaticSiteRepoList);

$$('#st-source-tabs .paas-status-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.stsrc;
    $$('#st-source-tabs .paas-status-tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#st-src-provider-panel').style.display = mode === 'provider' ? 'block' : 'none';
    $('#st-src-public-panel').style.display = mode === 'public' ? 'block' : 'none';
  });
});

stCredsBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  stCredsMenu?.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (stCredsMenu && !stCredsMenu.contains(e.target) && e.target !== stCredsBtn) stCredsMenu.classList.remove('open');
});
$$('#st-creds-menu [data-st-oauth]').forEach((btn) => {
  btn.addEventListener('click', () => {
    stCredsMenu?.classList.remove('open');
    startComposioOAuth(btn.dataset.stOauth);
  });
});

$('#st-public-connect-btn')?.addEventListener('click', () => {
  const raw = ($('#st-public-repo-input')?.value || '').trim();
  if (!raw) return setStatus('Enter a public Git repository URL', 'error');
  const slug = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  selectStaticSiteRepo(slug, 'main', 'Public repository');
});

$('#st-change-repo-btn')?.addEventListener('click', () => {
  stSourcePicker.style.display = 'block';
  stSourceSelected.style.display = 'none';
  stConfigForm.style.display = 'none';
});

async function selectStaticSiteRepo(repoSlug, defaultBranch = 'main', metaText = '') {
  stSelectedRepo = repoSlug;
  const parts = repoSlug.split('/');
  $('#st-selected-repo-name').textContent = parts.length === 2 ? `${parts[0]} / ${parts[1]}` : repoSlug;
  $('#st-selected-repo-meta').textContent = metaText ? `· ${metaText}` : '';
  stSourcePicker.style.display = 'none';
  stSourceSelected.style.display = 'flex';
  stConfigForm.style.display = 'block';

  const shortName = (parts[parts.length - 1] || 'static-site').replace(/[^a-zA-Z0-9-]/g, '-');
  stNameInput.value = shortName;
  updateStUrlPreview();

  stBranchSelect.innerHTML = `<option value="${defaultBranch}">${defaultBranch}</option>`;
  try {
    const bData = await resellerFetch(`/paas/git/branches?repo=${encodeURIComponent(repoSlug)}`);
    const branches = (bData.branches || []).length ? bData.branches : [defaultBranch];
    stBranchSelect.innerHTML = branches.map((b) => `<option value="${b}" ${b === defaultBranch ? 'selected' : ''}>${b}</option>`).join('');
  } catch {}
}

// Environment Variables rows
function renderStEnvRows() {
  const el = $('#st-env-rows');
  if (!el) return;
  el.innerHTML = '';
  stEnvRowsData.forEach((row, idx) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:grid; grid-template-columns:1fr 1fr 68px; gap:8px; align-items:center;';
    div.innerHTML = `
      <input type="text" class="input st-ek" placeholder="KEY" value="${(row.key || '').replace(/"/g, '&quot;')}" style="font-family:var(--mono); font-size:12.5px;" />
      <input type="${row.masked ? 'password' : 'text'}" class="input st-ev" placeholder="value" value="${(row.value || '').replace(/"/g, '&quot;')}" style="font-family:var(--mono); font-size:12.5px;" />
      <div style="display:flex; gap:4px; justify-content:flex-end;">
        <button type="button" class="icon-btn st-eye" title="${row.masked ? 'Reveal value' : 'Hide value'}" style="width:30px;height:30px;color:var(--text-secondary);">${row.masked ? EYE_ICON_SVG : EYE_OFF_ICON_SVG}</button>
        <button type="button" class="icon-btn st-del" title="Remove" style="width:30px;height:30px;color:#dc2626;">✕</button>
      </div>
    `;
    div.querySelector('.st-ek').addEventListener('input', (e) => { stEnvRowsData[idx].key = e.target.value; });
    div.querySelector('.st-ev').addEventListener('input', (e) => { stEnvRowsData[idx].value = e.target.value; });
    div.querySelector('.st-eye').addEventListener('click', () => { stEnvRowsData[idx].masked = !stEnvRowsData[idx].masked; renderStEnvRows(); });
    div.querySelector('.st-del').addEventListener('click', () => { stEnvRowsData.splice(idx, 1); renderStEnvRows(); });
    el.appendChild(div);
  });
}

$('#st-add-env-btn')?.addEventListener('click', () => {
  stEnvRowsData.push({ key: '', value: '', masked: false });
  renderStEnvRows();
});

$('#st-add-dotenv-btn')?.addEventListener('click', () => {
  const box = $('#st-dotenv-box');
  if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
});
$('#st-dotenv-cancel-btn')?.addEventListener('click', () => { $('#st-dotenv-box').style.display = 'none'; });
$('#st-dotenv-apply-btn')?.addEventListener('click', () => {
  const raw = ($('#st-dotenv-textarea')?.value || '').trim();
  for (const [k, v] of parseEnvText(raw)) {
    stEnvRowsData.push({ key: k, value: v, masked: true });
  }
  stEnvRowsData = stEnvRowsData.filter((r) => r.key.trim() || r.value.trim());
  if (stEnvRowsData.length === 0) stEnvRowsData.push({ key: '', value: '', masked: true });
  $('#st-dotenv-textarea').value = '';
  $('#st-dotenv-box').style.display = 'none';
  renderStEnvRows();
});

// Advanced accordion
$('#st-advanced-toggle')?.addEventListener('click', () => {
  const body = $('#st-advanced-body');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  $('#st-advanced-chevron').textContent = open ? '⌄' : '›';
});

function renderStSecretFiles() {
  const el = $('#st-secret-files-list');
  if (!el) return;
  el.innerHTML = '';
  stSecretFilesData.forEach((sf, idx) => {
    const row = document.createElement('div');
    row.className = 'bp-service-preview';
    row.innerHTML = `
      <div>
        <div style="font-size:13px; font-weight:600; font-family:var(--mono);">${sf.name}</div>
        <div style="font-size:11.5px; color:var(--text-secondary);">/etc/secrets/${sf.name} · ${(sf.content || '').length} bytes</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button type="button" class="btn btn-secondary btn-sm st-sf-edit">Edit</button>
        <button type="button" class="btn btn-danger-ghost btn-sm st-sf-del">Remove</button>
      </div>
    `;
    row.querySelector('.st-sf-edit').addEventListener('click', () => openSecretFileModal('st', idx));
    row.querySelector('.st-sf-del').addEventListener('click', () => { stSecretFilesData.splice(idx, 1); renderStSecretFiles(); });
    el.appendChild(row);
  });
}
$('#st-add-secret-file-btn')?.addEventListener('click', () => openSecretFileModal('st', -1));

function renderStPathList(kind) {
  const arr = kind === 'included' ? stIncludedPathsData : stIgnoredPathsData;
  const el = $(kind === 'included' ? '#st-included-paths-list' : '#st-ignored-paths-list');
  if (!el) return;
  el.innerHTML = '';
  arr.forEach((val, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:6px;';
    row.innerHTML = `
      <input type="text" class="input" placeholder="e.g. frontend/**" value="${(val || '').replace(/"/g, '&quot;')}" style="flex:1; font-family:var(--mono); font-size:12px;" />
      <button type="button" class="btn btn-danger-ghost btn-sm">✕</button>
    `;
    row.querySelector('input').addEventListener('input', (e) => { arr[idx] = e.target.value; });
    row.querySelector('button').addEventListener('click', () => { arr.splice(idx, 1); renderStPathList(kind); });
    el.appendChild(row);
  });
}
$('#st-add-included-path-btn')?.addEventListener('click', () => { stIncludedPathsData.push(''); renderStPathList('included'); });
$('#st-add-ignored-path-btn')?.addEventListener('click', () => { stIgnoredPathsData.push(''); renderStPathList('ignored'); });

// Deploy Static Site submit
$('#st-deploy-submit-btn')?.addEventListener('click', async () => {
  const btn = $('#st-deploy-submit-btn');
  const name = (stNameInput?.value || '').trim();
  if (!stSelectedRepo) return setStatus('Select a Git repository first', 'error');
  if (!name) return setStatus('Enter a Static Site name', 'error');

  btn.disabled = true;
  btn.textContent = 'Deploying Static Site...';
  try {
    const res = await resellerFetch('/paas/static-sites', {
      method: 'POST',
      body: JSON.stringify({
        name,
        repo: stSelectedRepo,
        projectId: stProjectSelect?.value || selectedProjectId || '',
        branch: stBranchSelect?.value || 'main',
        rootDirectory: (stRootDirInput?.value || '').trim(),
        buildCommand: (stBuildCmdInput?.value || '').trim(),
        publishDirectory: (stPublishDirInput?.value || '').trim(),
        env: stEnvRowsData.filter((r) => r.key && r.key.trim()),
        secretFiles: stSecretFilesData.filter((s) => s.name && s.name.trim()),
        autoDeploy: ($('#st-autodeploy-select')?.value || 'on') === 'on',
        includedPaths: stIncludedPathsData.filter(Boolean),
        ignoredPaths: stIgnoredPathsData.filter(Boolean),
      }),
    });
    setStatus(`Static site deploying: ${res.site?.url}`, 'connected');
    showPaasSubview('overview');
    await loadHostedApps();
  } catch (e) {
    setStatus(`Static site deploy failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Deploy Static Site';
  }
});

// ============================================================================
// --- RENDER-STYLE NEW WEB SERVICE FLOW ---
// ============================================================================
let wsServiceKind = 'web'; // 'web' | 'private'
let wsSourceMode = 'git'; // 'git' | 'image'
let wsSelectedRepo = null;
let wsSelectedImage = null;
let wsReposCache = [];
let wsEnvRowsData = [{ key: 'PORT', value: '3000', masked: false }];
let wsSecretFilesData = [];
let wsIncludedPathsData = [];
let wsIgnoredPathsData = [];
let wsDiskAttached = false;
let wsDiskSizeGb = 10;
let wsSelectedPlan = { plan: 'free', price: '$0 / month', cpu: '0.1 CPU', ram: '512 MB RAM' };
let wsRegionsList = [
  { id: 'eu-north-1', label: 'Stockholm', location: 'EU North', serverId: null, active: true },
  { id: 'eu-central-1', label: 'Frankfurt', location: 'EU Central', serverId: null, active: false },
  { id: 'us-east-2', label: 'Ohio', location: 'US East', serverId: null, active: false },
  { id: 'us-west-2', label: 'Oregon', location: 'US West', serverId: null, active: false },
  { id: 'ap-southeast-1', label: 'Singapore', location: 'Southeast Asia', serverId: null, active: false },
  { id: 'us-east-1', label: 'Virginia', location: 'US East', serverId: null, active: false },
];
let wsSelectedRegion = wsRegionsList[0];

function renderWsRegionSelector() {
  if ($('#ws-region-label')) $('#ws-region-label').textContent = wsSelectedRegion.label;
  if ($('#ws-region-location')) $('#ws-region-location').textContent = `(${wsSelectedRegion.location})`;
  if ($('#ws-region-active-text')) $('#ws-region-active-text').textContent = wsSelectedRegion.label;
  const count = wsSelectedRegion.id === 'eu-north-1' ? hostedApps.length : 0;
  if ($('#ws-region-svc-count')) $('#ws-region-svc-count').textContent = count > 0 ? `${count} existing service${count === 1 ? '' : 's'}` : 'New region';

  const menu = $('#ws-region-menu');
  if (!menu) return;
  menu.innerHTML = '';
  wsRegionsList.filter((r) => r.id !== wsSelectedRegion.id).forEach((reg) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'paas-new-item';
    btn.style.justifyContent = 'space-between';
    btn.innerHTML = `<span>${reg.label} (${reg.location})</span>${reg.serverId ? '<span class="badge badge-running" style="font-size:10px;">Live</span>' : ''}`;
    btn.addEventListener('click', () => {
      wsSelectedRegion = reg;
      menu.classList.remove('open');
      renderWsRegionSelector();
    });
    menu.appendChild(btn);
  });
}

$('#ws-new-region-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('#ws-region-menu')?.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  const menu = $('#ws-region-menu');
  const btn = $('#ws-new-region-btn');
  if (menu && !menu.contains(e.target) && e.target !== btn) menu.classList.remove('open');
});

const wsBackOverviewBtn = $('#ws-back-overview-btn');
const wsCancelBtn = $('#ws-cancel-btn');
const wsSourcePicker = $('#ws-source-picker');
const wsSourceSelected = $('#ws-source-selected');
const wsConfigForm = $('#ws-config-form');
const wsRepoList = $('#ws-repo-list');
const wsRepoSearch = $('#ws-repo-search');
const wsCredsBtn = $('#ws-creds-btn');
const wsCredsMenu = $('#ws-creds-menu');
const wsNameInput = $('#ws-name-input');
const wsUrlPreview = $('#ws-url-preview');
const wsProjectSelect = $('#ws-project-select');
const wsLanguageSelect = $('#ws-language-select');
const wsBranchSelect = $('#ws-branch-select');
const wsPortInput = $('#ws-port-input');

wsBackOverviewBtn?.addEventListener('click', () => showPaasSubview('overview'));
wsCancelBtn?.addEventListener('click', () => showPaasSubview('overview'));

function updateWsUrlPreview() {
  const safe = (wsNameInput?.value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || (wsServiceKind === 'private' ? 'my-private-service' : 'my-web-service');
  if (wsUrlPreview) {
    wsUrlPreview.textContent = wsServiceKind === 'private'
      ? `https://${safe}.apps.iecloudbase.com (Password-protected Private Service)`
      : `https://${safe}.apps.iecloudbase.com`;
  }
}
wsNameInput?.addEventListener('input', updateWsUrlPreview);
wsPortInput?.addEventListener('input', updateWsUrlPreview);

function syncWsLanguageFields() {
  const lang = wsLanguageSelect?.value || 'Node';
  const isImg = wsSourceMode === 'image' || lang === 'Image';
  const isDocker = lang === 'Docker';
  if ($('#ws-dockerfile-wrap')) $('#ws-dockerfile-wrap').style.display = isDocker ? 'block' : 'none';
  if ($('#ws-branch-row')) $('#ws-branch-row').style.display = isImg ? 'none' : 'grid';
  if ($('#ws-root-dir-row')) $('#ws-root-dir-row').style.display = isImg ? 'none' : 'grid';
  if ($('#ws-build-cmd-row')) $('#ws-build-cmd-row').style.display = (isImg || isDocker) ? 'none' : 'grid';
}
wsLanguageSelect?.addEventListener('change', syncWsLanguageFields);

const WS_KIND_META = {
  web: { title: 'New Web Service', btn: 'Deploy web service', deploying: 'Deploying web service...', label: 'Web Service' },
  private: { title: 'New Private Service', btn: 'Deploy private service', deploying: 'Deploying private service...', label: 'Private Service' },
  worker: { title: 'New Background Worker', btn: 'Deploy background worker', deploying: 'Deploying background worker...', label: 'Background Worker' },
  cron: { title: 'New Cron Job', btn: 'Deploy cron job', deploying: 'Deploying cron job...', label: 'Cron Job' },
};

const WS_CRON_PLANS = [
  { plan: '0.5c-512mb', price: '$0.00016 / min', cpu: '0.5 CPU', ram: '512 MB RAM' },
  { plan: '1c-2g', price: '$0.00058 / min', cpu: '1 CPU', ram: '2 GB RAM' },
  { plan: '2c-4g', price: '$0.00197 / min', cpu: '2 CPU', ram: '4 GB RAM' },
  { plan: '2c-8g', price: '$0.00313 / min', cpu: '2 CPU', ram: '8 GB RAM' },
  { plan: '4c-8g', price: '$0.00405 / min', cpu: '4 CPU', ram: '8 GB RAM' },
  { plan: '4c-16g', price: '$0.00637 / min', cpu: '4 CPU', ram: '16 GB RAM' },
  { plan: '8c-16g', price: '$0.00868 / min', cpu: '8 CPU', ram: '16 GB RAM' },
  { plan: '8c-32g', price: '$0.01331 / min', cpu: '8 CPU', ram: '32 GB RAM' },
  { plan: '16c-32g', price: '$0.01736 / min', cpu: '16 CPU', ram: '32 GB RAM' },
  { plan: '16c-64g', price: '$0.02662 / min', cpu: '16 CPU', ram: '64 GB RAM' },
  { plan: '32c-128g', price: '$0.05324 / min', cpu: '32 CPU', ram: '128 GB RAM' },
];
let wsCronShowAllPlans = false;

function describeCronSchedule(expr) {
  const s = (expr || '').trim();
  if (s === '* * * * *') return 'every minute';
  if (s === '*/5 * * * *') return 'every 5 minutes';
  if (s === '*/15 * * * *') return 'every 15 minutes';
  if (s === '0 * * * *') return 'every hour';
  if (s === '0 0 * * *') return 'every day at midnight UTC';
  if (s === '0 0 * * 0') return 'every Sunday at midnight UTC';
  const m = s.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m) return `every ${m[1]} minutes`;
  return s ? `cron schedule (${s})` : 'enter a cron expression';
}

function renderWsCronComputePlans() {
  const listEl = $('#ws-cron-compute-list');
  const toggleBtn = $('#ws-cron-toggle-plans-btn');
  if (!listEl) return;
  const shown = wsCronShowAllPlans ? WS_CRON_PLANS : WS_CRON_PLANS.slice(0, 4);
  listEl.innerHTML = '';
  shown.forEach((p) => {
    const selected = wsSelectedPlan?.plan === p.plan;
    const row = document.createElement('label');
    row.style.cssText = `display:grid; grid-template-columns:24px 125px 80px 100px 1fr; align-items:center; padding:10px 12px; border:${selected ? '1.5px solid #111827' : '1px solid var(--border)'}; border-radius:8px; cursor:pointer; font-size:13px; background:${selected ? '#f8fafc' : '#ffffff'};`;
    row.innerHTML = `
      <input type="radio" name="ws-cron-compute-plan" value="${p.plan}" ${selected ? 'checked' : ''} style="accent-color:#111827;" />
      <strong>${p.price}</strong>
      <span>${p.cpu}</span>
      <span>${p.ram}</span>
      <span style="text-align:right; color:var(--text-secondary); font-family:var(--mono); font-size:12px;">${p.plan}</span>
    `;
    row.querySelector('input')?.addEventListener('change', () => {
      wsSelectedPlan = { ...p };
      renderWsCronComputePlans();
      if ($('#ws-compute-selected-summary')) {
        $('#ws-compute-selected-summary').textContent = `${p.price}  ·  ${p.cpu}  ·  ${p.ram}`;
      }
      if ($('#ws-sticky-plan-summary')) {
        $('#ws-sticky-plan-summary').innerHTML = `<strong style="color:var(--text-primary);">${p.price}</strong> &nbsp;&nbsp; ${p.cpu} &nbsp;&nbsp; ${p.ram}`;
      }
    });
    listEl.appendChild(row);
  });
  if (toggleBtn) {
    toggleBtn.textContent = wsCronShowAllPlans ? 'Show less' : `Show all ${WS_CRON_PLANS.length} compute plans`;
  }
}

$('#ws-cron-toggle-plans-btn')?.addEventListener('click', () => {
  wsCronShowAllPlans = !wsCronShowAllPlans;
  renderWsCronComputePlans();
});

$('#ws-cron-schedule-input')?.addEventListener('input', (e) => {
  const lbl = $('#ws-cron-schedule-human');
  if (lbl) lbl.textContent = describeCronSchedule(e.target.value);
});

async function openNewWebServiceView(kind = 'web') {
  wsServiceKind = WS_KIND_META[kind] ? kind : 'web';
  const meta = WS_KIND_META[wsServiceKind];
  const isCron = wsServiceKind === 'cron';
  const isWorker = wsServiceKind === 'worker';
  wsSourceMode = 'git';
  wsSelectedRepo = null;
  wsSelectedImage = null;
  wsEnvRowsData = [{ key: 'PORT', value: '3000', masked: false }];
  wsSecretFilesData = [];
  wsIncludedPathsData = [];
  wsIgnoredPathsData = [];
  wsDiskAttached = false;
  wsDiskSizeGb = 10;
  wsCronShowAllPlans = false;
  if ($('#ws-page-title')) $('#ws-page-title').textContent = meta.title;
  if ($('#ws-breadcrumb-title')) $('#ws-breadcrumb-title').textContent = meta.title;
  if ($('#ws-deploy-submit-btn')) $('#ws-deploy-submit-btn').textContent = meta.btn;
  if ($('#ws-cron-schedule-row')) $('#ws-cron-schedule-row').style.display = isCron ? 'grid' : 'none';
  if ($('#ws-cron-schedule-input')) $('#ws-cron-schedule-input').value = '*/5 * * * *';
  if ($('#ws-cron-schedule-human')) $('#ws-cron-schedule-human').textContent = 'every 5 minutes';
  if ($('#ws-start-cmd-title')) $('#ws-start-cmd-title').textContent = isCron ? 'Command' : 'Start Command';
  if ($('#ws-start-cmd-desc')) $('#ws-start-cmd-desc').textContent = isCron ? 'The command to run periodically.' : 'ieCloudbase runs this command to start your app with each deploy.';
  if ($('#ws-port-row')) $('#ws-port-row').style.display = (isCron || isWorker) ? 'none' : 'grid';
  if ($('#ws-disk-section')) $('#ws-disk-section').style.display = isCron ? 'none' : 'block';
  if ($('#ws-healthcheck-row')) $('#ws-healthcheck-row').style.display = isCron ? 'none' : 'grid';
  if ($('#ws-predeploy-row')) $('#ws-predeploy-row').style.display = isCron ? 'none' : 'grid';
  if ($('#ws-compute-plans')) $('#ws-compute-plans').style.display = isCron ? 'none' : 'flex';
  if ($('#ws-cron-compute-wrap')) $('#ws-cron-compute-wrap').style.display = isCron ? 'block' : 'none';
  if ($('#ws-compute-bullets')) {
    $('#ws-compute-bullets').innerHTML = isCron
      ? 'Select a compute plan for your cron job.'
      : 'Choose the CPU and RAM allocation for your web service:<br/>• Zero Downtime<br/>• Automatic Let\'s Encrypt HTTPS<br/>• Live Build &amp; Runtime Logs<br/>• Persistent Disks';
  }
  if (isCron) {
    wsSelectedPlan = { ...WS_CRON_PLANS[0] };
    renderWsCronComputePlans();
    if ($('#ws-compute-selected-summary')) {
      $('#ws-compute-selected-summary').textContent = `${wsSelectedPlan.price}  ·  ${wsSelectedPlan.cpu}  ·  ${wsSelectedPlan.ram}`;
    }
    if ($('#ws-sticky-plan-summary')) {
      $('#ws-sticky-plan-summary').innerHTML = `<strong style="color:var(--text-primary);">${wsSelectedPlan.price}</strong> &nbsp;&nbsp; ${wsSelectedPlan.cpu} &nbsp;&nbsp; ${wsSelectedPlan.ram}`;
    }
  } else {
    wsSelectedPlan = { plan: 'free', price: '$0 / month', cpu: '0.1 CPU', ram: '512 MB RAM' };
    if ($('#ws-compute-selected-summary')) {
      $('#ws-compute-selected-summary').textContent = '$0 / month  ·  0.1 CPU  ·  512 MB RAM';
    }
    if ($('#ws-sticky-plan-summary')) {
      $('#ws-sticky-plan-summary').innerHTML = `<strong style="color:var(--text-primary);">$0</strong> / month &nbsp;&nbsp; 0.1 CPU &nbsp;&nbsp; 512 MB RAM`;
    }
  }
  if (wsSourcePicker) wsSourcePicker.style.display = 'block';
  if (wsSourceSelected) wsSourceSelected.style.display = 'none';
  if (wsConfigForm) wsConfigForm.style.display = 'none';
  if ($('#ws-autofill-hint')) $('#ws-autofill-hint').style.display = 'none';
  if ($('#ws-advanced-body')) $('#ws-advanced-body').style.display = 'none';
  if ($('#ws-advanced-chevron')) $('#ws-advanced-chevron').textContent = '›';
  if ($('#ws-disk-box')) $('#ws-disk-box').style.display = 'none';
  if ($('#ws-disk-mount')) $('#ws-disk-mount').value = '';
  if ($('#ws-disk-size-label')) $('#ws-disk-size-label').textContent = '10';
  if ($('#ws-add-disk-btn')) $('#ws-add-disk-btn').style.display = 'inline-flex';
  renderWsRegionSelector();
  resellerFetch('/paas/regions').then((r) => {
    if (Array.isArray(r.regions) && r.regions.length) {
      wsRegionsList = r.regions;
      wsSelectedRegion = wsRegionsList[0];
      renderWsRegionSelector();
    }
  }).catch(() => {});

  if (wsProjectSelect) {
    wsProjectSelect.innerHTML = `<option value="">Select a project...</option>` +
      paasProjects.map((p) => `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`).join('');
  }
  renderWsEnvRows();
  renderWsSecretFiles();
  renderWsPathList('included');
  renderWsPathList('ignored');
  showPaasSubview('web-new');
  loadRegistryCredentials();
  await loadWebServiceRepos();
}

async function loadWebServiceRepos() {
  if (!wsRepoList) return;
  wsRepoList.innerHTML = '<div class="empty-box" style="padding:24px;">Loading repositories...</div>';
  try {
    const cfg = await resellerFetch('/paas/git/config');
    let count = 0;
    if (cfg.connected) count++;
    if (cfg.providers?.gitlab?.connected) count++;
    if (cfg.providers?.bitbucket?.connected) count++;
    if ($('#ws-creds-count')) $('#ws-creds-count').textContent = count;
    if ($('#ws-cred-gh')) $('#ws-cred-gh').textContent = cfg.connected ? `@${cfg.username || 'Connected'}` : 'Connect +';
    if ($('#ws-cred-gl')) $('#ws-cred-gl').textContent = cfg.providers?.gitlab?.connected ? 'Connected ✓' : 'Connect +';
    if ($('#ws-cred-bb')) $('#ws-cred-bb').textContent = cfg.providers?.bitbucket?.connected ? 'Connected ✓' : 'Connect +';

    if (!cfg.connected) {
      wsReposCache = [];
      wsRepoList.innerHTML = `
        <div class="empty-box" style="padding:30px 18px;">
          <h3>Connect your Git Provider</h3>
          <p>Sign in with GitHub via <strong>Credentials</strong>, or use <strong>Public Git Repository</strong> / <strong>Existing Image</strong>.</p>
          <button type="button" class="btn btn-primary btn-sm" id="ws-empty-gh-btn" style="margin-top:8px;">Sign in with GitHub</button>
        </div>`;
      $('#ws-empty-gh-btn')?.addEventListener('click', () => startComposioOAuth('github'));
      return;
    }
    const data = await resellerFetch('/paas/git/repos');
    wsReposCache = data.repos || [];
    renderWebServiceRepoList();
  } catch (e) {
    wsRepoList.innerHTML = `<div class="empty-box" style="padding:24px;"><p>${e.message}</p></div>`;
  }
}

function renderWebServiceRepoList() {
  if (!wsRepoList) return;
  const q = (wsRepoSearch?.value || '').trim().toLowerCase();
  const filtered = wsReposCache.filter((r) => !q || r.fullName.toLowerCase().includes(q));
  if (filtered.length === 0) {
    wsRepoList.innerHTML = '<div class="empty-box" style="padding:24px;"><p>No matching repositories found.</p></div>';
    return;
  }
  wsRepoList.innerHTML = '';
  filtered.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'bp-repo-row';
    row.style.cursor = 'pointer';
    const lockSvg = r.private
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-secondary);"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '';
    row.innerHTML = `
      <div class="bp-repo-meta">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.07.78 2.15v3.19c0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>
        <span style="font-weight:600;">${r.owner} / ${r.name}</span>
        ${lockSvg}
        <span class="muted">${paasTimeAgo(r.updatedAt)}</span>
      </div>
      <span style="font-size:12px; color:var(--text-secondary);">Select →</span>
    `;
    row.addEventListener('click', () => selectWebServiceGitRepo(r.fullName, r.defaultBranch || 'main', paasTimeAgo(r.updatedAt)));
    wsRepoList.appendChild(row);
  });
}

wsRepoSearch?.addEventListener('input', renderWebServiceRepoList);

$$('#ws-source-tabs .paas-status-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.wssrc;
    $$('#ws-source-tabs .paas-status-tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#ws-src-provider-panel').style.display = mode === 'provider' ? 'block' : 'none';
    $('#ws-src-public-panel').style.display = mode === 'public' ? 'block' : 'none';
    $('#ws-src-image-panel').style.display = mode === 'image' ? 'block' : 'none';
  });
});

wsCredsBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  wsCredsMenu?.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (wsCredsMenu && !wsCredsMenu.contains(e.target) && e.target !== wsCredsBtn) wsCredsMenu.classList.remove('open');
});
$$('#ws-creds-menu [data-ws-oauth]').forEach((btn) => {
  btn.addEventListener('click', () => {
    wsCredsMenu?.classList.remove('open');
    startComposioOAuth(btn.dataset.wsOauth);
  });
});

let wsSavedRegCreds = [];
let wsSelectedCredId = '';
let regCredTokenMasked = true;

async function loadRegistryCredentials(selectId = null) {
  const sel = $('#ws-image-cred-select');
  if (!sel) return;
  try {
    const res = await resellerFetch('/paas/registry-credentials');
    wsSavedRegCreds = res.credentials || [];
  } catch {
    wsSavedRegCreds = [];
  }
  const keepVal = selectId !== null ? selectId : (wsSelectedCredId || 'none');
  sel.innerHTML = `<option value="none">No credential</option>` +
    wsSavedRegCreds.map((c) => `<option value="${c.id}">${c.name} (${c.registryLabel || c.registry} · ${c.username})</option>`).join('') +
    `<option value="__add__">+ Add credential</option>`;
  sel.value = keepVal && wsSavedRegCreds.some((c) => c.id === keepVal) ? keepVal : 'none';
  wsSelectedCredId = sel.value === 'none' ? '' : sel.value;
}

function openRegCredModal() {
  const bd = $('#paas-reg-cred-modal-backdrop');
  if (!bd) return;
  $('#reg-cred-name').value = '';
  $('#reg-cred-registry').value = '';
  $('#reg-cred-username').value = '';
  $('#reg-cred-token').value = '';
  regCredTokenMasked = true;
  $('#reg-cred-token').type = 'password';
  $('#reg-cred-token-eye').innerHTML = EYE_ICON_SVG;
  bd.classList.add('open');
  $('#reg-cred-name')?.focus();
}

function closeRegCredModal() {
  $('#paas-reg-cred-modal-backdrop')?.classList.remove('open');
  const sel = $('#ws-image-cred-select');
  if (sel && sel.value === '__add__') sel.value = wsSelectedCredId || 'none';
}

$('#reg-cred-close-btn')?.addEventListener('click', closeRegCredModal);
$('#reg-cred-cancel-btn')?.addEventListener('click', closeRegCredModal);
$('#paas-reg-cred-modal-backdrop')?.addEventListener('click', (e) => {
  if (e.target === $('#paas-reg-cred-modal-backdrop')) closeRegCredModal();
});
$('#reg-cred-token-eye')?.addEventListener('click', () => {
  regCredTokenMasked = !regCredTokenMasked;
  $('#reg-cred-token').type = regCredTokenMasked ? 'password' : 'text';
  $('#reg-cred-token-eye').innerHTML = regCredTokenMasked ? EYE_ICON_SVG : EYE_OFF_ICON_SVG;
});

$('#reg-cred-save-btn')?.addEventListener('click', async () => {
  const btn = $('#reg-cred-save-btn');
  const name = ($('#reg-cred-name')?.value || '').trim();
  const registry = ($('#reg-cred-registry')?.value || '').trim();
  const username = ($('#reg-cred-username')?.value || '').trim();
  const token = ($('#reg-cred-token')?.value || '').trim();
  if (!name || !registry || !username || !token) {
    return setStatus('Fill in Name, Registry, Username, and Personal Access Token', 'error');
  }
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const res = await resellerFetch('/paas/registry-credentials', {
      method: 'POST',
      body: JSON.stringify({ name, registry, username, token }),
    });
    closeRegCredModal();
    await loadRegistryCredentials(res.credential?.id || '');
    setStatus(`Saved registry credential: ${name}`, 'connected');
  } catch (e) {
    setStatus(`Save credential failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Credential';
  }
});

$('#ws-image-cred-select')?.addEventListener('change', (e) => {
  if (e.target.value === '__add__') {
    openRegCredModal();
  } else {
    wsSelectedCredId = e.target.value === 'none' ? '' : e.target.value;
  }
});

$('#ws-public-connect-btn')?.addEventListener('click', () => {
  const raw = ($('#ws-public-repo-input')?.value || '').trim();
  if (!raw) return setStatus('Enter a public Git repository URL', 'error');
  const slug = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  selectWebServiceGitRepo(slug, 'main', 'Public repository');
});

$('#ws-image-connect-btn')?.addEventListener('click', () => {
  const img = ($('#ws-image-url-input')?.value || '').trim();
  if (!img) return setStatus('Enter a Docker Image URL', 'error');
  wsSourceMode = 'image';
  wsSelectedImage = img;
  wsSelectedRepo = null;
  $('#ws-selected-icon').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
  $('#ws-selected-source-name').textContent = img;
  const credObj = wsSavedRegCreds.find((c) => c.id === wsSelectedCredId);
  $('#ws-selected-source-meta').textContent = credObj ? `· ${credObj.name} (${credObj.registryLabel})` : '· Public Docker Image';
  wsSourcePicker.style.display = 'none';
  wsSourceSelected.style.display = 'flex';
  wsConfigForm.style.display = 'block';
  const baseName = img.split('/').pop().split(':')[0].replace(/[^a-zA-Z0-9-]/g, '-') || 'web-app';
  wsNameInput.value = baseName;
  updateWsUrlPreview();
  wsLanguageSelect.value = 'Image';
  wsPortInput.value = '80';
  wsEnvRowsData = [{ key: 'PORT', value: '80', masked: false }];
  renderWsEnvRows();
  syncWsLanguageFields();
});

$('#ws-change-source-btn')?.addEventListener('click', () => {
  wsSourcePicker.style.display = 'block';
  wsSourceSelected.style.display = 'none';
  wsConfigForm.style.display = 'none';
});

async function selectWebServiceGitRepo(repoSlug, defaultBranch = 'main', metaText = '') {
  wsSourceMode = 'git';
  wsSelectedRepo = repoSlug;
  wsSelectedImage = null;
  const parts = repoSlug.split('/');
  $('#ws-selected-icon').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.07.78 2.15v3.19c0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>';
  $('#ws-selected-source-name').textContent = parts.length === 2 ? `${parts[0]} / ${parts[1]}` : repoSlug;
  $('#ws-selected-source-meta').textContent = metaText ? `· ${metaText}` : '';
  wsSourcePicker.style.display = 'none';
  wsSourceSelected.style.display = 'flex';
  wsConfigForm.style.display = 'block';

  const shortName = (parts[parts.length - 1] || 'web-service').replace(/[^a-zA-Z0-9-]/g, '-');
  wsNameInput.value = shortName;
  updateWsUrlPreview();
  wsLanguageSelect.value = 'Node';
  wsPortInput.value = '3000';
  syncWsLanguageFields();

  wsBranchSelect.innerHTML = `<option value="${defaultBranch}">${defaultBranch}</option>`;
  try {
    const bData = await resellerFetch(`/paas/git/branches?repo=${encodeURIComponent(repoSlug)}`);
    const branches = (bData.branches || []).length ? bData.branches : [defaultBranch];
    wsBranchSelect.innerHTML = branches.map((b) => `<option value="${b}" ${b === defaultBranch ? 'selected' : ''}>${b}</option>`).join('');
  } catch {}
}

// Compute plan radio selection
$$('#ws-compute-plans .ws-plan-opt').forEach((lbl) => {
  lbl.addEventListener('click', () => {
    $$('#ws-compute-plans .ws-plan-opt').forEach((el) => {
      const active = el === lbl;
      el.style.border = active ? '1.5px solid #111827' : '1px solid var(--border)';
      el.style.background = active ? '#f8fafc' : '#ffffff';
      const radio = el.querySelector('input[type="radio"]');
      if (radio) radio.checked = active;
    });
    wsSelectedPlan = {
      plan: lbl.dataset.plan,
      price: lbl.dataset.price,
      cpu: lbl.dataset.cpu,
      ram: lbl.dataset.ram,
    };
    const priceNum = wsSelectedPlan.price.split(' ')[0];
    if ($('#ws-compute-selected-summary')) {
      $('#ws-compute-selected-summary').textContent = `${wsSelectedPlan.price}  ·  ${wsSelectedPlan.cpu}  ·  ${wsSelectedPlan.ram}`;
    }
    if ($('#ws-sticky-plan-summary')) {
      $('#ws-sticky-plan-summary').innerHTML = `<strong style="color:var(--text-primary);">${priceNum}</strong> / month &nbsp;&nbsp; ${wsSelectedPlan.cpu} &nbsp;&nbsp; ${wsSelectedPlan.ram}`;
    }
  });
});

// Environment Variables rows
function renderWsEnvRows() {
  const el = $('#ws-env-rows');
  if (!el) return;
  el.innerHTML = '';
  wsEnvRowsData.forEach((row, idx) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:grid; grid-template-columns:1fr 1fr 68px; gap:8px; align-items:center;';
    div.innerHTML = `
      <input type="text" class="input ws-ek" placeholder="KEY" value="${(row.key || '').replace(/"/g, '&quot;')}" style="font-family:var(--mono); font-size:12.5px;" />
      <input type="${row.masked ? 'password' : 'text'}" class="input ws-ev" placeholder="value" value="${(row.value || '').replace(/"/g, '&quot;')}" style="font-family:var(--mono); font-size:12.5px;" />
      <div style="display:flex; gap:4px; justify-content:flex-end;">
        <button type="button" class="icon-btn ws-eye" title="${row.masked ? 'Reveal value' : 'Hide value'}" style="width:30px;height:30px;color:var(--text-secondary);">${row.masked ? EYE_ICON_SVG : EYE_OFF_ICON_SVG}</button>
        <button type="button" class="icon-btn ws-del" title="Remove" style="width:30px;height:30px;color:#dc2626;">✕</button>
      </div>
    `;
    div.querySelector('.ws-ek').addEventListener('input', (e) => { wsEnvRowsData[idx].key = e.target.value; });
    div.querySelector('.ws-ev').addEventListener('input', (e) => { wsEnvRowsData[idx].value = e.target.value; });
    div.querySelector('.ws-eye').addEventListener('click', () => { wsEnvRowsData[idx].masked = !wsEnvRowsData[idx].masked; renderWsEnvRows(); });
    div.querySelector('.ws-del').addEventListener('click', () => { wsEnvRowsData.splice(idx, 1); renderWsEnvRows(); });
    el.appendChild(div);
  });
}

$('#ws-add-env-btn')?.addEventListener('click', () => {
  wsEnvRowsData.push({ key: '', value: '', masked: false });
  renderWsEnvRows();
});
$('#ws-add-dotenv-btn')?.addEventListener('click', () => {
  const box = $('#ws-dotenv-box');
  if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
});
$('#ws-dotenv-cancel-btn')?.addEventListener('click', () => { $('#ws-dotenv-box').style.display = 'none'; });
$('#ws-dotenv-apply-btn')?.addEventListener('click', () => {
  const raw = ($('#ws-dotenv-textarea')?.value || '').trim();
  for (const [k, v] of parseEnvText(raw)) wsEnvRowsData.push({ key: k, value: v, masked: true });
  wsEnvRowsData = wsEnvRowsData.filter((r) => r.key.trim() || r.value.trim());
  if (wsEnvRowsData.length === 0) wsEnvRowsData.push({ key: '', value: '', masked: true });
  $('#ws-dotenv-textarea').value = '';
  $('#ws-dotenv-box').style.display = 'none';
  renderWsEnvRows();
});

// Advanced accordion, Secret Files, Disk, Build Filters
$('#ws-advanced-toggle')?.addEventListener('click', () => {
  const body = $('#ws-advanced-body');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  $('#ws-advanced-chevron').textContent = open ? '⌄' : '›';
});

// Shared Secret File Modal (Static Site, Web Service & Private Service)
let sfModalTarget = 'ws'; // 'ws' | 'st'
let sfModalEditIdx = -1;

function openSecretFileModal(target = 'ws', editIdx = -1) {
  sfModalTarget = target;
  sfModalEditIdx = editIdx;
  const arr = target === 'st' ? stSecretFilesData : wsSecretFilesData;
  const existing = editIdx >= 0 ? arr[editIdx] : null;
  $('#sf-modal-filename').value = existing?.name || '';
  $('#sf-modal-contents').value = existing?.content || '';
  $('#paas-secret-file-modal-backdrop')?.classList.add('open');
  $('#sf-modal-filename')?.focus();
}

function closeSecretFileModal() {
  $('#paas-secret-file-modal-backdrop')?.classList.remove('open');
}

$('#sf-modal-close-btn')?.addEventListener('click', closeSecretFileModal);
$('#sf-modal-cancel-btn')?.addEventListener('click', closeSecretFileModal);
$('#paas-secret-file-modal-backdrop')?.addEventListener('click', (e) => {
  if (e.target === $('#paas-secret-file-modal-backdrop')) closeSecretFileModal();
});
$('#sf-modal-save-btn')?.addEventListener('click', () => {
  const name = ($('#sf-modal-filename')?.value || '').trim();
  const content = $('#sf-modal-contents')?.value || '';
  if (!name) return setStatus('Enter a filename (e.g. .env or file.txt)', 'error');
  const arr = sfModalTarget === 'st' ? stSecretFilesData : wsSecretFilesData;
  if (sfModalEditIdx >= 0) arr[sfModalEditIdx] = { name, content };
  else arr.push({ name, content });
  closeSecretFileModal();
  if (sfModalTarget === 'st') renderStSecretFiles();
  else renderWsSecretFiles();
});

function renderWsSecretFiles() {
  const el = $('#ws-secret-files-list');
  if (!el) return;
  el.innerHTML = '';
  wsSecretFilesData.forEach((sf, idx) => {
    const row = document.createElement('div');
    row.className = 'bp-service-preview';
    row.innerHTML = `
      <div>
        <div style="font-size:13px; font-weight:600; font-family:var(--mono);">${sf.name}</div>
        <div style="font-size:11.5px; color:var(--text-secondary);">/etc/secrets/${sf.name} · ${(sf.content || '').length} bytes</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button type="button" class="btn btn-secondary btn-sm ws-sf-edit">Edit</button>
        <button type="button" class="btn btn-danger-ghost btn-sm ws-sf-del">Remove</button>
      </div>
    `;
    row.querySelector('.ws-sf-edit').addEventListener('click', () => openSecretFileModal('ws', idx));
    row.querySelector('.ws-sf-del').addEventListener('click', () => { wsSecretFilesData.splice(idx, 1); renderWsSecretFiles(); });
    el.appendChild(row);
  });
}
$('#ws-add-secret-file-btn')?.addEventListener('click', () => openSecretFileModal('ws', -1));

// Disk attach / stepper / remove
$('#ws-add-disk-btn')?.addEventListener('click', () => {
  wsDiskAttached = true;
  wsDiskSizeGb = 10;
  if ($('#ws-disk-size-label')) $('#ws-disk-size-label').textContent = String(wsDiskSizeGb);
  if ($('#ws-disk-box')) $('#ws-disk-box').style.display = 'block';
  if ($('#ws-add-disk-btn')) $('#ws-add-disk-btn').style.display = 'none';
  $('#ws-disk-mount')?.focus();
});
$('#ws-disk-dec-btn')?.addEventListener('click', () => {
  wsDiskSizeGb = Math.max(1, wsDiskSizeGb - (wsDiskSizeGb > 10 ? 5 : 1));
  if ($('#ws-disk-size-label')) $('#ws-disk-size-label').textContent = String(wsDiskSizeGb);
});
$('#ws-disk-inc-btn')?.addEventListener('click', () => {
  wsDiskSizeGb = Math.min(500, wsDiskSizeGb + (wsDiskSizeGb >= 10 ? 5 : 1));
  if ($('#ws-disk-size-label')) $('#ws-disk-size-label').textContent = String(wsDiskSizeGb);
});
$('#ws-disk-remove-btn')?.addEventListener('click', () => {
  wsDiskAttached = false;
  if ($('#ws-disk-mount')) $('#ws-disk-mount').value = '';
  if ($('#ws-disk-box')) $('#ws-disk-box').style.display = 'none';
  if ($('#ws-add-disk-btn')) $('#ws-add-disk-btn').style.display = 'inline-flex';
});

function renderWsPathList(kind) {
  const arr = kind === 'included' ? wsIncludedPathsData : wsIgnoredPathsData;
  const el = $(kind === 'included' ? '#ws-included-paths-list' : '#ws-ignored-paths-list');
  if (!el) return;
  el.innerHTML = '';
  arr.forEach((val, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:6px;';
    row.innerHTML = `
      <input type="text" class="input" placeholder="e.g. src/**" value="${(val || '').replace(/"/g, '&quot;')}" style="flex:1; font-family:var(--mono); font-size:12px;" />
      <button type="button" class="btn btn-danger-ghost btn-sm">✕</button>
    `;
    row.querySelector('input').addEventListener('input', (e) => { arr[idx] = e.target.value; });
    row.querySelector('button').addEventListener('click', () => { arr.splice(idx, 1); renderWsPathList(kind); });
    el.appendChild(row);
  });
}
$('#ws-add-included-path-btn')?.addEventListener('click', () => { wsIncludedPathsData.push(''); renderWsPathList('included'); });
$('#ws-add-ignored-path-btn')?.addEventListener('click', () => { wsIgnoredPathsData.push(''); renderWsPathList('ignored'); });

// Deploy Web / Private / Background Worker / Cron Job submit
$('#ws-deploy-submit-btn')?.addEventListener('click', async () => {
  const btn = $('#ws-deploy-submit-btn');
  const name = (wsNameInput?.value || '').trim();
  const meta = WS_KIND_META[wsServiceKind] || WS_KIND_META.web;
  if (wsSourceMode === 'git' && !wsSelectedRepo) return setStatus('Select a Git repository first', 'error');
  if (wsSourceMode === 'image' && !wsSelectedImage) return setStatus('Enter a Docker Image URL first', 'error');
  if (!name) return setStatus(`Enter a ${meta.label} name`, 'error');

  const mountPath = ($('#ws-disk-mount')?.value || '').trim();
  if (wsDiskAttached && (!mountPath || mountPath === '/')) {
    return setStatus('Enter a valid absolute disk mount path (e.g. /var/data, cannot be /)', 'error');
  }

  btn.disabled = true;
  btn.textContent = meta.deploying;
  try {
    const res = await resellerFetch('/paas/web-services', {
      method: 'POST',
      body: JSON.stringify({
        name,
        serviceKind: wsServiceKind,
        schedule: wsServiceKind === 'cron' ? ($('#ws-cron-schedule-input')?.value || '0 * * * *').trim() : undefined,
        sourceMode: wsSourceMode,
        repo: wsSelectedRepo || '',
        imageUrl: wsSelectedImage || '',
        credentialId: wsSelectedCredId || null,
        projectId: wsProjectSelect?.value || selectedProjectId || '',
        region: wsSelectedRegion?.id || 'eu-north-1',
        serverId: wsSelectedRegion?.serverId || null,
        language: wsLanguageSelect?.value || 'Node',
        dockerfilePath: ($('#ws-dockerfile-input')?.value || './Dockerfile').trim(),
        branch: wsBranchSelect?.value || 'main',
        rootDirectory: ($('#ws-root-dir-input')?.value || '').trim(),
        buildCommand: ($('#ws-build-cmd-input')?.value || '').trim(),
        startCommand: ($('#ws-start-cmd-input')?.value || '').trim(),
        containerPort: parseInt(wsPortInput?.value || '3000', 10),
        plan: wsSelectedPlan.plan,
        env: wsEnvRowsData.filter((r) => r.key && r.key.trim()),
        secretFiles: wsSecretFilesData.filter((s) => s.name && s.name.trim()),
        disk: wsDiskAttached ? { mountPath, sizeGB: wsDiskSizeGb } : null,
        healthCheckPath: ($('#ws-healthcheck-input')?.value || '').trim(),
        preDeployCommand: ($('#ws-predeploy-input')?.value || '').trim(),
        autoDeploy: ($('#ws-autodeploy-select')?.value || 'on') === 'on',
        includedPaths: wsIncludedPathsData.filter(Boolean),
        ignoredPaths: wsIgnoredPathsData.filter(Boolean),
      }),
    });
    setStatus(`${meta.label} deploying: ${res.service?.url || name}`, 'connected');
    showPaasSubview('overview');
    await loadHostedApps();
    if (res.service?.requiresLock) {
      openPrivateLockModal(res.service);
    }
  } catch (e) {
    setStatus(`Deploy failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = meta.btn;
  }
});

// ============================================================================
// --- PRIVATE SERVICE PASSWORD LOCK & UNLOCK MODALS ---
// ============================================================================
const unlockedPrivateServiceIds = new Set();
let pendingLockService = null;
let pendingUnlockService = null;

function bindEyeToggle(btnId, inputId) {
  const btn = $(btnId);
  const inp = $(inputId);
  if (!btn || !inp) return;
  btn.innerHTML = EYE_ICON_SVG;
  btn.addEventListener('click', () => {
    const isPwd = inp.type === 'password';
    inp.type = isPwd ? 'text' : 'password';
    btn.innerHTML = isPwd ? EYE_OFF_ICON_SVG : EYE_ICON_SVG;
  });
}
bindEyeToggle('#priv-lock-eye-1', '#priv-lock-password');
bindEyeToggle('#priv-lock-eye-2', '#priv-lock-confirm');
bindEyeToggle('#priv-unlock-eye', '#priv-unlock-password');

function openPrivateLockModal(svc) {
  pendingLockService = svc;
  $('#priv-lock-svc-name').textContent = svc?.name || 'Private Service';
  $('#priv-lock-username').value = 'admin';
  $('#priv-lock-password').value = '';
  $('#priv-lock-confirm').value = '';
  $('#priv-lock-password').type = 'password';
  $('#priv-lock-confirm').type = 'password';
  $('#priv-lock-eye-1').innerHTML = EYE_ICON_SVG;
  $('#priv-lock-eye-2').innerHTML = EYE_ICON_SVG;
  $('#priv-lock-error').style.display = 'none';
  $('#paas-private-lock-modal-backdrop')?.classList.add('open');
  $('#priv-lock-password')?.focus();
}

function closePrivateLockModal() {
  pendingLockService = null;
  $('#paas-private-lock-modal-backdrop')?.classList.remove('open');
}

$('#priv-lock-skip-btn')?.addEventListener('click', closePrivateLockModal);
$('#priv-lock-save-btn')?.addEventListener('click', async () => {
  if (!pendingLockService) return;
  const errEl = $('#priv-lock-error');
  const username = ($('#priv-lock-username')?.value || 'admin').trim() || 'admin';
  const password = $('#priv-lock-password')?.value || '';
  const confirm = $('#priv-lock-confirm')?.value || '';
  if (password.length < 4) {
    errEl.textContent = 'Password must be at least 4 characters.';
    errEl.style.display = 'block';
    return;
  }
  if (password !== confirm) {
    errEl.textContent = 'Passwords do not match.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  const btn = $('#priv-lock-save-btn');
  btn.disabled = true;
  btn.textContent = 'Locking...';
  try {
    await resellerFetch(`/paas/services/private/${encodeURIComponent(pendingLockService.id)}/lock`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const svcName = pendingLockService.name;
    closePrivateLockModal();
    setStatus(`Private service "${svcName}" is now password-locked & encrypted`, 'connected');
    await loadHostedApps();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lock & Protect Service';
  }
});

function openPrivateUnlockModal(svc) {
  pendingUnlockService = svc;
  $('#priv-unlock-svc-name').textContent = svc?.name || 'Private Service';
  $('#priv-unlock-password').value = '';
  $('#priv-unlock-password').type = 'password';
  $('#priv-unlock-eye').innerHTML = EYE_ICON_SVG;
  $('#priv-unlock-error').style.display = 'none';
  $('#paas-private-unlock-modal-backdrop')?.classList.add('open');
  $('#priv-unlock-password')?.focus();
}

function closePrivateUnlockModal() {
  pendingUnlockService = null;
  $('#paas-private-unlock-modal-backdrop')?.classList.remove('open');
}

$('#priv-unlock-close-btn')?.addEventListener('click', closePrivateUnlockModal);
$('#priv-unlock-cancel-btn')?.addEventListener('click', closePrivateUnlockModal);
$('#paas-private-unlock-modal-backdrop')?.addEventListener('click', (e) => {
  if (e.target === $('#paas-private-unlock-modal-backdrop')) closePrivateUnlockModal();
});

async function submitPrivateUnlock() {
  if (!pendingUnlockService) return;
  const errEl = $('#priv-unlock-error');
  const password = $('#priv-unlock-password')?.value || '';
  if (!password) {
    errEl.textContent = 'Enter the password to unlock.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  const btn = $('#priv-unlock-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Verifying...';
  try {
    await resellerFetch(`/paas/services/private/${encodeURIComponent(pendingUnlockService.id)}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    const target = pendingUnlockService;
    unlockedPrivateServiceIds.add(target.id);
    closePrivateUnlockModal();
    openServiceDetail(target.kind || 'web', target.id);
  } catch (e) {
    errEl.textContent = e.message || 'Incorrect password.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock Service';
  }
}

$('#priv-unlock-submit-btn')?.addEventListener('click', submitPrivateUnlock);
$('#priv-unlock-password')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPrivateUnlock();
});

// ============================================================================
// --- NEW POSTGRES FLOW (Matching Render 5-Screenshot Flow) ---
// ============================================================================
const PG_COMPUTE_PLANS = [
  { id: 'free', price: 0, cpuNum: 0.1, cpu: '0.1 CPU', ram: '256 MB RAM', code: 'Free' },
  { id: 'basic-256mb', price: 6, cpuNum: 0.1, cpu: '0.1 CPU', ram: '256 MB RAM', code: '0.1c-256mb' },
  { id: 'basic-1gb', price: 19, cpuNum: 0.5, cpu: '0.5 CPU', ram: '1 GB RAM', code: '0.5c-1g' },
  { id: 'basic-2gb', price: 40, cpuNum: 1, cpu: '1 CPU', ram: '2 GB RAM', code: '1c-2g' },
  { id: 'basic-4gb', price: 75, cpuNum: 1, cpu: '1 CPU', ram: '4 GB RAM', code: '1c-4g' },
  { id: 'pro-4gb', price: 100, cpuNum: 2, cpu: '2 CPU', ram: '4 GB RAM', code: '2c-4g' },
  { id: 'pro-8gb', price: 200, cpuNum: 2, cpu: '2 CPU', ram: '8 GB RAM', code: '2c-8g' },
  { id: 'pro-16gb', price: 400, cpuNum: 4, cpu: '4 CPU', ram: '16 GB RAM', code: '4c-16g' },
];

let pgSelectedRegion = 'eu-north-1';
let pgAvailableRegions = [];
let pgSelectedComputeId = 'basic-256mb';
let pgShowAllCompute = false;
let pgStorageGb = 15;

function formatUsd(val) {
  return Number.isInteger(val) ? `$${val}` : `$${val.toFixed(2)}`;
}

function renderPgRegions() {
  const listEl = $('#pg-region-cards-list');
  const optsEl = $('#pg-new-region-options');
  if (!listEl) return;

  const activeRegs = pgAvailableRegions.filter((r) => r.serviceCount > 0 || r.id === pgSelectedRegion);
  const shown = activeRegs.length > 0 ? activeRegs : [{ id: 'eu-north-1', label: 'Stockholm (EU North)', serviceCount: 0 }];

  listEl.innerHTML = '';
  shown.forEach((r) => {
    const selected = r.id === pgSelectedRegion;
    const cnt = r.existingCount ?? r.serviceCount ?? 0;
    const card = document.createElement('label');
    card.style.cssText = `display:flex; align-items:center; justify-content:space-between; padding:11px 14px; border-radius:8px; cursor:pointer; background:#ffffff; border:${selected ? '1.5px solid #0f172a' : '1px solid var(--border)'};`;
    card.innerHTML = `
      <span style="display:flex; align-items:center; gap:10px; font-size:13px; font-weight:${selected ? '600' : '500'};">
        <input type="radio" name="pg-region-radio" value="${r.id}" ${selected ? 'checked' : ''} style="accent-color:#0f172a;" />
        <span>${r.label}</span>
      </span>
      <span style="font-size:12px; color:var(--text-muted);">${cnt} existing service${cnt === 1 ? '' : 's'}</span>
    `;
    card.querySelector('input')?.addEventListener('change', () => {
      pgSelectedRegion = r.id;
      renderPgRegions();
    });
    listEl.appendChild(card);
  });

  if (optsEl) {
    optsEl.innerHTML = '';
    pgAvailableRegions.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = r.id === pgSelectedRegion ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
      btn.textContent = r.label;
      btn.addEventListener('click', () => {
        pgSelectedRegion = r.id;
        $('#pg-new-region-picker').style.display = 'none';
        renderPgRegions();
      });
      optsEl.appendChild(btn);
    });
  }
}

$('#pg-new-region-btn')?.addEventListener('click', () => {
  const picker = $('#pg-new-region-picker');
  if (picker) picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
});

function renderPgComputeAndSummary() {
  const listEl = $('#pg-compute-list');
  const plan = PG_COMPUTE_PLANS.find((p) => p.id === pgSelectedComputeId) || PG_COMPUTE_PLANS[1];
  const visiblePlans = pgShowAllCompute ? PG_COMPUTE_PLANS : PG_COMPUTE_PLANS.slice(0, 4);

  if (listEl) {
    listEl.innerHTML = '';
    visiblePlans.forEach((p) => {
      const selected = p.id === pgSelectedComputeId;
      const row = document.createElement('label');
      row.style.cssText = `display:grid; grid-template-columns:20px 100px 90px 1fr 95px; align-items:center; gap:8px; padding:10px 12px; border-radius:6px; cursor:pointer; font-size:13px; background:${selected ? '#f8fafc' : '#ffffff'}; border:${selected ? '1.5px solid #0f172a' : '1px solid #f1f5f9'};`;
      row.innerHTML = `
        <input type="radio" name="pg-compute-radio" value="${p.id}" ${selected ? 'checked' : ''} style="accent-color:#0f172a;" />
        <strong>${formatUsd(p.price)} / month</strong>
        <span>${p.cpu}</span>
        <span>${p.ram}</span>
        <span style="text-align:right; color:var(--text-muted); font-family:var(--mono); font-size:12px;">${p.code}</span>
      `;
      row.querySelector('input')?.addEventListener('change', () => {
        pgSelectedComputeId = p.id;
        renderPgComputeAndSummary();
      });
      listEl.appendChild(row);
    });
  }

  const toggleBtn = $('#pg-toggle-all-compute-btn');
  if (toggleBtn) {
    toggleBtn.textContent = pgShowAllCompute ? 'Show fewer compute plans' : `Show all ${PG_COMPUTE_PLANS.length} compute plans`;
  }

  const haToggle = $('#pg-ha-toggle');
  const haLabel = $('#pg-ha-label');
  const haNotice = $('#pg-ha-notice');
  if (haToggle && haLabel && haNotice) {
    const canHa = plan.cpuNum >= 1;
    haToggle.disabled = !canHa;
    if (!canHa) {
      haToggle.checked = false;
      haLabel.textContent = 'Disabled';
      haNotice.style.display = 'block';
    } else {
      haNotice.style.display = 'none';
    }
  }

  const storagePrice = pgStorageGb * 0.3;
  const totalPrice = plan.price + storagePrice;

  $('#pg-selected-compute-text').innerHTML = `${formatUsd(plan.price)} / month &nbsp;&nbsp; ${plan.cpu} &nbsp;&nbsp; ${plan.ram}`;
  $('#pg-storage-val-label').textContent = `${pgStorageGb} GB`;
  $('#pg-storage-price-label').textContent = `${formatUsd(storagePrice)} / month`;
  $('#pg-summary-compute-name').textContent = plan.code;
  $('#pg-summary-compute-price').textContent = `${formatUsd(plan.price)} / month`;
  $('#pg-summary-storage-gb').textContent = `${pgStorageGb} GB`;
  $('#pg-summary-storage-price').textContent = `${formatUsd(storagePrice)} / month`;
  $('#pg-summary-total-price').textContent = `${formatUsd(totalPrice)} / month`;
  $('#pg-sticky-plan-summary').innerHTML = `<strong style="color:var(--text-primary);">${formatUsd(totalPrice)}</strong> / month &nbsp;&nbsp; ${plan.cpu} &nbsp;&nbsp; ${plan.ram} &nbsp;&nbsp; ${pgStorageGb} GB Storage`;
}

$('#pg-toggle-all-compute-btn')?.addEventListener('click', () => {
  pgShowAllCompute = !pgShowAllCompute;
  renderPgComputeAndSummary();
});

$('#pg-storage-dec-btn')?.addEventListener('click', () => {
  if (pgStorageGb > 5) pgStorageGb -= 5;
  else pgStorageGb = 1;
  renderPgComputeAndSummary();
});

$('#pg-storage-inc-btn')?.addEventListener('click', () => {
  if (pgStorageGb === 1) pgStorageGb = 5;
  else pgStorageGb += 5;
  renderPgComputeAndSummary();
});

$('#pg-autoscaling-toggle')?.addEventListener('change', (e) => {
  const lbl = $('#pg-autoscaling-label');
  if (lbl) lbl.textContent = e.target.checked ? 'Enabled' : 'Disabled';
});

$('#pg-ha-toggle')?.addEventListener('change', (e) => {
  const lbl = $('#pg-ha-label');
  if (lbl) lbl.textContent = e.target.checked ? 'Enabled' : 'Disabled';
});

$('#pg-project-select')?.addEventListener('change', (e) => {
  const envSelect = $('#pg-env-select');
  if (!envSelect) return;
  const projId = e.target.value;
  if (!projId) {
    envSelect.innerHTML = '<option value="">Select an environment..</option>';
    envSelect.disabled = true;
    return;
  }
  const proj = paasProjects.find((p) => p.id === projId);
  const envs = proj?.environments || [{ environmentId: 'default', name: 'production' }];
  envSelect.innerHTML = envs.map((ev) => `<option value="${ev.environmentId}">${ev.name || 'production'}</option>`).join('');
  envSelect.disabled = false;
});

async function openNewPostgresView() {
  showPaasSubview('postgres-new');
  $('#pg-name-input').value = '';
  $('#pg-dbname-input').value = '';
  $('#pg-dbuser-input').value = '';
  $('#pg-datadog-key-input').value = '';
  $('#pg-version-select').value = '18';
  $('#pg-datadog-region-select').value = 'US1';
  pgSelectedComputeId = 'basic-256mb';
  pgShowAllCompute = false;
  pgStorageGb = 15;
  if ($('#pg-autoscaling-toggle')) {
    $('#pg-autoscaling-toggle').checked = false;
    $('#pg-autoscaling-label').textContent = 'Disabled';
  }

  const projSel = $('#pg-project-select');
  const envSel = $('#pg-env-select');
  if (projSel && envSel) {
    projSel.innerHTML = '<option value="">Select a project..</option>' +
      paasProjects.map((p) => `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`).join('');
    if (selectedProjectId) {
      projSel.dispatchEvent(new Event('change'));
    } else {
      envSel.innerHTML = '<option value="">Select an environment..</option>';
      envSel.disabled = true;
    }
  }

  try {
    const rData = await resellerFetch('/paas/regions');
    pgAvailableRegions = rData.regions || [];
    if (pgAvailableRegions.length > 0 && !pgAvailableRegions.some((r) => r.id === pgSelectedRegion)) {
      pgSelectedRegion = pgAvailableRegions[0].id;
    }
  } catch {
    pgAvailableRegions = [{ id: 'eu-north-1', label: 'Stockholm (EU North)', serviceCount: 0 }];
  }

  renderPgRegions();
  renderPgComputeAndSummary();
  $('#pg-name-input')?.focus();
}

$('#pg-back-btn')?.addEventListener('click', () => showPaasSubview('overview'));
$('#pg-cancel-btn')?.addEventListener('click', () => showPaasSubview('overview'));

$('#pg-create-submit-btn')?.addEventListener('click', async () => {
  const name = ($('#pg-name-input')?.value || '').trim();
  if (!name) {
    setStatus('Please enter a name for your Postgres instance', 'error');
    $('#pg-name-input')?.focus();
    return;
  }
  const btn = $('#pg-create-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Creating database...';
  try {
    await resellerFetch('/paas/postgres', {
      method: 'POST',
      body: JSON.stringify({
        name,
        projectId: $('#pg-project-select')?.value || selectedProjectId || undefined,
        environmentId: $('#pg-env-select')?.value || undefined,
        databaseName: ($('#pg-dbname-input')?.value || '').trim() || undefined,
        databaseUser: ($('#pg-dbuser-input')?.value || '').trim() || undefined,
        region: pgSelectedRegion,
        version: $('#pg-version-select')?.value || '18',
        computePlan: pgSelectedComputeId,
        storageGb: pgStorageGb,
        storageAutoscaling: Boolean($('#pg-autoscaling-toggle')?.checked),
        highAvailability: Boolean($('#pg-ha-toggle')?.checked),
        datadogApiKey: ($('#pg-datadog-key-input')?.value || '').trim() || undefined,
        datadogRegion: $('#pg-datadog-region-select')?.value || 'US1',
      }),
    });
    setStatus(`Provisioned PostgreSQL database: ${name}`, 'connected');
    showPaasSubview('overview');
    await loadHostedApps();
  } catch (e) {
    setStatus(`Create Postgres failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create database';
  }
});

// ============================================================================
// --- NEW KEY VALUE (REDIS) FLOW ---
// ============================================================================
const KV_COMPUTE_PLANS = [
  { id: 'free', price: 0, ram: '25 MB RAM', conns: '50 Connections', code: 'Free', badge: 'No persistence' },
  { id: '256mb', price: 10, ram: '256 MB RAM', conns: '250 Connections', code: '256mb' },
  { id: '1g', price: 20, ram: '1 GB RAM', conns: '1,000 Connections', code: '1g' },
  { id: '3g', price: 60, ram: '3 GB RAM', conns: '3,000 Connections', code: '3g' },
  { id: '5g', price: 100, ram: '5 GB RAM', conns: '5,000 Connections', code: '5g' },
  { id: '10g', price: 200, ram: '10 GB RAM', conns: '10,000 Connections', code: '10g' },
  { id: '20g', price: 350, ram: '20 GB RAM', conns: '20,000 Connections', code: '20g' },
  { id: '40g', price: 600, ram: '40 GB RAM', conns: '40,000 Connections', code: '40g' },
  { id: '50g', price: 750, ram: '50 GB RAM', conns: '50,000 Connections', code: '50g' },
];

let kvSelectedRegion = 'eu-north-1';
let kvAvailableRegions = [];
let kvSelectedComputeId = '256mb';
let kvShowAllCompute = false;

function renderKvRegions() {
  const listEl = $('#kv-region-cards-list');
  const optsEl = $('#kv-new-region-options');
  if (!listEl) return;

  const activeRegs = kvAvailableRegions.filter((r) => (r.existingCount ?? r.serviceCount ?? 0) > 0 || r.id === kvSelectedRegion);
  const shown = activeRegs.length > 0 ? activeRegs : [{ id: 'eu-north-1', label: 'Stockholm (EU North)', existingCount: 0 }];

  listEl.innerHTML = '';
  shown.forEach((r) => {
    const selected = r.id === kvSelectedRegion;
    const cnt = r.existingCount ?? r.serviceCount ?? 0;
    const card = document.createElement('label');
    card.style.cssText = `display:flex; align-items:center; justify-content:space-between; padding:11px 14px; border-radius:8px; cursor:pointer; background:#ffffff; border:${selected ? '1.5px solid #0f172a' : '1px solid var(--border)'};`;
    card.innerHTML = `
      <span style="display:flex; align-items:center; gap:10px; font-size:13px; font-weight:${selected ? '600' : '500'};">
        <input type="radio" name="kv-region-radio" value="${r.id}" ${selected ? 'checked' : ''} style="accent-color:#0f172a;" />
        <span>${r.label}</span>
      </span>
      <span style="font-size:12px; color:var(--text-muted);">${cnt} existing service${cnt === 1 ? '' : 's'}</span>
    `;
    card.querySelector('input')?.addEventListener('change', () => {
      kvSelectedRegion = r.id;
      renderKvRegions();
    });
    listEl.appendChild(card);
  });

  if (optsEl) {
    optsEl.innerHTML = '';
    kvAvailableRegions.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = r.id === kvSelectedRegion ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
      btn.textContent = r.label;
      btn.addEventListener('click', () => {
        kvSelectedRegion = r.id;
        $('#kv-new-region-picker').style.display = 'none';
        renderKvRegions();
      });
      optsEl.appendChild(btn);
    });
  }
}

$('#kv-new-region-btn')?.addEventListener('click', () => {
  const picker = $('#kv-new-region-picker');
  if (picker) picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
});

function renderKvComputeAndSummary() {
  const listEl = $('#kv-compute-list');
  const plan = KV_COMPUTE_PLANS.find((p) => p.id === kvSelectedComputeId) || KV_COMPUTE_PLANS[1];
  const visiblePlans = kvShowAllCompute ? KV_COMPUTE_PLANS : KV_COMPUTE_PLANS.slice(0, 3);

  if (listEl) {
    listEl.innerHTML = '';
    visiblePlans.forEach((p) => {
      const selected = p.id === kvSelectedComputeId;
      const row = document.createElement('label');
      row.style.cssText = `display:grid; grid-template-columns:20px 100px 110px 1fr 140px; align-items:center; gap:8px; padding:10px 12px; border-radius:6px; cursor:pointer; font-size:13px; background:${selected ? '#f8fafc' : '#ffffff'}; border:${selected ? '1.5px solid #0f172a' : '1px solid #f1f5f9'};`;
      row.innerHTML = `
        <input type="radio" name="kv-compute-radio" value="${p.id}" ${selected ? 'checked' : ''} style="accent-color:#0f172a;" />
        <strong>${formatUsd(p.price)} / month</strong>
        <span>${p.ram}</span>
        <span>${p.conns}</span>
        <span style="text-align:right; color:var(--text-muted); font-family:var(--mono); font-size:12px;">${p.code}${p.badge ? ` <span class="badge badge-neutral" style="font-size:10px; margin-left:4px;">${p.badge}</span>` : ''}</span>
      `;
      row.querySelector('input')?.addEventListener('change', () => {
        kvSelectedComputeId = p.id;
        renderKvComputeAndSummary();
      });
      listEl.appendChild(row);
    });
  }

  const toggleBtn = $('#kv-toggle-all-compute-btn');
  if (toggleBtn) {
    toggleBtn.textContent = kvShowAllCompute ? 'Show less' : `Show all ${KV_COMPUTE_PLANS.length} compute plans`;
  }

  const persSel = $('#kv-persistence-select');
  if (persSel) {
    if (plan.id === 'free') {
      persSel.value = 'off';
      persSel.disabled = true;
    } else {
      if (persSel.disabled) persSel.value = 'journal-snapshot';
      persSel.disabled = false;
    }
  }

  $('#kv-selected-compute-text').innerHTML = `${formatUsd(plan.price)} / month &nbsp;&nbsp; ${plan.ram} &nbsp;&nbsp; ${plan.conns}`;
  $('#kv-sticky-plan-summary').innerHTML = `<strong style="color:var(--text-primary);">${formatUsd(plan.price)}</strong> / month &nbsp;&nbsp; ${plan.ram} &nbsp;&nbsp; ${plan.conns}`;
}

$('#kv-toggle-all-compute-btn')?.addEventListener('click', () => {
  kvShowAllCompute = !kvShowAllCompute;
  renderKvComputeAndSummary();
});

$('#kv-project-select')?.addEventListener('change', (e) => {
  const envSelect = $('#kv-env-select');
  if (!envSelect) return;
  const projId = e.target.value;
  if (!projId) {
    envSelect.innerHTML = '<option value="">Select an environment..</option>';
    envSelect.disabled = true;
    return;
  }
  const proj = paasProjects.find((p) => p.id === projId);
  const envs = proj?.environments || [{ environmentId: 'default', name: 'production' }];
  envSelect.innerHTML = envs.map((ev) => `<option value="${ev.environmentId}">${ev.name || 'production'}</option>`).join('');
  envSelect.disabled = false;
});

async function openNewKeyValueView() {
  showPaasSubview('kv-new');
  $('#kv-name-input').value = '';
  $('#kv-maxmemory-select').value = 'allkeys-lru';
  $('#kv-persistence-select').value = 'journal-snapshot';
  $('#kv-persistence-select').disabled = false;
  kvSelectedComputeId = '256mb';
  kvShowAllCompute = false;

  const projSel = $('#kv-project-select');
  const envSel = $('#kv-env-select');
  if (projSel && envSel) {
    projSel.innerHTML = '<option value="">Select a project..</option>' +
      paasProjects.map((p) => `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`).join('');
    if (selectedProjectId) {
      projSel.dispatchEvent(new Event('change'));
    } else {
      envSel.innerHTML = '<option value="">Select an environment..</option>';
      envSel.disabled = true;
    }
  }

  try {
    const rData = await resellerFetch('/paas/regions');
    kvAvailableRegions = rData.regions || [];
    if (kvAvailableRegions.length > 0 && !kvAvailableRegions.some((r) => r.id === kvSelectedRegion)) {
      kvSelectedRegion = kvAvailableRegions[0].id;
    }
  } catch {
    kvAvailableRegions = [{ id: 'eu-north-1', label: 'Stockholm (EU North)', existingCount: 0 }];
  }

  renderKvRegions();
  renderKvComputeAndSummary();
  $('#kv-name-input')?.focus();
}

$('#kv-back-btn')?.addEventListener('click', () => showPaasSubview('overview'));
$('#kv-cancel-btn')?.addEventListener('click', () => showPaasSubview('overview'));

$('#kv-create-submit-btn')?.addEventListener('click', async () => {
  const name = ($('#kv-name-input')?.value || '').trim();
  if (!name) {
    setStatus('Please enter a name for your Key Value instance', 'error');
    $('#kv-name-input')?.focus();
    return;
  }
  const btn = $('#kv-create-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Creating Key Value...';
  try {
    await resellerFetch('/paas/redis', {
      method: 'POST',
      body: JSON.stringify({
        name,
        projectId: $('#kv-project-select')?.value || selectedProjectId || undefined,
        environmentId: $('#kv-env-select')?.value || undefined,
        region: kvSelectedRegion,
        maxmemoryPolicy: $('#kv-maxmemory-select')?.value || 'allkeys-lru',
        persistenceMode: $('#kv-persistence-select')?.value || 'journal-snapshot',
        computePlan: kvSelectedComputeId,
      }),
    });
    setStatus(`Provisioned Key Value (Redis) instance: ${name}`, 'connected');
    showPaasSubview('overview');
    await loadHostedApps();
  } catch (e) {
    setStatus(`Create Key Value failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Key Value';
  }
});

// ============================================================================
// --- GROUP MAIL (1. Dedicated Group Addresses + 2. Personal Contact Groups) ---
// ============================================================================
var mailGroupsList = [];
let editingGroupId = null;
let editingGroupMembers = [];
let pendingConvertMailbox = null;

async function loadMailGroupsFromServer() {
  try {
    const data = await resellerFetch('/mail/groups');
    mailGroupsList = Array.isArray(data.groups) ? data.groups : [];
  } catch {
    mailGroupsList = [];
  }
  renderMailGroupsTable();
  if (typeof renderEmailTable === 'function') renderEmailTable();
}

function renderMailGroupsTable() {
  const tbody = $('#mail-groups-tbody');
  const countLbl = $('#mail-groups-count-label');
  if (!tbody) return;
  const domFilter = selectedMailDomain || emailDomainFilter?.value || 'all';
  const filtered = mailGroupsList.filter((g) => domFilter === 'all' || g.domain === domFilter);
  if (countLbl) countLbl.textContent = `${filtered.length} group(s)`;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7"><div class="empty-box">
        <h3>No group addresses yet</h3>
        <p>Create a shared address like <code>team@iecloudbase.com</code> or <code>sales@yourdomain.com</code>.</p>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach((g) => {
    const tr = document.createElement('tr');
    const permLabel = g.postPermission === 'members' ? 'Members Only' : g.postPermission === 'admins' ? 'Admins Only' : 'Anyone';
    const deliveryLabel = g.deliveryMode === 'all_and_inbox' ? 'All Members + Inbox' : 'All Members';
    const replyLabel = g.replyMode === 'sender' ? 'Reply to Sender' : 'Reply to Group';
    tr.innerHTML = `
      <td><span class="mono-id" style="font-weight:600;">${g.address}</span></td>
      <td>${g.name || '—'}</td>
      <td><span class="badge badge-neutral" title="${(g.members || []).join(', ')}">${(g.members || []).length} member(s)</span></td>
      <td><span class="badge badge-running">${deliveryLabel}</span></td>
      <td><span class="badge badge-neutral">${replyLabel}</span></td>
      <td><span class="badge badge-neutral">${permLabel}</span></td>
      <td style="text-align:right;"></td>
    `;
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.style.cssText = 'display:inline-flex; gap:4px; align-items:center;';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary btn-sm';
    editBtn.textContent = 'Edit Members';
    editBtn.addEventListener('click', () => openMailGroupModal(g));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger-ghost btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      try {
        await resellerFetch(`/mail/groups/${encodeURIComponent(g.id)}`, { method: 'DELETE' });
        await loadMailGroupsFromServer();
        setStatus(`Deleted group address: ${g.address}`, 'connected');
      } catch (e) {
        setStatus(`Delete group failed: ${e.message}`, 'error');
      }
    });

    actions.append(editBtn, delBtn);
    tr.lastElementChild.appendChild(actions);
    tbody.appendChild(tr);
  });
}

function renderEditingGroupMembers() {
  const listEl = $('#mail-group-members-list');
  if (!listEl) return;
  if (editingGroupMembers.length === 0) {
    listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">No members yet. Add member emails above.</div>';
    return;
  }
  listEl.innerHTML = '';
  editingGroupMembers.forEach((m) => {
    const pill = document.createElement('div');
    pill.style.cssText = 'display:inline-flex; align-items:center; gap:6px; background:#f1f5f9; border:1px solid var(--border); border-radius:999px; padding:4px 10px; font-size:12px; font-family:var(--mono);';
    pill.innerHTML = `<span>${m}</span><button type="button" style="border:none;background:none;cursor:pointer;font-weight:700;color:var(--text-secondary);">✕</button>`;
    pill.querySelector('button')?.addEventListener('click', () => {
      editingGroupMembers = editingGroupMembers.filter((x) => x !== m);
      renderEditingGroupMembers();
    });
    listEl.appendChild(pill);
  });
}

function openMailGroupModal(grp = null, mailbox = null) {
  editingGroupId = grp ? grp.id : null;
  pendingConvertMailbox = (!grp && mailbox) ? mailbox : null;
  editingGroupMembers = grp ? [...(grp.members || [])] : [];
  const modal = $('#mail-group-modal-backdrop');
  if (!modal) return;
  if (grp) {
    $('#mail-group-modal-title').textContent = `Edit Group Mail: ${grp.address}`;
  } else if (mailbox) {
    $('#mail-group-modal-title').textContent = `Make Group Mail: ${mailbox.address}`;
  } else {
    $('#mail-group-modal-title').textContent = 'Create Group Address';
  }
  $('#mail-group-addr-row').style.display = (grp || mailbox) ? 'none' : 'block';
  const domSel = $('#mail-group-domain-select');
  const domains = [...new Set(['iecloudbase.com', ...mailDomains.map((d) => d.domain || d.name)])];
  if (domSel) {
    domSel.innerHTML = domains.map((d) => `<option value="${d}" ${(selectedMailDomain || 'iecloudbase.com') === d ? 'selected' : ''}>${d}</option>`).join('');
  }
  $('#mail-group-user-input').value = '';
  $('#mail-group-name-input').value = grp ? (grp.name || '') : (mailbox ? (mailbox.displayName || mailbox.address.split('@')[0]) : '');
  const delivSel = $('#mail-group-delivery-select');
  if (delivSel) delivSel.value = grp ? (grp.deliveryMode || 'all_members') : (mailbox ? 'all_and_inbox' : 'all_members');
  $('#mail-group-reply-select').value = grp ? (grp.replyMode || 'group') : 'group';
  $('#mail-group-perm-select').value = grp ? (grp.postPermission || 'anyone') : 'anyone';
  $('#mail-group-member-input').value = '';
  renderEditingGroupMembers();
  modal.classList.add('open');
}

function openMailGroupModalForMailbox(mailbox) {
  if (!mailbox?.address) return;
  const existing = mailGroupsList.find((g) => g.address.toLowerCase() === mailbox.address.toLowerCase());
  if (existing) {
    openMailGroupModal(existing);
  } else {
    openMailGroupModal(null, mailbox);
  }
}

function closeMailGroupModal() {
  pendingConvertMailbox = null;
  $('#mail-group-modal-backdrop')?.classList.remove('open');
}

$('#mail-group-modal-close')?.addEventListener('click', closeMailGroupModal);
$('#mail-group-modal-cancel')?.addEventListener('click', closeMailGroupModal);
$('#mail-group-add-member-btn')?.addEventListener('click', () => {
  const inp = $('#mail-group-member-input');
  const val = (inp?.value || '').trim().toLowerCase();
  if (!val || !val.includes('@')) return setStatus('Enter a valid member email address', 'error');
  if (!editingGroupMembers.includes(val)) {
    editingGroupMembers.push(val);
    inp.value = '';
    renderEditingGroupMembers();
  }
});
$('#mail-group-modal-submit')?.addEventListener('click', async () => {
  const btn = $('#mail-group-modal-submit');
  const name = ($('#mail-group-name-input')?.value || '').trim();
  const deliveryMode = $('#mail-group-delivery-select')?.value || 'all_members';
  const replyMode = $('#mail-group-reply-select')?.value || 'group';
  const postPermission = $('#mail-group-perm-select')?.value || 'anyone';
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    if (editingGroupId) {
      await resellerFetch(`/mail/groups/${encodeURIComponent(editingGroupId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name, members: editingGroupMembers, deliveryMode, replyMode, postPermission }),
      });
      setStatus('Group Mail updated', 'connected');
    } else if (pendingConvertMailbox) {
      const [u, d] = pendingConvertMailbox.address.split('@');
      await resellerFetch('/mail/groups', {
        method: 'POST',
        body: JSON.stringify({
          username: u,
          domain: d || pendingConvertMailbox.domain || 'iecloudbase.com',
          name: name || u,
          members: editingGroupMembers,
          deliveryMode,
          replyMode,
          postPermission,
          convertExisting: true,
        }),
      });
      setStatus(`Configured ${pendingConvertMailbox.address} as Group Mail`, 'connected');
    } else {
      const username = ($('#mail-group-user-input')?.value || '').trim().toLowerCase();
      const domain = $('#mail-group-domain-select')?.value || 'iecloudbase.com';
      if (!username) {
        btn.disabled = false;
        btn.textContent = 'Save Group';
        return setStatus('Enter a group username (e.g. team)', 'error');
      }
      await resellerFetch('/mail/groups', {
        method: 'POST',
        body: JSON.stringify({ username, domain, name: name || username, members: editingGroupMembers, deliveryMode, replyMode, postPermission }),
      });
      setStatus(`Created group address: ${username}@${domain}`, 'connected');
    }
    closeMailGroupModal();
    await loadMailGroupsFromServer();
  } catch (e) {
    setStatus(`Save group failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Group';
  }
});

// 2. Personal Contact Groups in Webmail Inbox
let wmContactGroups = [];
let wmSharedGroups = [];

async function loadWmContactGroups() {
  if (!wmSession?.email) return;
  try {
    const data = await resellerFetch(`/webmail/contact-groups?email=${encodeURIComponent(wmSession.email)}`);
    wmContactGroups = Array.isArray(data.contactGroups) ? data.contactGroups : [];
    wmSharedGroups = Array.isArray(data.sharedGroups) ? data.sharedGroups : [];
  } catch {
    wmContactGroups = [];
    wmSharedGroups = [];
  }
  renderWmContactGroupsList();
  renderWmComposeGroupDropdown();
}

function renderWmComposeGroupDropdown() {
  const sel = $('#wm-compose-group-select');
  if (!sel) return;
  let html = '<option value="">+ Insert Group...</option>';
  if (wmContactGroups.length > 0) {
    html += '<optgroup label="My Contact Groups">';
    wmContactGroups.forEach((cg) => {
      html += `<option value="cg:${cg.id}">👥 ${cg.name} (${(cg.members || []).length})</option>`;
    });
    html += '</optgroup>';
  }
  if (wmSharedGroups.length > 0) {
    html += '<optgroup label="Shared Group Addresses">';
    wmSharedGroups.forEach((sg) => {
      html += `<option value="sg:${sg.address}">📨 ${sg.name} (${sg.address})</option>`;
    });
    html += '</optgroup>';
  }
  sel.innerHTML = html;
}

$('#wm-compose-group-select')?.addEventListener('change', (e) => {
  const val = e.target.value;
  if (!val) return;
  let toAdd = [];
  if (val.startsWith('cg:')) {
    const cg = wmContactGroups.find((c) => c.id === val.slice(3));
    if (cg) toAdd = cg.members || [];
  } else if (val.startsWith('sg:')) {
    toAdd = [val.slice(3)];
  }
  if (toAdd.length > 0 && wmComposeTo) {
    const existing = wmComposeTo.value.split(',').map((s) => s.trim()).filter(Boolean);
    const merged = [...new Set([...existing, ...toAdd])];
    wmComposeTo.value = merged.join(', ');
  }
  e.target.value = '';
});

function renderWmContactGroupsList() {
  const el = $('#wm-cg-list');
  if (!el) return;
  if (wmContactGroups.length === 0) {
    el.innerHTML = '<div style="font-size:12.5px; color:var(--text-muted); text-align:center; padding:12px 0;">No contact groups yet. Create one above!</div>';
    return;
  }
  el.innerHTML = '';
  wmContactGroups.forEach((cg) => {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--border); border-radius:8px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px;';
    card.innerHTML = `
      <div style="min-width:0;">
        <div style="font-weight:700; font-size:13px;">${cg.name} <span class="badge badge-neutral" style="font-size:10.5px; margin-left:4px;">${(cg.members || []).length} member(s)</span></div>
        <div style="font-size:11.5px; color:var(--text-secondary); font-family:var(--mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${(cg.members || []).join(', ')}</div>
      </div>
      <div style="display:flex; gap:6px; flex-shrink:0;">
        <button type="button" class="btn btn-secondary btn-sm wm-cg-compose-btn">Compose</button>
        <button type="button" class="btn btn-danger-ghost btn-sm wm-cg-del-btn">Delete</button>
      </div>
    `;
    card.querySelector('.wm-cg-compose-btn')?.addEventListener('click', () => {
      $('#wm-contact-groups-modal-backdrop')?.classList.remove('open');
      openWmCompose();
      if (wmComposeTo) wmComposeTo.value = (cg.members || []).join(', ');
    });
    card.querySelector('.wm-cg-del-btn')?.addEventListener('click', async () => {
      await resellerFetch(`/webmail/contact-groups/${encodeURIComponent(cg.id)}`, { method: 'DELETE' });
      await loadWmContactGroups();
      setStatus(`Deleted contact group: ${cg.name}`, 'connected');
    });
    el.appendChild(card);
  });
}

$('#wm-contact-groups-btn')?.addEventListener('click', async () => {
  await loadWmContactGroups();
  $('#wm-contact-groups-modal-backdrop')?.classList.add('open');
});
$('#wm-cg-modal-close')?.addEventListener('click', () => $('#wm-contact-groups-modal-backdrop')?.classList.remove('open'));
$('#wm-cg-modal-done')?.addEventListener('click', () => $('#wm-contact-groups-modal-backdrop')?.classList.remove('open'));
$('#wm-cg-save-btn')?.addEventListener('click', async () => {
  if (!wmSession?.email) return;
  const name = ($('#wm-cg-name-input')?.value || '').trim();
  const members = ($('#wm-cg-members-input')?.value || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!name || members.length === 0) return setStatus('Enter group name and at least one member email', 'error');
  await resellerFetch('/webmail/contact-groups', {
    method: 'POST',
    body: JSON.stringify({ ownerEmail: wmSession.email, name, members }),
  });
  $('#wm-cg-name-input').value = '';
  $('#wm-cg-members-input').value = '';
  await loadWmContactGroups();
  setStatus(`Saved contact group: ${name}`, 'connected');
});

// Standalone Webmail Mode (when accessed on mail.iecloudbase.com / webmail.iecloudbase.com or ?standalone=mail)
(function initStandaloneMailMode() {
  const host = (window.location.hostname || '').toLowerCase();
  const isMailHost = host === 'mail.iecloudbase.com' || host === 'webmail.iecloudbase.com';
  const isMailQuery = new URLSearchParams(window.location.search).get('standalone') === 'mail';
  if (!isMailHost && !isMailQuery) return;
  document.body.classList.add('standalone-mail-mode');
  document.title = 'ieCloudbase Mail';
  switchView('webmail');
  if (topbarPageTitle) topbarPageTitle.textContent = 'Mail';
})();

// ============================================================================
// --- RECORDS STUDIO (Auth + Database + Storage/Disks for App Hosting) ---
// ============================================================================
let recActiveDbId = null;
let recTables = [];
let recActiveTable = '';
let recTableColumns = [];
let recPrimaryKeys = [];
let recRows = [];
let recTotalRows = 0;
let recOffset = 0;
const REC_LIMIT = 50;
let recEditingRowWhere = null; // null = insert, object = update
let recModalMode = 'database'; // 'database' | 'auth'

$('#sd-records-btn')?.addEventListener('click', () => {
  switchServiceDetailTab('records');
});

function switchRecordsSubTab(tab) {
  $$('#rec-subtabs .paas-status-tab').forEach((b) => b.classList.toggle('active', b.dataset.rectab === tab));
  $$('.rec-panel').forEach((p) => { p.style.display = 'none'; });
  const target = $(`#rec-panel-${tab}`);
  if (target) target.style.display = 'block';
  if (tab === 'overview') renderRecOverview();
  if (tab === 'schemas') renderRecSchemas();
  if (tab === 'auth') loadAuthTableRows();
  if (tab === 'storage') {
    loadRecBuckets();
    renderRecMounts();
  }
  if (tab === 'settings') renderRecSettings();
}

$$('#rec-subtabs .paas-status-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchRecordsSubTab(btn.dataset.rectab));
});

async function openRecordsStudio() {
  if (!currentServiceDetail) return;
  const dbSel = $('#rec-db-select');
  const pgList = (hostedApps || []).filter((s) => s.kind === 'postgres');
  if (currentServiceDetail.kind === 'postgres' && !pgList.some((s) => s.id === currentServiceDetail.id)) {
    pgList.unshift({ id: currentServiceDetail.id, name: currentServiceDetail.name, kind: 'postgres' });
  }
  if ($('#rec-studio-project-title')) $('#rec-studio-project-title').textContent = `${currentServiceDetail.name} · Records Studio`;
  if (dbSel) {
    if (pgList.length === 0) {
      dbSel.innerHTML = '<option value="">No PostgreSQL databases</option>';
    } else {
      dbSel.innerHTML = pgList.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
    }
  }
  if (currentServiceDetail.kind === 'postgres') {
    recActiveDbId = currentServiceDetail.id;
  } else {
    const svcSlug = (currentServiceDetail.name || '').toLowerCase().replace(/-web$|-app$/, '');
    const match = pgList.find((d) => d.name.toLowerCase().includes(svcSlug)) || pgList[0];
    recActiveDbId = match ? match.id : '';
  }
  if (dbSel && recActiveDbId) dbSel.value = recActiveDbId;
  switchRecordsSubTab('overview');
  renderRecMounts();
  await Promise.all([loadRecTables(), loadRecBuckets()]);
  renderRecOverview();
}

$('#rec-db-select')?.addEventListener('change', async (e) => {
  recActiveDbId = e.target.value;
  recActiveTable = '';
  recOffset = 0;
  await loadRecTables();
  if ($('#rec-panel-auth')?.style.display !== 'none') await loadAuthTableRows();
});

$('#rec-refresh-btn')?.addEventListener('click', async () => {
  await loadRecTables();
  if ($('#rec-panel-auth')?.style.display !== 'none') await loadAuthTableRows();
  if ($('#rec-panel-storage')?.style.display !== 'none') {
    await openServiceDetail(currentServiceDetail.kind, currentServiceDetail.id);
    switchServiceDetailTab('records');
    switchRecordsSubTab('storage');
  }
});

async function loadRecTables() {
  const listEl = $('#rec-tables-list');
  const authSel = $('#rec-auth-table-select');
  if (!recActiveDbId) {
    if (listEl) listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:6px;">No PostgreSQL database selected.</div>';
    if (authSel) authSel.innerHTML = '';
    renderRecRowsEmpty('Select or deploy a PostgreSQL database to manage records.');
    return;
  }
  if (listEl) listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:6px;">Connecting...</div>';
  try {
    const data = await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/tables`);
    recTables = Array.isArray(data.tables) ? data.tables : [];
    if (authSel) {
      authSel.innerHTML = recTables.map((t) => `<option value="${t.name}">${t.name}</option>`).join('');
      const authGuess = recTables.find((t) => /^(users?|accounts?|auth_users|profiles)$/i.test(t.name))
        || recTables.find((t) => (t.columns || []).some((c) => /email/i.test(c.name)));
      if (authGuess) authSel.value = authGuess.name;
    }
    renderRecTablesList();
    if (recTables.length > 0) {
      if (!recActiveTable || !recTables.some((t) => t.name === recActiveTable)) {
        recActiveTable = recTables[0].name;
      }
      await loadRecRows();
    } else {
      renderRecRowsEmpty('No tables found in public schema yet.');
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div style="font-size:12px; color:#dc2626; padding:6px;">${e.message}</div>`;
    renderRecRowsEmpty(`Could not connect to database: ${e.message}`);
  }
}

function renderRecTablesList() {
  const listEl = $('#rec-tables-list');
  if (!listEl) return;
  if (recTables.length === 0) {
    listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:6px;">No tables yet.</div>';
    return;
  }
  listEl.innerHTML = '';
  recTables.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const active = t.name === recActiveTable;
    btn.style.cssText = `display:flex; align-items:center; justify-content:space-between; width:100%; text-align:left; padding:7px 10px; border-radius:7px; border:none; cursor:pointer; font-size:12.5px; font-family:var(--mono); background:${active ? '#0f172a' : 'transparent'}; color:${active ? '#ffffff' : 'var(--text-primary)'};`;
    btn.innerHTML = `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.name}</span><span style="font-size:11px; opacity:0.75; margin-left:6px;">${t.approxRows}</span>`;
    btn.addEventListener('click', async () => {
      recActiveTable = t.name;
      recOffset = 0;
      renderRecTablesList();
      await loadRecRows();
    });
    listEl.appendChild(btn);
  });
}

function renderRecRowsEmpty(msg) {
  $('#rec-active-table-name').textContent = recActiveTable || 'Database';
  $('#rec-active-table-count').textContent = '';
  $('#rec-rows-thead').innerHTML = '';
  $('#rec-rows-tbody').innerHTML = `<tr><td style="padding:24px; text-align:center; color:var(--text-muted);">${msg}</td></tr>`;
  $('#rec-page-info').textContent = '0 row(s)';
}

async function loadRecRows() {
  if (!recActiveDbId || !recActiveTable) return;
  const search = ($('#rec-row-search')?.value || '').trim();
  try {
    const q = new URLSearchParams({ table: recActiveTable, limit: String(REC_LIMIT), offset: String(recOffset), search });
    const data = await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/rows?${q.toString()}`);
    recTableColumns = data.columns || [];
    recPrimaryKeys = data.primaryKeys || [];
    recRows = data.rows || [];
    recTotalRows = Number(data.total || 0);
    renderRecRowsTable();
  } catch (e) {
    renderRecRowsEmpty(`Error loading rows: ${e.message}`);
  }
}

function formatCellValue(v) {
  if (v === null || v === undefined) return '<span style="color:#94a3b8; font-style:italic;">null</span>';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.length > 80 ? esc.slice(0, 77) + '...' : esc;
}

function buildRowWhere(row) {
  if (recPrimaryKeys.length > 0 && recPrimaryKeys.every((pk) => row[pk] !== undefined)) {
    const w = {};
    recPrimaryKeys.forEach((pk) => { w[pk] = row[pk]; });
    return w;
  }
  return { _ctid: row._ctid };
}

function renderRecRowsTable() {
  $('#rec-active-table-name').textContent = recActiveTable;
  $('#rec-active-table-count').textContent = `${recTotalRows} row(s)`;
  const thead = $('#rec-rows-thead');
  const tbody = $('#rec-rows-tbody');
  if (!thead || !tbody) return;

  thead.innerHTML = `<tr style="background:#f8fafc; border-bottom:1px solid var(--border);">${recTableColumns.map((c) => `<th style="padding:8px 10px; text-align:left; font-weight:600; white-space:nowrap;">${c.name}<div style="font-size:10px; font-weight:400; color:var(--text-muted);">${c.type}</div></th>`).join('')}<th style="padding:8px 10px; text-align:right; font-weight:600; white-space:nowrap;">ACTIONS</th></tr>`;

  if (recRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${recTableColumns.length + 1}" style="padding:20px; text-align:center; color:var(--text-muted);">No records found in ${recActiveTable}.</td></tr>`;
  } else {
    tbody.innerHTML = '';
    recRows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #f1f5f9';
      tr.innerHTML = `${recTableColumns.map((c) => `<td style="padding:7px 10px; font-family:var(--mono); font-size:12px; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${formatCellValue(row[c.name])}</td>`).join('')}<td style="padding:6px 10px; text-align:right; white-space:nowrap;"></td>`;
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.style.cssText = 'padding:3px 8px; font-size:11px; margin-right:4px;';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openRecRowModal(row, 'database'));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger-ghost btn-sm';
      delBtn.style.cssText = 'padding:3px 8px; font-size:11px;';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        try {
          await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/rows`, {
            method: 'DELETE',
            body: JSON.stringify({ table: recActiveTable, where: buildRowWhere(row) }),
          });
          setStatus('Record deleted', 'connected');
          await loadRecRows();
        } catch (e) {
          setStatus(`Delete failed: ${e.message}`, 'error');
        }
      });
      tr.lastElementChild.append(editBtn, delBtn);
      tbody.appendChild(tr);
    });
  }

  const start = recTotalRows === 0 ? 0 : recOffset + 1;
  const end = Math.min(recTotalRows, recOffset + recRows.length);
  $('#rec-page-info').textContent = `Showing ${start}–${end} of ${recTotalRows}`;
  if ($('#rec-prev-btn')) $('#rec-prev-btn').disabled = recOffset <= 0;
  if ($('#rec-next-btn')) $('#rec-next-btn').disabled = recOffset + REC_LIMIT >= recTotalRows;
}

$('#rec-row-search')?.addEventListener('input', () => { recOffset = 0; loadRecRows(); });
$('#rec-prev-btn')?.addEventListener('click', () => { recOffset = Math.max(0, recOffset - REC_LIMIT); loadRecRows(); });
$('#rec-next-btn')?.addEventListener('click', () => { recOffset += REC_LIMIT; loadRecRows(); });
$('#rec-insert-row-btn')?.addEventListener('click', () => openRecRowModal(null, 'database'));

// --- Auth Sub-Tab ---
async function loadAuthTableRows() {
  const authTbl = $('#rec-auth-table-select')?.value;
  const thead = $('#rec-auth-thead');
  const tbody = $('#rec-auth-tbody');
  if (!recActiveDbId || !authTbl || !thead || !tbody) {
    if (tbody) tbody.innerHTML = '<tr><td style="padding:20px; text-align:center; color:var(--text-muted);">No users table detected in this database.</td></tr>';
    return;
  }
  try {
    const data = await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/rows?table=${encodeURIComponent(authTbl)}&limit=100`);
    const cols = data.columns || [];
    const pks = data.primaryKeys || [];
    const rows = data.rows || [];
    const displayCols = cols.filter((c) => !/password|hash|salt|secret|token/i.test(c.name)).slice(0, 6);
    thead.innerHTML = `<tr style="background:#f8fafc; border-bottom:1px solid var(--border);">${displayCols.map((c) => `<th style="padding:8px 10px; text-align:left; font-weight:600;">${c.name}</th>`).join('')}<th style="padding:8px 10px; text-align:right; font-weight:600;">ACTIONS</th></tr>`;
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${displayCols.length + 1}" style="padding:20px; text-align:center; color:var(--text-muted);">No user records in ${authTbl}.</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #f1f5f9';
      tr.innerHTML = `${displayCols.map((c) => `<td style="padding:7px 10px; font-size:12.5px;">${formatCellValue(row[c.name])}</td>`).join('')}<td style="padding:6px 10px; text-align:right; white-space:nowrap;"></td>`;
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-sm';
      editBtn.style.cssText = 'padding:3px 8px; font-size:11px; margin-right:4px;';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        recActiveTable = authTbl;
        recTableColumns = cols;
        recPrimaryKeys = pks;
        openRecRowModal(row, 'auth');
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger-ghost btn-sm';
      delBtn.style.cssText = 'padding:3px 8px; font-size:11px;';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        const w = pks.length > 0 && pks.every((pk) => row[pk] !== undefined)
          ? Object.fromEntries(pks.map((pk) => [pk, row[pk]]))
          : { _ctid: row._ctid };
        await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/rows`, {
          method: 'DELETE',
          body: JSON.stringify({ table: authTbl, where: w }),
        });
        setStatus('User deleted', 'connected');
        await loadAuthTableRows();
      });
      tr.lastElementChild.append(editBtn, delBtn);
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td style="padding:20px; color:#dc2626;">${e.message}</td></tr>`;
  }
}

$('#rec-auth-table-select')?.addEventListener('change', loadAuthTableRows);
$('#rec-auth-add-btn')?.addEventListener('click', async () => {
  const authTbl = $('#rec-auth-table-select')?.value;
  if (!authTbl || !recActiveDbId) return setStatus('Select a users table first', 'error');
  const data = await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/rows?table=${encodeURIComponent(authTbl)}&limit=1`);
  recActiveTable = authTbl;
  recTableColumns = data.columns || [];
  recPrimaryKeys = data.primaryKeys || [];
  openRecRowModal(null, 'auth');
});

// --- Insert / Edit Record Modal ---
function openRecRowModal(row = null, mode = 'database') {
  if (!recActiveTable || recTableColumns.length === 0) return setStatus('Select a table first', 'error');
  recModalMode = mode;
  recEditingRowWhere = row ? buildRowWhere(row) : null;
  $('#rec-row-modal-title').textContent = row
    ? `Edit ${mode === 'auth' ? 'User' : 'Record'} (${recActiveTable})`
    : `Add ${mode === 'auth' ? 'User' : 'Record'} (${recActiveTable})`;
  const fieldsEl = $('#rec-row-modal-fields');
  fieldsEl.innerHTML = '';
  recTableColumns.forEach((c) => {
    const wrap = document.createElement('div');
    const val = row && row[c.name] !== null && row[c.name] !== undefined
      ? (typeof row[c.name] === 'object' ? JSON.stringify(row[c.name]) : String(row[c.name]))
      : '';
    const hint = !row && c.hasDefault ? ' (auto/default if blank)' : '';
    wrap.innerHTML = `
      <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;">${c.name} <span style="font-weight:400; color:var(--text-muted);">${c.type}${hint}</span></label>
      <input type="text" class="input rec-field-input" data-col="${c.name}" value="${val.replace(/"/g, '&quot;')}" placeholder="${c.nullable ? 'NULL' : ''}" style="margin-bottom:0; font-family:var(--mono); font-size:12.5px;" />
    `;
    fieldsEl.appendChild(wrap);
  });
  $('#rec-row-modal-backdrop')?.classList.add('open');
}

function closeRecRowModal() {
  $('#rec-row-modal-backdrop')?.classList.remove('open');
}

$('#rec-row-modal-close')?.addEventListener('click', closeRecRowModal);
$('#rec-row-modal-cancel')?.addEventListener('click', closeRecRowModal);
$('#rec-row-modal-save')?.addEventListener('click', async () => {
  const btn = $('#rec-row-modal-save');
  const payload = {};
  $$('#rec-row-modal-fields .rec-field-input').forEach((inp) => {
    const col = inp.dataset.col;
    const raw = inp.value;
    if (!recEditingRowWhere && raw === '') return; // let DB defaults apply on insert
    payload[col] = raw;
  });
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    if (recEditingRowWhere) {
      await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/rows`, {
        method: 'PUT',
        body: JSON.stringify({ table: recActiveTable, where: recEditingRowWhere, data: payload }),
      });
      setStatus('Record updated', 'connected');
    } else {
      await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/rows`, {
        method: 'POST',
        body: JSON.stringify({ table: recActiveTable, data: payload }),
      });
      setStatus('Record inserted', 'connected');
    }
    closeRecRowModal();
    if (recModalMode === 'auth') await loadAuthTableRows();
    else await loadRecRows();
  } catch (e) {
    setStatus(`Save failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Record';
  }
});

// --- Storage & Persistent Disks Sub-Tab ---
function renderRecMounts() {
  const listEl = $('#rec-mounts-list');
  const addForm = $('#rec-mount-add-form');
  const diskInput = $('#rec-disk-size-input');
  if (diskInput && currentServiceDetail) {
    diskInput.value = String(currentServiceDetail.diskSizeGB || 10);
  }
  if (!listEl || !currentServiceDetail) return;
  const canMount = currentServiceDetail.kind === 'web' || currentServiceDetail.kind === 'postgres';
  if (addForm) addForm.style.display = canMount ? 'flex' : 'none';
  const mounts = Array.isArray(currentServiceDetail.mounts) ? currentServiceDetail.mounts : [];
  if (mounts.length === 0) {
    listEl.innerHTML = '<p style="font-size:13px; color:var(--text-secondary);">No persistent disks or volume mounts attached to this service yet.</p>';
    return;
  }
  listEl.innerHTML = '';
  mounts.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'bp-service-preview';
    const sz = m.sizeGB || currentServiceDetail.diskSizeGB || 10;
    row.innerHTML = `
      <div>
        <div style="font-size:13px; font-weight:600; font-family:var(--mono);">${m.mountPath || '/data'} <span class="badge badge-neutral" style="margin-left:6px; font-size:11px;">${sz} GB</span></div>
        <div style="font-size:12px; color:var(--text-secondary);">Type: ${m.type || 'volume'} · ${m.volumeName || m.filePath || m.hostPath || ''}</div>
      </div>
      <button type="button" class="btn btn-danger-ghost btn-sm">Remove</button>
    `;
    row.querySelector('button')?.addEventListener('click', async () => {
      try {
        await resellerFetch(`/paas/mounts/${encodeURIComponent(m.mountId)}`, { method: 'DELETE' });
        setStatus('Removed mount (redeploy service to apply)', 'connected');
        await openServiceDetail(currentServiceDetail.kind, currentServiceDetail.id);
        switchServiceDetailTab('records');
        switchRecordsSubTab('storage');
      } catch (e) {
        setStatus(`Remove mount failed: ${e.message}`, 'error');
      }
    });
    listEl.appendChild(row);
  });
}

$('#rec-disk-dec-btn')?.addEventListener('click', () => {
  const inp = $('#rec-disk-size-input');
  if (!inp) return;
  const cur = Math.max(1, parseInt(inp.value || '10', 10));
  inp.value = String(Math.max(1, cur - (cur > 10 ? 5 : 1)));
});
$('#rec-disk-inc-btn')?.addEventListener('click', () => {
  const inp = $('#rec-disk-size-input');
  if (!inp) return;
  const cur = Math.max(1, parseInt(inp.value || '10', 10));
  inp.value = String(Math.min(1000, cur + (cur >= 10 ? 5 : 1)));
});
$('#rec-disk-save-btn')?.addEventListener('click', async () => {
  if (!currentServiceDetail) return;
  const btn = $('#rec-disk-save-btn');
  const inp = $('#rec-disk-size-input');
  const sizeGB = Math.min(1000, Math.max(1, Math.round(Number(inp?.value || 10))));
  if (inp) inp.value = String(sizeGB);
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const firstMountId = currentServiceDetail.mounts?.[0]?.mountId || null;
    await resellerFetch(`/paas/services/${encodeURIComponent(currentServiceDetail.kind)}/${encodeURIComponent(currentServiceDetail.id)}/disk-size`, {
      method: 'PUT',
      body: JSON.stringify({ sizeGB, mountId: firstMountId }),
    });
    currentServiceDetail.diskSizeGB = sizeGB;
    if (currentServiceDetail.mounts?.[0]) currentServiceDetail.mounts[0].sizeGB = sizeGB;
    renderRecMounts();
    setStatus(`Saved disk space: ${sizeGB} GB`, 'connected');
  } catch (e) {
    setStatus(`Save disk space failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
});

$('#rec-mount-add-btn')?.addEventListener('click', async () => {
  if (!currentServiceDetail) return;
  const volumeName = ($('#rec-mount-vol-input')?.value || '').trim();
  const mountPath = ($('#rec-mount-path-input')?.value || '').trim();
  const sizeGB = Math.min(1000, Math.max(1, Math.round(Number($('#rec-mount-size-input')?.value || 10))));
  if (!volumeName || !mountPath) return setStatus('Enter volume name and mount path', 'error');
  try {
    await resellerFetch(`/paas/services/${encodeURIComponent(currentServiceDetail.kind)}/${encodeURIComponent(currentServiceDetail.id)}/mounts`, {
      method: 'POST',
      body: JSON.stringify({ volumeName, mountPath, sizeGB }),
    });
    $('#rec-mount-vol-input').value = '';
    $('#rec-mount-path-input').value = '';
    setStatus(`Persistent disk attached (${sizeGB} GB)`, 'connected');
    await openServiceDetail(currentServiceDetail.kind, currentServiceDetail.id);
    switchServiceDetailTab('records');
    switchRecordsSubTab('storage');
  } catch (e) {
    setStatus(`Attach disk failed: ${e.message}`, 'error');
  }
});

// --- Supabase-Style Studio Extensions (Overview, Schemas, SQL, New Table, Storage Buckets, Settings) ---
let recBuckets = [];
let recActiveBucket = '';

function renderRecOverview() {
  if (!currentServiceDetail) return;
  if ($('#rec-ov-name')) $('#rec-ov-name').textContent = currentServiceDetail.name || 'Database Project';
  if ($('#rec-ov-host')) {
    $('#rec-ov-host').textContent = currentServiceDetail.connectionString
      ? `${currentServiceDetail.host}:${currentServiceDetail.port}/${currentServiceDetail.databaseName || ''}`
      : (currentServiceDetail.url || currentServiceDetail.appName || '');
  }
  if ($('#rec-ov-tables-count')) $('#rec-ov-tables-count').textContent = String(recTables.length);
  const totalApprox = recTables.reduce((sum, t) => sum + Number(t.approxRows || 0), 0);
  if ($('#rec-ov-rows-count')) $('#rec-ov-rows-count').textContent = String(totalApprox);
  if ($('#rec-ov-buckets-count')) $('#rec-ov-buckets-count').textContent = String(recBuckets.length);
}

$('#rec-table-filter')?.addEventListener('input', () => {
  const q = ($('#rec-table-filter')?.value || '').trim().toLowerCase();
  $$('#rec-tables-list button').forEach((b) => {
    const name = (b.firstElementChild?.textContent || '').toLowerCase();
    b.style.display = !q || name.includes(q) ? 'flex' : 'none';
  });
});

$('#rec-auth-search')?.addEventListener('input', () => {
  const q = ($('#rec-auth-search')?.value || '').trim().toLowerCase();
  $$('#rec-auth-tbody tr').forEach((tr) => {
    tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

function renderRecSchemas() {
  const grid = $('#rec-schema-cards');
  if (!grid) return;
  if (recTables.length === 0) {
    grid.innerHTML = '<div style="font-size:13px; color:var(--text-muted);">No tables in public schema yet. Click <strong>+ New table</strong> to create one.</div>';
    return;
  }
  grid.innerHTML = recTables.map((t) => `
    <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; background:#fff;">
      <div style="padding:8px 12px; background:#f8fafc; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
        <strong style="font-size:12.5px; font-family:var(--mono);">${t.name}</strong>
        <span style="font-size:11px; color:var(--text-muted);">${t.approxRows} rows</span>
      </div>
      <div style="padding:6px 10px;">
        ${(t.columns || []).map((c) => `
          <div style="display:flex; justify-content:space-between; padding:3px 2px; font-size:11.5px; border-bottom:1px solid #f8fafc;">
            <span style="font-family:var(--mono);">${c.name}</span>
            <span style="color:var(--text-muted); font-family:var(--mono);">${c.type}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// SQL Editor
$('#rec-sql-template-select')?.addEventListener('change', (e) => {
  if (e.target.value && $('#rec-sql-input')) $('#rec-sql-input').value = e.target.value;
});

async function runRecSql() {
  if (!recActiveDbId) return setStatus('Select a PostgreSQL database first', 'error');
  const sql = ($('#rec-sql-input')?.value || '').trim();
  if (!sql) return setStatus('Enter a SQL query', 'error');
  const btn = $('#rec-sql-run-btn');
  const meta = $('#rec-sql-meta');
  const thead = $('#rec-sql-thead');
  const tbody = $('#rec-sql-tbody');
  btn.disabled = true;
  btn.textContent = 'Running...';
  try {
    const res = await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/sql`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
    if (meta) meta.textContent = `${res.command || 'OK'} · ${res.rowCount} row(s) · ${res.durationMs || 0}ms`;
    const fields = res.fields || [];
    const rows = res.rows || [];
    if (fields.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = `<tr><td style="padding:14px; color:var(--text-secondary);">Query executed successfully (${res.command || 'OK'}, ${res.rowCount} row(s) affected).</td></tr>`;
    } else {
      thead.innerHTML = `<tr style="background:#f8fafc; border-bottom:1px solid var(--border);">${fields.map((f) => `<th style="padding:7px 10px; text-align:left; font-weight:600; white-space:nowrap;">${f}</th>`).join('')}</tr>`;
      tbody.innerHTML = rows.length === 0
        ? `<tr><td colspan="${fields.length}" style="padding:14px; text-align:center; color:var(--text-muted);">0 rows returned.</td></tr>`
        : rows.map((r) => `<tr style="border-bottom:1px solid #f1f5f9;">${fields.map((f) => `<td style="padding:6px 10px; font-family:var(--mono); max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${formatCellValue(r[f])}</td>`).join('')}</tr>`).join('');
    }
    await loadRecTables();
  } catch (e) {
    if (meta) meta.textContent = 'Error';
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td style="padding:14px; color:#dc2626; font-family:var(--mono);">${e.message}</td></tr>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run SQL';
  }
}

$('#rec-sql-run-btn')?.addEventListener('click', runRecSql);
$('#rec-sql-input')?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runRecSql();
  }
});

// New Table Modal
function addNewTableColRow(name = '', type = 'text', isPrimary = false) {
  const wrap = $('#rec-nt-cols');
  if (!wrap) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:6px; align-items:center;';
  row.innerHTML = `
    <input type="text" class="input rec-nt-cname" placeholder="column_name" value="${name}" style="flex:1; margin-bottom:0; font-family:var(--mono); font-size:12px;" />
    <select class="select rec-nt-ctype" style="width:130px; font-size:12px;">
      <option value="uuid" ${type === 'uuid' ? 'selected' : ''}>uuid</option>
      <option value="serial" ${type === 'serial' ? 'selected' : ''}>serial</option>
      <option value="text" ${type === 'text' ? 'selected' : ''}>text</option>
      <option value="integer" ${type === 'integer' ? 'selected' : ''}>integer</option>
      <option value="boolean" ${type === 'boolean' ? 'selected' : ''}>boolean</option>
      <option value="numeric" ${type === 'numeric' ? 'selected' : ''}>numeric</option>
      <option value="jsonb" ${type === 'jsonb' ? 'selected' : ''}>jsonb</option>
      <option value="timestamptz" ${type === 'timestamptz' ? 'selected' : ''}>timestamptz</option>
    </select>
    <label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; white-space:nowrap;"><input type="checkbox" class="rec-nt-cpk" ${isPrimary ? 'checked' : ''} /> PK</label>
    <button type="button" class="icon-btn" title="Remove">✕</button>
  `;
  row.querySelector('button')?.addEventListener('click', () => row.remove());
  wrap.appendChild(row);
}

function openNewTableModal() {
  if (!recActiveDbId) return setStatus('Select a PostgreSQL database first', 'error');
  if ($('#rec-nt-name')) $('#rec-nt-name').value = '';
  const wrap = $('#rec-nt-cols');
  if (wrap) {
    wrap.innerHTML = '';
    addNewTableColRow('id', 'uuid', true);
    addNewTableColRow('name', 'text', false);
    addNewTableColRow('created_at', 'timestamptz', false);
  }
  $('#rec-new-table-modal-backdrop')?.classList.add('open');
}

$('#rec-new-table-btn')?.addEventListener('click', openNewTableModal);
$('#rec-schemas-new-tbl-btn')?.addEventListener('click', openNewTableModal);
$('#rec-nt-add-col-btn')?.addEventListener('click', () => addNewTableColRow('', 'text', false));
$('#rec-nt-close')?.addEventListener('click', () => $('#rec-new-table-modal-backdrop')?.classList.remove('open'));
$('#rec-nt-cancel')?.addEventListener('click', () => $('#rec-new-table-modal-backdrop')?.classList.remove('open'));
$('#rec-nt-save')?.addEventListener('click', async () => {
  const name = ($('#rec-nt-name')?.value || '').trim();
  const columns = $$('#rec-nt-cols > div').map((r) => ({
    name: (r.querySelector('.rec-nt-cname')?.value || '').trim(),
    type: r.querySelector('.rec-nt-ctype')?.value || 'text',
    isPrimary: Boolean(r.querySelector('.rec-nt-cpk')?.checked),
  })).filter((c) => c.name);
  if (!name || columns.length === 0) return setStatus('Enter table name and at least one column', 'error');
  try {
    await resellerFetch(`/paas/records/postgres/${encodeURIComponent(recActiveDbId)}/tables`, {
      method: 'POST',
      body: JSON.stringify({ name, columns }),
    });
    $('#rec-new-table-modal-backdrop')?.classList.remove('open');
    recActiveTable = name;
    await loadRecTables();
    renderRecSchemas();
    setStatus(`Created table ${name}`, 'connected');
  } catch (e) {
    setStatus(`Create table failed: ${e.message}`, 'error');
  }
});

// Storage Buckets & Objects
async function loadRecBuckets() {
  const listEl = $('#rec-buckets-list');
  const targetId = recActiveDbId || currentServiceDetail?.id;
  if (!listEl || !targetId) return;
  try {
    const data = await resellerFetch(`/paas/records/postgres/${encodeURIComponent(targetId)}/storage/buckets`);
    recBuckets = Array.isArray(data.buckets) ? data.buckets : [];
    renderRecOverview();
    if (recBuckets.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px;">No buckets yet. Click <strong>+ New bucket</strong>.</div>';
      $('#rec-active-bucket-name').textContent = 'Select a bucket';
      if ($('#rec-file-upload-btn')) $('#rec-file-upload-btn').style.display = 'none';
      $('#rec-objects-list').textContent = 'Create a bucket to upload and manage files.';
      return;
    }
    if (!recActiveBucket || !recBuckets.some((b) => b.name === recActiveBucket)) {
      recActiveBucket = recBuckets[0].name;
    }
    listEl.innerHTML = '';
    recBuckets.forEach((b) => {
      const item = document.createElement('div');
      const active = b.name === recActiveBucket;
      item.style.cssText = `display:flex; align-items:center; justify-content:space-between; padding:7px 9px; border-radius:6px; cursor:pointer; font-size:12.5px; background:${active ? '#0f172a' : 'transparent'}; color:${active ? '#fff' : 'var(--text-primary)'}; margin-bottom:2px;`;
      item.innerHTML = `<span style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${b.name}</span><span style="font-size:10.5px; opacity:0.8;">${b.isPublic ? 'PUBLIC' : 'PRIVATE'} · ${b.fileCount || 0}</span>`;
      item.addEventListener('click', () => {
        recActiveBucket = b.name;
        loadRecBuckets();
      });
      listEl.appendChild(item);
    });
    await loadRecBucketObjects();
  } catch {
    listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px;">Could not load buckets.</div>';
  }
}

async function loadRecBucketObjects() {
  const targetId = recActiveDbId || currentServiceDetail?.id;
  const listEl = $('#rec-objects-list');
  const uploadBtn = $('#rec-file-upload-btn');
  if (!targetId || !recActiveBucket || !listEl) return;
  $('#rec-active-bucket-name').textContent = `${recActiveBucket} (bucket)`;
  if (uploadBtn) uploadBtn.style.display = 'inline-flex';
  const data = await resellerFetch(`/paas/records/postgres/${encodeURIComponent(targetId)}/storage/objects?bucket=${encodeURIComponent(recActiveBucket)}`);
  const objs = Array.isArray(data.objects) ? data.objects : [];
  if (objs.length === 0) {
    listEl.innerHTML = '<div style="padding:14px; text-align:center; color:var(--text-muted);">No files in this bucket yet. Click <strong>+ Upload File</strong>.</div>';
    return;
  }
  listEl.innerHTML = '';
  objs.forEach((o) => {
    const row = document.createElement('div');
    row.className = 'bp-service-preview';
    const url = `${RESELLER_BASE}/paas/records/postgres/${encodeURIComponent(targetId)}/storage/objects/${encodeURIComponent(o.id)}`;
    row.innerHTML = `
      <div>
        <a href="${url}" target="_blank" style="font-weight:600; font-size:12.5px; color:var(--text-primary); text-decoration:underline;">${o.name} ↗</a>
        <div style="font-size:11px; color:var(--text-muted);">${o.mimeType} · ${Math.max(1, Math.round((o.size || 0) / 1024))} KB</div>
      </div>
      <button type="button" class="btn btn-danger-ghost btn-sm">Delete</button>
    `;
    row.querySelector('button')?.addEventListener('click', async () => {
      await resellerFetch(`/paas/records/postgres/${encodeURIComponent(targetId)}/storage/objects`, {
        method: 'DELETE',
        body: JSON.stringify({ id: o.id }),
      });
      await loadRecBuckets();
      setStatus(`Deleted ${o.name}`, 'connected');
    });
    listEl.appendChild(row);
  });
}

$('#rec-new-bucket-btn')?.addEventListener('click', () => {
  if ($('#rec-nb-name')) $('#rec-nb-name').value = '';
  $('#rec-new-bucket-modal-backdrop')?.classList.add('open');
});
$('#rec-nb-close')?.addEventListener('click', () => $('#rec-new-bucket-modal-backdrop')?.classList.remove('open'));
$('#rec-nb-cancel')?.addEventListener('click', () => $('#rec-new-bucket-modal-backdrop')?.classList.remove('open'));
$('#rec-nb-save')?.addEventListener('click', async () => {
  const targetId = recActiveDbId || currentServiceDetail?.id;
  const name = ($('#rec-nb-name')?.value || '').trim();
  const isPublic = Boolean($('#rec-nb-public')?.checked);
  if (!name || !targetId) return setStatus('Enter a bucket name', 'error');
  try {
    await resellerFetch(`/paas/records/postgres/${encodeURIComponent(targetId)}/storage/buckets`, {
      method: 'POST',
      body: JSON.stringify({ name, isPublic }),
    });
    $('#rec-new-bucket-modal-backdrop')?.classList.remove('open');
    recActiveBucket = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    await loadRecBuckets();
    setStatus(`Created bucket ${recActiveBucket}`, 'connected');
  } catch (e) {
    setStatus(`Create bucket failed: ${e.message}`, 'error');
  }
});

$('#rec-file-upload-btn')?.addEventListener('click', () => $('#rec-file-upload-input')?.click());
$('#rec-file-upload-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  const targetId = recActiveDbId || currentServiceDetail?.id;
  if (!file || !targetId || !recActiveBucket) return;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  await resellerFetch(`/paas/records/postgres/${encodeURIComponent(targetId)}/storage/objects`, {
    method: 'POST',
    body: JSON.stringify({
      bucket: recActiveBucket,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      dataBase64: btoa(binary),
    }),
  });
  e.target.value = '';
  await loadRecBuckets();
  setStatus(`Uploaded ${file.name}`, 'connected');
});

function renderRecSettings() {
  const card = $('#rec-settings-card');
  if (!card || !currentServiceDetail) return;
  card.innerHTML = `
    <h3 style="margin:0 0 12px; font-size:15px;">Project Settings</h3>
    <div style="display:grid; grid-template-columns:150px 1fr; gap:10px; font-size:13px; align-items:center;">
      <strong>Service Name</strong><code style="background:#f3f4f6; padding:6px 10px; border-radius:6px;">${currentServiceDetail.name}</code>
      <strong>Service ID</strong><code style="background:#f3f4f6; padding:6px 10px; border-radius:6px;">${currentServiceDetail.id}</code>
      <strong>Engine / Runtime</strong><code style="background:#f3f4f6; padding:6px 10px; border-radius:6px;">${currentServiceDetail.runtime || currentServiceDetail.kind}</code>
      ${currentServiceDetail.connectionString ? `<strong>Connection URL</strong><code style="background:#f3f4f6; padding:6px 10px; border-radius:6px; word-break:break-all;">${currentServiceDetail.connectionString}</code>` : ''}
    </div>
  `;
}
