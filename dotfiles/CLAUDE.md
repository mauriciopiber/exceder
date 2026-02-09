# Behavior

- **Don't assume actions** - If user says "check the UI", don't take screenshots unless asked. Just confirm it's running.
- **Wait when told** - If user says "wait", stop and wait for next instruction.

# Global Commands

## slot-cli (exceder)

Git worktree management for parallel Claude sessions.

**In Claude's shell, use `slot-cli` directly** (aliases don't work in non-interactive shells).

Source: `~/Projects/piber/exceder`

### Commands

| Command | Where | What |
|---------|-------|------|
| `slot-cli new [N\|name]` | main repo | Create slot (number or name, auto-increments) |
| `slot-cli delete <N\|name>` | main repo | Delete slot (--force to skip confirmation) |
| `slot-cli done` | slot dir | Merge into main + cleanup |
| `slot-cli pr` | slot dir | Push + create PR |
| `slot-cli start` | slot dir | Fresh Claude session |
| `slot-cli continue` | slot dir | Resume last session |
| `slot-cli sync` | slot dir | Rebase slot branch on main |
| `slot-cli db-sync` | slot dir | Clone database from main to slot |
| `slot-cli list` | anywhere | Show running Claude instances |
| `slot-cli clean` | anywhere | Scan for stale worktrees/sessions |

### Slot Types

**Numbered:** `slot-cli new` → `project-1/`, branch: `slot-1`
**Named:** `slot-cli new auth` → `project-auth/`, branch: `auth`

### How it works

1. Creates git worktree: `project-1/`, `project-auth/`, etc.
2. Copies gitignored files (`.env`, etc.) from main
3. Scans all `.env` files, allocates `slot_port = main_port + slot_num`
4. Updates `docker-compose.yml` container names
5. Starts docker and clones database

### Clean (safe cleanup)

```bash
slot-cli clean              # Dry run
slot-cli clean --do         # Execute safe items
slot-cli clean --do --force # Include unmerged branches
```

**Project requirements:** See `~/Projects/piber/exceder/docs/multi-slot-requirements.md`
