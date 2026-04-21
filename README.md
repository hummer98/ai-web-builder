# AI Web Builder

[日本語版はこちら / Japanese](README.ja.md)

An AI-powered WYSIWYG website builder where the AI doesn't just generate code — it acts as a developer, editing a live site, verifying the result visually, and fixing its own mistakes.

## Why this exists

There's no shortage of AI website builders — v0, bolt.new, Lovable, and others all let you prompt your way to a website. So why build another one?

The core frustration with existing tools comes down to three things:

**1. You can't point at what you want to change.**

Chat-only tools (v0, bolt.new) force you to describe elements in words: "the second button in the hero section." GUI-only tools (Wix, Squarespace) give you drag-and-drop but hit a ceiling fast. AI Web Builder combines both — click an element in the live preview, then tell the AI what to do with it. The AI knows exactly which component and line of code you're referring to.

**2. AI generates code but doesn't verify it.**

Most AI code generators produce output and hope for the best. AI Web Builder runs a feedback loop after every edit: the AI takes a screenshot via Playwright, reads the browser console, checks server logs, and if something broke, fixes it automatically — up to 3 retries before asking for help. The user only sees working states.

**3. Your site is trapped in the platform.**

Wix sites live on Wix. Squarespace sites live on Squarespace. Even code-generating tools often lock you into their hosting or proprietary project formats. AI Web Builder outputs standard React + Hono source code, committed to a GitHub repository you own. `git clone` it and you have a normal project you can develop with any tool.

## How it works

```
Browser                              Fly.io Container
┌─────────────┐                     ┌──────────────────────────────────┐
│ Chat Panel  │── WebSocket ──────→ │ Agent Server (:8080)             │
│ + Preview   │                     │   ↓                              │
│   (iframe)  │                     │ OpenCode AI Engine (:4096)       │
│             │                     │   ├── Edits files                │
│  Click an   │                     │   ├── Playwright: screenshots,   │
│  element →  │                     │   │   console, visual verify     │
│  AI knows   │                     │   └── Log reader: cross-process  │
│  the exact  │                     │       error detection            │
│  component  │                     │   ↓                              │
│             │◄── HMR ────────────│ Vite (:5173) + Hono (:3000)     │
└─────────────┘                     └──────────────────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ↓                    ↓                    ↓
              GitHub               Cloudflare            OpenRouter
              (backup)          (production host)        (LLM API)
```

1. **You open the editor** — a Fly Machine starts automatically
2. **You click an element** in the preview — the Source Locator identifies the exact component and line
3. **You type a message** — "make this blue", "add a contact form", "make it responsive"
4. **The AI edits the code** — changes reflect instantly via HMR
5. **The AI verifies its work** — screenshot → console check → log check → auto-fix if broken
6. **You hit Publish** — deploys to Cloudflare Pages + Workers
7. **You close the tab** — the machine stops, billing stops

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| **Standard React + Hono output** | No proprietary format. `git clone` and you have a real project. |
| **1 container per user** | Each user gets a full dev environment (Vite, Hono, OpenCode). Expensive, but enables real HMR and AI-driven debugging. Not designed for scale — designed for quality. |
| **AI self-healing loop** | Static analysis → Playwright visual check → console/log check → auto-retry. Users should never see a broken screen. |
| **Click-to-select + chat** | Neither pure GUI nor pure chat. Click gives the AI spatial context; chat gives expressiveness. |
| **No templates** | The AI generates from scratch every time. Templates constrain; a good AI doesn't need them. |
| **GitHub as the source of truth** | Every AI edit is auto-committed. Full history, easy revert, no data loss. |

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Tailwind CSS |
| Backend | Hono (dev: Node.js / prod: Cloudflare Workers) |
| Database | Cloudflare D1 (SQLite-compatible) |
| AI Engine | [OpenCode](https://opencode.ai) server mode |
| LLM | Via OpenRouter (Gemini, GPT, Kimi, etc.) |
| Editing env | Fly.io (Machines + Volumes, auto start/stop) |
| Production | Cloudflare Pages + Workers |
| Git | GitHub App (`ai-web-builder[bot]`) for auto-commit |

## Repository structure

```
ai-web-builder/
├── editor/                 Editor UI (chat + iframe shell)
├── container/
│   ├── agent-server/       WebSocket ↔ OpenCode bridge
│   ├── log-reader-mcp/     Cross-process log reader (MCP server)
│   └── scaffold/           Initial files for new guest sites
├── e2e/                    Playwright E2E + demo scripts
├── docs/                   Architecture docs
├── Dockerfile
└── fly.toml
```

The builder edits a **separate guest repository** per user — a standard React + Hono project that lives on GitHub and deploys to Cloudflare.

## Local development

```bash
direnv allow    # Load secrets from .envrc
npm run dev     # Starts 4 processes in parallel:
                #   Agent Server     :8080
                #   opencode serve   :4096
                #   Vite dev server  :5173
                #   Hono dev server  :3000
```

## What this is NOT

- **Not a SaaS product.** Built for a specific set of users (friends who want websites), not for scale.
- **Not a template engine.** The AI generates everything from scratch.
- **Not a hosted IDE.** It's a WYSIWYG editor where the AI is the developer and the user is the creative director.

## License

MIT
