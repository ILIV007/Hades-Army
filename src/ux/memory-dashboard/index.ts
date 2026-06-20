/**
 * Hades Army v0.6 - Memory Dashboard
 */

export function renderMemoryDashboard(data: {
  projectGoals: string[];
  adrs: Array<{ number: string; title: string; status: string }>;
  knownIssues: string[];
  technicalDebt: Array<{ file: string; severity: string }>;
  futurePlans: string[];
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Memory - Hades Army</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .header { margin-bottom: 2rem; }
    .header h1 { font-size: 2rem; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    .card { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 1.5rem; }
    .card h3 { color: #667eea; margin-bottom: 1rem; }
    .card ul { list-style: none; }
    .card li { padding: 0.5rem 0; border-bottom: 1px solid #1a1a2e; color: #888; font-size: 0.875rem; }
    .card li:last-child { border-bottom: none; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem; }
    .badge-proposed { background: #f59e0b; color: black; }
    .badge-accepted { background: #10b981; color: white; }
    .badge-deprecated { background: #ef4444; color: white; }
    .severity-critical { color: #ef4444; }
    .severity-high { color: #f97316; }
    .severity-medium { color: #eab308; }
    .severity-low { color: #10b981; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>🧠 Project Memory</h1></div>
    <div class="grid-2">
      <div class="card">
        <h3>🎯 Project Goals</h3>
        <ul>${data.projectGoals.map(g => `<li>✓ ${g}</li>`).join('') || '<li>No goals defined</li>'}</ul>
      </div>
      <div class="card">
        <h3>📋 Architecture Decisions</h3>
        <ul>${data.adrs.map(adr => `<li>${adr.number}: ${adr.title} <span class="badge badge-${adr.status}">${adr.status}</span></li>`).join('') || '<li>No ADRs</li>'}</ul>
      </div>
      <div class="card">
        <h3>⚠️ Known Issues</h3>
        <ul>${data.knownIssues.map(i => `<li>• ${i}</li>`).join('') || '<li>No known issues</li>'}</ul>
      </div>
      <div class="card">
        <h3>🔧 Technical Debt</h3>
        <ul>${data.technicalDebt.map(d => `<li class="severity-${d.severity}">⚠️ ${d.file} (${d.severity})</li>`).join('') || '<li>No technical debt</li>'}</ul>
      </div>
      <div class="card" style="grid-column: 1 / -1;">
        <h3>🚀 Future Plans</h3>
        <ul>${data.futurePlans.map(p => `<li>→ ${p}</li>`).join('') || '<li>No future plans</li>'}</ul>
      </div>
    </div>
  </div>
</body>
</html>`;
}
