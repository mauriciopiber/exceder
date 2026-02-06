---
stratum: dev
type: exploration
status: archived
created: "2026-01-23"
superseded_by: dev/workflow-operations.md
tags:
  - workflow
  - tooling
  - parallel-development
---

# Slot System Specification

> **DEPRECATED:** This document is archived. Do NOT use as reference.
>
> **Use instead:** `dev/workflow-operations.md` (single source of truth)

## Overview

A slot system for parallel development across multiple projects. Each slot is a worktree with pre-configured resources (port, database, etc). Slots are created on demand, persist while active, and can be deleted when done.

## Core Concept

```
Slot = Physical environment (created on demand, any number 1-99)
Branch = Logical work (lives in the slot)
Ticket = Why you're there (tracking)
Number = Coordination key (same number across projects = related work)
```

**Mental model:** "I'm working in slot 32" — and if it touches dbt, I also have dbt-32.

## Why Numbered Slots

| Named Worktrees | Numbered Slots |
|-----------------|----------------|
| Name = work description | Number = workspace ID |
| Port assigned randomly | Port derived from number |
| No cross-project link | Same number = same task |
| Create/destroy each time | Create once, reuse until done |
| Env configured per creation | Env derived from number |

## Key Insight: Cross-Project Coordination

Working on PLAT-123 that touches both api and dbt?

```
ai-platform-32    → port 3032, db ai_platform_32
ai-platform-dbt-32 → port 4032, db dbt_32
```

The number **32** links them. No config needed. Pick a number, use it everywhere.

## Directory Structure

```
~/Projects/
├── ai-platform/              # Main repo
├── ai-platform-32/           # Slot 32 (working on PLAT-123)
├── ai-platform-7/            # Slot 7 (working on PLAT-456)
│
├── ai-platform-dbt/          # Main repo
├── ai-platform-dbt-32/       # Slot 32 (same task as ai-platform-32)
└── ai-platform-dbt-15/       # Slot 15 (independent dbt work)
```

**Naming convention:** `{project}-{slot_number}`

**Slot numbers:**
- Range: 1-99
- Not sequential — pick any number
- Same number across projects = related work
- Created on demand, deleted when done

## Registry

**Location:** `~/.config/slots/registry.json`

```json
{
  "version": 1,
  "projects": {
    "ai-platform": {
      "path": "~/Projects/ai-platform",
      "base_port": 3000
    },
    "ai-platform-dbt": {
      "path": "~/Projects/ai-platform-dbt",
      "base_port": 4000
    }
  },
  "slots": {
    "ai-platform-32": {
      "project": "ai-platform",
      "number": 32,
      "branch": "PLAT-123",
      "ticket": "PLAT-123",
      "created_at": "2026-01-23T10:00:00Z",
      "claude_pid": 12345
    },
    "ai-platform-7": {
      "project": "ai-platform",
      "number": 7,
      "branch": "PLAT-456",
      "ticket": "PLAT-456",
      "created_at": "2026-01-22T14:00:00Z",
      "claude_pid": null
    },
    "ai-platform-dbt-32": {
      "project": "ai-platform-dbt",
      "number": 32,
      "branch": "PLAT-123",
      "ticket": "PLAT-123",
      "created_at": "2026-01-23T10:30:00Z",
      "claude_pid": 12378
    }
  }
}
```

**Note:** Slots are stored flat, not nested under projects. This makes cross-project queries easier ("show me all slot 32s").

## Resource Allocation

Each slot gets resources derived from its number:

| Resource | Formula | Example (ai-platform, slot 32) |
|----------|---------|--------------------------------|
| Port | base_port + slot | 3032 |
| Database | {project}_{N} | ai_platform_32 |
| Redis prefix | {project}:{slot}: | ai-platform:32: |
| Docker project | {project}-{slot} | ai-platform-32 |

## Environment Injection

On slot creation, the system updates `.env` files in the worktree with slot-specific values.

**Template variables:**

```bash
# In any .env file, these placeholders get replaced:
SLOT_PORT      → 3032
SLOT_DB        → ai_platform_32
SLOT_REDIS     → ai-platform:32:
SLOT_NUMBER    → 32
```

**Example flow:**

1. Main repo has `.env.example`:
   ```bash
   PORT=${SLOT_PORT:-3000}
   DATABASE_URL=postgres://localhost/${SLOT_DB:-ai_platform_dev}
   ```

2. On `jg slot create ai-platform 32`, the system:
   - Creates worktree `ai-platform-32/`
   - Copies `.env.example` to `.env`
   - Replaces `${SLOT_PORT}` → `3032`
   - Replaces `${SLOT_DB}` → `ai_platform_32`

3. Result in `ai-platform-32/.env`:
   ```bash
   PORT=3032
   DATABASE_URL=postgres://localhost/ai_platform_32
   ```

**Multiple .env files:** If project has `.env`, `.env.local`, `.env.development`, all are processed.

## Slot Lifecycle

```
(not exists) → create → active → idle → active → ... → delete
                                   ↓
                                delete
```

**States:**

| State | Meaning |
|-------|---------|
| `active` | Claude running in slot |
| `idle` | Slot exists, no claude running |

Slots persist until explicitly deleted. Can sit idle indefinitely.

**Lifecycle commands:**

| Command | Action |
|---------|--------|
| `jg slot create {project} {N}` | Create worktree, inject env, register |
| `jg slot delete {project} {N}` | Confirm, remove worktree, unregister |
| `jg slot {project} {N} start` | Start claude in slot |

**Reuse pattern:** After merging PLAT-123 in slot 32:
1. Switch branch for new work: `jg slot ai-platform 32 branch PLAT-789`
2. Or delete if not needed: `jg slot delete ai-platform 32`
3. Or leave idle for later

## Commands

### View Commands

```bash
jg slots                    # List all slots, all projects
jg slots ai-platform        # List slots for specific project
jg slots 32                 # Show all slots numbered 32 (cross-project)
jg slots find PLAT-123      # Find which slot has this ticket
```

**Output format:**

```
SLOT                   TICKET    BRANCH     CLAUDE       AGE
ai-platform-32         PLAT-123  PLAT-123   ● running    3h
ai-platform-7          PLAT-456  PLAT-456   ○ idle       1d
ai-platform-dbt-32     PLAT-123  PLAT-123   ● running    3h
ai-platform-dbt-15     DBT-99    DBT-99     ○ idle       5d
```

**Legend:**
- `● running` — claude process detected in this directory
- `○ idle` — slot exists, no claude running

### Slot Management

```bash
jg slot create ai-platform 32           # Create slot, inject env
jg slot create ai-platform 32 PLAT-123  # Create + set ticket/branch
jg slot delete ai-platform 32           # Remove slot (confirms if dirty)
```

### Work Commands

```bash
jg slot ai-platform 32 start            # Start claude in slot
jg slot ai-platform 32 continue         # Resume claude with history
jg slot ai-platform 32 branch PLAT-789  # Switch to different ticket
jg slot ai-platform 32 sync             # Rebase on dev/main
```

### Project Setup

```bash
jg slot init ai-platform --base-port 3000
jg slot init ai-platform-dbt --base-port 4000
```

This registers the project in the registry with its base port. No slots are created yet — they're created on demand.

## Command Details

### `jg slot create {project} {N} [ticket]`

1. Check slot doesn't exist
2. Check project is registered
3. `git worktree add ../{project}-{N}` from main repo
4. If ticket provided: create branch, checkout
5. Process all `.env*` files — inject slot values
6. Create database if configured
7. Register slot in registry
8. Print slot info

### `jg slot delete {project} {N}`

1. Check slot exists
2. If uncommitted changes: confirm with user
3. `git worktree remove ../{project}-{N}`
4. Unregister from registry
5. Optionally: drop database, cleanup

### `jg slot {project} {N} start`

1. cd to slot directory
2. Start claude
3. Register claude PID in registry

### `jg slot {project} {N} branch {ticket}`

1. Fetch latest from origin
2. Create branch `{ticket}` from `dev` (or switch if exists)
3. Update registry with new ticket/branch

### `jg slot {project} {N} sync`

1. Fetch origin
2. Rebase current branch on dev (or main)
3. Report conflicts if any

## Branch Naming

**Convention:** Branch name = ticket

```
PLAT-123
DBT-45
```

Simple. The ticket tracker has the description. The slot number provides context (what's related). The branch just needs to identify the work.

## Claude Integration

### Starting Claude

```bash
jg slot ai-platform 32 start
# Equivalent to:
# cd ~/Projects/ai-platform-32 && claude
```

### Detecting Running Claude Instances

Claude Code runs as a node process. We can find all instances and their working directories:

```bash
# Find all claude processes with working directory
pgrep -f "claude" | while read pid; do
  cwd=$(lsof -p "$pid" 2>/dev/null | grep cwd | awk '{print $NF}')
  echo "$pid → $cwd"
done
```

**Example output:**

```
12345 → /Users/me/Projects/ai-platform-32
12378 → /Users/me/Projects/ai-platform-dbt-32
12456 → /Users/me/Projects/ai-platform-7
```

### Auto-Discovery

On `jg slots`, the system:

1. Reads registry for known slots
2. Scans for running claude processes (`pgrep -f claude`)
3. Gets working directory of each (`lsof -p PID | grep cwd`)
4. Matches directories to known slots
5. Updates registry with live PIDs
6. Clears stale PIDs (process no longer running)

This means even if you start claude manually (not via `jg slot start`), it gets detected.

### Checking Claude Status

```bash
jg slots
# Shows which slots have running claude (● vs ○)

jg slots --claude
# Only show slots with running claude

jg slots --count
# Just the count: "3 claude instances running"
```

### Tracking Claude

Registry stores `claude_pid`. Updated automatically by:
- `jg slot start` — records PID on start
- `jg slots` — auto-discovers and syncs PIDs
- Any command — validates PIDs still alive

## Terminal Setup

### iTerm2 (Recommended)

Install: `brew install --cask iterm2`

**Why iTerm2:**
- Split panes without tmux complexity
- Normal copy/paste works (unlike tmux)
- Native macOS integration

**Essential hotkeys:**

| Action | Hotkey |
|--------|--------|
| New tab | `Cmd+T` |
| Close tab/pane | `Cmd+W` |
| Split right | `Cmd+D` |
| Split down | `Cmd+Shift+D` |
| Switch pane | `Cmd+]` or `Cmd+[` |
| Switch tab | `Cmd+1/2/3` |

**Recommended layout:**

```
┌─────────────────────────────────────┐
│ Claude Code (main work)             │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ dev server (pnpm dev)               │
└─────────────────────────────────────┘
```

1. Open iTerm2
2. `Cmd+Shift+D` — split horizontal
3. Top pane: Claude Code
4. Bottom pane: dev server
5. `Cmd+]` to switch between them

**Match macOS Terminal appearance:**
1. `Cmd+,` (Settings) → Profiles → Text
2. Font: **Menlo** or **SF Mono**, size **11**
3. Profiles → Colors → Color Presets → **Light Background**

### Why NOT tmux

tmux has painful copy/paste on macOS. iTerm2 splits give the same benefit with native UX.

### Simple Alternative

If you don't want splits, just use tabs:
- Tab 1: Claude Code
- Tab 2: dev server
- `Cmd+1` / `Cmd+2` to switch

**Shell prompt shows slot info:**
```bash
ai-platform-32 (PLAT-123) $
```

## Edge Cases

### Delete slot with uncommitted work

Confirm prompt: "Slot has uncommitted changes. Delete anyway? [y/N]"

### Same ticket in multiple slots

Allowed. Common case: same ticket in ai-platform-32 and dbt-32.

### Claude dies unexpectedly

On `jg slots`, detect stale PIDs (process not running) and clear from registry.

### Slot number already taken

Error: "Slot ai-platform-32 already exists". Use different number or delete first.

### Branch already exists on remote

On `branch` command: fetch and checkout existing, or create fresh — user chooses.

### Cross-project slot coordination

`jg slots 32` shows all slots numbered 32 across projects. Makes it easy to see related work.

## Open Questions

1. **Base branch:** Should `branch` command base from `dev` or `main`? Make configurable per project?

2. **Database management:** Auto-create on slot create? Auto-drop on delete? Or manual?

3. **PR integration:** Separate command `jg slot ai-platform 32 pr`? Or part of workflow?

4. **Env template:** Should projects have `.env.slot.template` that defines which vars need slot injection?

5. **Slot number assignment:** Auto-suggest next available? Or always explicit?

6. **Cleanup command:** `jg slots cleanup` to delete all slots with merged branches?

## Implementation Plan

### Phase 1: Core

1. Registry format and location (`~/.config/slots/registry.json`)
2. `jg slot init {project} --base-port {N}` — register project
3. `jg slot create {project} {N}` — create worktree + env injection
4. `jg slot delete {project} {N}` — remove worktree
5. `jg slots` — list all slots

### Phase 2: Workflow

1. `jg slot {project} {N} branch {ticket}` — switch/create branch
2. `jg slot {project} {N} sync` — rebase on dev
3. `jg slot {project} {N} start/continue` — claude management
4. PID tracking and stale detection

### Phase 3: Polish

1. Shell prompt integration (show slot + ticket)
2. `jg slots {N}` — cross-project view
3. Database auto-create/drop
4. `jg slot {project} {N} pr` — create PR

## Web Dashboard (Future)

A Next.js dashboard for mission control over all Claude instances.

### Features

1. **View all slots** — directory, branch, model, runtime, last message
2. **Send messages** — type into any running Claude from the browser
3. **Session history** — read from `~/.claude/projects/` session files
4. **Slot management** — create, delete, switch branch from UI

### Architecture

```
Browser (localhost:3000)
    │
    ▼ GET /api/slots (list all)
    ▼ POST /api/slots/32/send (send message)
    │
Next.js API Routes
    │
    ▼ pgrep + lsof (detect instances)
    ▼ fs.read (parse session files)
    ▼ tmux send-keys (inject messages)
    │
tmux sessions (slot-1, slot-32, etc.)
    │
    ▼ Claude running inside each
```

### Requirements

- Claude sessions run inside tmux: `tmux new-session -d -s slot-32 "claude"`
- Next.js server running locally
- Session files readable from `~/.claude/projects/`

### Data Available from Running Claude

| Info | Source |
|------|--------|
| PID | `pgrep -f claude` |
| Directory | `lsof -p PID \| grep cwd` |
| Branch | `git -C dir branch --show-current` |
| Session slug | session jsonl (`slug` field) |
| Model | session jsonl (`model` field) |
| Runtime | `ps -p PID -o etime=` |
| Last user message | session jsonl (parse `type: user` entries) |
| TTY | `ps -p PID -o tty=` |

### Send Message Flow

```typescript
// POST /api/slots/[id]/send
const { message } = await req.json()
await exec(`tmux send-keys -t slot-${id} "${message}" Enter`)
```

### UI Concept

```
┌─────────────────────────────────────────────────────────┐
│  SLOT CONTROL                              localhost:3000│
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ● slot-32: ai-platform          ● slot-32: dbt        │
│    branch: normalization           branch: dbt-norm    │
│    opus-4-5 | 8m                   opus-4-5 | 22h      │
│    "can you fix the tests?"        "run the models"    │
│    [________________] [send]       [________________]   │
│                                                         │
│  ● slot-7: ai-platform           ○ slot-15: (idle)     │
│    branch: pdf-flow                                     │
│    "check the upload logic"        [start claude]      │
│    [________________] [send]                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Control all Claude instances from one browser tab.

---

## Example Session

```bash
# Register projects (one time)
$ jg slot init ai-platform --base-port 3000
$ jg slot init ai-platform-dbt --base-port 4000

# New ticket comes in: PLAT-123 (touches both repos)
$ jg slot create ai-platform 32 PLAT-123
✓ Created worktree ai-platform-32/
✓ Injected env: PORT=3032, DB=ai_platform_32
✓ Created branch PLAT-123

$ jg slot create ai-platform-dbt 32 PLAT-123
✓ Created worktree ai-platform-dbt-32/
✓ Injected env: PORT=4032, DB=dbt_32
✓ Created branch PLAT-123

# Start working
$ jg slot ai-platform 32 start
# Opens claude in ai-platform-32/

# Check what's running
$ jg slots 32
SLOT                   TICKET    BRANCH     CLAUDE    AGE
ai-platform-32         PLAT-123  PLAT-123   ● 12345   2h
ai-platform-dbt-32     PLAT-123  PLAT-123   ○         2h

# Done with PLAT-123, cleanup
$ jg slot delete ai-platform 32
✓ Removed ai-platform-32/

$ jg slot delete ai-platform-dbt 32
✓ Removed ai-platform-dbt-32/

# Later, reuse slot 32 for different work
$ jg slot create ai-platform 32 PLAT-789
✓ Created worktree ai-platform-32/
✓ Fresh start for PLAT-789
```
