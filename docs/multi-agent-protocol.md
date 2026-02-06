---
stratum: guiding
type: protocol
status: active
created: "2026-02-03"
tags:
  - multi-agent
  - swarm
  - protocol
  - coordination
  - tmux
---

# Multi-Agent Protocol Specification

Standard protocol for coordinating multiple Claude Code agents working in parallel.

---

## 1. Directory Structure

```
~/.claude-swarm/
└── {project}/
    ├── config.json              # Project configuration
    ├── tasks.json               # Task board (shared state)
    ├── agents/
    │   ├── {agent-id}.status    # Single word: STARTING|WORKING|DONE|ERROR
    │   ├── {agent-id}.log       # Append-only activity log
    │   └── {agent-id}.error     # Error details (only if ERROR status)
    └── results/
        └── task-{id}.md         # Task output (one per completed task)
```

---

## 2. Configuration

`config.json`:

```json
{
  "project": "dbt-audit",
  "created": "2026-02-03T10:00:00Z",
  "coordinator": "main",
  "spawn_backend": "tmux",
  "settings": {
    "max_agents": 5,
    "task_timeout_minutes": 60,
    "auto_cleanup": false
  },
  "repositories": [
    "/Users/mauriciopiber/Projects/edge/ai-platform-dbt",
    "/Users/mauriciopiber/Projects/edge/dot-sync"
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `project` | Yes | Unique project identifier |
| `created` | Yes | ISO timestamp |
| `coordinator` | Yes | ID of coordinating agent |
| `spawn_backend` | Yes | `tmux` or `iterm2` |
| `settings.max_agents` | No | Limit concurrent agents |
| `settings.task_timeout_minutes` | No | Auto-fail stuck tasks |
| `settings.auto_cleanup` | No | Remove completed task files |
| `repositories` | No | Paths agents may need |

---

## 3. Task Board

`tasks.json`:

```json
{
  "version": 1,
  "updated_at": "2026-02-03T10:30:00Z",
  "tasks": [
    {
      "id": "1",
      "subject": "Audit VA test failures",
      "description": "Investigate all dbt test failures for state VA",
      "status": "completed",
      "owner": "agent-va",
      "claimed_at": "2026-02-03T10:05:00Z",
      "completed_at": "2026-02-03T10:25:00Z",
      "result": "results/task-1.md",
      "error": null
    },
    {
      "id": "2",
      "subject": "Audit TX test failures",
      "description": "Investigate all dbt test failures for state TX",
      "status": "in_progress",
      "owner": "agent-tx",
      "claimed_at": "2026-02-03T10:05:00Z",
      "completed_at": null,
      "result": null,
      "error": null
    },
    {
      "id": "3",
      "subject": "Audit FL test failures",
      "description": "Investigate all dbt test failures for state FL",
      "status": "pending",
      "owner": null,
      "claimed_at": null,
      "completed_at": null,
      "result": null,
      "error": null
    }
  ]
}
```

### Task Status Flow

```
pending → in_progress → completed
                     ↘ error
```

| Status | Meaning |
|--------|---------|
| `pending` | Unclaimed, available for any agent |
| `in_progress` | Claimed by an agent, work ongoing |
| `completed` | Finished successfully, result written |
| `error` | Failed, error details in task.error |
| `blocked` | Waiting on other tasks (optional) |

### Task Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `subject` | string | Short description (< 80 chars) |
| `description` | string | Full task details |
| `status` | enum | Current state |
| `owner` | string | Agent ID or null |
| `claimed_at` | timestamp | When claimed |
| `completed_at` | timestamp | When finished |
| `result` | string | Path to result file |
| `error` | string | Error message if failed |
| `blocked_by` | array | Task IDs that must complete first (optional) |

---

## 4. Agent Lifecycle

### 4.1 Startup Sequence

Agent MUST:

1. Write `STARTING` to `agents/{agent-id}.status`
2. Log `[TIMESTAMP] Agent started` to `agents/{agent-id}.log`
3. Read `config.json` for project context
4. Read `tasks.json` to find work

```bash
# Agent startup
echo "STARTING" > ~/.claude-swarm/{project}/agents/{agent-id}.status
echo "[$(date -Iseconds)] Agent started" >> ~/.claude-swarm/{project}/agents/{agent-id}.log
```

### 4.2 Task Claiming

Agent MUST:

1. Read `tasks.json`
2. Find first task where `status=pending` AND `owner=null` AND `blocked_by` is empty/satisfied
3. Atomically update:
   - `status` → `in_progress`
   - `owner` → `{agent-id}`
   - `claimed_at` → current timestamp
4. Write `WORKING` to status file
5. Log task claim

```bash
# Status update
echo "WORKING" > ~/.claude-swarm/{project}/agents/{agent-id}.status
echo "[$(date -Iseconds)] Claimed task {id}: {subject}" >> ~/.claude-swarm/{project}/agents/{agent-id}.log
```

### 4.3 Progress Logging

Agent SHOULD periodically log progress:

```bash
echo "[$(date -Iseconds)] Progress: Investigated 5/12 test failures" >> ~/.claude-swarm/{project}/agents/{agent-id}.log
```

### 4.4 Task Completion

Agent MUST:

1. Write result to `results/task-{id}.md`
2. Update `tasks.json`:
   - `status` → `completed`
   - `completed_at` → current timestamp
   - `result` → path to result file
3. Log completion
4. Check for more pending tasks OR signal done

```bash
echo "[$(date -Iseconds)] Completed task {id}" >> ~/.claude-swarm/{project}/agents/{agent-id}.log
```

### 4.5 Shutdown

When no more tasks available:

1. Write `DONE` to status file
2. Log shutdown
3. Exit

```bash
echo "DONE" > ~/.claude-swarm/{project}/agents/{agent-id}.status
echo "[$(date -Iseconds)] Agent shutdown - no more tasks" >> ~/.claude-swarm/{project}/agents/{agent-id}.log
```

### 4.6 Error Handling

On unrecoverable error:

1. Write `ERROR` to status file
2. Write error details to `agents/{agent-id}.error`
3. Update task:
   - `status` → `error`
   - `error` → error message
4. Log error
5. Exit (do not claim more tasks)

```bash
echo "ERROR" > ~/.claude-swarm/{project}/agents/{agent-id}.status
echo "Failed to connect to Snowflake: timeout after 30s" > ~/.claude-swarm/{project}/agents/{agent-id}.error
echo "[$(date -Iseconds)] ERROR: Failed to connect to Snowflake" >> ~/.claude-swarm/{project}/agents/{agent-id}.log
```

---

## 5. Agent Prompt Template

Standard prompt for spawning an agent:

```
You are agent "{agent-id}" in a multi-agent coordination system.

## Protocol

1. ON START:
   - Write "STARTING" to ~/.claude-swarm/{project}/agents/{agent-id}.status
   - Log start to ~/.claude-swarm/{project}/agents/{agent-id}.log

2. CLAIM TASK:
   - Read ~/.claude-swarm/{project}/tasks.json
   - Find first task where status="pending" and owner=null
   - Update the task: status="in_progress", owner="{agent-id}", claimed_at=now
   - Write "WORKING" to status file

3. DO WORK:
   - Execute the task as described
   - Log progress periodically
   - Write result to ~/.claude-swarm/{project}/results/task-{id}.md

4. COMPLETE:
   - Update task: status="completed", completed_at=now, result="results/task-{id}.md"
   - Check for more pending tasks → repeat from step 2
   - If no more tasks: write "DONE" to status file and exit

5. ON ERROR:
   - Write "ERROR" to status file
   - Write details to ~/.claude-swarm/{project}/agents/{agent-id}.error
   - Update task: status="error", error="description"
   - Exit (do not continue)

## Your Assignment

{task-specific instructions here}

## Context

- Project: {project}
- Repositories: {list of repos}
- Your agent ID: {agent-id}
```

---

## 6. Result Format

`results/task-{id}.md`:

```markdown
# Task {id}: {subject}

**Agent:** {agent-id}
**Started:** {timestamp}
**Completed:** {timestamp}
**Duration:** {minutes}m

---

## Summary

{2-3 sentence summary of findings}

## Findings

### {Finding 1 Title}

**Classification:** {known_exception|needs_fix|needs_investigation}

**Details:**
{description}

**Evidence:**
```sql
{query or code showing evidence}
```

**Recommendation:**
{action to take}

---

### {Finding 2 Title}

...

---

## Metrics

| Metric | Value |
|--------|-------|
| Items investigated | {n} |
| Known exceptions | {n} |
| Needs fix | {n} |
| Needs investigation | {n} |

## Next Steps

- [ ] {action item 1}
- [ ] {action item 2}
```

---

## 7. Coordinator Operations

### Initialize Project

```bash
PROJECT="dbt-audit"
mkdir -p ~/.claude-swarm/$PROJECT/{agents,results}

# Create config
cat > ~/.claude-swarm/$PROJECT/config.json << 'EOF'
{
  "project": "dbt-audit",
  "created": "2026-02-03T10:00:00Z",
  "coordinator": "main",
  "spawn_backend": "tmux"
}
EOF

# Create initial task board
cat > ~/.claude-swarm/$PROJECT/tasks.json << 'EOF'
{
  "version": 1,
  "updated_at": "2026-02-03T10:00:00Z",
  "tasks": []
}
EOF
```

### Add Tasks

```bash
# Use jq to add task
jq '.tasks += [{
  "id": "1",
  "subject": "Audit VA test failures",
  "description": "...",
  "status": "pending",
  "owner": null,
  "claimed_at": null,
  "completed_at": null,
  "result": null,
  "error": null
}] | .updated_at = now' ~/.claude-swarm/$PROJECT/tasks.json > tmp && mv tmp ~/.claude-swarm/$PROJECT/tasks.json
```

### Spawn Agent

```bash
AGENT_ID="agent-va"
PROJECT="dbt-audit"
WORKDIR="/Users/mauriciopiber/Projects/edge/ai-platform-dbt-1"

tmux new-session -d -s $AGENT_ID "cd $WORKDIR && claude -p '$(cat << EOF
You are agent "$AGENT_ID" in project "$PROJECT".
[... full prompt from template ...]
EOF
)'"
```

### Monitor All Agents

```bash
PROJECT="dbt-audit"

# Status summary
echo "=== Agent Status ==="
for f in ~/.claude-swarm/$PROJECT/agents/*.status; do
  agent=$(basename $f .status)
  status=$(cat $f)
  echo "$agent: $status"
done

# Task summary
echo ""
echo "=== Tasks ==="
jq -r '.tasks[] | "\(.id): \(.status) (\(.owner // "unclaimed"))"' ~/.claude-swarm/$PROJECT/tasks.json

# Recent logs
echo ""
echo "=== Recent Activity ==="
tail -5 ~/.claude-swarm/$PROJECT/agents/*.log
```

### Cleanup

```bash
PROJECT="dbt-audit"

# Kill all agent sessions
for f in ~/.claude-swarm/$PROJECT/agents/*.status; do
  agent=$(basename $f .status)
  tmux kill-session -t $agent 2>/dev/null && echo "Killed $agent"
done

# Optional: archive results
tar -czf ~/.claude-swarm/$PROJECT-archive-$(date +%Y%m%d).tar.gz ~/.claude-swarm/$PROJECT/

# Optional: remove project
rm -rf ~/.claude-swarm/$PROJECT
```

---

## 8. Failure Modes & Recovery

### Agent Crash (No Status Update)

**Detection:** Status file shows `WORKING` but tmux session dead.

**Recovery:**
1. Set task status back to `pending`, clear `owner`
2. Remove stale status file
3. Spawn replacement agent

```bash
# Check for zombie tasks
for f in ~/.claude-swarm/$PROJECT/agents/*.status; do
  agent=$(basename $f .status)
  status=$(cat $f)
  if [ "$status" = "WORKING" ]; then
    if ! tmux has-session -t $agent 2>/dev/null; then
      echo "ZOMBIE: $agent has WORKING status but no session"
    fi
  fi
done
```

### Task Timeout

**Detection:** Task `claimed_at` older than `task_timeout_minutes`.

**Recovery:**
1. Log timeout
2. Set task to `error` with timeout message
3. Agent should detect and shutdown

### Duplicate Claims (Race Condition)

**Prevention:** Agents should re-read tasks.json after writing to verify they own the task.

**Recovery:** If two agents claim same task, one must yield:
- Agent with lexicographically lower ID keeps task
- Other agent re-reads and finds different task

---

## 9. Quick Reference

### File Locations

| File | Purpose |
|------|---------|
| `config.json` | Project settings |
| `tasks.json` | Shared task board |
| `agents/{id}.status` | Single word status |
| `agents/{id}.log` | Activity log |
| `agents/{id}.error` | Error details |
| `results/task-{id}.md` | Task output |

### Status Values

| Status | Meaning |
|--------|---------|
| `STARTING` | Agent initializing |
| `WORKING` | Processing a task |
| `DONE` | No more work, clean exit |
| `ERROR` | Failed, see .error file |

### Task Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Available |
| `in_progress` | Being worked |
| `completed` | Done, has result |
| `error` | Failed |
| `blocked` | Waiting on dependencies |

### Commands

```bash
# Initialize
mkdir -p ~/.claude-swarm/{project}/{agents,results}

# Spawn agent
tmux new-session -d -s {agent-id} "claude -p '...'"

# Monitor
cat ~/.claude-swarm/{project}/agents/*.status
tail -f ~/.claude-swarm/{project}/agents/*.log

# Check results
ls ~/.claude-swarm/{project}/results/

# Cleanup
tmux kill-session -t {agent-id}
```
