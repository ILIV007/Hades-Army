# ⚔️ Hades Army

**Multi-Agent AI Software Development Team**

Hades Army is a Cloudflare-based AI orchestration system that acts as a software development team inside your Telegram chat. It coordinates specialized AI agents (Manager, Builder, Reviewer) to analyze repositories, plan features, implement code, and create pull requests — all through a GPT-style conversational interface.

---

## 🏗️ Architecture

```
User (Telegram)
    ↓
Cloudflare Worker
    ↓
Manager Agent (Gemini 3 Flash)
    ↓
Builder Agent (Qwen3 Coder) → Patch
    ↓
Reviewer Agent (DeepSeek V3.1) → PASS/FAIL
    ↓
GitHub PR → User Approval → Merge
    ↓
Memory Update (.hades/)
```

---

## 🚀 Quick Start

### 1. Prerequisites

- Cloudflare account
- Telegram Bot (via @BotFather)
- GitHub Personal Access Token
- OpenRouter API Key

### 2. Setup

```bash
# Clone and install
git clone <repo>
cd hades-army
npm install

# Configure secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put OPENROUTER_API_KEY
wrangler secret put GITHUB_TOKEN
wrangler secret put ENCRYPTION_KEY  # Generate: openssl rand -base64 32

# Create D1 database
wrangler d1 create hades-db
# Update wrangler.toml with database_id

# Run migrations
npm run db:migrate

# Create KV namespace
wrangler kv:namespace create "HADES_KV"
# Update wrangler.toml with id

# Deploy
npm run deploy

# Set Telegram webhook
GET https://your-worker.your-subdomain.workers.dev/setup-webhook
```

### 3. Usage

In Telegram:

```
/newproject MyApp https://github.com/user/repo ghp_xxxxxxxx

Build a login page with JWT authentication
```

---

## 📁 Project Structure

```
src/
├── worker.ts              # Cloudflare Worker entry
├── core/
│   ├── manager.ts         # Manager Agent (coordination)
│   ├── workflow.ts        # State machine engine
│   └── orchestrator.ts    # Request router
├── agents/
│   ├── builder.ts         # Code implementation
│   ├── reviewer.ts        # Code review
│   └── registry.ts        # Agent configuration
├── services/
│   ├── llm.service.ts     # AI provider abstraction
│   ├── github.service.ts  # GitHub operations
│   ├── telegram.service.ts # Bot interface
│   ├── task.service.ts    # Task lifecycle
│   └── prompt.service.ts  # Prompt management
├── memory/
│   ├── d1.client.ts       # Operational database
│   ├── kv.client.ts       # Runtime state
│   └── hades.memory.ts    # Repository memory (.hades/)
├── github/
│   ├── repo.client.ts     # Repository access
│   ├── pr.client.ts       # Pull requests
│   └── branch.client.ts   # Branch management
├── database/
│   └── schema.sql         # D1 schema
├── types/
│   └── index.ts           # TypeScript definitions
├── config/
│   ├── env.ts             # Environment validation
│   └── agents.config.ts   # Agent registry
├── utils/
│   ├── crypto.ts          # Encryption utilities
│   ├── logger.ts          # Structured logging
│   └── helpers.ts         # General utilities
└── prompts/
    ├── manager.md         # Manager system prompt
    ├── builder.md         # Builder system prompt
    ├── reviewer.md        # Reviewer system prompt
    └── onboarding.md      # Onboarding prompt
```

---

## 🧠 Core Principles

1. **LLMs are workers, not truth** — Repository is the source of truth
2. **Every project owns its memory** — `.hades/` directory in each repo
3. **Controlled orchestration** — No agent talks directly to another
4. **Traceability** — Every action is logged and recoverable
5. **Security** — Secrets encrypted, no hardcoded credentials

---

## 📋 Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/newproject <name> <repo> <token>` | Create new project |
| `/projects` | List your projects |
| `/status` | Active project status |
| `/tasks` | List tasks |
| `/help` | Show help |

---

## 🔒 Security

- GitHub tokens encrypted with AES-GCM before storage
- All secrets via Cloudflare Worker secrets (never in code)
- No critical data in LLM context windows
- File locking prevents concurrent modifications

---

## 📊 Task State Machine

```
CREATED → PLANNING → READY → BUILDING → REVIEWING → PR_CREATED → WAITING_APPROVAL → MERGED → COMPLETED
```

Failure states: `FAILED`, `BLOCKED`, `CANCELLED`

---

## 🛣️ Roadmap

- [x] MVP Core Loop
- [ ] Reviewer Agent integration
- [ ] Advanced Workflow Engine
- [ ] Repository Scanner & Indexer
- [ ] File Locking System
- [ ] Model Usage Tracking
- [ ] Multi-project support
- [ ] GitLab support
- [ ] Team collaboration

---

Built with ⚔️ by Hades Army
