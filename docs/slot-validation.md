---
stratum: prompts
type: rule
status: archived
created: "2026-01-24"
superseded_by: "jg slot check command"
tags:
  - slot
  - validation
  - workflow
---

# Slot Validation Checklist

> **DEPRECATED:** This document is archived. Do NOT use as reference.
>
> **Use instead:** `jg slot check` command or `dev/workflow-operations.md`

Use this prompt to verify a slot was created correctly.

## Usage

After running `jg slot new [N]`, validate with:

```
Validate slot {project}-{N} was created correctly.
```

## Validation Checks

### 1. Directory Structure

```bash
# Slot directory exists
ls -la {slot_path}

# Is a git worktree (has .git file, not folder)
cat {slot_path}/.git
```

**Expected:** `.git` is a file pointing to main repo's worktrees.

### 2. Git Branch

```bash
git -C {slot_path} branch --show-current
```

**Expected:** `slot-{N}` or the ticket name.

### 3. Registry Entry

```bash
cat ~/.config/slots/registry.json | jq '.slots["{project}-{N}"]'
```

**Expected:** Entry with project, number, branch, created_at.

### 4. Environment Files (if docker project)

```bash
# Check .env.local exists and has slot ports
cat {slot_path}/.env.local

# Compare with main
diff {main_path}/.env.local {slot_path}/.env.local 2>/dev/null || echo "Files differ (good)"
```

**Expected ports for slot N:**
- PORT: 3000 + N
- POSTGRES_PORT: 5432 + N
- REDIS_PORT: 6379 + N

### 5. Monorepo Apps (if applicable)

```bash
# Check apps/* have .env.local copies
ls {slot_path}/apps/*/.env.local
```

**Expected:** Each app has its own .env.local with slot ports.

### 6. Node Modules (if npm project)

```bash
# Check node_modules exist where pnpm-lock.yaml exists
find {slot_path} -name "pnpm-lock.yaml" -not -path "*/node_modules/*" | while read f; do
  dir=$(dirname "$f")
  if [ -d "$dir/node_modules" ]; then
    echo "✓ $dir/node_modules exists"
  else
    echo "✗ $dir/node_modules MISSING"
  fi
done
```

### 7. Docker Isolation (if docker project)

```bash
# Check COMPOSE_PROJECT_NAME is unique
grep "COMPOSE_PROJECT_NAME" {slot_path}/.env.local

# Should be: {project}-{N}
```

## Quick Validation Command

Run all checks:

```bash
slot_path="$1"
main_path="$2"

echo "=== Slot Validation ==="

# 1. Directory
[ -d "$slot_path" ] && echo "✓ Directory exists" || echo "✗ Directory missing"

# 2. Git worktree
[ -f "$slot_path/.git" ] && echo "✓ Is worktree" || echo "✗ Not a worktree"

# 3. Branch
branch=$(git -C "$slot_path" branch --show-current)
echo "  Branch: $branch"

# 4. Env ports
if [ -f "$slot_path/.env.local" ]; then
    port=$(grep "^PORT=" "$slot_path/.env.local" | cut -d= -f2)
    pg=$(grep "^POSTGRES_PORT=" "$slot_path/.env.local" | cut -d= -f2)
    echo "✓ .env.local exists (PORT=$port, PG=$pg)"
else
    echo "○ No .env.local (not a docker project?)"
fi

# 5. Node modules
missing=0
for lock in $(find "$slot_path" -name "pnpm-lock.yaml" -not -path "*/node_modules/*" 2>/dev/null); do
    dir=$(dirname "$lock")
    [ ! -d "$dir/node_modules" ] && missing=$((missing + 1))
done
[ "$missing" -eq 0 ] && echo "✓ All node_modules installed" || echo "✗ $missing node_modules missing"

echo "=== Done ==="
```

## Common Issues

### .env.local not created
**Cause:** No docker-compose.yml in project.
**Fix:** Manual or project doesn't need it.

### node_modules missing
**Cause:** pnpm install failed or lockfile not found.
**Fix:** Run `pnpm install` in slot directory.

### Ports same as main
**Cause:** Bug in slot creation or .env.local not regenerated.
**Fix:** Delete .env.local and recreate, or manually edit ports.

### Apps missing .env.local
**Cause:** apps/* copy step failed.
**Fix:** Manually copy root .env.local to each app.
