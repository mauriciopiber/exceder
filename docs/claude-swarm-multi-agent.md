---
stratum: guiding
type: guide
status: active
created: "2026-02-03"
tags:
  - claude-code
  - multi-agent
  - swarm
  - tmux
  - orchestration
  - parallel
---

# Claude Code Swarm / Multi-Agent Patterns

Run multiple Claude Code instances in parallel, each with isolated context, coordinating via shared tasks.

## Why Multi-Agent?

**Problem:** Single Claude session accumulates context, degrades over time.

**Solution:** Spawn specialized agents, each with fresh context. Orchestrator stays lean.

```
Orchestrator (main context)
    │
    ├─→ Agent 1 (isolated) → summary back
    ├─→ Agent 2 (isolated) → summary back
    └─→ Agent 3 (isolated) → summary back
```

Like microservices for AI — bounded context, single responsibility, API contracts (summaries).

---

## Two Approaches

| Approach | Stability | Control | Setup |
|----------|-----------|---------|-------|
| **Native Swarm** (TeammateTool) | Experimental | Full integration | Requires unlock |
| **DIY tmux + worktrees** | Stable | Maximum control | Uses existing tools |

---

## Option 1: Native Swarm (Experimental)

### Enable Feature-Flagged Swarm

```bash
npx @realmikekelly/claude-sneakpeek quick --name claudesp
```

Creates unlocked Claude Code at `~/.claude-sneakpeek/claudesp/`

### Set tmux Backend

```bash
export CLAUDE_CODE_SPAWN_BACKEND=tmux
```

### Spawn Backends

| Backend | Visibility | Persistence |
|---------|------------|-------------|
| `in-process` | Hidden | Dies with leader |
| `tmux` | Visible panes | Survives exit |
| `iterm2` | Split panes (macOS) | Dies with window |

### TeammateTool Operations

| Operation | Purpose |
|-----------|---------|
| `spawnTeam` | Create team with leader |
| `write` | Message specific teammate |
| `broadcast` | Message all teammates |
| `requestShutdown` | Ask teammate to exit |
| `approveShutdown` | Confirm exit |
| `approvePlan` / `rejectPlan` | Plan approval workflow |

### Communication

Agents communicate via JSON inbox files:

```
~/.claude/teams/{team-name}/messages/{session-id}/
    ├── agent-1-inbox.json
    ├── agent-2-inbox.json
    └── agent-3-inbox.json
```

Message types: `text`, `task_completed`, `plan_approval_request`, `shutdown_request`, `join_request`

### Environment Variables

```bash
CLAUDE_CODE_TEAM_NAME=my-project
CLAUDE_CODE_AGENT_ID=worker-1
CLAUDE_CODE_AGENT_TYPE=backend
CLAUDE_CODE_SPAWN_BACKEND=tmux
```

---

## Option 2: DIY with tmux + Worktrees

Use existing jg tooling for a stable, controlled multi-agent setup.

### Architecture

```
You (orchestrator)
    │
    ├─→ tmux:task-1 → claude in slot-1 → feature A
    ├─→ tmux:task-2 → claude in slot-2 → bug fix B
    └─→ tmux:task-3 → claude in slot-3 → research C

Shared coordination:
~/.claude-swarm/{project}/
    ├── tasks.json
    ├── agent-1-status.txt
    ├── agent-2-status.txt
    └── results/
```

### Setup

```bash
# Create slots (isolated worktrees with port allocation)
jg slot new 1
jg slot new 2
jg slot new 3

# Create coordination directory
mkdir -p ~/.claude-swarm/my-project/results
```

### Spawn Agents

```bash
# Agent 1: Feature work
tmux new-session -d -s agent-1 \
  "cd ~/Projects/my-project-1 && claude -p 'Work on auth feature. When done, write summary to ~/.claude-swarm/my-project/results/agent-1.md and echo DONE to ~/.claude-swarm/my-project/agent-1-status.txt'"

# Agent 2: Bug fix
tmux new-session -d -s agent-2 \
  "cd ~/Projects/my-project-2 && claude -p 'Fix login bug. When done, write summary to ~/.claude-swarm/my-project/results/agent-2.md and echo DONE to ~/.claude-swarm/my-project/agent-2-status.txt'"

# Agent 3: Research
tmux new-session -d -s agent-3 \
  "cd ~/Projects/my-project-3 && claude -p 'Research caching strategies. Write findings to ~/.claude-swarm/my-project/results/agent-3.md and echo DONE to ~/.claude-swarm/my-project/agent-3-status.txt'"
```

### Monitor

```bash
# Check status
cat ~/.claude-swarm/my-project/agent-*-status.txt

# Watch specific agent
tmux attach -t agent-1

# Capture agent output without attaching
tmux capture-pane -t agent-1 -p | tail -30

# List all agent sessions
tmux list-sessions
```

### Collect Results

```bash
# Check completed work
ls ~/.claude-swarm/my-project/results/

# Read summaries
cat ~/.claude-swarm/my-project/results/*.md
```

### Cleanup

```bash
# Kill agent sessions
tmux kill-session -t agent-1
tmux kill-session -t agent-2
tmux kill-session -t agent-3

# Merge worktrees back to main
cd ~/Projects/my-project
git merge slot-1
git merge slot-2
git merge slot-3

# Or use jg
jg slot delete 1
jg slot delete 2
jg slot delete 3
```

---

## Task Board Pattern

For more structured coordination, use a shared task file:

### tasks.json

```json
{
  "tasks": [
    {
      "id": 1,
      "subject": "Implement auth",
      "status": "in_progress",
      "owner": "agent-1",
      "blockedBy": []
    },
    {
      "id": 2,
      "subject": "Add API endpoint",
      "status": "pending",
      "owner": null,
      "blockedBy": [1]
    },
    {
      "id": 3,
      "subject": "Write tests",
      "status": "pending",
      "owner": null,
      "blockedBy": [1, 2]
    }
  ]
}
```

### Agent Instructions

Include in agent prompt:
```
Check ~/.claude-swarm/my-project/tasks.json for your task.
When done:
1. Update task status to "completed"
2. Write summary to results/task-{id}.md
3. Echo DONE to agent-{n}-status.txt
```

---

## Orchestration Patterns

### 1. Parallel Specialists

**All agents work simultaneously on independent parts.**

```
                    You
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   Frontend      Backend       Tests
   Agent         Agent         Agent
        │            │            │
        ▼            ▼            ▼
   UI changes    API code     Test suite
        │            │            │
        └────────────┴────────────┘
                     │
                  Merge all
```

**When to use:**
- Feature touches multiple layers (UI, API, DB)
- Changes are independent (no blocking dependencies)
- You want speed

**Example task:**
> "Add user profile page"
> - Agent 1: Build ProfilePage.tsx component
> - Agent 2: Build /api/profile endpoint
> - Agent 3: Write tests for both

---

### 2. Pipeline

**Sequential stages — each waits for the previous.**

```
Research Agent
      │
      ▼ findings.md
      │
Implementation Agent
      │
      ▼ code changes
      │
Review Agent
      │
      ▼ approved / feedback
```

**When to use:**
- Later work depends on earlier work
- You need research before implementation
- Quality gates (review before merge)

**Example task:**
> "Optimize database queries"
> 1. Research Agent: Profile queries, identify slow ones, write report
> 2. Implementation Agent: Read report, fix the queries
> 3. Review Agent: Check changes, verify performance improved

**Implementation:**
```json
{
  "tasks": [
    { "id": 1, "subject": "Research slow queries", "blockedBy": [] },
    { "id": 2, "subject": "Implement fixes", "blockedBy": [1] },
    { "id": 3, "subject": "Review & verify", "blockedBy": [2] }
  ]
}
```

---

### 3. Self-Organizing Swarm

**Agents autonomously claim tasks from a shared board.**

```
┌─────────────────────────────────────┐
│         Task Board                  │
│  [ ] Task A  (unclaimed)            │
│  [→] Task B  (agent-2 working)      │
│  [✓] Task C  (done)                 │
│  [ ] Task D  (unclaimed)            │
└─────────────────────────────────────┘
         ▲           ▲           ▲
         │           │           │
     Agent-1     Agent-2     Agent-3

Each agent: "Find unclaimed task → claim → work → mark done → repeat"
```

**When to use:**
- Many small independent tasks
- Backlog of issues/bugs
- You don't want to micromanage assignment

**Agent prompt:**
```
Loop:
1. Read ~/.claude-swarm/project/tasks.json
2. Find first task where status="pending" and owner=null
3. Set owner="agent-1", status="in_progress"
4. Do the work
5. Set status="completed", write summary
6. Go to step 1 until no pending tasks
```

**Good for:**
- Bug bash (10 bugs, 3 agents, they self-assign)
- Refactoring (multiple files to update)
- Documentation (multiple docs to write)

---

### 4. Plan + Execute

**Leader creates plan, spawns workers for subtasks.**

```
         You
          │
          ▼
       Leader
       "Plan feature X"
          │
          ▼
    ┌─────────────────┐
    │ Plan:           │
    │ 1. Add schema   │
    │ 2. Build API    │
    │ 3. Build UI     │
    │ 4. Add tests    │
    └─────────────────┘
          │
    Spawn workers
          │
    ┌─────┴─────┬─────────┬─────────┐
    ▼           ▼         ▼         ▼
 Worker-1   Worker-2   Worker-3   Worker-4
 (schema)   (API)      (UI)       (tests)
```

**When to use:**
- Complex features needing breakdown
- You want oversight before execution
- Avoid wasted parallel work on wrong approach

**Flow:**
1. Leader analyzes requirement
2. Leader outputs plan (or asks for approval)
3. You approve/modify plan
4. Leader spawns workers with specific instructions
5. Workers execute in parallel
6. Leader collects results, handles conflicts

---

### 5. Research + Implementation (Async)

**Research runs ahead, implementation consumes when ready.**

```
Research Agent (continuous)
      │
      ├──▶ finding-1.md ──▶ Implementation Agent picks up
      │
      ├──▶ finding-2.md ──▶ Implementation Agent picks up
      │
      └──▶ finding-3.md ──▶ ...
```

**When to use:**
- Exploring unknown territory
- Research might change approach
- Don't want to block implementation on all research

---

### Pattern Comparison

| Pattern | Parallelism | Coordination | Best For |
|---------|-------------|--------------|----------|
| Parallel Specialists | High | Low | Independent layers |
| Pipeline | None | Sequential | Dependent stages |
| Self-Organizing | High | Shared board | Many small tasks |
| Plan + Execute | High (after plan) | Leader controls | Complex features |
| Research + Impl | Medium | Async handoff | Unknown territory |

---

## When to Use

| Scenario | Approach |
|----------|----------|
| Single focused task | Regular Claude session |
| 2-3 related changes | Task tool subagents |
| Multiple independent features | DIY tmux + worktrees |
| Complex coordinated workflow | Native swarm (when stable) |

---

## Cost Considerations

Each agent consumes tokens independently:
- 3 agents working 30 min each = 3x token usage
- Only spawn for substantial tasks (10+ min work)
- Use for parallelization, not for simple queries

---

## Quick Start (DIY)

```bash
# 1. Create slots
jg slot new 1
jg slot new 2

# 2. Setup coordination
mkdir -p ~/.claude-swarm/my-project/results

# 3. Spawn agents
tmux new-session -d -s a1 "cd ../my-project-1 && claude"
tmux new-session -d -s a2 "cd ../my-project-2 && claude"

# 4. Monitor
tmux list-sessions
tmux attach -t a1

# 5. Cleanup when done
tmux kill-session -t a1
tmux kill-session -t a2
jg slot delete 1
jg slot delete 2
```

---

## References

- [Claude Code Swarm Discovery - Hacker News](https://news.ycombinator.com/item?id=46743908)
- [Claude Code Hidden Multi-Agent System](https://paddo.dev/blog/claude-code-hidden-swarm/)
- [TeammateTool Orchestration Gist](https://gist.github.com/kieranklaassen/4f2aba89594a4aea4ad64d753984b2ea)
- [claude-sneakpeek npm](https://www.npmjs.com/package/@realmikekelly/claude-sneakpeek)
