---
stratum: dev
type: decision
status: active
created: "2026-01-25"
tags:
  - workflow
  - tooling
  - cli
  - jg
---

# Workflow Operations

Single source of truth for the `jg` CLI and workflow system.

---

## Overview

The workflow system provides parallel development environments using git worktrees. Two naming conventions exist:

| System | Naming | Use Case |
|--------|--------|----------|
| **Workspace** | `project-ws-name` | Named branches (features, explorations) |
| **Slot** | `project-N` | Numbered slots (tickets, cross-project work) |

**When to use which:**
- **Workspace**: One-off feature work, quick explorations
- **Slot**: Ticket-based work, multi-repo coordination (same number = same task)

---

## Installation

```bash
# Install just
brew install just

# Add to ~/.zshrc
alias jg="just --justfile ~/.config/just/justfile --working-directory ."
```

Justfile location: `~/.config/just/justfile`

---

## Workspace Commands

For named branches. Creates `project-ws-name/` directories.

| Command | Where | What |
|---------|-------|------|
| `jg workspace list` | anywhere | Show all worktrees |
| `jg workspace new <name>` | main repo | Create worktree + setup |
| `jg workspace start` | worktree | Fresh Claude session |
| `jg workspace continue` | worktree | Resume last session |
| `jg workspace done` | worktree | Merge to main + cleanup |
| `jg workspace pr` | worktree | Push + create PR |
| `jg workspace kill` | worktree | Delete without merge |
| `jg workspace docker up` | worktree | Start docker containers |
| `jg workspace docker down` | worktree | Stop docker containers |
| `jg workspace docker clone` | worktree | Clone DB from main |

### Workspace Workflow

```bash
# 1. Create (from main repo)
jg workspace new feature-name
# → Copies "cd /path" to clipboard

# 2. Open new tab
Cmd+T, Cmd+V, Enter

# 3. Start Claude
jg workspace start

# 4. Work... commit when done
git add . && git commit -m "done"

# 5. Merge back (from worktree)
jg workspace done
```

---

## Slot Commands

For numbered slots. Creates `project-N/` directories.

| Command | Where | What |
|---------|-------|------|
| `jg slot init <base_port>` | main repo | Register project with base port |
| `jg slot list` | anywhere | Show running Claude instances |
| `jg slot new [N]` | main repo | Create slot (auto-increments if no N) |
| `jg slot delete <N>` | main repo | Delete slot |
| `jg slot start` | slot dir | Fresh Claude session |
| `jg slot continue` | slot dir | Resume last session |
| `jg slot check [N]` | slot dir | Validate slot configuration |
| `jg slot docker up` | slot dir | Start docker containers |
| `jg slot docker down` | slot dir | Stop docker containers |
| `jg slot docker clone` | slot dir | Clone DB from main |

### Slot Workflow

```bash
# 1. Register project (one time)
jg slot init 4000

# 2. Create slot (from main repo)
jg slot new
# → Auto-assigns next number
# → Copies "cd /path" to clipboard

# 3. Open new tab
Cmd+T, Cmd+V, Enter

# 4. Start Claude
jg slot start

# 5. Work...

# 6. Delete when done
jg slot delete 1
```

### Port Allocation

Slots get deterministic ports based on project base port:

```
PORT         = base_port + slot_number
POSTGRES_PORT = 5432 + project_offset + slot_number
REDIS_PORT   = 6379 + project_offset + slot_number
```

Where `project_offset = (base_port - 3000) / 10`

Example for `realcraft` (base_port=4000), slot 1:
- PORT: 4001
- POSTGRES_PORT: 5433
- REDIS_PORT: 6380

### Cross-Project Coordination

Same slot number across projects = related work:

```
realcraft-1     → port 4001
ai-platform-1   → port 3001
```

Both working on the same ticket/task.

---

## Clean Command

Safe cleanup with pre-flight checks.

```bash
jg clean              # Dry run - shows what would happen
jg clean --do         # Execute safe cleanup
jg clean --do --force # Include unmerged branches
```

### Safety Checks

| Status | Meaning | Action |
|--------|---------|--------|
| **DIRTY** | Uncommitted changes | BLOCKED - won't delete |
| **UNPUSHED** | Commits not pushed | BLOCKED - won't delete |
| **UNMERGED** | Commits not in main | WARNING - needs --force |
| **CLEAN** | Merged, no changes | Safe to delete |

### What Gets Cleaned

- tmux sessions (without running Claude)
- Worktrees that pass safety checks
- Docker containers in cleaned worktrees

---

## Dashboard

Web UI for monitoring workflows.

```bash
cd apps/workflow && pnpm dev
# Open http://localhost:4000
```

### Features

- View all slots, workspaces, Claude instances
- Manage tmux sessions (create, kill, start web access)
- Docker container status
- Click slot → open chat UI

### Chat UI

Real-time chat view for Claude Code sessions.

```
http://localhost:4000/chat?project=/path/to/project&tmux=session-name
```

- SSE streaming for live updates
- Send messages via tmux integration
- LIVE indicator shows connection status

---

## Remote Access (tmux + ttyd)

Access Claude from phone or any browser.

### Setup

```bash
# 1. Install ttyd
brew install ttyd

# 2. Create tmux session
tmux new -s my-session -c /path/to/project

# 3. Start web access
ttyd -W -p 7681 tmux attach -t my-session &

# 4. Access from browser
# Local: http://localhost:7681
# Phone: http://YOUR-MAC-IP:7681
```

### From Dashboard

1. Click "+ New Session" in Tmux Sessions section
2. Enter name, click "Create + Web"
3. Access via the web URL shown

---

## MCP Tools

The workflow MCP server provides tools for Claude Code:

| Tool | What |
|------|------|
| `workflow_status` | Full status (slots, claudes, docker) |
| `list_claudes` | Running Claude instances |
| `list_containers` | Docker containers |
| `list_slots` | Registered slots |
| `list_workspaces` | Registered workspaces |
| `list_tmux_sessions` | Tmux sessions with ttyd status |
| `create_tmux_session` | Create session (optionally with ttyd) |
| `start_ttyd` | Enable web access for session |
| `send_to_tmux` | Send commands to session |
| `kill_tmux_session` | Kill session |

---

## Registry

Slot configuration stored at `~/.config/slots/registry.json`:

```json
{
  "projects": {
    "realcraft": {
      "base_port": 4000,
      "path": "/Users/.../realcraft"
    }
  },
  "slots": {
    "realcraft-1": {
      "project": "realcraft",
      "number": 1,
      "branch": "slot-1",
      "created_at": "2026-01-25T..."
    }
  }
}
```

---

## Files

| File | Purpose |
|------|---------|
| `~/.config/just/justfile` | CLI implementation |
| `~/.config/slots/registry.json` | Slot registry |
| `apps/workflow/` | Dashboard app |
| `apps/workflow/mcp/` | MCP server |

---

## Migration Notes

### From Old Docs

These docs are now superseded by this file:
- `dev/slot-system-spec.md` → Spec, now implemented
- `dev/2026-01/2026-01-16-parallel-agent-workflows.md` → Research, resolved
- `prompts/slot-validation.md` → Use `jg slot check` instead

### Command Changes

| Old (in docs) | Current (implemented) |
|---------------|----------------------|
| `jg slot create ai-platform 32` | `jg slot new 32` (simpler, auto-detects project) |
| Manual validation | `jg slot check` (built-in) |
