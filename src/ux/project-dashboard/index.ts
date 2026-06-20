/**
 * Hades Army v0.6 - Project Dashboard
 */

export function renderProjectDashboard(project: {
  id: number;
  name: string;
  status: string;
  complexityScore: number;
  architectureScore: number;
  healthScore: number;
  memoryScore: number;
  tasks: number;
  prs: number;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${project.name} - Hades Army</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    .header h1 { font-size: 2rem; }
    .status-badge { padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.875rem; font-weight: 600; }
    .status-active { background: #10b981; color: white; }
    .status-pending { background: #f59e0b; color: white; }
    .status-archived { background: #6b7280; color: white; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .metric-card { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid #2a2a4a; border-radius: 12px; padding: 1.5rem; }
    .metric-card .value { font-size: 2rem; font-weight: bold; color: #667eea; }
    .metric-card .label { color: #888; font-size: 0.875rem; }
    .actions { display: flex; gap: 1rem; margin-bottom: 2rem; }
    .btn { padding: 0.75rem 1.5rem; border-radius: 8px; border: none; cursor: pointer; font-size: 0.875rem; font-weight: 600; color: white; }
    .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .btn-secondary { background: #1a1a2e; border: 1px solid #2a2a4a; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    .card { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 1.5rem; }
    .card h3 { color: #667eea; margin-bottom: 1rem; }
    .card p { color: #888; font-size: 0.875rem; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏛️ ${project.name}</h1>
      <span class="status-badge status-${project.status}">${project.status.toUpperCase()}</span>
    </div>
    <div class="metrics">
      <div class="metric-card"><div class="value">${project.complexityScore}</div><div class="label">Complexity</div></div>
      <div class="metric-card"><div class="value">${project.architectureScore}%</div><div class="label">Architecture</div></div>
      <div class="metric-card"><div class="value">${project.healthScore}%</div><div class="label">Health</div></div>
      <div class="metric-card"><div class="value">${project.memoryScore}%</div><div class="label">Memory</div></div>
    </div>
    <div class="actions">
      <button class="btn btn-primary">➕ New Task</button>
      <button class="btn btn-secondary">📋 Tasks</button>
      <button class="btn btn-secondary">🧠 Memory</button>
      <button class="btn btn-secondary">📁 Repository</button>
      <button class="btn btn-secondary">🏥 Health</button>
    </div>
    <div class="grid-2">
      <div class="card"><h3>📊 Task Overview</h3><p>Active Tasks: ${project.tasks}<br>PRs: ${project.prs}</p></div>
      <div class="card"><h3>🧠 Project Memory</h3><p>Architecture decisions, known issues, and technical debt tracked here.</p></div>
    </div>
  </div>
</body>
</html>`;
}
