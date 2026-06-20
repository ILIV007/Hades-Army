/**
 * Hades Army v0.6 - Project Wizard
 * 8-step repository connection wizard
 */

export function renderProjectWizard(step: number, data: Record<string, string> = {}): string {
  const steps = [
    { title: 'Repository URL', icon: '🔗' },
    { title: 'Validation', icon: '✅' },
    { title: 'Permissions', icon: '🔐' },
    { title: 'Repository Scan', icon: '🔍' },
    { title: 'Manager Interview', icon: '💬' },
    { title: 'Architecture Proposal', icon: '📐' },
    { title: 'Approval', icon: '👍' },
    { title: 'Activation', icon: '🚀' },
  ];

  const currentStep = steps[step - 1] || steps[0];
  const progress = ((step - 1) / steps.length) * 100;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Project - Hades Army</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.75rem; }
    .progress-bar { width: 100%; height: 8px; background: #1a1a2e; border-radius: 4px; margin: 1rem 0; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); border-radius: 4px; transition: width 0.3s; }
    .steps { display: flex; justify-content: space-between; margin: 1rem 0; }
    .step { text-align: center; font-size: 0.75rem; color: #888; }
    .step.active { color: #667eea; font-weight: 600; }
    .step.completed { color: #10b981; }
    .content { background: #0f0f1a; border: 1px solid #1a1a2e; border-radius: 12px; padding: 2rem; margin: 2rem 0; }
    .content h2 { color: #667eea; margin-bottom: 1rem; }
    .content p { color: #888; margin-bottom: 1.5rem; }
    input, textarea { width: 100%; padding: 0.75rem; border: 1px solid #2a2a4a; border-radius: 8px; background: #1a1a2e; color: #e0e0e0; font-size: 1rem; margin-bottom: 1rem; }
    input:focus, textarea:focus { outline: none; border-color: #667eea; }
    .actions { display: flex; justify-content: space-between; margin-top: 2rem; }
    .btn { padding: 0.75rem 1.5rem; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; color: white; }
    .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .btn-secondary { background: #1a1a2e; border: 1px solid #2a2a4a; }
    .proposal { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 1rem; font-family: monospace; font-size: 0.875rem; white-space: pre-wrap; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>➕ New Project</h1>
      <div class="progress-bar"><div class="progress-fill" style="width: ${progress}%"></div></div>
      <div class="steps">${steps.map((s, i) => `<div class="step ${i + 1 === step ? 'active' : i + 1 < step ? 'completed' : ''}">${s.icon}<br>${s.title}</div>`).join('')}</div>
    </div>
    <div class="content">
      <h2>${currentStep.icon} ${currentStep.title}</h2>
      ${getStepContent(step, data)}
    </div>
    <div class="actions">
      ${step > 1 ? '<button class="btn btn-secondary">← Back</button>' : '<div></div>'}
      ${step < 8 ? '<button class="btn btn-primary">Next →</button>' : '<button class="btn btn-primary">🚀 Activate</button>'}
    </div>
  </div>
</body>
</html>`;
}

function getStepContent(step: number, data: Record<string, string>): string {
  switch (step) {
    case 1:
      return `<p>Enter your GitHub repository URL to get started.</p>
      <input type="url" placeholder="https://github.com/username/repo" value="${data.repoUrl || ''}">`;
    case 2:
      return `<p>Validating repository access...</p>
      <div class="proposal">${data.validation || 'Checking repository...'}</div>`;
    case 3:
      return `<p>Checking GitHub token permissions...</p>
      <div class="proposal">${data.permissions || 'Checking permissions...'}</div>`;
    case 4:
      return `<p>Scanning repository structure...</p>
      <div class="proposal">${data.scan || 'Scanning files...'}</div>`;
    case 5:
      return `<p>What is the primary goal of this project?</p>
      <textarea rows="4" placeholder="Describe the project goals...">${data.goals || ''}</textarea>`;
    case 6:
      return `<p>Reviewing proposed architecture...</p>
      <div class="proposal">${data.proposal || 'Generating proposal...'}</div>`;
    case 7:
      return `<p>Do you approve the architecture proposal?</p>
      <div class="proposal">${data.proposal || 'No proposal yet'}</div>`;
    case 8:
      return `<p>Activating project...</p>
      <div class="proposal">Project is being activated. This may take a moment.</div>`;
    default:
      return '<p>Unknown step</p>';
  }
}
