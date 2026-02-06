---
type: exploration
status: active
stratum: dev
created: "2026-01-25"
tags: [workflow, tmux, ttyd, dashboard]
---

# Workflow Dashboard

Dashboard for monitoring and managing development workflows.

**Full documentation:** `dev/workflow-operations.md`

## Quick Start

```bash
cd apps/workflow
pnpm dev
```

Open http://localhost:4000

---

## Features

### Dashboard (/)

- Slots with Claude status, ports, docker
- Workspaces with member details
- Unregistered Claude instances
- Orphan Docker containers
- Tmux session management

### Chat UI (/chat)

Real-time chat view for Claude Code sessions.

- SSE streaming for live updates
- Send messages via tmux
- LIVE indicator
- Auto-scroll

Access via slot card "Chat" button or directly:
```
/chat?project=/path/to/project&tmux=session-name
```

---

## Remote Access (tmux + ttyd)

Access Claude from phone or any browser.

```bash
# Install ttyd
brew install ttyd

# From dashboard: Click "+ New Session" → "Create + Web"
# Or manually:
tmux new -s my-session -c /path/to/project
ttyd -W -p 7681 tmux attach -t my-session &
```

Access: `http://YOUR-MAC-IP:7681`

---

## API Endpoints

| Endpoint | Method | What |
|----------|--------|------|
| `/api/slots` | GET | Slots, workspaces, Claude, Docker |
| `/api/tmux` | GET | Tmux sessions with ttyd status |
| `/api/tmux` | POST | Create, kill, start/stop ttyd |
| `/api/claude-session` | GET | List Claude JSONL sessions |
| `/api/claude-session/stream` | GET | SSE stream for session |

---

## MCP Server

Located at `mcp/server.ts`. Provides tools for Claude Code integration.

See `dev/workflow-operations.md` for full tool list.

---

## Architecture

```
apps/workflow/
├── src/app/
│   ├── page.tsx              # Dashboard
│   ├── chat/page.tsx         # Chat UI test page
│   └── api/
│       ├── slots/            # Slots, workspaces, Claude, Docker
│       ├── tmux/             # Tmux management
│       └── claude-session/   # JSONL sessions + SSE stream
├── src/components/
│   └── claude-chat.tsx       # Chat UI component
├── src/lib/
│   └── claude-jsonl.ts       # JSONL parser
└── mcp/
    └── server.ts             # MCP server
```
