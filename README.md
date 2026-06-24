# 🏛️⚔️ Hades Army

> **Autonomous AI Development Army - Cloudflare Workers Edition**

[![Version](https://img.shields.io/badge/version-0.8.0-blue.svg)](https://github.com/hades-army/hades-army)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Workers](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com)

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Development](#development)
- [Security](#security)
- [Monitoring](#monitoring)
- [Contributing](#contributing)

---

## 🎯 Overview

Hades Army is an autonomous AI development platform designed to run on Cloudflare Workers. It provides a complete ecosystem for managing AI agents, code reviews, approvals, memory management, and deployments — all serverless at the edge.

### Key Capabilities

- 🤖 **Multi-Agent System** — Builder, Reviewer, Analyzer, Tester, Deployer agents
- 🔍 **7-Stage Code Review** — Syntax, Security, Performance, Architecture, Style, Tests, Documentation
- ✅ **Approval Workflows** — Multi-level approval with escalation policies
- 🧠 **Memory Management** — Persistent storage with versioning and rollback
- 📊 **Real-time Monitoring** — Health checks, metrics, and alerting
- 🔐 **Security First** — Secret scanning, RBAC, audit logging
- ☁️ **Cloudflare Native** — D1, KV, R2, Workers AI, Queues, Cron Triggers

---

## ✨ Features

### Agent Management

| Agent Type | Role | Status |
|------------|------|--------|
| Builder | Code generation & file creation | ✅ Active |
| Reviewer | 7-stage code review pipeline | ✅ Active |
| Analyzer | Security & performance analysis | ✅ Active |
| Tester | Automated testing & validation | ✅ Active |
| Deployer | Deployment & release management | ✅ Active |

### API Endpoints

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/v1/agents` | GET, POST | List/create agents | Required |
| `/api/v1/agents/:id` | GET, PATCH, DELETE | Manage agent | Required |
| `/api/v1/reviews` | GET, POST | List/create reviews | Required |
| `/api/v1/approvals` | GET, POST | Approval requests | Required |
| `/api/v1/memory` | GET, POST | Memory entries | Required |
| `/api/v1/rollback` | GET, POST | Snapshots & rollback | Required |
| `/api/v1/prompts` | GET, POST | Prompt templates | Required |
| `/api/v1/health` | GET | Health checks | Public |
| `/metrics` | GET | Prometheus metrics | Public |
| `/webhook/telegram` | POST | Telegram bot webhook | Public |
| `/webhook/github` | POST | GitHub webhook | Public |

### Database Schema (15 Tables)

- `agents` — Agent registry
- `agent_tasks` — Task execution log
- `reviews` — Code review results
- `approval_requests` — Approval workflow
- `memory_entries` — Key-value storage
- `memory_versions` — Version history
- `rollback_snapshots` — System snapshots
- `rollback_operations` — Rollback audit
- `prompt_templates` — AI prompt library
- `scheduled_jobs` — Cron job definitions
- `jobs` — Background job queue
- `alerts` — Alert history
- `metrics` — Time-series data
- `config` — System configuration

---

## 🏗️ Architecture
