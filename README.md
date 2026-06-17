# ⚔️ Hades Army v0.2.1

**Multi-Agent AI Software Development Team**

Hades Army is a Cloudflare-based AI orchestration system that acts as a software development team inside your Telegram chat.

## 🏗️ Architecture v0.2.1

```
User (Telegram)
 ↓
Cloudflare Worker
 ↓
Orchestrator
 ├── Project Manager
 ├── Task Planner (Registry-driven)
 ├── Execution Coordinator
 └── Approval Handler
 ↓
Manager Agent → Google AI Studio (gemini-3-flash)
 ↓
Builder Agent → OpenRouter (qwen/qwen3-coder) → Patch
 ↓
Reviewer Agent → OpenRouter (deepseek/deepseek-v3.1) → PASS/FAIL
 ↓
GitHub: Blob → Tree → Commit → Ref → PR
 ↓
User Approval → Merge
 ↓
Memory Sync: D1 ↔ .hades/ ↔ KV
```

## ✅ v0.2.1 Changes

| Fix | Description |
|-----|-------------|
| #1 | Manager → Google AI Studio (provider: "google") |
| #2 | Builder → Registry-driven (no hardcoding) |
| #3 | Reviewer → Registry-driven (no hardcoding) |
| #4 | Task Planner → Registry-driven (no hardcoding) |
| #5 | Registry Validation — throws if config missing |
| #6 | Model Capability Validation — pattern matching per role |
| #7 | Single Source of Truth — only agents.config.ts defines models |
| #8 | Boot-Time Audit — /health endpoint validates all agents |
| #9 | Agent Metadata — capabilities, restrictions, temperature, maxTokens |

## 🚀 Quick Start

### Prerequisites
- Cloudflare account
- Telegram Bot (@BotFather)
- GitHub Personal Access Token
- OpenRouter API Key
- Google AI Studio API Key (for Manager)

### Setup

```bash
npm install

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put OPENROUTER_API_KEY
wrangler secret put GITHUB_TOKEN
wrangler secret put ENCRYPTION_KEY  # openssl rand -base64 32
wrangler secret put GOOGLE_AI_API_KEY  # Required for Manager

# Create D1 database in Dashboard, update wrangler.toml
# Create KV namespace in Dashboard, update wrangler.toml

# Run migrations
npm run db:migrate

# Deploy
npm run deploy

# Set webhook
GET https://your-worker.workers.dev/setup-webhook
```

## 📁 Project Structure

```
src/
├── worker.ts              # Entry point + Boot Audit
├── core/
│   ├── orchestrator.ts    # Request router
│   ├── workflow.ts        # State machine engine
│   └── managers/
│       ├── project.manager.ts
│       ├── task.planner.ts      # ← Registry-driven
│       ├── execution.coordinator.ts
│       └── approval.handler.ts
├── agents/
│   ├── builder.ts         # ← Registry-driven
│   ├── reviewer.ts        # ← Registry-driven
│   └── registry.ts        # ← Boot-time validation
├── services/
│   ├── llm.service.ts     # OpenRouter + Google AI Studio
│   ├── github.service.ts
│   ├── telegram.service.ts
│   ├── task.service.ts
│   └── prompt.service.ts
├── github/clients/
│   ├── base.client.ts
│   ├── repo.client.ts
│   ├── branch.client.ts
│   ├── pr.client.ts
│   └── commit.client.ts
├── memory/
│   ├── d1.client.ts
│   ├── kv.client.ts
│   └── hades.memory.ts
├── utils/
│   ├── crypto.ts
│   ├── logger.ts
│   ├── helpers.ts
│   └── patch-parser.ts
├── types/                 # All TypeScript types
├── config/
│   ├── env.ts
│   └── agents.config.ts   # ← SINGLE SOURCE OF TRUTH
└── database/schema.sql
```

## 🔒 Security
- GitHub tokens encrypted with AES-GCM
- All secrets via Cloudflare Worker secrets
- File locking prevents concurrent modifications
- No critical data in LLM context

## 📊 Task State Machine
```
CREATED → PLANNING → READY → BUILDING → REVIEWING → PR_CREATED → WAITING_APPROVAL → MERGED → COMPLETED
```

## 🔍 Boot-Time Audit

Visit `/health` to see real-time validation:

```json
{
  "status": "ok",
  "version": "0.2.1",
  "audit": [
    { "name": "manager config", "status": "pass", "message": "google / gemini-3-flash" },
    { "name": "builder config", "status": "pass", "message": "openrouter / qwen/qwen3-coder" },
    { "name": "reviewer config", "status": "pass", "message": "openrouter / deepseek/deepseek-v3.1" }
  ]
}
```

Built with ⚔️ by Hades Army
