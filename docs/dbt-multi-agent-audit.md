---
stratum: guiding
type: guide
status: active
created: "2026-02-03"
tags:
  - dbt
  - multi-agent
  - data-quality
  - snowflake
  - testing
---

# DBT Multi-Agent Audit Pattern

Use multiple Claude agents to investigate dbt test failures in parallel, each focusing on a specific state or test type.

## Context

**Repositories:**
- DBT platform: `/Users/mauriciopiber/Projects/edge/ai-platform-dbt`
- Source data: `/Users/mauriciopiber/Projects/edge/s3-v2`, `/Users/mauriciopiber/Projects/edge/dot-sync`

**Test failures summary:**
```bash
dbt build -s marts_test_failures_summary --vars '{"build_test_summary": true}'
```

This builds a table showing all test failures grouped by US state (VA, TX, FL, etc.).

---

## Architecture

```
                    Coordinator (You)
                           │
                           ▼
              ┌────────────────────────┐
              │  1. Run summary query  │
              │  2. Parse into tasks   │
              └────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   Agent: VA          Agent: TX          Agent: FL
   (slot-1)           (slot-2)           (slot-3)
        │                  │                  │
        ▼                  ▼                  ▼
   For each test:     For each test:     For each test:
   - Query failures   - Query failures   - Query failures
   - Investigate      - Investigate      - Investigate
   - Classify         - Classify         - Classify
        │                  │                  │
        └──────────────────┴──────────────────┘
                           │
                           ▼
              ~/.claude-swarm/dbt-audit/
              ├── VA-results.md
              ├── TX-results.md
              └── FL-results.md
```

---

## Assignment Strategies

### Option A: Agent per State

Each agent owns all tests for one state.

```
Agent-VA: All failing tests where state = 'VA'
Agent-TX: All failing tests where state = 'TX'
Agent-FL: All failing tests where state = 'FL'
```

**Good when:**
- States are independent
- Fewer states than test types
- State-specific domain knowledge needed

### Option B: Agent per Test Type

Each agent owns one test across all states.

```
Agent-1: bid_extension_total_wrong (all states)
Agent-2: assert_catalog_validation_100_percent (all states)
Agent-3: duplicate_identifier (all states)
```

**Good when:**
- Test types require specialized knowledge
- Same fix applies across states
- Fewer test types than states

---

## Implementation

### 1. Setup

```bash
# Create coordination directory
mkdir -p ~/.claude-swarm/dbt-audit/results

# Create slots for parallel work
cd /Users/mauriciopiber/Projects/edge/ai-platform-dbt
jg slot new 1
jg slot new 2
jg slot new 3
```

### 2. Run Summary Query

```bash
cd /Users/mauriciopiber/Projects/edge/ai-platform-dbt
dbt build -s marts_test_failures_summary --vars '{"build_test_summary": true}'
```

### 3. Export Tasks

Query the summary table and create task list:

```json
{
  "tasks": [
    {
      "id": 1,
      "state": "VA",
      "tests": ["bid_extension_total_wrong", "duplicate_identifier"],
      "status": "pending",
      "owner": null
    },
    {
      "id": 2,
      "state": "TX",
      "tests": ["assert_catalog_validation_100_percent"],
      "status": "pending",
      "owner": null
    }
  ]
}
```

Save to `~/.claude-swarm/dbt-audit/tasks.json`

### 4. Spawn Agents

```bash
# Agent for Virginia
tmux new-session -d -s agent-va "cd /Users/mauriciopiber/Projects/edge/ai-platform-dbt-1 && claude -p '
You are investigating dbt test failures for state VA.

Context:
- DBT repo: /Users/mauriciopiber/Projects/edge/ai-platform-dbt
- Source extraction: /Users/mauriciopiber/Projects/edge/dot-sync
- Test failures schema: DBT_MPIBER_test_failures

For each failing test in VA:
1. Query the failures:
   SELECT * FROM EV3_US_DOT_DB.DBT_MPIBER_test_failures.{test_name} WHERE state = \"VA\" LIMIT 10

2. Investigate:
   - What data is causing the failure?
   - Is this a source data issue or transformation bug?
   - Check the extraction logic in dot-sync if needed

3. Classify each failure:
   - known_exception: Documented source data behavior (e.g., bond fees not in line items)
   - needs_fix: Bug in our transformation logic
   - needs_investigation: Cannot determine without more info

4. Write findings to:
   ~/.claude-swarm/dbt-audit/results/VA.md

Format:
## Test: {test_name}
- Failures: {count}
- Classification: {known_exception|needs_fix|needs_investigation}
- Root cause: {description}
- Recommendation: {action}

When done:
echo DONE > ~/.claude-swarm/dbt-audit/agent-va-status.txt
'"

# Agent for Texas
tmux new-session -d -s agent-tx "cd /Users/mauriciopiber/Projects/edge/ai-platform-dbt-2 && claude -p '
[Same prompt but for TX]
'"

# Agent for Florida
tmux new-session -d -s agent-fl "cd /Users/mauriciopiber/Projects/edge/ai-platform-dbt-3 && claude -p '
[Same prompt but for FL]
'"
```

### 5. Monitor Progress

```bash
# Check status
cat ~/.claude-swarm/dbt-audit/agent-*-status.txt

# Watch specific agent
tmux attach -t agent-va

# Capture output without attaching
tmux capture-pane -t agent-va -p | tail -50

# List all sessions
tmux list-sessions
```

### 6. Collect Results

```bash
# Check completed results
ls ~/.claude-swarm/dbt-audit/results/

# Combine into single report
cat ~/.claude-swarm/dbt-audit/results/*.md > ~/.claude-swarm/dbt-audit/full-report.md
```

### 7. Cleanup

```bash
# Kill agent sessions
tmux kill-session -t agent-va
tmux kill-session -t agent-tx
tmux kill-session -t agent-fl

# Delete slots
jg slot delete 1
jg slot delete 2
jg slot delete 3
```

---

## Classification Categories

| Category | Meaning | Action |
|----------|---------|--------|
| `known_exception` | Documented source data behavior | Document, no fix needed |
| `needs_fix` | Bug in transformation logic | Create ticket, fix in dbt |
| `needs_investigation` | Unclear root cause | Escalate, gather more info |
| `source_data_issue` | Bad data from vendor | Report to data provider |

---

## Output Template

Each agent produces a markdown file:

```markdown
# State: VA - Test Failures Audit

## Summary
- Total tests with failures: 5
- Known exceptions: 2
- Needs fix: 2
- Needs investigation: 1

---

## Test: bid_extension_total_wrong

**Failures:** 127
**Classification:** known_exception

**Root Cause:**
Virginia DOT includes bond/fee amounts in bids_value that are not itemized
in the line items. This causes a $2,500-$5,500 discrepancy.

**Evidence:**
```sql
SELECT vendor, SUM(ext_total), bids_value, bids_value - SUM(ext_total) as diff
FROM ... WHERE state = 'VA'
-- Shows consistent bond fee amounts
```

**Recommendation:**
Document as known behavior. No code fix needed.

---

## Test: duplicate_identifier

**Failures:** 3
**Classification:** needs_fix

**Root Cause:**
Extraction logic not handling re-bid scenarios where same letting_id
appears with different dates.

**Evidence:**
```sql
SELECT letting_id, COUNT(*), ARRAY_AGG(letting_date)
FROM ... WHERE state = 'VA'
GROUP BY letting_id HAVING COUNT(*) > 1
```

**Recommendation:**
Fix in dot-sync extraction to use composite key (letting_id + letting_date).

---
```

---

## Coordination File

For self-organizing swarm, agents can claim tasks:

```json
{
  "project": "dbt-audit",
  "created": "2026-02-03",
  "tasks": [
    {
      "id": 1,
      "state": "VA",
      "status": "completed",
      "owner": "agent-va",
      "result": "results/VA.md"
    },
    {
      "id": 2,
      "state": "TX",
      "status": "in_progress",
      "owner": "agent-tx",
      "result": null
    },
    {
      "id": 3,
      "state": "FL",
      "status": "pending",
      "owner": null,
      "result": null
    }
  ]
}
```

---

## When to Use This Pattern

**Good for:**
- Quarterly data quality audits
- New state onboarding validation
- Large backlog of test failures
- Independent investigations (no cross-state dependencies)

**Overkill for:**
- Single state, few failures
- Quick spot checks
- Tightly coupled issues needing sequential investigation
