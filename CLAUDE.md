# slot-cli

Git worktree management for parallel Claude sessions. Use `slot-cli` directly in Claude's shell (aliases don't work in non-interactive shells).

## Commands

| Command | Where | What |
|---------|-------|------|
| `slot-cli new [N\|name]` | main repo | Create slot (number or name, auto-increments if omitted) |
| `slot-cli delete <N\|name>` | main repo | Delete slot |
| `slot-cli done` | slot dir | Merge into main + cleanup |
| `slot-cli pr` | slot dir | Push + create PR |
| `slot-cli start` | slot dir | Fresh Claude session |
| `slot-cli continue` | slot dir | Resume last session |
| `slot-cli sync` | slot dir | Rebase slot branch on main |
| `slot-cli db-sync` | slot dir | Clone database from main to slot |
| `slot-cli list` | anywhere | Show running Claude instances |
| `slot-cli clean` | anywhere | Scan for stale worktrees/sessions |

## Slot Types

**Numbered slots** (default):
```bash
slot-cli new        # Auto: exceder-1, branch: slot-1
slot-cli new 2      # exceder-2, branch: slot-2
```

**Named slots**:
```bash
slot-cli new auth   # exceder-auth, branch: auth
```

## Auto Features

- Scans `.env` files for ports, allocates slot-specific ports
- Updates `docker-compose.yml` container names
- Starts docker and clones database from main
- Checks port availability before allocation

See `docs/multi-slot-requirements.md` for project setup.

## Clean (safe cleanup)

```bash
slot-cli clean              # Dry run
slot-cli clean --do         # Execute safe items
slot-cli clean --do --force # Include unmerged branches
```

Safety checks: uncommitted changes, unpushed commits, unmerged with main.

## Building slot-cli

After modifying `cli/slot-cli/main.go`, always build AND sign:

```bash
cd cli/slot-cli && go build -o slot-cli . && codesign -f -s - slot-cli && cp slot-cli ~/bin/slot-cli && codesign -f -s - ~/bin/slot-cli
```

macOS kills unsigned Go binaries (signal 9). The `codesign -f -s -` ad-hoc signs it. Must sign both the local build and the installed copy.

## Groups

```bash
slot-cli group list                        # Show groups and projects
slot-cli group create <id> "<name>"        # Create a group
slot-cli group assign <project> <group>    # Assign project to group
slot-cli init                              # Auto-detects group from /Projects/<owner>/<project>
```

## Quick Reference

```bash
# Create slot
slot-cli new          # → Cmd+T, Cmd+V, Enter
slot-cli start

# When done
slot-cli done         # Merges and cleans up

# Or for PR workflow
slot-cli pr           # Push + create PR
slot-cli delete 1     # Manual cleanup later
```
