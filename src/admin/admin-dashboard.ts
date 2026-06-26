/**
 * Admin Debug Center HTML Dashboard - Cloudflare Workers Edition
 * Hades Army v9.2
 *
 * Single-page HTML dashboard served from /admin.
 * Dark mode, mobile-friendly, single-page navigation.
 * All data is fetched from /admin/api/* endpoints.
 */

import type { HadesBindings } from "../types";

// ============================================
// HTML template
// ============================================

export function renderAdminDashboard(env: HadesBindings): string {
  // Defensive: never throw if env is partial
  const version = (env && env.HADES_VERSION) ? env.HADES_VERSION : "unknown";
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🏛 Hades Control Center</title>
<style>
  :root {
    --bg: #0d1117;
    --bg-card: #161b22;
    --bg-hover: #1f2937;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --yellow: #d29922;
    --red: #f85149;
    --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    min-height: 100vh;
  }
  .header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .header h1 { font-size: 18px; }
  .header .subtitle { color: var(--text-muted); font-size: 13px; }
  .layout {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: calc(100vh - 60px);
  }
  .sidebar {
    background: var(--bg-card);
    border-right: 1px solid var(--border);
    padding: 16px 0;
  }
  .sidebar a {
    display: block;
    padding: 10px 20px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 14px;
    cursor: pointer;
    border-left: 3px solid transparent;
  }
  .sidebar a:hover { background: var(--bg-hover); color: var(--text); }
  .sidebar a.active { color: var(--accent); border-left-color: var(--accent); background: var(--bg-hover); }
  .main { padding: 24px; overflow-x: auto; }
  .section { display: none; }
  .section.active { display: block; }
  .section h2 { margin-bottom: 16px; font-size: 20px; }
  .section h3 { margin: 16px 0 8px; font-size: 15px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .grid-2 { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 16px;
  }
  .card-title { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
  .card-value { font-size: 22px; font-weight: 600; }
  .card-value.green { color: var(--green); }
  .card-value.yellow { color: var(--yellow); }
  .card-value.red { color: var(--red); }
  .status-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .status-pill.healthy { background: rgba(63,185,80,0.15); color: var(--green); }
  .status-pill.warning { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .status-pill.failed { background: rgba(248,81,73,0.15); color: var(--red); }
  .status-pill.degraded { background: rgba(210,153,34,0.15); color: var(--yellow); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--text-muted); font-weight: 500; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
  tr:hover { background: var(--bg-hover); }
  .btn {
    display: inline-block;
    padding: 8px 16px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .btn:hover { opacity: 0.9; }
  .btn.danger { background: var(--red); }
  .btn.success { background: var(--green); }
  .btn.warn { background: var(--yellow); color: var(--bg); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; background: var(--bg-hover); color: var(--text-muted); }
  .badge.green { background: rgba(63,185,80,0.2); color: var(--green); }
  .badge.red { background: rgba(248,81,73,0.2); color: var(--red); }
  .badge.yellow { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 12px; background: var(--bg); padding: 2px 6px; border-radius: 3px; }
  .empty { color: var(--text-muted); font-style: italic; padding: 16px; text-align: center; }
  .banner {
    padding: 12px 16px;
    border-radius: 6px;
    margin-bottom: 16px;
    font-size: 14px;
  }
  .banner.emergency { background: rgba(248,81,73,0.15); border: 1px solid var(--red); color: var(--red); }
  .banner.success { background: rgba(63,185,80,0.15); border: 1px solid var(--green); color: var(--green); }
  .spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; }
  @media (max-width: 768px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { display: flex; overflow-x: auto; padding: 8px; }
    .sidebar a { padding: 8px 12px; border-left: none; border-bottom: 3px solid transparent; white-space: nowrap; }
    .sidebar a.active { border-left: none; border-bottom-color: var(--accent); }
  }
</style>
</head>
<body>

<div class="header">
  <div class="row">
    <h1>🏛 Hades Control Center</h1>
    <span class="badge">v${version}</span>
    <div class="grow"></div>
    <span id="emergency-banner"></span>
    <button class="btn" onclick="refreshAll()">↻ Refresh</button>
  </div>
  <div class="subtitle">Admin Debug Center — operational control room</div>
</div>

<div class="layout">
  <div class="sidebar">
    <a data-section="overview" class="active">📊 Overview</a>
    <a data-section="telegram">🤖 Telegram</a>
    <a data-section="agents">🧠 Agents</a>
    <a data-section="tasks">📋 Tasks</a>
    <a data-section="errors">🔴 Errors</a>
    <a data-section="memory">🗄️ Memory</a>
    <a data-section="github">🐙 GitHub</a>
    <a data-section="usage">💰 LLM Usage</a>
    <a data-section="timeline">📡 Live Timeline</a>
    <a data-section="conversations">💬 Conversations</a>
    <a data-section="performance">⚡ Performance</a>
    <a data-section="deployment">🚀 Deployment</a>
    <a data-section="emergency">🚨 Emergency</a>
    <a data-section="logs">📜 Logs</a>
  </div>

  <div class="main">

    <!-- OVERVIEW -->
    <div id="overview" class="section active">
      <h2>System Health</h2>
      <div id="overview-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- TELEGRAM -->
    <div id="telegram" class="section">
      <h2>Telegram Debug Panel</h2>
      <div id="telegram-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- AGENTS -->
    <div id="agents" class="section">
      <h2>Agent Activity Monitor</h2>
      <div id="agents-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- TASKS -->
    <div id="tasks" class="section">
      <h2>Task Execution Monitor</h2>
      <div id="tasks-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- ERRORS -->
    <div id="errors" class="section">
      <h2>Error Center</h2>
      <div id="errors-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- MEMORY -->
    <div id="memory" class="section">
      <h2>Memory Monitor</h2>
      <div id="memory-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- GITHUB -->
    <div id="github" class="section">
      <h2>GitHub Monitor</h2>
      <div id="github-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- LLM USAGE -->
    <div id="usage" class="section">
      <h2>LLM Usage Dashboard</h2>
      <div id="usage-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- TIMELINE -->
    <div id="timeline" class="section">
      <h2>Live Event Timeline</h2>
      <div id="timeline-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- CONVERSATIONS -->
    <div id="conversations" class="section">
      <h2>Conversation Inspector</h2>
      <div id="conversations-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- PERFORMANCE -->
    <div id="performance" class="section">
      <h2>Performance Dashboard</h2>
      <div id="performance-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- DEPLOYMENT -->
    <div id="deployment" class="section">
      <h2>Deployment Diagnostics</h2>
      <div id="deployment-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- EMERGENCY -->
    <div id="emergency" class="section">
      <h2>Emergency Panel</h2>
      <div id="emergency-content"><div class="empty">Loading…</div></div>
    </div>

    <!-- LOGS -->
    <div id="logs" class="section">
      <h2>Structured Logs</h2>
      <div id="logs-content"><div class="empty">Loading…</div></div>
    </div>

  </div>
</div>

<script>
const token = prompt("Enter ADMIN_API_TOKEN:");
if (!token) { document.body.innerHTML = "<div style='padding:40px;text-align:center'>🔒 Authentication required. Refresh to try again.</div>"; }
const headers = { "Authorization": "Bearer " + token };

// Section navigation
document.querySelectorAll(".sidebar a").forEach(a => {
  a.addEventListener("click", () => {
    document.querySelectorAll(".sidebar a").forEach(x => x.classList.remove("active"));
    a.classList.add("active");
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
    document.getElementById(a.dataset.section).classList.add("active");
    loadSection(a.dataset.section);
  });
});

async function api(path) {
  try {
    const res = await fetch("/admin/api/" + path, { headers });
    if (res.status === 401) {
      alert("Unauthorized. Check your ADMIN_API_TOKEN.");
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error("API error", path, e);
    return null;
  }
}

function statusPill(status) {
  const cls = status === "healthy" ? "healthy" : status === "warning" || status === "degraded" ? "warning" : "failed";
  return '<span class="status-pill ' + cls + '">' + status.toUpperCase() + '</span>';
}

function fmtTime(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

async function loadSection(name) {
  const map = {
    overview: loadOverview,
    telegram: loadTelegram,
    agents: loadAgents,
    tasks: loadTasks,
    errors: loadErrors,
    memory: loadMemory,
    github: loadGithub,
    usage: loadUsage,
    timeline: loadTimeline,
    conversations: loadConversations,
    performance: loadPerformance,
    deployment: loadDeployment,
    emergency: loadEmergency,
    logs: loadLogs,
  };
  if (map[name]) await map[name]();
}

async function loadOverview() {
  const d = await api("overview");
  if (!d) return;
  let html = '';
  if (d.emergencyMode) {
    html += '<div class="banner emergency">🚨 EMERGENCY MODE ACTIVE — Builder, Reviewer, GitHub Actions, and Background Jobs are DISABLED.</div>';
  }
  html += '<div class="grid-2">';
  html += '<div class="card"><div class="card-title">Worker</div><div class="card-value">' + statusPill(d.worker.status) + '</div></div>';
  html += '<div class="card"><div class="card-title">Version</div><div class="card-value">' + d.worker.version + '</div></div>';
  html += '<div class="card"><div class="card-title">Environment</div><div class="card-value" style="font-size:16px">' + d.worker.environment + '</div></div>';
  html += '<div class="card"><div class="card-title">Secrets</div><div class="card-value ' + (d.secrets.ok ? 'green' : 'red') + '">' + (d.secrets.ok ? 'OK' : 'MISSING') + '</div></div>';
  html += '</div>';
  html += '<h3>Components</h3><table><thead><tr><th>Component</th><th>Status</th><th>Detail</th><th>Latency</th></tr></thead><tbody>';
  d.components.forEach(c => {
    html += '<tr><td>' + c.emoji + ' ' + c.name + '</td><td>' + statusPill(c.status) + '</td><td>' + c.detail + '</td><td>' + (c.latencyMs ? c.latencyMs + 'ms' : '—') + '</td></tr>';
  });
  html += '</tbody></table>';
  if (d.secrets.missing.length > 0) {
    html += '<h3>Missing Critical Secrets</h3><div class="card">';
    d.secrets.missing.forEach(s => html += '<span class="badge red">' + s + '</span> ');
    html += '</div>';
  }
  if (d.configDrift.hasDrift) {
    html += '<h3>Config Drift (' + d.configDrift.driftCount + ' items)</h3><table><thead><tr><th>Variable</th><th>Issue</th><th>Recommendation</th></tr></thead><tbody>';
    d.configDrift.items.forEach(i => {
      html += '<tr><td><code>' + i.name + '</code></td><td>' + i.issue + '</td><td>' + i.recommendation + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  document.getElementById("overview-content").innerHTML = html;
  document.getElementById("emergency-banner").innerHTML = d.emergencyMode ? '<span class="badge red">🚨 EMERGENCY</span>' : '';
}

async function loadTelegram() {
  const d = await api("telegram");
  if (!d) return;
  let html = '<div class="grid-2">';
  html += '<div class="card"><div class="card-title">Webhook</div><div class="card-value ' + (d.webhook.active ? 'green' : 'red') + '">' + (d.webhook.active ? 'Active' : 'Inactive') + '</div></div>';
  html += '<div class="card"><div class="card-title">Bot Token</div><div class="card-value ' + (d.botTokenConfigured ? 'green' : 'red') + '">' + (d.botTokenConfigured ? 'Configured' : 'Missing') + '</div></div>';
  html += '<div class="card"><div class="card-title">Success Rate</div><div class="card-value">' + d.stats.successRate + '%</div></div>';
  html += '<div class="card"><div class="card-title">Pending Updates</div><div class="card-value">' + d.webhook.pendingUpdates + '</div></div>';
  html += '</div>';
  html += '<h3>Webhook Info</h3><div class="card"><table><tbody>';
  html += '<tr><td>URL</td><td><code>' + d.webhook.url + '</code></td></tr>';
  html += '<tr><td>Last Error</td><td>' + (d.webhook.lastErrorMessage || '—') + '</td></tr>';
  html += '</tbody></table></div>';
  html += '<h3>Last Update</h3><div class="card">';
  if (d.lastUpdate) {
    html += '<table><tbody>';
    html += '<tr><td>Time</td><td>' + fmtTime(d.lastUpdate.timestamp) + '</td></tr>';
    html += '<tr><td>User</td><td>' + d.lastUpdate.userId + '</td></tr>';
    html += '<tr><td>Chat</td><td>' + d.lastUpdate.chatId + '</td></tr>';
    html += '<tr><td>Text</td><td><code>' + (d.lastUpdate.text || '').slice(0,200) + '</code></td></tr>';
    html += '</tbody></table>';
  } else html += '<div class="empty">No updates received yet</div>';
  html += '</div>';
  html += '<h3>Last Response</h3><div class="card">';
  if (d.lastResponse) {
    html += '<table><tbody>';
    html += '<tr><td>Time</td><td>' + fmtTime(d.lastResponse.timestamp) + '</td></tr>';
    html += '<tr><td>Duration</td><td>' + (d.lastResponse.durationMs || '?') + 'ms</td></tr>';
    html += '<tr><td>Preview</td><td><code>' + (d.lastResponse.preview || '').slice(0,200) + '</code></td></tr>';
    html += '</tbody></table>';
  } else html += '<div class="empty">No responses sent yet</div>';
  html += '</div>';
  html += '<h3>Last Failure</h3><div class="card">';
  if (d.lastFailure) {
    html += '<table><tbody>';
    html += '<tr><td>Time</td><td>' + fmtTime(d.lastFailure.timestamp) + '</td></tr>';
    html += '<tr><td>Preview</td><td><code>' + (d.lastFailure.preview || '').slice(0,200) + '</code></td></tr>';
    html += '<tr><td>Error</td><td><span class="badge red">' + (d.lastFailure.error || '') + '</span></td></tr>';
    html += '</tbody></table>';
  } else html += '<div class="empty">No failures 🎉</div>';
  html += '</div>';
  html += '<h3>Recent Events</h3><table><thead><tr><th>Time</th><th>Kind</th><th>Chat</th><th>Detail</th></tr></thead><tbody>';
  d.recentEvents.forEach(e => {
    const cls = e.kind === 'failed' ? 'red' : e.kind === 'sent' ? 'green' : '';
    html += '<tr><td>' + fmtTime(e.timestamp) + '</td><td><span class="badge ' + cls + '">' + e.kind + '</span></td><td>' + (e.chatId || '—') + '</td><td>' + (e.error || e.text || e.responsePreview || '').slice(0,80) + '</td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById("telegram-content").innerHTML = html;
}

async function loadAgents() {
  const d = await api("agents");
  if (!d) return;
  let html = '<div class="grid-2">';
  d.agents.forEach(a => {
    const statusCls = a.status === 'healthy' ? 'green' : a.status === 'degraded' ? 'yellow' : 'red';
    html += '<div class="card"><div class="card-title">' + a.role.toUpperCase() + '</div>';
    html += '<div class="card-value ' + statusCls + '">' + a.status + '</div>';
    html += '<div style="margin-top:8px;font-size:13px"><code>' + a.provider + '/' + a.model + '</code></div>';
    html += '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + a.detail + '</div></div>';
  });
  html += '</div>';
  html += '<h3>Registry Compliance</h3><div class="card">';
  html += d.registryCompliant
    ? '<span class="badge green">✅ Compliant — no hardcoded models</span>'
    : '<span class="badge red">❌ Violations detected</span>';
  if (d.hardcodedModelViolations.length > 0) {
    html += '<ul>' + d.hardcodedModelViolations.map(v => '<li><code>' + v + '</code></li>').join('') + '</ul>';
  }
  html += '</div>';
  document.getElementById("agents-content").innerHTML = html;
}

async function loadTasks() {
  const d = await api("tasks");
  if (!d) return;
  document.getElementById("tasks-content").innerHTML = '<div class="card"><div class="empty">' + d.message + '</div></div>';
}

async function loadErrors() {
  const d = await api("errors");
  if (!d) return;
  let html = '<div class="grid-2">';
  html += '<div class="card"><div class="card-title">Critical</div><div class="card-value red">' + d.stats.critical + '</div></div>';
  html += '<div class="card"><div class="card-title">Errors</div><div class="card-value red">' + d.stats.error + '</div></div>';
  html += '<div class="card"><div class="card-title">Warnings</div><div class="card-value yellow">' + d.stats.warning + '</div></div>';
  html += '<div class="card"><div class="card-title">Info</div><div class="card-value">' + d.stats.info + '</div></div>';
  html += '</div>';
  html += '<h3>Recent Errors</h3><table><thead><tr><th>Time</th><th>Component</th><th>Severity</th><th>Message</th><th>Trace ID</th></tr></thead><tbody>';
  if (d.recent.length === 0) html += '<tr><td colspan="5" class="empty">No errors 🎉</td></tr>';
  d.recent.forEach(e => {
    const cls = e.severity === 'critical' ? 'red' : e.severity === 'error' ? 'red' : e.severity === 'warning' ? 'yellow' : '';
    html += '<tr><td>' + fmtTime(e.timestamp) + '</td><td>' + e.component + '</td><td><span class="badge ' + cls + '">' + e.severity + '</span></td><td>' + e.message + '</td><td><code>' + (e.traceId || '—') + '</code></td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById("errors-content").innerHTML = html;
}

async function loadMemory() {
  const d = await api("memory");
  if (!d) return;
  let html = '<div class="grid-2">';
  html += '<div class="card"><div class="card-title">KV</div><div class="card-value ' + (d.kv.available ? 'green' : 'red') + '">' + (d.kv.available ? d.kv.keysCount + ' keys' : 'Unavailable') + '</div></div>';
  html += '<div class="card"><div class="card-title">D1</div><div class="card-value ' + (d.d1.available ? 'green' : 'red') + '">' + (d.d1.available ? d.d1.tablesCount + ' tables' : 'Unavailable') + '</div></div>';
  html += '<div class="card"><div class="card-title">Repository Memory</div><div class="card-value ' + (d.repository.available ? 'green' : 'red') + '">' + (d.repository.available ? d.repository.filesCount + ' files' : 'Empty') + '</div></div>';
  html += '<div class="card"><div class="card-title">Last Sync</div><div class="card-value" style="font-size:14px">' + (d.sync.lastSyncAt ? fmtTime(d.sync.lastSyncAt) : 'Never') + '</div></div>';
  html += '</div>';
  if (d.sync.warnings.length > 0) {
    html += '<h3>Warnings</h3><div class="card"><ul>' + d.sync.warnings.map(w => '<li>' + w + '</li>').join('') + '</ul></div>';
  }
  document.getElementById("memory-content").innerHTML = html;
}

async function loadGithub() {
  const d = await api("github");
  if (!d) return;
  let html = '<div class="grid-2">';
  html += '<div class="card"><div class="card-title">Token</div><div class="card-value ' + (d.tokenConfigured ? 'green' : 'red') + '">' + (d.tokenConfigured ? 'Configured' : 'Missing') + '</div></div>';
  html += '<div class="card"><div class="card-title">Connected Repos</div><div class="card-value">' + d.connectedRepositories + '</div></div>';
  html += '<div class="card"><div class="card-title">Open PRs</div><div class="card-value">' + d.openPRs + '</div></div>';
  html += '<div class="card"><div class="card-title">Failed Ops</div><div class="card-value ' + (d.failedOperations > 0 ? 'red' : 'green') + '">' + d.failedOperations + '</div></div>';
  html += '</div>';
  document.getElementById("github-content").innerHTML = html;
}

async function loadUsage() {
  const d = await api("llm-usage");
  if (!d) return;
  let html = '<h3>Today</h3><div class="grid-2">';
  html += '<div class="card"><div class="card-title">Cost (today)</div><div class="card-value">$' + d.today.totalCostUsd.toFixed(4) + '</div></div>';
  html += '<div class="card"><div class="card-title">Tokens In</div><div class="card-value">' + d.today.totalTokensIn.toLocaleString() + '</div></div>';
  html += '<div class="card"><div class="card-title">Tokens Out</div><div class="card-value">' + d.today.totalTokensOut.toLocaleString() + '</div></div>';
  html += '</div>';
  html += '<h3>This Month</h3><div class="grid-2">';
  html += '<div class="card"><div class="card-title">Cost (month)</div><div class="card-value">$' + d.month.totalCostUsd.toFixed(4) + '</div></div>';
  html += '<div class="card"><div class="card-title">Tokens</div><div class="card-value">' + (d.month.totalTokensIn + d.month.totalTokensOut).toLocaleString() + '</div></div>';
  html += '</div>';
  html += '<h3>By Agent</h3><table><thead><tr><th>Agent</th><th>Calls</th><th>Success Rate</th><th>Cost</th><th>Avg Response</th></tr></thead><tbody>';
  if (d.agentCalls && d.agentCalls.byAgent) {
    d.agentCalls.byAgent.forEach(a => {
      html += '<tr><td>' + a.role + '</td><td>' + a.calls + '</td><td>' + a.successRate + '%</td><td>$' + a.costUsd.toFixed(4) + '</td><td>' + a.avgResponseMs + 'ms</td></tr>';
    });
  }
  html += '</tbody></table>';
  document.getElementById("usage-content").innerHTML = html;
}

async function loadTimeline() {
  const d = await api("timeline");
  if (!d) return;
  let html = '<table><thead><tr><th>Time</th><th>Event</th><th>User</th><th>Detail</th></tr></thead><tbody>';
  if (d.events.length === 0) html += '<tr><td colspan="4" class="empty">No events yet</td></tr>';
  d.events.forEach(e => {
    const cls = e.kind === 'failed' ? 'red' : e.kind === 'sent' ? 'green' : '';
    html += '<tr><td>' + fmtTime(e.timestamp) + '</td><td><span class="badge ' + cls + '">' + e.kind + '</span></td><td>' + (e.userId || '—') + '</td><td>' + (e.error || e.text || '').slice(0,100) + '</td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById("timeline-content").innerHTML = html;
}

async function loadConversations() {
  const d = await api("conversations");
  if (!d) return;
  let html = '<div class="banner success">🔒 Privacy: ' + (d.privacy.systemPromptsHidden ? 'System prompts hidden' : '') + ', ' + (d.privacy.secretsHidden ? 'Secrets hidden' : '') + ', ' + (d.privacy.chainOfThoughtHidden ? 'Chain-of-thought hidden' : '') + '</div>';
  html += '<div class="card"><div class="empty">' + d.message + '</div></div>';
  document.getElementById("conversations-content").innerHTML = html;
}

async function loadPerformance() {
  const d = await api("performance");
  if (!d) return;
  let html = '<div class="grid-2">';
  html += '<div class="card"><div class="card-title">Avg Response Time</div><div class="card-value">' + d.averageResponseTimeMs + 'ms</div></div>';
  html += '</div>';
  html += '<h3>Agent Durations</h3><table><thead><tr><th>Agent</th><th>Avg Response</th></tr></thead><tbody>';
  d.agentDurations.forEach(a => html += '<tr><td>' + a.agent + '</td><td>' + a.avgResponseMs + 'ms</td></tr>');
  html += '</tbody></table>';
  document.getElementById("performance-content").innerHTML = html;
}

async function loadDeployment() {
  const d = await api("deployment");
  if (!d) return;
  let html = '<div class="grid-2">';
  html += '<div class="card"><div class="card-title">Version</div><div class="card-value">' + d.version + '</div></div>';
  html += '<div class="card"><div class="card-title">Environment</div><div class="card-value" style="font-size:16px">' + d.environment + '</div></div>';
  html += '<div class="card"><div class="card-title">Compatibility Date</div><div class="card-value" style="font-size:16px">' + d.compatibilityDate + '</div></div>';
  html += '<div class="card"><div class="card-title">Triggers</div><div class="card-value" style="font-size:14px">' + d.triggers + '</div></div>';
  html += '</div>';
  html += '<h3>Bindings</h3><div class="card"><table><tbody>';
  html += '<tr><td>D1</td><td>' + (d.bindings.d1 ? '✅' : '❌') + '</td></tr>';
  html += '<tr><td>KV</td><td>' + (d.bindings.kv ? '✅' : '❌') + '</td></tr>';
  html += '<tr><td>AI</td><td>' + (d.bindings.ai ? '✅' : '❌') + '</td></tr>';
  html += '<tr><td>R2</td><td>' + (d.bindings.r2 ? '✅' : '⏸') + '</td></tr>';
  html += '</tbody></table></div>';
  if (d.configDrift.hasDrift) {
    html += '<h3>Config Drift</h3><table><thead><tr><th>Variable</th><th>Issue</th><th>Recommendation</th></tr></thead><tbody>';
    d.configDrift.items.forEach(i => html += '<tr><td><code>' + i.name + '</code></td><td>' + i.issue + '</td><td>' + i.recommendation + '</td></tr>');
    html += '</tbody></table>';
  }
  document.getElementById("deployment-content").innerHTML = html;
}

async function loadEmergency() {
  const d = await api("emergency/status");
  if (!d) return;
  let html = '';
  if (d.emergencyMode) {
    html += '<div class="banner emergency">🚨 EMERGENCY MODE IS ACTIVE</div>';
    html += '<p>The following are DISABLED:</p><ul>';
    d.disabledWhenEmergency.forEach(x => html += '<li><span class="badge red">' + x + '</span></li>');
    html += '</ul>';
    html += '<p>The following are KEPT ALIVE:</p><ul>';
    d.keptAliveWhenEmergency.forEach(x => html += '<li><span class="badge green">' + x + '</span></li>');
    html += '</ul>';
    html += '<button class="btn success" onclick="toggleEmergency(false)">✅ Disable Emergency Mode</button>';
  } else {
    html += '<div class="banner success">✅ System running normally</div>';
    html += '<p>Enabling Emergency Mode will DISABLE:</p><ul>';
    d.disabledWhenEmergency.forEach(x => html += '<li><span class="badge">' + x + '</span></li>');
    html += '</ul>';
    html += '<p>And KEEP ALIVE:</p><ul>';
    d.keptAliveWhenEmergency.forEach(x => html += '<li><span class="badge green">' + x + '</span></li>');
    html += '</ul>';
    html += '<button class="btn danger" onclick="toggleEmergency(true)">🚨 Enable Emergency Mode</button>';
  }
  document.getElementById("emergency-content").innerHTML = html;
}

async function toggleEmergency(enable) {
  if (!confirm(enable ? "ENABLE Emergency Mode? This will disable Builder, Reviewer, and GitHub actions." : "Disable Emergency Mode?")) return;
  await api("emergency/" + (enable ? "enable" : "disable"));
  loadEmergency();
  loadOverview();
}

async function loadLogs() {
  const d = await api("logs");
  if (!d) return;
  let html = '<h3>Recent Telegram Events</h3><table><thead><tr><th>Time</th><th>Level</th><th>Message</th><th>Detail</th></tr></thead><tbody>';
  if (d.recent.length === 0) html += '<tr><td colspan="4" class="empty">No logs</td></tr>';
  d.recent.forEach(l => {
    const cls = l.level === 'error' ? 'red' : '';
    html += '<tr><td>' + fmtTime(l.timestamp) + '</td><td><span class="badge ' + cls + '">' + l.level + '</span></td><td>' + l.message + '</td><td>' + (l.error || l.text || '').slice(0,80) + '</td></tr>';
  });
  html += '</tbody></table>';
  html += '<h3>Error Log</h3><table><thead><tr><th>Time</th><th>Severity</th><th>Component</th><th>Message</th></tr></thead><tbody>';
  if (d.errors.length === 0) html += '<tr><td colspan="4" class="empty">No errors 🎉</td></tr>';
  d.errors.forEach(e => {
    const cls = e.severity === 'critical' ? 'red' : e.severity === 'error' ? 'red' : e.severity === 'warning' ? 'yellow' : '';
    html += '<tr><td>' + fmtTime(e.timestamp) + '</td><td><span class="badge ' + cls + '">' + e.level + '</span></td><td>' + e.component + '</td><td>' + e.message + '</td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById("logs-content").innerHTML = html;
}

async function refreshAll() {
  const active = document.querySelector(".sidebar a.active");
  if (active) loadSection(active.dataset.section);
}

// Auto-load overview on first render
loadOverview();
// Auto-refresh every 30s
setInterval(() => {
  const active = document.querySelector(".sidebar a.active");
  if (active) loadSection(active.dataset.section);
}, 30000);
</script>

</body>
</html>`;
}
