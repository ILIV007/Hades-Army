# ⚔️ HADES ARMY v0.4 — COMPLETE SPECIFICATION DOCUMENT
# Generated from v0.2.1 codebase + v0.4 upgrade requirements
# Date: 2026-06-18
# Author: Ilya (ILIV007)

═══════════════════════════════════════════════════════════════════════════════
SECTION 0 — CURRENT ARCHITECTURE BASELINE (v0.2.1)
═══════════════════════════════════════════════════════════════════════════════

## File Structure (36 files)

src/
├── worker.ts                    # Entry point + Boot Audit
├── types/index.ts               # All TypeScript types
├── config/
│   ├── env.ts                   # Environment validation
│   └── agents.config.ts         # SINGLE SOURCE OF TRUTH — Agent Registry
├── agents/
│   ├── builder.ts               # Builder Agent (Registry-driven)
│   ├── reviewer.ts              # Reviewer Agent (Registry-driven)
│   └── registry.ts              # AgentRegistryService + KV persistence
├── core/
│   ├── orchestrator.ts          # Request router + Telegram handler
│   ├── workflow.ts              # State machine engine
│   └── managers/
│       ├── project.manager.ts   # Project CRUD + .hades init
│       ├── task.planner.ts      # Task planning (Registry-driven)
│       ├── execution.coordinator.ts  # Builder→Reviewer→GitHub pipeline
│       └── approval.handler.ts  # User approval/rejection handling
├── services/
│   ├── llm.service.ts           # OpenRouter + Google AI Studio
│   ├── github.service.ts        # Unified GitHub facade
│   ├── telegram.service.ts      # Telegram bot + progress UX
│   ├── task.service.ts          # Task CRUD + file locking
│   └── prompt.service.ts        # System prompts
├── github/clients/
│   ├── base.client.ts           # Auth + token cache
│   ├── repo.client.ts           # Repository scanning
│   ├── branch.client.ts         # Branch management
│   ├── pr.client.ts             # Pull requests
│   └── commit.client.ts         # Blob→Tree→Commit→Ref pipeline
├── memory/
│   ├── d1.client.ts             # D1 database operations
│   ├── kv.client.ts             # KV runtime state
│   ├── hades.memory.ts           # .hades/ repository memory
│   └── memory-sync.ts           # Transactional sync engine
├── utils/
│   ├── crypto.ts                # AES-GCM encryption
│   ├── logger.ts                # Structured logging
│   ├── helpers.ts               # Dangerous file detection + utilities
│   └── patch-parser.ts          # Unified diff parser
└── database/schema.sql          # D1 schema

## Current Agent Configuration

Manager    → Google AI Studio  → gemini-3-flash    → provider: "google"
Builder    → OpenRouter         → qwen/qwen3-coder  → provider: "openrouter"
Reviewer   → OpenRouter         → deepseek/deepseek-v3.1 → provider: "openrouter"

## Fixed Bugs (v0.2.1)
✅ BuilderAgent private config
✅ ReviewerAgent private config
✅ GitHubService mergeAndCleanup prNumber
✅ Workflow projectId hack removed
✅ Workflow retry → previous state
✅ MemorySyncEngine (sync + recovery + reconciliation)
✅ GitHub token cache
✅ Boot Audit on every start (blocks if fail)
✅ Builder dangerous file check (.env, wrangler.toml, etc.)
✅ Registry updateModel KV persistence

═══════════════════════════════════════════════════════════════════════════════
SECTION 1 — REPOSITORY CONNECTION WIZARD
═══════════════════════════════════════════════════════════════════════════════

## Current Flow (v0.2.1)
/newproject → name → repo_url → token → start

## Target Flow (v0.4)
/newproject
  STEP 1: Repository URL input
  STEP 2: Repository Validation (exists, reachable, branch, size, languages, files)
  STEP 3: Permission Validation (read, write, PR, branch creation)
  STEP 4: Repository Scan (file tree, README, dependencies)
  STEP 5: Manager Interview (goal, scope, priority, complexity, deadline, style, architecture, risk)
  STEP 6: Architecture Proposal (analysis, complexity score, estimated tasks, risks, recommendations, roadmap)
  STEP 7: User Approval (must approve before activation)
  STEP 8: Project Activation

## Implementation Files
- NEW: src/core/wizard/repository-wizard.ts
- NEW: src/core/wizard/steps/
  - validate-repo.step.ts
  - validate-permissions.step.ts
  - scan-repo.step.ts
  - manager-interview.step.ts
  - architecture-proposal.step.ts
- MODIFY: src/core/managers/project.manager.ts (add wizard integration)
- MODIFY: src/core/orchestrator.ts (add /newproject wizard flow)

## Telegram UX
Each step sends progress message with emoji:
🔍 Validating repository...
✅ Repository found: ILIVIR3-HUB
📊 Languages: TypeScript, React
📁 Files: 124
🔐 Checking permissions...
✅ Read: OK | Write: OK | PR: OK | Branch: OK
🧠 Manager interview starting...
📋 Question 1/8: What is the project goal?
[User replies]
...
📊 Architecture Proposal ready
[User approves]
🚀 Project activated!

═══════════════════════════════════════════════════════════════════════════════
SECTION 2 — MANAGER INTERVIEW SYSTEM
═══════════════════════════════════════════════════════════════════════════════

## Purpose
Prevent immediate project start. Manager must understand requirements before planning.

## Interview Questions (8 questions)
1. Project goal — What does this project do?
2. Expected scope — Features, pages, endpoints?
3. Priority — Speed vs Quality vs Cost?
4. Complexity estimation — Simple/Medium/Complex?
5. Deadline — Timeline expectations?
6. Coding style — Preferences, conventions?
7. Architecture preferences — Tech stack, patterns?
8. Risk tolerance — How much experimentation?

## Storage
Answers stored in:
- D1: project_interviews table
- .hades/interview.json (Repository Memory)
- KV: project:{id}:interview (fast access)

## Implementation
- NEW: src/core/managers/interview.manager.ts
- NEW: src/types/interview.types.ts
- MODIFY: src/services/prompt.service.ts (add interview prompts)

═══════════════════════════════════════════════════════════════════════════════
SECTION 3 — ARCHITECTURE PROPOSAL
═══════════════════════════════════════════════════════════════════════════════

## Trigger
After repository scan + interview completion.

## Manager Generates
1. Project Analysis — Summary of repo structure, tech stack, dependencies
2. Complexity Score — 1-10 based on file count, languages, dependencies
3. Estimated Task Count — Predicted number of tasks
4. Risks — Identified challenges
5. Architecture Recommendations — Suggested improvements
6. Implementation Roadmap — Phase-by-phase plan

## User Must Approve
If user rejects: return to interview or cancel.
If user approves: activate project.

## Storage
- .hades/architecture_proposal.json
- D1: architecture_proposals table

## Implementation
- NEW: src/core/managers/architecture.manager.ts
- NEW: src/types/architecture.types.ts

═══════════════════════════════════════════════════════════════════════════════
SECTION 4 — PROJECT DASHBOARD
═══════════════════════════════════════════════════════════════════════════════

## New Commands
/repos       — List all connected repositories with status
/project     — Show active project details
/project-health — Health analysis
/tasks       — List tasks with filters

## /repos Output
```
📁 Your Repositories

1. ILIVIR3-HUB
   Status: Active 🟢
   Tasks: 12 | PRs: 3 | Health: 94%

2. Hades-Army
   Status: Active 🟢
   Tasks: 8 | PRs: 1 | Health: 88%

3. Arkeen-Serpent
   Status: Paused 🟡
   Tasks: 0 | PRs: 0 | Health: N/A
```

## /project Output
```
📊 ILIVIR3-HUB

Tasks: 12 total
  🟢 Completed: 8
  🟡 In Progress: 3
  🔴 Failed: 1

Open PRs: 3
Recent Activity: 2h ago
Memory Health: ✅ Synced
Models: Manager(Gemini), Builder(Qwen), Reviewer(DeepSeek)
Repository Health: ✅ Protected branches, ✅ Default branch
```

## Implementation
- NEW: src/core/managers/dashboard.manager.ts
- MODIFY: src/core/orchestrator.ts (add dashboard commands)
- MODIFY: src/services/telegram.service.ts (formatting helpers)

═══════════════════════════════════════════════════════════════════════════════
SECTION 5 — PROJECT HEALTH SYSTEM
═══════════════════════════════════════════════════════════════════════════════

## Command: /project-health

## Metrics
1. Architecture Score — Code quality, structure, dependencies
2. Open Tasks — Count by state
3. Failed Tasks — Count + retry status
4. Repository Health — Protected branches, merge strategy, size
5. Memory Health — .hades/ sync status, D1 sync status
6. Agent Efficiency — Average tokens per task, success rate
7. Review Pass Rate — PASS vs FAIL ratio

## Output
```
🏥 Project Health Report

Architecture Score: 87/100
Open Tasks: 3 (Building: 1, Reviewing: 1, PR: 1)
Failed Tasks: 1 (Retry: 2/3)
Repository Health: ✅ Protected branches | ✅ Default branch
Memory Health: ✅ .hades synced | ✅ D1 synced
Agent Efficiency: 4.2k tokens/task | 92% success
Review Pass Rate: 85% (17 PASS / 3 FAIL)
```

## Implementation
- NEW: src/core/managers/health.manager.ts
- NEW: src/types/health.types.ts

═══════════════════════════════════════════════════════════════════════════════
SECTION 6 — ADAPTIVE MANAGER STRICTNESS
═══════════════════════════════════════════════════════════════════════════════

## Risk-Based Behavior

### Low Risk (auto-fast)
- README updates
- Comments
- Minor UI text
- Documentation
→ Fast workflow, minimal approvals, auto-merge if review passes

### Medium Risk (standard)
- UI features
- Refactors
- API updates
- Component additions
→ Standard workflow, requires review approval

### High Risk (strict)
- Authentication
- Database changes
- Payment logic
- Security headers
→ Additional review required, mandatory human approval

### Critical Risk (lockdown)
- Production secrets
- Security systems
- Database migrations
- Permission systems
→ Mandatory human approval, NO auto-merge, manual verification

## Risk Detection
Manager analyzes task description + affected files to determine risk level.

## Implementation
- NEW: src/core/managers/risk.manager.ts
- NEW: src/types/risk.types.ts
- MODIFY: src/core/managers/execution.coordinator.ts (add risk checks)
- MODIFY: src/core/managers/approval.handler.ts (add risk-based rules)

═══════════════════════════════════════════════════════════════════════════════
SECTION 7 — AGENT CONTRACT SYSTEM
═══════════════════════════════════════════════════════════════════════════════

## Purpose
Agents must NEVER exchange free-form text. All communication uses structured JSON contracts.

## Contract Types

### Manager → Builder
```json
{
  "version": "1.0",
  "taskId": "task-uuid",
  "goal": "Implement user authentication",
  "files": ["src/auth.ts", "src/middleware.ts"],
  "constraints": ["Use JWT", "No plain text passwords"],
  "acceptanceCriteria": ["Login works", "Logout works", "Token refresh works"],
  "riskLevel": "high",
  "priority": "critical",
  "deadline": "2026-06-20"
}
```

### Builder → Reviewer
```json
{
  "version": "1.0",
  "taskId": "task-uuid",
  "filesChanged": ["src/auth.ts", "src/middleware.ts"],
  "summary": "Added JWT authentication with refresh tokens",
  "patch": "diff --git a/src/auth.ts...",
  "tests": ["test/auth.test.ts"],
  "dependencies": ["jsonwebtoken"]
}
```

### Reviewer → Manager
```json
{
  "version": "1.0",
  "taskId": "task-uuid",
  "status": "PASS",
  "issues": [],
  "riskLevel": "medium",
  "recommendations": ["Add rate limiting"],
  "securityNotes": "Token expiration is 24h, consider shorter"
}
```

## Implementation
- NEW: src/contracts/
  - manager-builder.contract.ts
  - builder-reviewer.contract.ts
  - reviewer-manager.contract.ts
  - contract-validator.ts
- NEW: src/types/contracts.types.ts

═══════════════════════════════════════════════════════════════════════════════
SECTION 8 — CONTRACT VALIDATION
═══════════════════════════════════════════════════════════════════════════════

## Schema Validation
All agent outputs must pass JSON schema validation.

## On Invalid JSON
1. Reject output
2. Retry agent (with error feedback)
3. Log failure
4. Never continue with malformed contracts

## Validation Rules
- Required fields must exist
- Types must match (string, array, enum)
- taskId must match current task
- version must be supported
- riskLevel must be valid enum

## Implementation
- NEW: src/contracts/contract-validator.ts
- NEW: src/contracts/schemas/
  - manager-builder.schema.json
  - builder-reviewer.schema.json
  - reviewer-manager.schema.json

═══════════════════════════════════════════════════════════════════════════════
SECTION 9 — MEMORY SYSTEM IMPROVEMENTS
═══════════════════════════════════════════════════════════════════════════════

## Priority Hierarchy (official)
Repository Memory (.hades/) > D1 > KV

## Requirements
- Conflict Resolution — When sources disagree, D1 wins
- Recovery — Rebuild from D1 if .hades/ corrupted
- Reconciliation — Periodic sync checks
- Version Tracking — Track memory versions

## Worker Restart Safety
- Workflow must resume automatically
- No progress loss on restart
- KV stores active workflow state
- D1 stores persistent task state
- .hades/ stores project memory

## Implementation
- MODIFY: src/memory/memory-sync.ts (enhance with version tracking)
- MODIFY: src/memory/hades.memory.ts (add version tracking)
- MODIFY: src/memory/d1.client.ts (add version columns)
- MODIFY: src/memory/kv.client.ts (add workflow resume keys)

═══════════════════════════════════════════════════════════════════════════════
SECTION 10 — REPOSITORY INDEXING
═══════════════════════════════════════════════════════════════════════════════

## Purpose
Manager must NEVER load entire repository. Only relevant files enter context.

## Process
1. Repository Scan — Full tree scan (one-time)
2. Repository Index — Build searchable index
3. Relevant File Selection — Select files matching task
4. Context Construction — Build context from selected files

## Index Structure
```json
{
  "version": "1.0",
  "generatedAt": "2026-06-18",
  "files": [
    { "path": "src/auth.ts", "type": "source", "size": 2048, "module": "auth", "features": ["login", "jwt"] }
  ],
  "modules": [
    { "name": "auth", "files": ["src/auth.ts", "src/middleware.ts"], "dependencies": ["jsonwebtoken"] }
  ],
  "dependencies": [
    { "from": "src/auth.ts", "to": "src/middleware.ts", "type": "import" }
  ]
}
```

## Implementation
- NEW: src/indexing/
  - repository-indexer.ts
  - file-selector.ts
  - context-builder.ts
- NEW: src/types/indexing.types.ts

═══════════════════════════════════════════════════════════════════════════════
SECTION 11 — CONTEXT BUDGET MANAGEMENT
═══════════════════════════════════════════════════════════════════════════════

## Purpose
Prevent token explosion. Support repositories with thousands of files.

## Strategies
1. Prioritize Files — Most relevant first
2. Summarize History — Compress old context
3. Limit Context Size — Max tokens per request
4. Track Token Usage — Monitor and alert

## Budget Rules
- Manager: max 8k tokens (Gemini Flash)
- Builder: max 16k tokens (Qwen Coder)
- Reviewer: max 8k tokens (DeepSeek)
- Context budget: 60% of max tokens
- History budget: 20% of max tokens
- Response budget: 20% of max tokens

## Implementation
- NEW: src/context/
  - budget-manager.ts
  - file-prioritizer.ts
  - history-summarizer.ts
- NEW: src/types/context.types.ts

═══════════════════════════════════════════════════════════════════════════════
SECTION 12 — GITHUB HEALTH ANALYSIS
═══════════════════════════════════════════════════════════════════════════════

## Diagnostics
- Protected Branches — Check if main is protected
- Default Branch — Verify default branch exists
- Open PRs — Count and list
- Merge Strategy — Squash, rebase, merge
- Repository Size — Total size warning
- Branch Rules — Required reviews, CI checks

## Output
```
🔍 GitHub Health

Protected Branches: ✅ main protected
Default Branch: ✅ main
Open PRs: 3
Merge Strategy: squash
Repository Size: 2.4MB ✅
Branch Rules: ✅ 2 required reviews | ✅ CI checks
```

## Implementation
- NEW: src/github/health/
  - repo-health.checker.ts
- MODIFY: src/github/clients/repo.client.ts (add health methods)

═══════════════════════════════════════════════════════════════════════════════
SECTION 13 — TELEMETRY IMPROVEMENTS
═══════════════════════════════════════════════════════════════════════════════

## Rule: Telemetry must NEVER block workflow.

## On D1 Logging Failure
1. Log warning to console
2. Continue execution
3. Agent execution must not fail because analytics failed

## Implementation
- MODIFY: src/services/llm.service.ts (wrap telemetry in try/catch)
- MODIFY: src/utils/logger.ts (wrap D1 writes in try/catch)

═══════════════════════════════════════════════════════════════════════════════
SECTION 14 — BOOT VALIDATION
═══════════════════════════════════════════════════════════════════════════════

## On Worker Startup
Validate:
- Agent Registry — All agents configured
- Provider Registry — All providers accessible
- Models — Model names valid and reachable
- Environment Variables — All required present
- Secrets — All secrets set
- Database Connection — D1 reachable
- KV Connection — KV reachable

## Fail Early
If any validation fails, worker returns 503 with error details.

## Implementation
- MODIFY: src/worker.ts (enhance boot validation)
- MODIFY: src/config/agents.config.ts (add provider connectivity check)

═══════════════════════════════════════════════════════════════════════════════
SECTION 15 — REMAINING ARCHITECTURE FIXES
═══════════════════════════════════════════════════════════════════════════════

## Remove All Private Property Access Hacks
Replace `obj["privateProp"]` with proper getters or public APIs.

## Ensure registry.init()
AgentRegistryService.init() must be called before use.

## Implementation
- AUDIT: All files for private property access
- MODIFY: src/agents/registry.ts (ensure init called)
- MODIFY: src/core/orchestrator.ts (call registry.init() on startup)

═══════════════════════════════════════════════════════════════════════════════
SUCCESS CRITERIA (v0.4 Complete Checklist)
═══════════════════════════════════════════════════════════════════════════════

□ Repository Connection Wizard exists
□ Manager Interview exists
□ Architecture Proposal exists
□ Repository Dashboard exists
□ Project Health exists
□ Adaptive Manager exists
□ Agent Contracts exist
□ Schema Validation exists
□ Repository Indexing exists
□ Context Budget Management exists
□ Memory Recovery exists
□ GitHub Health exists
□ Boot Validation exists

═══════════════════════════════════════════════════════════════════════════════
NEW FILES TO CREATE (v0.4)
═══════════════════════════════════════════════════════════════════════════════

src/core/wizard/
  repository-wizard.ts
  steps/validate-repo.step.ts
  steps/validate-permissions.step.ts
  steps/scan-repo.step.ts
  steps/manager-interview.step.ts
  steps/architecture-proposal.step.ts

src/core/managers/
  interview.manager.ts
  architecture.manager.ts
  dashboard.manager.ts
  health.manager.ts
  risk.manager.ts

src/contracts/
  manager-builder.contract.ts
  builder-reviewer.contract.ts
  reviewer-manager.contract.ts
  contract-validator.ts
  schemas/
    manager-builder.schema.json
    builder-reviewer.schema.json
    reviewer-manager.schema.json

src/indexing/
  repository-indexer.ts
  file-selector.ts
  context-builder.ts

src/context/
  budget-manager.ts
  file-prioritizer.ts
  history-summarizer.ts

src/github/health/
  repo-health.checker.ts

src/types/
  interview.types.ts
  architecture.types.ts
  dashboard.types.ts
  health.types.ts
  risk.types.ts
  contracts.types.ts
  indexing.types.ts
  context.types.ts

═══════════════════════════════════════════════════════════════════════════════
MODIFY EXISTING FILES (v0.4)
═══════════════════════════════════════════════════════════════════════════════

src/core/orchestrator.ts
  - Add /newproject wizard flow
  - Add /repos, /project, /project-health, /tasks commands
  - Call registry.init() on startup

src/core/managers/project.manager.ts
  - Add wizard integration
  - Add interview storage
  - Add architecture proposal storage

src/services/prompt.service.ts
  - Add interview prompts
  - Add architecture proposal prompts
  - Add risk assessment prompts

src/services/telegram.service.ts
  - Add dashboard formatting
  - Add wizard step formatting
  - Add health report formatting

src/memory/memory-sync.ts
  - Add version tracking
  - Enhance conflict resolution

src/memory/hades.memory.ts
  - Add version tracking

src/memory/d1.client.ts
  - Add version columns
  - Add interview table
  - Add architecture_proposals table
  - Add project_health table

src/memory/kv.client.ts
  - Add workflow resume keys
  - Add wizard state keys

src/worker.ts
  - Enhance boot validation
  - Add provider connectivity checks

src/database/schema.sql
  - Add project_interviews table
  - Add architecture_proposals table
  - Add project_health table
  - Add versions to existing tables

═══════════════════════════════════════════════════════════════════════════════
END OF SPECIFICATION
═══════════════════════════════════════════════════════════════════════════════
