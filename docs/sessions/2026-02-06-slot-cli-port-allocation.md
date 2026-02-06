# Session: Smart Port Allocation for Slots

**Date:** 2026-02-06
**Goal:** Enable parallel development slots with isolated databases and smart port allocation

## Problem

The original bash-based slot system had issues:

1. **Hardcoded port logic** - Used fixed formulas like `5432 + offset` instead of reading actual project ports
2. **No port discovery** - Didn't scan `.env` files to find what ports the project uses
3. **Container name conflicts** - `container_name: tracker-db` was hardcoded, causing Docker conflicts
4. **Bash limitations** - macOS has bash 3.x without associative arrays (`declare -A` fails)

## Learnings

### 1. Port Discovery Strategy

**Wrong approach:**
```bash
# Fixed base port from registry
base_port=3000
pg_port=$((5432 + slot_num))
```

**Right approach:**
```go
// Scan ALL .env files for actual ports
// Pattern match: PORT=, *_PORT=, localhost:PORT
// Then offset each discovered port by slot_num
```

### 2. Docker Container Naming

**Problem:** Hardcoded `container_name: tracker-db` causes conflicts.

**Solution:** Use environment variable in docker-compose.yml:
```yaml
container_name: ${COMPOSE_PROJECT_NAME:-tracker}-db
```

And ensure `.env` has:
```bash
COMPOSE_PROJECT_NAME=tracker      # main
COMPOSE_PROJECT_NAME=tracker-1    # slot 1
```

### 3. Go Pipe Deadlock

**Problem:** Piping between two commands in Go can deadlock:
```go
// DEADLOCK - dump fills pipe buffer, blocks waiting for reader
pipe, _ := dump.StdoutPipe()
restore.Stdin = pipe
dump.Start()
restore.Start()
dump.Wait()  // Blocks forever
restore.Wait()
```

**Solution:** Use shell for piping:
```go
cmd := exec.Command("sh", "-c", "pg_dump ... | psql ...")
cmd.Run()
```

### 4. Worktree Gets Committed Version

**Problem:** `git worktree add` gets the committed version of files, not working copy changes.

If you modify `docker-compose.yml` in main but don't commit, the slot gets the old version.

**Solution:** Have slot-cli update tracked files (like docker-compose.yml) after worktree creation.

### 5. .env Must Be Gitignored

**Requirement:** `.env` files with runtime config must be:
- Gitignored (not tracked)
- Copied during slot creation (from main's gitignored files)
- Updated with slot-specific values

**Pattern:**
```
.env.example  → committed (template)
.env          → gitignored (runtime, copied to slots)
.env.local    → gitignored (local overrides)
```

### 6. Port Availability Check

**Simple Go check:**
```go
func isPortAvailable(port int) bool {
    ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
    if err != nil {
        return false
    }
    ln.Close()
    return true
}
```

## Architecture Decisions

### Why Go over Bash?

| Bash | Go |
|------|-----|
| macOS bash 3.x lacks features | Full language features |
| Complex string manipulation | Clean data structures |
| Hard to debug | Easy to test/debug |
| Slow for file operations | Fast, parallel processing |

### Port Allocation Formula

```
slot_port = main_port + slot_num

Main:    PORT=4200, POSTGRES_PORT=4232
Slot 1:  PORT=4201, POSTGRES_PORT=4233
Slot 2:  PORT=4202, POSTGRES_PORT=4234
```

If port in use, increment until available.

## Files Changed

1. **Created:** `cli/slot-cli/main.go` - Go implementation
2. **Updated:** `~/.config/just/justfile` - Now calls slot-cli
3. **Created:** `docs/multi-slot-requirements.md` - Project setup guide
4. **Updated:** `CLAUDE.md` - Documented slot-cli features

## Testing

```bash
# Main project
docker ps | grep tracker
# tracker-db on 4232

# Create slot
xc slot new 1

# Both running
docker ps | grep tracker
# tracker-db on 4232
# tracker-1-db on 4233

# Verify clone
psql -p 4232 -c "SELECT count(*) FROM pg_tables"  # 58
psql -p 4233 -c "SELECT count(*) FROM pg_tables"  # 58
```

### 7. Shell Aliases Don't Work in Claude

**Problem:** Claude Code runs commands in non-interactive shell where aliases don't work.

```bash
# This fails in Claude's shell context
xc slot new   # "command not found: xc"

# Even after sourcing
source ~/.zshrc && xc slot new  # Still fails
```

**Solution:** Use the binary directly:
```bash
slot-cli new   # Works!
```

**For users:** `xc slot new` works in their terminal (alias defined in .zshrc)
**For Claude:** Must use `slot-cli new` directly

Added symlink to PATH: `~/.volta/bin/slot-cli -> ~/bin/slot-cli`

## Future Improvements

1. **Seed mode** - Instead of full clone, run migrations + seed data
2. **Snapshot restore** - Pre-made pg_dump for faster setup
3. **Port range config** - Allow projects to reserve port ranges
4. **Health checks** - Verify slot is fully operational before reporting success
