/**
 * Hades Army v0.6 - Health Dashboard
 */

export function renderHealthDashboard(data: {
  overall: number;
  repositoryHealth: number;
  architectureHealth: number;
  memoryHealth: number;
  agentEfficiency: number;
  reviewSuccess: number;
  workflowStability: number;
  recommendations: Array<{ category: string; severity: string; message: string }>;
}): string {
  const getColor = (score: number) => score >= 80 ? '#10b981' : score >= 60 ? '#eab308' : '#ef4444';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Health - Hades Army</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .header { margin-bottom: 2rem; }
    .header h1 { font-size: 2rem; }
    .overall-score { text-align: center; margin: 2rem 0; }
    .score-circle { width: 150px; height: 150px; border-radius: 50%; border: 10px solid; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 0 auto; }
    .score-value { font-size: 2.5rem; font-weight: bold; }
    .score-label { font-size: 0.875rem; color: #888; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 2rem 0; }
    .metric-card { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 1.5rem; text-align: center; }
    .metric-card .value { font-size: 1.75rem; font-weight: bold; }
    .metric-card .label { color: #888; font-size: 0.875rem; margin-top: 0.5rem; }
    .recommendations { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 1.5rem; margin-top: 2rem; }
    .recommendations h3 { color: #667eea; margin-bottom: 1rem; }
    .rec-item { padding: 0.75rem; margin: 0.5rem 0; border-radius: 8px; background: #1a1a2e; }
    .rec-critical { border-left: 4px solid #ef4444; }
    .rec-high { border-left: 4px solid #f97316; }
    .rec-medium { border-left: 4px solid #eab308; }
    .rec-low { border-left: 4px solid #10b981; }
    .rec-category { font-size: 0.75rem; color: #667eea; text-transform: uppercase; }
    .rec-message { font-size: 0.875rem; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>🏥 System Health</h1></div>
    <div class="overall-score">
      <div class="score-circle" style="border-color: ${getColor(data.overall)}">
        <div class="score-value" style="color: ${getColor(data.overall)}">${data.overall}%</div>
        <div class="score-label">Overall Health</div>
      </div>
    </div>
    <div class="metrics">
      <div class="metric-card"><div class="value" style="color: ${getColor(data.repositoryHealth)}">${data.repositoryHealth}%</div><div class="label">Repository</div></div>
      <div class="metric-card"><div class="value" style="color: ${getColor(data.architectureHealth)}">${data.architectureHealth}%</div><div class="label">Architecture</div></div>
      <div class="metric-card"><div class="value" style="color: ${getColor(data.memoryHealth)}">${data.memoryHealth}%</div><div class="label">Memory</div></div>
      <div class="metric-card"><div class="value" style="color: ${getColor(data.agentEfficiency)}">${data.agentEfficiency}%</div><div class="label">Agent Efficiency</div></div>
      <div class="metric-card"><div class="value" style="color: ${getColor(data.reviewSuccess)}">${data.reviewSuccess}%</div><div class="label">Review Success</div></div>
      <div class="metric-card"><div class="value" style="color: ${getColor(data.workflowStability)}">${data.workflowStability}%</div><div class="label">Workflow Stability</div></div>
    </div>
    <div class="recommendations">
      <h3>💡 Recommendations</h3>
      ${data.recommendations.map(r => `<div class="rec-item rec-${r.severity}"><div class="rec-category">${r.category}</div><div class="rec-message">${r.message}</div></div>`).join('') || '<div class="rec-item rec-low"><div class="rec-message">No recommendations at this time.</div></div>'}
    </div>
  </div>
</body>
</html>`;
}
