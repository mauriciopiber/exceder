# Exceder

Developer workflow toolkit for parallel development with Claude.

> *exceder* (Portuguese): to exceed, surpass — pushing beyond limits

## What it does

- **Workspaces**: Git worktrees for named feature branches
- **Slots**: Numbered parallel development environments with isolated ports/databases
- **Multi-agent**: Orchestrate multiple Claude instances working in parallel
- **MCP Server**: Workflow status via Model Context Protocol

## Install

```bash
./install.sh
```

This will:
- Link `cli/justfile` to `~/.config/just/justfile`
- Add `xc` alias to your shell

## Usage

### Quick Reference

```bash
# Workspaces (named branches)
xc workspace new feature-name
xc workspace start
xc workspace done

# Slots (numbered, isolated environments)
xc slot init 3000          # Set project base port
xc slot new                # Create slot (auto-increment)
xc slot start              # Start Claude in slot

# Cleanup
xc clean                   # Dry run
xc clean --do              # Execute
```

### Workspaces

For feature branches with git worktrees:

```bash
xc workspace new auth-feature    # Create worktree + branch
xc workspace start               # Start Claude
xc workspace done                # Merge to main + cleanup
xc workspace pr                  # Push + create PR
xc workspace kill                # Delete without merge
```

### Slots

For parallel isolated environments:

```bash
xc slot init 3000      # Register project with base port
xc slot new            # Create slot-1 (port 3001, pg 5433)
xc slot new            # Create slot-2 (port 3002, pg 5434)
xc slot start          # Start Claude in slot
xc slot delete 1       # Remove slot
```

Each slot gets:
- Isolated git worktree
- Unique ports (app, postgres, redis, etc.)
- Isolated docker containers
- Cloned database from main

### Multi-Agent

See `docs/multi-agent-protocol.md` for orchestrating multiple Claude instances.

## Structure

```
exceder/
├── cli/
│   └── justfile        # Main CLI commands
├── mcp/
│   └── server.ts       # MCP workflow server
├── docs/
│   ├── multi-agent.md
│   └── protocol.md
└── install.sh
```

## Requirements

- [just](https://github.com/casey/just) — command runner
- git
- Docker (for slot database isolation)
- pnpm (for Node.js projects)
