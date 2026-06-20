/**
 * Hades Army v0.6 - Task Dashboard
 */

export function renderTaskDashboard(task: {
  id: number;
  title: string;
  status: string;
  assignedAgent?: string;
  riskLevel: string;
  files?: string[];
  reviewStatus?: string;
}): string {
  const riskColor = task.riskLevel === 'critical' ? '#ef4444' : task.riskLevel === 'high' ? '#f97316' : task.riskLevel === 'medium' ? '#eab308' : '#10b981';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task #${task.id} - Hades Army</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem; }
    .header { margin-bottom: 2rem; }
    .header h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    .meta { display: flex; gap: 1rem; color: #888; font-size: 0.875rem; }
    .status-badge { padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .risk-indicator { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 0.5rem; }
    .actions { display: flex; gap: 1rem; margin: 2rem 0; }
    .btn { padding: 0.75rem 1.5rem; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; color: white; }
    .btn-success { background: #10b981; }
    .btn-danger { background: #ef4444; }
    .btn-secondary { background: #1a1a2e; border: 1px solid #2a2a4a; }
    .section { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
    .section h3 { color: #667eea; margin-bottom: 1rem; }
    .file-list { list-style: none; }
    .file-list li { padding: 0.5rem 0; border-bottom: 1px solid #1a1a2e; color: #888; }
    .file-list li:last-child { border-bottom: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔨 Task #${task.id}: ${task.title}</h1>
      <div class="meta">
        <span class="status-badge" style="background: ${getStatusColor(task.status)}">${task.status.toUpperCase()}</span>
        <span><span class="risk-indicator" style="background: ${riskColor}"></span>${task.riskLevel} Risk</span>
        ${task.assignedAgent ? `<span>👤 ${task.assignedAgent}</span>` : ''}
      </div>
    </div>
    <div class="actions">
      <button class="btn btn-secondary">📄 Show Diff</button>
      <button class="btn btn-success">✅ Approve</button>
      <button class="btn btn-danger">❌ Reject</button>
    </div>
    <div class="section">
      <h3>📁 Files</h3>
      <ul class="file-list">${task.files?.map(f => `<li>📄 ${f}</li>`).join('') || '<li>No files specified</li>'}</ul>
    </div>
    <div class="section">
      <h3>👀 Review Status</h3>
      <p>${task.reviewStatus || 'Pending review'}</p>
    </div>
  </div>
</body>
</html>`;
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: '#f59e0b', planning: '#3b82f6', building: '#8b5cf6',
    reviewing: '#06b6d4', approved: '#10b981', merged: '#059669',
    failed: '#ef4444', rolled_back: '#6b7280',
  };
  return colors[status] || '#6b7280';
}
