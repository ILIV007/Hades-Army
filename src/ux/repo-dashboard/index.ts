/**
 * Hades Army v0.6 - Repository Dashboard
 */

export function renderRepoDashboard(data: {
  languages: Record<string, number>;
  fileCount: number;
  branches: string[];
  prs: number;
  architectureScore: number;
}): string {
  const langEntries = Object.entries(data.languages).sort((a, b) => b[1] - a[1]);
  const totalBytes = Object.values(data.languages).reduce((a, b) => a + b, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Repository - Hades Army</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .header { margin-bottom: 2rem; }
    .header h1 { font-size: 2rem; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .metric-card { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid #2a2a4a; border-radius: 12px; padding: 1.5rem; text-align: center; }
    .metric-card .value { font-size: 2rem; font-weight: bold; color: #667eea; }
    .metric-card .label { color: #888; font-size: 0.875rem; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    .card { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 1.5rem; }
    .card h3 { color: #667eea; margin-bottom: 1rem; }
    .lang-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 1rem 0; }
    .lang-segment { height: 100%; }
    .lang-legend { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 0.5rem; }
    .lang-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: #888; }
    .lang-dot { width: 10px; height: 10px; border-radius: 50%; }
    .branch-list { list-style: none; }
    .branch-list li { padding: 0.5rem 0; border-bottom: 1px solid #1a1a2e; color: #888; font-size: 0.875rem; }
    .branch-list li:last-child { border-bottom: none; }
    .score-ring { width: 120px; height: 120px; border-radius: 50%; border: 8px solid; display: flex; align-items: center; justify-content: center; margin: 0 auto; }
    .score-value { font-size: 1.5rem; font-weight: bold; }
    .score-label { font-size: 0.75rem; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>📁 Repository</h1></div>
    <div class="metrics">
      <div class="metric-card"><div class="value">${data.fileCount}</div><div class="label">Files</div></div>
      <div class="metric-card"><div class="value">${data.branches.length}</div><div class="label">Branches</div></div>
      <div class="metric-card"><div class="value">${data.prs}</div><div class="label">PRs</div></div>
      <div class="metric-card"><div class="value">${data.architectureScore}%</div><div class="label">Architecture</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>💻 Languages</h3>
        <div class="lang-bar">${langEntries.map(([lang, bytes]) => {
          const pct = (bytes / totalBytes * 100).toFixed(1);
          const colors = ['#3178c6', '#f7df1e', '#3572A5', '#e34c26', '#00ADD8', '#701516'];
          return `<div class="lang-segment" style="width: ${pct}%; background: ${colors[langEntries.indexOf([lang, bytes]) % colors.length]}"></div>`;
        }).join('')}</div>
        <div class="lang-legend">${langEntries.map(([lang, bytes]) => {
          const pct = (bytes / totalBytes * 100).toFixed(1);
          const colors = ['#3178c6', '#f7df1e', '#3572A5', '#e34c26', '#00ADD8', '#701516'];
          return `<div class="lang-item"><span class="lang-dot" style="background: ${colors[langEntries.indexOf([lang, bytes]) % colors.length]}"></span>${lang} ${pct}%</div>`;
        }).join('')}</div>
      </div>
      <div class="card">
        <h3>🌿 Branches</h3>
        <ul class="branch-list">${data.branches.map(b => `<li>🌿 ${b}</li>`).join('') || '<li>No branches</li>'}</ul>
      </div>
    </div>
  </div>
</body>
</html>`;
}
