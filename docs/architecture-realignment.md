# Hades Army v0.8.5 — Architecture Realignment

This document describes how the v0.8.5 update realigns Hades Army with the original architecture vision, without modifying any v0.8.0 code.

## Principles

1. **Additive only** — All v0.8.5 features are new files. No existing file is edited.
2. **Manager is the single source of control** — Builder and Reviewer never touch GitHub.
3. **Repository Memory is the highest authority** — `.hades/` overrides D1 overrides KV.
4. **Registry controls all models** — No agent has a hardcoded model.
5. **GitHub is the workflow center** — No project starts without repository onboarding.
6. **Telegram feels like a platform** — Menus, wizards, dashboards — not commands.

## Memory Hierarchy

```
┌─────────────────────────────────────┐
│  Repository Memory (.hades/)        │  ← source of truth
│  - project.json                     │
│  - architecture.md                  │
│  - roadmap.md                       │
│  - decisions.md                     │
│  - tasks/ reviews/ failures/        │
│  - knowledge/ metrics/              │
└──────────────┬──────────────────────┘
               │ (falls back to)
               ▼
┌─────────────────────────────────────┐
│  D1 (project database)              │  ← structured tables
│  - workflows, agent_messages,       │
│    github_audit_log, cost_records,  │
│    onboarding_sessions, ...         │
└──────────────┬──────────────────────┘
               │ (falls back to)
               ▼
┌─────────────────────────────────────┐
│  KV (ephemeral cache)               │  ← fast lookups
│  - cost-tracker:log                 │
│  - agent-metrics:summary            │
│  - repo-memory:<project>:<path>     │
└─────────────────────────────────────┘
```

## Agent Roles

### Manager (`src/orchestration/manager-controller.ts`)
**Owns:**
- Project planning
- Task decomposition
- Context distribution (to Builder / Reviewer)
- Risk assessment
- Cost monitoring
- Memory updates
- Agent assignment
- Approval requests
- GitHub operations (sole authority)

**Model:** `google/gemini-3-flash` (default, via Model Registry)

### Builder (`src/agents/builder.ts` — UNCHANGED from v0.8.0)
**Does:**
- Receives `ManagerToBuilder` message
- Produces patch using provided context only
- Returns patch to Manager

**Does NOT:**
- Touch GitHub
- Read repository directly
- Update memory

**Model:** `openrouter/qwen/qwen3-coder` (default, via Model Registry)

### Reviewer (`src/agents/reviewer.ts` — UNCHANGED from v0.8.0)
**Does:**
- Receives `BuilderToReviewer` message (forwarded by Manager)
- Runs 7-stage validation pipeline
- Returns verdict to Manager

**Does NOT:**
- Touch GitHub
- Read repository directly
- Update memory

**Model:** `openrouter/deepseek/deepseek-chat` (default, via Model Registry)

## Workflow

```
User Request
   ↓
Manager Analysis       (Gemini 3 Flash)
   ↓
Repository Analysis    (Scanner + .hades/ memory)
   ↓
Task Planning          (decompose into atomic tasks)
   ↓
Builder Assignment     (ManagerToBuilder message)
   ↓
Patch Generation       (Qwen3 Coder)
   ↓
Reviewer Validation    (DeepSeek, 7-stage pipeline)
   ↓
Manager Decision       (proceed | replan | abort)
   ↓
GitHub PR              (Manager-only, with pre-PR secret scan)
   ↓
User Approval          (Telegram inline button)
   ↓
Merge + .hades/ update
```

## File Inventory

### v0.8.0 baseline (UNMODIFIED — 64 files)
See `src/agents/`, `src/api/`, `src/approval/`, `src/core/`, `src/database/`, `src/integrations/`, `src/memory/manager.ts`, `src/memory/runtime.ts`, `src/memory/versioning.ts`, `src/middleware/`, `src/monitoring/alerts.ts`, `src/monitoring/health.ts`, `src/monitoring/metrics.ts`, `src/monitoring/service.ts`, `src/prompts/`, `src/rollback/`, `src/scheduler/`, `src/security/audit.ts`, `src/security/manager.ts`, `src/security/permissions.ts`, `src/security/secret-scanner.ts`, `src/types/index.ts`, `src/utils/`, `src/workers/manager.ts`, `tests/`, root configs.

### v0.8.5 additions (NEW — 15 files)
- `src/orchestration/` — 4 files
- `src/registry/` — 5 files (incl. providers/)
- `src/memory/repository-memory.ts`, `repository-scanner.ts`, `onboarding.ts`
- `src/github/` — 2 files
- `src/telegram/` — 7 files
- `src/monitoring/cost-tracker.ts`, `agent-metrics.ts`
- `src/security/repo-secret-scanner.ts`
- `config/model-registry.json`
- `sql/v0.8.5-additions.sql`
- `docs/v0.8.5-changelog.md`, `architecture-realignment.md`

## Future Refactor (NOT in v0.8.5)

The current structure is acceptable. Future refactor may move:
- `application/` — business logic
- `orchestration/` — workflow coordination
- `domain/` — entity models
- `infrastructure/` — DB / KV / external integrations

This refactor is deferred to v0.9.0.
