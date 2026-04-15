/**
 * dashboard-html.ts — embedded single-file dashboard SPA
 * Dark theme, real-time via SSE, Chart.js for token usage.
 */

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Business OS — Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --border: #2a2d3e;
    --accent: #6366f1;
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #eab308;
    --text: #e2e8f0;
    --muted: #64748b;
    --font: 'Inter', system-ui, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; }
  header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 18px; font-weight: 700; }
  header .status { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  nav { display: flex; gap: 2px; padding: 0 24px; background: var(--surface); border-bottom: 1px solid var(--border); }
  nav button { background: none; border: none; color: var(--muted); font-size: 13px; padding: 10px 14px; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
  nav button.active { color: var(--accent); border-bottom-color: var(--accent); }
  nav button:hover { color: var(--text); }
  main { padding: 24px; max-width: 1400px; margin: 0 auto; }
  .tab { display: none; }
  .tab.active { display: block; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .card h3 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  .card .val { font-size: 28px; font-weight: 700; }
  .card .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge.active { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge.inactive { background: rgba(100,116,139,0.15); color: var(--muted); }
  .badge.pending { background: rgba(234,179,8,0.15); color: var(--yellow); }
  .badge.running { background: rgba(99,102,241,0.15); color: var(--accent); }
  .badge.failed { background: rgba(239,68,68,0.15); color: var(--red); }
  .importance { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; }
  .imp-high { background: var(--green); }
  .imp-med { background: var(--yellow); }
  .imp-low { background: var(--muted); }
  .feed { display: flex; flex-direction: column; gap: 8px; }
  .feed-item { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
  .feed-item .meta { color: var(--muted); font-size: 11px; margin-top: 4px; }
  .chart-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
  .section-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
  .blur-toggle { cursor: pointer; padding: 6px 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 6px; font-size: 12px; }
  .blurred td:nth-child(2) { filter: blur(4px); }
  input[type=text], select { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 8px 12px; font-size: 13px; width: 100%; margin-bottom: 8px; }
  button.btn { background: var(--accent); border: none; color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
  button.btn:hover { opacity: 0.9; }
  .privacy-note { font-size: 11px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<header>
  <span style="font-size:20px">🧠</span>
  <h1>AI Business OS</h1>
  <div class="status">
    <div class="dot"></div>
    <span id="status-text">Live</span>
    <button class="blur-toggle" onclick="toggleBlur()">🔒 Privacy</button>
  </div>
</header>

<nav>
  <button class="active" onclick="showTab('overview')">Overview</button>
  <button onclick="showTab('memory')">Memory</button>
  <button onclick="showTab('agents')">Agents</button>
  <button onclick="showTab('hive')">Hive Mind</button>
  <button onclick="showTab('tasks')">Tasks</button>
  <button onclick="showTab('tokens')">Tokens</button>
</nav>

<main>

<!-- Overview Tab -->
<div id="tab-overview" class="tab active">
  <div class="grid" id="stats-grid">
    <div class="card"><h3>Total Memories</h3><div class="val" id="stat-memories">—</div><div class="sub">across all agents</div></div>
    <div class="card"><h3>Active Agents</h3><div class="val" id="stat-agents">—</div><div class="sub">running now</div></div>
    <div class="card"><h3>Scheduled Tasks</h3><div class="val" id="stat-tasks">—</div><div class="sub">pending / active</div></div>
    <div class="card"><h3>Hive Events Today</h3><div class="val" id="stat-hive">—</div><div class="sub">cross-agent actions</div></div>
  </div>

  <div class="chart-wrap">
    <div class="section-title">Token Usage (Last 100 Requests)</div>
    <canvas id="token-chart" height="120"></canvas>
  </div>

  <div class="section-title">Recent Hive Activity</div>
  <div class="feed" id="overview-hive"></div>
</div>

<!-- Memory Tab -->
<div id="tab-memory" class="tab">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <div class="section-title" style="margin:0">Memory Timeline</div>
    <select id="mem-agent-filter" onchange="loadMemories()">
      <option value="main">main</option>
      <option value="comms">comms</option>
      <option value="content">content</option>
      <option value="ops">ops</option>
      <option value="research">research</option>
    </select>
    <input type="text" id="mem-search" placeholder="Search memories..." oninput="filterMemories()" style="width:200px">
  </div>
  <div class="card">
    <table id="memory-table">
      <thead><tr><th>Imp.</th><th>Summary</th><th>Topics</th><th>Date</th></tr></thead>
      <tbody id="memory-tbody"></tbody>
    </table>
  </div>
</div>

<!-- Agents Tab -->
<div id="tab-agents" class="tab">
  <div class="section-title">Agent Registry</div>
  <div class="card" style="margin-bottom:16px">
    <table id="agents-table">
      <thead><tr><th>Agent</th><th>Model</th><th>Status</th><th>Created</th></tr></thead>
      <tbody id="agents-tbody"></tbody>
    </table>
  </div>
</div>

<!-- Hive Mind Tab -->
<div id="tab-hive" class="tab">
  <div class="section-title">Hive Mind Log</div>
  <div class="feed" id="hive-feed"></div>
</div>

<!-- Tasks Tab -->
<div id="tab-tasks" class="tab">
  <div class="section-title">Mission Control — Scheduled Tasks</div>
  <div class="card">
    <table id="tasks-table">
      <thead><tr><th>Name</th><th>Agent</th><th>Cron</th><th>Next Run</th><th>Status</th><th>Runs</th></tr></thead>
      <tbody id="tasks-tbody"></tbody>
    </table>
  </div>
</div>

<!-- Tokens Tab -->
<div id="tab-tokens" class="tab">
  <div class="section-title">Token Usage by Agent</div>
  <div class="chart-wrap">
    <canvas id="agent-token-chart" height="150"></canvas>
  </div>
  <div class="card">
    <table id="tokens-table">
      <thead><tr><th>Agent</th><th>Input</th><th>Output</th><th>Total</th><th>Date</th></tr></thead>
      <tbody id="tokens-tbody"></tbody>
    </table>
  </div>
</div>

</main>

<script>
const token = new URLSearchParams(window.location.search).get('token') || '';
const api = path => fetch(path + (path.includes('?') ? '&' : '?') + 'token=' + token).then(r => r.json());

let allMemories = [];
let privacyBlur = false;
let tokenChart = null, agentTokenChart = null;

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
  loadTab(name);
}

function toggleBlur() {
  privacyBlur = !privacyBlur;
  document.querySelectorAll('table').forEach(t => t.classList.toggle('blurred', privacyBlur));
}

async function loadTab(name) {
  if (name === 'overview') await loadOverview();
  else if (name === 'memory') await loadMemories();
  else if (name === 'agents') await loadAgents();
  else if (name === 'hive') await loadHive();
  else if (name === 'tasks') await loadTasks();
  else if (name === 'tokens') await loadTokens();
}

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtNum(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return String(n);
}

async function loadOverview() {
  const [memories, agents, tasks, hive, tokens] = await Promise.all([
    api('/api/memories'), api('/api/agents'), api('/api/tasks'), api('/api/hive'), api('/api/tokens')
  ]);

  document.getElementById('stat-memories').textContent = memories.length;
  document.getElementById('stat-agents').textContent = agents.filter(a => a.status === 'active').length;
  document.getElementById('stat-tasks').textContent = tasks.filter(t => t.status === 'pending').length;
  document.getElementById('stat-hive').textContent = hive.filter(h => h.created_at > new Date(Date.now() - 86400000).toISOString()).length;

  // Token chart
  const last30 = tokens.slice(0, 30).reverse();
  if (tokenChart) tokenChart.destroy();
  const ctx = document.getElementById('token-chart').getContext('2d');
  tokenChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: last30.map(t => t.agent_id),
      datasets: [
        { label: 'Input', data: last30.map(t => t.input_tokens), backgroundColor: 'rgba(99,102,241,0.6)' },
        { label: 'Output', data: last30.map(t => t.output_tokens), backgroundColor: 'rgba(34,197,94,0.6)' },
      ]
    },
    options: { plugins: { legend: { labels: { color: '#e2e8f0' } } }, scales: { x: { ticks: { color: '#64748b' } }, y: { ticks: { color: '#64748b' } } }, responsive: true }
  });

  // Hive feed
  const hiveFeed = document.getElementById('overview-hive');
  hiveFeed.innerHTML = hive.slice(0, 8).map(h =>
    \`<div class="feed-item"><b>[\${h.agent_id}]</b> \${h.action_type}: \${h.summary}<div class="meta">\${fmt(h.created_at)}</div></div>\`
  ).join('');
}

async function loadMemories() {
  const agentId = document.getElementById('mem-agent-filter').value;
  allMemories = await api('/api/memories?agent=' + agentId);
  renderMemories(allMemories);
}

function filterMemories() {
  const q = document.getElementById('mem-search').value.toLowerCase();
  renderMemories(allMemories.filter(m => m.summary.toLowerCase().includes(q)));
}

function renderMemories(mems) {
  const tbody = document.getElementById('memory-tbody');
  tbody.innerHTML = mems.slice(0, 100).map(m => {
    const impClass = m.importance >= 0.8 ? 'imp-high' : m.importance >= 0.5 ? 'imp-med' : 'imp-low';
    const topics = JSON.parse(m.topics || '[]').slice(0, 2).join(', ') || '—';
    return \`<tr>
      <td><span class="importance \${impClass}"></span>\${m.importance.toFixed(1)}</td>
      <td>\${m.summary}</td>
      <td style="color:var(--muted)">\${topics}</td>
      <td style="color:var(--muted)">\${fmt(m.created_at)}</td>
    </tr>\`;
  }).join('');
}

async function loadAgents() {
  const agents = await api('/api/agents');
  document.getElementById('agents-tbody').innerHTML = agents.map(a =>
    \`<tr>
      <td><b>\${a.name}</b><br><span style="color:var(--muted);font-size:11px">@\${a.id}</span></td>
      <td style="color:var(--muted)">\${a.model}</td>
      <td><span class="badge \${a.status}">\${a.status}</span></td>
      <td style="color:var(--muted)">\${fmt(a.created_at)}</td>
    </tr>\`
  ).join('');
}

async function loadHive() {
  const hive = await api('/api/hive');
  document.getElementById('hive-feed').innerHTML = hive.map(h =>
    \`<div class="feed-item"><b>[\${h.agent_id}]</b> <span style="color:var(--accent)">\${h.action_type}</span>: \${h.summary}<div class="meta">\${fmt(h.created_at)}</div></div>\`
  ).join('');
}

async function loadTasks() {
  const tasks = await api('/api/tasks');
  document.getElementById('tasks-tbody').innerHTML = tasks.map(t =>
    \`<tr>
      <td><b>\${t.name}</b></td>
      <td style="color:var(--muted)">\${t.agent_id}</td>
      <td><code style="font-size:11px">\${t.cron}</code></td>
      <td style="color:var(--muted)">\${fmt(t.next_run)}</td>
      <td><span class="badge \${t.status}">\${t.status}</span></td>
      <td style="color:var(--muted)">\${t.run_count}</td>
    </tr>\`
  ).join('');
}

async function loadTokens() {
  const tokens = await api('/api/tokens');
  // Aggregate by agent
  const byAgent = {};
  for (const t of tokens) {
    if (!byAgent[t.agent_id]) byAgent[t.agent_id] = { input: 0, output: 0 };
    byAgent[t.agent_id].input += t.input_tokens;
    byAgent[t.agent_id].output += t.output_tokens;
  }
  const entries = Object.entries(byAgent);
  if (agentTokenChart) agentTokenChart.destroy();
  const ctx = document.getElementById('agent-token-chart').getContext('2d');
  agentTokenChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => v.input + v.output), backgroundColor: ['#6366f1','#22c55e','#eab308','#ef4444','#06b6d4'] }]
    },
    options: { plugins: { legend: { labels: { color: '#e2e8f0' } } } }
  });

  document.getElementById('tokens-tbody').innerHTML = tokens.slice(0, 50).map(t =>
    \`<tr>
      <td>\${t.agent_id}</td>
      <td>\${fmtNum(t.input_tokens)}</td>
      <td>\${fmtNum(t.output_tokens)}</td>
      <td>\${fmtNum(t.input_tokens + t.output_tokens)}</td>
      <td style="color:var(--muted)">\${fmt(t.created_at)}</td>
    </tr>\`
  ).join('');
}

// Load overview on init
loadOverview();

// SSE for real-time updates
const evtSource = new EventSource('/api/events?token=' + token);
evtSource.addEventListener('message', e => {
  const data = JSON.parse(e.data);
  // Refresh current tab
  const activeTab = document.querySelector('.tab.active')?.id?.replace('tab-', '');
  if (activeTab) loadTab(activeTab);
});
evtSource.onerror = () => { document.getElementById('status-text').textContent = 'Disconnected'; };
</script>
</body>
</html>`;
}
