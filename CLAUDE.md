# Exceder CLI

Git worktree management for parallel Claude sessions.

## Workspace (named branches)

| Command | Where | What |
|---------|-------|------|
| `xc workspace new <name>` | main repo | Create worktree |
| `xc workspace start` | worktree | Fresh Claude session |
| `xc workspace continue` | worktree | Resume last session |
| `xc workspace done` | worktree | Merge to main + cleanup |
| `xc workspace pr` | worktree | Push + create PR |
| `xc workspace kill` | worktree | Delete without merge |

## Slot (numbered, cross-project)

Powered by `slot-cli` (Go binary at `~/bin/slot-cli`).

| Command | Where | What |
|---------|-------|------|
| `xc slot new [N]` | main repo | Create slot with port allocation + DB clone |
| `xc slot start` | slot dir | Fresh Claude session |
| `xc slot continue` | slot dir | Resume last session |
| `xc slot delete <N>` | main repo | Delete slot |
| `xc slot list` | anywhere | Show running Claude instances |
| `xc slot check` | slot dir | Validate slot config |

**Auto features:**
- Scans `.env` files for ports, allocates slot-specific ports
- Updates `docker-compose.yml` container names
- Starts docker and clones database from main
- Checks port availability before allocation

See `docs/multi-slot-requirements.md` for project setup.

## Clean (safe cleanup)

```bash
xc clean              # Dry run
xc clean --do         # Execute safe items
xc clean --do --force # Include unmerged branches
```

Safety checks: uncommitted changes, unpushed commits, unmerged with main.

## Quick Reference

```bash
# Workspace flow
xc workspace new feature-name  # → Cmd+T, Cmd+V, Enter
xc workspace start
# work...
xc workspace done

# Slot flow
xc slot new          # → Cmd+T, Cmd+V, Enter
xc slot start
# work...
xc slot delete 1
```

Run `xc workspace` or `xc slot` for help.
