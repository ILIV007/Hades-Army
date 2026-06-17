# ⚔️ Hades Army v0.2

**Multi-Agent AI Software Development Team**

Hades Army is a Cloudflare-based AI orchestration system that acts as a software development team inside your Telegram chat.

## 🏗️ Architecture v0.2

```
User (Telegram)
    ↓
Cloudflare Worker
    ↓
Orchestrator
    ├── Project Manager
    ├── Task Planner
    ├── Execution Coordinator
    └── Approval Handler
    ↓
Manager Agent (Gemini 3 Flash)
    ↓
Builder Agent (Qwen3 Coder) → Patch
    ↓
Reviewer Agent (DeepSeek V3.1) → PASS/FAIL
    ↓
GitHub: Blob → Tree → Commit → Ref → PR
    ↓
User Approval → Merge
    ↓
Memory Sync: D1 ↔ .hades/ ↔ KV
```

## 🚀 Quick Start

### Prerequisites
- Cloudflare account
- Telegram Bot (@BotFather)
- GitHub Personal Access Token
- OpenRouter API Key

### Setup

```bash
npm install

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put OPENROUTER_API_KEY
wrangler secret put GITHUB_TOKEN
wrangler secret put ENCRYPTION_KEY  # openssl rand -base64 32

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
├── worker.ts                    # Entry point
├── core/
│   ├── orchestrator.ts          # Request router
│   ├── workflow.ts              # State machine engine
│   └── managers/
│       ├── project.manager.ts   # Project CRUD
│       ├── task.planner.ts      # Task decomposition
│       ├── execution.coordinator.ts  # Build→Review→PR
│       └── approval.handler.ts  # User approval
├── agents/
│   ├── builder.ts               # Patch generation
│   ├── reviewer.ts              # PASS/FAIL
│   └── registry.ts              # Dynamic config
├── services/
│   ├── llm.service.ts           # AI + telemetry
│   ├── github.service.ts        # Unified facade
│   ├── telegram.service.ts      # Live progress
│   ├── task.service.ts          # Lifecycle + locks
│   └── prompt.service.ts        # Prompts
├── github/clients/
│   ├── base.client.ts           # Shared auth
│   ├── repo.client.ts           # Repository
│   ├── branch.client.ts         # Branches
│   ├── pr.client.ts             # Pull requests
│   └── commit.client.ts         # Blob→Tree→Commit
├── memory/
│   ├── d1.client.ts             # Operational DB
│   ├── kv.client.ts             # Runtime state
│   └── hades.memory.ts          # .hades/ sync
├── utils/
│   ├── crypto.ts                # AES-GCM
│   ├── logger.ts                # Structured logging
│   ├── helpers.ts               # Utilities
│   └── patch-parser.ts          # Real diff parser
├── types/                       # All TypeScript types
├── config/                      # Environment + agents
└── database/schema.sql          # D1 schema
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

Built with ⚔️ by Hades Army
