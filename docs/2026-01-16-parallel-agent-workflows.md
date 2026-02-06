---
date: 2026-01-16
created: "2026-01-16"
stratum: dev
type: exploration
status: archived
superseded_by: dev/workflow-operations.md
tags: [parallel-agents, workflow, tooling, claude-code]
---

# Parallel Agent Workflows

> **DEPRECATED:** This document is archived. Do NOT use as reference.
>
> **Use instead:** `dev/workflow-operations.md` (single source of truth)

## Question

How to run multiple Claude Code instances professionally from the terminal?

## Context

Working on multiple tasks simultaneously - bugs, features, refactors - without blocking. Need isolated environments to prevent conflicts.

---

## Core Concepts

### Workdir vs Agent

| Concept | What it is | Isolation of |
|---------|------------|--------------|
| **Workdir** | Where code lives | Files |
| **Agent** | Who does the work | Context/memory |

### Combinations

**Workdir alone (sequential):**
```
You (1 brain) switching between directories

workdir-1/  ←── you work here
workdir-2/  ←── then switch here

Sequential. One thing at a time.
```

**Multiple agents, same workdir (conflict):**
```
agent-1 ──┐
agent-2 ──┼──→ same directory  →  CONFLICT
agent-3 ──┘

Both edit the same file = chaos
```

**Multiple agents + multiple workdirs (parallel):**
```
agent-1 ──→ workdir-1/  ──→ feature A
agent-2 ──→ workdir-2/  ──→ bugfix B
agent-3 ──→ workdir-3/  ──→ refactor C

Parallel. No conflicts. Merge later.
```

### Why Both Are Needed

- **Workdir** = physical separation of code (3 copies of a document)
- **Agent** = separate worker with own brain/context (3 people)

One workdir + multiple agents = 3 people editing same doc = disaster
Multiple workdirs + one agent = 1 person switching copies = sequential
Multiple workdirs + multiple agents = 3 people, each own copy = true parallel

**Claude Squad combines both:**
- tmux → manages multiple agents (processes)
- git worktrees → gives each agent its own workdir (files)

---

## Research

### Conductor (GUI)

Mac app for parallel Claude Code instances.

**Features:**
- Isolated workspace copies per agent
- Checkpoints - auto-snapshots every turn, revert to any point
- Diff viewer with guided PR merge flow
- Scripts (setup/run/archive automation)
- MCP integration for external tools

**Limitation:** GUI-based, not terminal-native.

**Docs:** https://docs.conductor.build

---

### Claude Squad (Terminal)

Terminal-native orchestrator using tmux + git worktrees.

```bash
brew install claude-squad
cs
```

**How it works:**
- tmux creates isolated terminal sessions
- git worktrees isolate codebases per task
- TUI to manage all agents from one window

**Commands:**
| Key | Action |
|-----|--------|
| `n` | New session (auto-creates worktree) |
| `N` | New session with initial prompt |
| `Enter` | Attach to session |
| `Ctrl-q` | Detach (keeps running) |
| `s` | Commit & push |
| `c` | Checkout changes to main |
| `D` | Delete session + cleanup |

**GitHub:** https://github.com/smtg-ai/claude-squad

---

### DIY: Git Worktrees + direnv

Manual setup with full control.

```bash
# Create worktree
git worktree add ../project-feature -b feature

# Auto-environment per worktree (.envrc)
export PORT=$((3000 + RANDOM % 1000))
export DATABASE_URL="sqlite:./dev.db"
```

**Pros:** Full control, no dependencies
**Cons:** Manual management

---

### Official Anthropic Recommendations

From Claude Code Best Practices:

> "Some of the most powerful applications involve running multiple Claude instances in parallel"

**Patterns:**
1. Writer + Reviewer - One writes, another reviews
2. TDD Split - One writes tests, another implements
3. Scratchpad Communication - Agents share state via files
4. Git Worktrees - Lighter-weight than multiple checkouts

**Source:** https://www.anthropic.com/engineering/claude-code-best-practices

---

### Subagents Approach

Custom agents in `~/.claude/agents/`:

```markdown
# ~/.claude/agents/backend-engineer.md
---
name: Backend Engineer
---
You are a senior backend engineer...
```

Orchestrator spawns specialists in parallel, then sequential review.

**Source:** https://zachwills.net/how-to-use-claude-code-subagents-to-parallelize-development/

---

### Multi-Agent at Scale (10+ agents)

Requires:
- Meta-agent (task distributor)
- Redis queue
- Worker agents (specialized)
- File locking
- Monitoring dashboard

**Cost:** ~$2,000/month for continuous operation
**Advice:** Start with 2 agents before scaling

**Source:** https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da

---

## Environment Isolation

The real challenge with worktrees:

**Ports:** Dynamic via environment
```bash
export PORT=$((3000 + RANDOM % 1000))
```

**Database:** Per worktree
```bash
export DATABASE_URL="sqlite:./dev-${WORKTREE}.db"
```

**Docker:** Dynamic naming
```yaml
services:
  db:
    container_name: myapp-db-${WORKTREE:-main}
```

**direnv:** Auto-loads `.envrc` per directory

---

## CLI Tools Landscape

| Tool | Stars | Unique feature |
|------|-------|----------------|
| Claude Code | 27k | Docker sandboxing, subtasks |
| Aider | 12.9k | Repo maps, LSP integration |
| Codex CLI | 31.6k | Local with API key |
| Plandex | 14.2k | Million-token codebases |
| Goose | - | Fully on-machine |

---

## Hands-On Testing (2026-01-17)

### Claude Squad - NOT RECOMMENDED

Tested and found multiple issues:

1. **Error on startup:** "error capturing pane content: exit status 1"
   - Caused by Claude hooks in `~/.claude/settings.json`
   - Required `claude-squad reset` to fix

2. **Slow and laggy:** Long delay after first screen loads

3. **Copy/paste broken:** tmux copy mode is clunky
   - `Ctrl-b [` to enter copy mode
   - Complex navigation
   - `Shift+click` needed for system clipboard

4. **Orphaned state:** Worktrees and branches remain after crashes

**Verdict:** Too fragile for daily use. More friction than value.

---

### Conductor - NOT TESTED

GUI-based. Doesn't fit terminal-first workflow.

---

### Auto Tab Opening - macOS BLOCKS IT

Tried to auto-open terminal tabs for new worktrees.

**Problem:** macOS requires Accessibility permissions for any app to:
- Send keystrokes to other apps
- Click menus/buttons programmatically

**Options explored:**
1. Grant Terminal.app permission → Security risk (any script can control Mac)
2. Create dedicated app with limited permission → Still requires System Events access
3. iTerm2 has its own API → Would need to switch terminals

**Security consideration:** Real CVEs exist for TCC bypass:
- CVE-2025-43530 (VoiceOver bypass)
- CVE-2024-44133 (HM Surf)
- CVE-2024-54527 (MediaLibraryService)

**Decision:** Not worth the security tradeoff for automation.

---

## Final Solution: DIY Worktrees + Justfile (v1)

Simple, no dependencies, secure, self-contained.

### Setup

```bash
# Install just
brew install just

# Add alias to ~/.zshrc
alias jg="just --justfile ~/.config/just/justfile --working-directory ."
```

Global justfile at `~/.config/just/justfile`.

### Commands

| Command | Where | What |
|---------|-------|------|
| `jg workspace list` | anywhere | Show all worktrees |
| `jg workspace new <name>` | main repo | Create worktree, setup, copy cd |
| `jg workspace start` | worktree | Fresh Claude session |
| `jg workspace continue` | worktree | Resume last session |
| `jg workspace done` | worktree | Merge to main + cleanup |
| `jg workspace pr` | worktree | Push + create PR |
| `jg workspace kill` | worktree | Delete without merge |

**Self-contained:** Commands run from worktree auto-detect context. No need to specify name.

### Workflow

```bash
# 1. Create worktree (from main repo)
jg workspace new diet-calc
# → Creates ../realcraft-ws-diet-calc
# → Copies gitignored files (.env, credentials, tokens)
# → Installs dependencies (finds all pnpm-lock.yaml)
# → Copies "cd /path" to clipboard

# 2. Open new tab, paste, enter
Cmd+T, Cmd+V, Enter

# 3. Start Claude
jg workspace start

# 4. Work... commit when done
git add . && git commit -m "done"

# 5. Merge back (from worktree)
jg workspace done
# → Merges to main branch
# → Removes worktree
# → Deletes branch
```

### What `workspace new` Does

1. **Creates git worktree** with `-ws-` naming convention
2. **Copies gitignored files** (tokens, credentials, .env) - skips node_modules, backups, build artifacts
3. **Installs dependencies** - finds ALL pnpm-lock.yaml/package-lock.json and installs each
4. **Copies cd command** to clipboard

### Safety Checks

- `done` and `kill` check for uncommitted changes
- Require `--force` flag if worktree is dirty
- Prevents accidental data loss

### Naming Convention

```
realcraft-ws-diet-calc
    │      │     └── task name
    │      └── "ws" = worktree marker (easy to identify)
    └── project name
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Clipboard instead of auto-tab | macOS blocks automation without Accessibility permissions. Security > convenience. |
| `jg workspace start` separate | Allows `cd` to run first so Terminal tracks directory. New tabs then open in correct folder. |
| `start` vs `continue` split | Explicit control. `--continue` fails if no previous session. |
| Self-contained commands | Run `jg ws done` from worktree - no need to remember branch names. |
| Auto-copy gitignored files | Most projects need .env, credentials. Generic solution works everywhere. |
| Find all lock files | Monorepos have nested packages. Install in each location automatically. |
| Skip backups/node_modules | Only copy config files, not generated content. |

### Why This Works

- **No broken tools** - just git + terminal + just
- **No permissions** - clipboard is allowed, no System Events
- **No overhead** - no tmux monitoring, no daemon
- **Normal copy/paste** - regular terminal behavior
- **3 keystrokes** - Cmd+T, Cmd+V, Enter
- **Self-contained** - commands know their context

---

## What Didn't Work

| Approach | Why it failed |
|----------|---------------|
| Claude Squad | Fragile tmux integration, clunky copy/paste, orphaned state |
| Auto tab opening | macOS Accessibility permissions = security risk |
| Dedicated app for tabs | Still needs System Events permission |
| Combined `cd && claude` | Terminal loses directory context, new tabs open in wrong place |
| `.worktree-copy` config | Redundant if auto-copying gitignored files |

---

## Future Improvements (Level 2)

- [ ] `jg workspace status` - show diff summary for all worktrees
- [ ] `jg workspace sync` - pull latest from main into worktree
- [ ] Integration with git hooks for auto-cleanup
- [ ] Support for `--no-install` flag for quick worktrees

---

## Conclusion

The market tools (Conductor, Claude Squad) add complexity without proportional value. DIY approach with git worktrees + justfile shortcuts is simpler, more reliable, and more secure.

**Key insight:** The 3 keystrokes (Cmd+T, Cmd+V, Enter) are worth it to avoid granting Accessibility permissions. Security tradeoff favors manual tab opening.

**Status: RESOLVED - v1 COMPLETE**

---

## Sources

- https://docs.conductor.build
- https://github.com/smtg-ai/claude-squad
- https://www.anthropic.com/engineering/claude-code-best-practices
- https://simonwillison.net/2025/Oct/5/parallel-coding-agents/
- https://zachwills.net/how-to-use-claude-code-subagents-to-parallelize-development/
- https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da
- https://ona.com/stories/parallelize-claude-code
