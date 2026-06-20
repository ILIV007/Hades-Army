/**
 * Hades Army v0.6 - Landing Page
 */

export function renderLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hades Army v0.6 - AI Software Engineering Team</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .hero { text-align: center; padding: 4rem 0; }
    .hero h1 { font-size: 3.5rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1rem; }
    .hero p { font-size: 1.25rem; color: #888; margin-bottom: 2rem; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5rem; margin: 3rem 0; }
    .stat-card { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid #2a2a4a; border-radius: 16px; padding: 1.5rem; text-align: center; }
    .stat-card .number { font-size: 2.5rem; font-weight: bold; color: #667eea; }
    .stat-card .label { color: #888; font-size: 0.875rem; margin-top: 0.5rem; }
    .actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; max-width: 600px; margin: 2rem auto; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 1rem 2rem; border-radius: 12px; border: none; font-size: 1rem; cursor: pointer; transition: all 0.3s; text-decoration: none; color: white; }
    .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .btn-secondary { background: #1a1a2e; border: 1px solid #2a2a4a; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3); }
    .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-top: 4rem; }
    .feature { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 1.5rem; }
    .feature h3 { color: #667eea; margin-bottom: 0.5rem; }
    .feature p { color: #888; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <h1>🏛️ Hades Army</h1>
      <p>AI Software Engineering Team — Architecture Intelligence, Failure Learning, Knowledge Graph</p>
      <div class="stats">
        <div class="stat-card"><div class="number" id="project-count">0</div><div class="label">Projects</div></div>
        <div class="stat-card"><div class="number" id="task-count">0</div><div class="label">Tasks</div></div>
        <div class="stat-card"><div class="number" id="review-count">0</div><div class="label">Reviews</div></div>
        <div class="stat-card"><div class="number" id="health-score">98%</div><div class="label">System Health</div></div>
      </div>
      <div class="actions">
        <a href="/projects" class="btn btn-primary">📂 Projects</a>
        <a href="/new-project" class="btn btn-primary">➕ New Project</a>
        <a href="/health" class="btn btn-secondary">📊 Health</a>
        <a href="/settings" class="btn btn-secondary">⚙️ Settings</a>
      </div>
    </div>
    <div class="features">
      <div class="feature"><h3>🧠 Repository Intelligence</h3><p>Deep analysis of dependencies, architecture patterns, hotspots, and technical debt.</p></div>
      <div class="feature"><h3>📋 Architecture Memory</h3><p>ADR system preserves architectural decisions forever. Never lose context.</p></div>
      <div class="feature"><h3>🔄 Failure Learning</h3><p>Learns from past mistakes. Prevents recurring errors automatically.</p></div>
    </div>
  </div>
  <script>
    fetch('/api/stats').then(r => r.json()).then(data => {
      if (data.projects) document.getElementById('project-count').textContent = data.projects;
      if (data.tasks) document.getElementById('task-count').textContent = data.tasks;
      if (data.reviews) document.getElementById('review-count').textContent = data.reviews;
    });
  </script>
</body>
</html>`;
}
