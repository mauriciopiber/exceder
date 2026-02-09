# Vision: Task Execution Engine

## The Problem

You have an idea. You break it into tasks. You spin up slots. Each slot gets a Claude worker. But right now, the worker gets a blob of text and does its best — there's no structured way to:

- Decompose work into verifiable steps
- Validate each step before moving to the next
- Track *why* decisions were made
- Present results in a way that enables fast iteration
- Run multiple workers without them stepping on each other

## The Core Loop

```
init → plan → slot → execute → validate → present → iterate
```

Every piece of work follows this cycle. The system doesn't skip steps. Each step produces an artifact that the next step consumes.

## 1. Init: Register the Ground

```bash
slot-cli init
```

The project exists in the registry. Its ports, path, and group are known. This is the foundation — without it, nothing else works.

**What exists after init:**
- Registry entry with path, base port, group
- Main worktree as slot 0
- Docker, env, ports — all known

## 2. Plan: Decompose Into Claims

Before creating a slot, decompose the work. A task is not "build the auth system." A task is a list of **claims** — statements that will be true when the task is done.

### Structure

```
Task: Add user authentication
├── Claim 1: POST /auth/login accepts email+password, returns JWT
│   ├── Premise: Users table exists with email, password_hash columns
│   ├── Premise: bcrypt comparison validates credentials
│   └── Premise: JWT contains user_id, expires in 24h
├── Claim 2: Middleware rejects requests without valid JWT
│   ├── Premise: Authorization header parsed as Bearer token
│   ├── Premise: Expired tokens return 401
│   └── Premise: Invalid signatures return 401
└── Claim 3: GET /auth/me returns current user from token
    ├── Premise: Extracts user_id from JWT claims
    └── Premise: Returns 401 if no token
```

### Why Claims, Not Tasks

A "task" is vague. A **claim** is testable. You can look at it and say: is this true or false? Each claim has **premises** — the things that must hold for the claim to be true.

This is how validation works: you don't validate "did you build auth." You validate "does POST /auth/login return a JWT when given valid credentials."

### The Plan File

```
.claude/plans/{slot-name}.md
```

Written before work begins. Contains:
- **Goal**: One sentence. What's different when this is done.
- **Claims**: Numbered list. Each is a verifiable statement.
- **Premises**: Under each claim. The building blocks.
- **Order**: Which claims depend on which. What can be parallel.
- **Unknowns**: What the worker doesn't know yet and needs to discover.

## 3. Slot: Isolate the Work

```bash
slot-cli new auth
# or
slot-cli new 3
```

One slot per task group. The slot gets:
- Its own worktree, branch, ports, database
- A copy of the plan file
- A clean starting point

Multiple slots can run simultaneously because resources are isolated by design.

## 4. Execute: Work Through Claims in Order

The worker (Claude instance in the slot) follows the plan:

```
For each claim:
  1. Read the claim and its premises
  2. Check: are all premises satisfiable from current state?
     - If no: flag blocker, skip to next claim or stop
     - If yes: implement
  3. Implement the minimum code to make all premises true
  4. Validate each premise (see step 5)
  5. Log what was done and why
  6. Move to next claim
```

### Execution Log

Every decision gets recorded. Not the git diff — the *reasoning*.

```
.claude/logs/{slot-name}.md
```

Format:

```markdown
## Claim 1: POST /auth/login accepts email+password, returns JWT

### Premise: Users table exists with email, password_hash columns
- [x] Checked: migration 001_users.sql already exists
- Decision: Reuse existing table, add password_hash column via new migration
- Why: Table has 3 existing columns we need, only password_hash is missing
- Files: migrations/002_add_password_hash.sql

### Premise: bcrypt comparison validates credentials
- [x] Implemented: auth.service.ts:validatePassword()
- Decision: Used bcryptjs (not bcrypt) — pure JS, no native dependency
- Why: Avoids build issues across slots with different node versions
- Files: src/services/auth.service.ts

### Premise: JWT contains user_id, expires in 24h
- [x] Implemented: auth.service.ts:generateToken()
- Decision: 24h expiry, RS256 signing
- Why: Plan specified 24h. RS256 over HS256 because we'll need public key verification for microservices later (noted in unknowns)
- Files: src/services/auth.service.ts
```

This log is the audit trail. When something breaks in iteration 3, you read the log to understand *why* it was built that way, not just *what* was built.

## 5. Validate: Test Each Premise

Validation happens at three levels:

### Level 1: Premise Check (per premise)
Does the code match what the premise says?

```
Premise: "bcrypt comparison validates credentials"
Check: Does auth.service.ts import bcrypt and call compare()?
Result: PASS / FAIL
```

This is a code-level check. The worker does this immediately after implementing.

### Level 2: Claim Check (per claim)
Do all premises together satisfy the claim?

```
Claim: "POST /auth/login accepts email+password, returns JWT"
Check: Can you actually call the endpoint and get a token back?
Result: PASS / FAIL
Evidence: curl output, test result, or manual verification
```

This is an integration check. Run after all premises for a claim are done.

### Level 3: Goal Check (end of task)
Do all claims together achieve the goal?

```
Goal: "Users can authenticate and access protected resources"
Check: End-to-end flow works — register, login, access protected route
Result: PASS / FAIL
Evidence: Test suite output or manual walkthrough
```

This is the final gate before presenting results.

### Validation Record

```
.claude/validations/{slot-name}.md
```

```markdown
# Validation: auth

## Claim 1: POST /auth/login ✅
- [x] Premise: Users table exists — migration ran successfully
- [x] Premise: bcrypt validates — unit test passes
- [x] Premise: JWT correct — token decoded, contains user_id, exp = 24h

## Claim 2: Middleware rejects invalid JWT ✅
- [x] Premise: Bearer parsing — tested with/without header
- [x] Premise: Expired tokens — tested with expired JWT
- [x] Premise: Invalid signature — tested with tampered token

## Claim 3: GET /auth/me ✅
- [x] Premise: Extracts user_id — returns correct user
- [x] Premise: No token → 401 — confirmed

## Goal: ✅ All claims validated
```

## 6. Present: Package Results for Review

When the worker finishes (all claims validated), it produces a **result summary**:

```
.claude/results/{slot-name}.md
```

```markdown
# Result: Add User Authentication

## Status: COMPLETE — ready for review

## What Changed
- Added JWT authentication (login, middleware, me endpoint)
- 3 new files, 2 modified
- New migration for password_hash column

## Claims Fulfilled
1. ✅ POST /auth/login — works with email+password, returns JWT
2. ✅ Middleware — rejects invalid/expired/missing tokens
3. ✅ GET /auth/me — returns user from valid token

## Decisions Made
- bcryptjs over bcrypt (no native deps)
- RS256 over HS256 (future microservice compat)
- 24h token expiry (as specified)

## Open Questions
- Should refresh tokens be added? (not in original claims)
- Rate limiting on login? (not in scope but recommended)

## How to Verify
1. `pnpm test` — all auth tests pass
2. `curl -X POST localhost:4201/auth/login -d '{"email":"...", "password":"..."}'`
3. Use returned token: `curl -H "Authorization: Bearer {token}" localhost:4201/auth/me`

## Files
- src/services/auth.service.ts (new)
- src/middleware/auth.middleware.ts (new)
- src/routes/auth.routes.ts (new)
- migrations/002_add_password_hash.sql (new)
- src/app.ts (modified — added auth routes)
```

This is what the human reviews. Not the code. Not the git log. A structured summary with evidence.

## 7. Iterate: Refine Until Right

The human reads the result. Two outcomes:

**Accept**: `slot-cli done` or `slot-cli pr` — merge and move on.

**Revise**: Add new claims, modify existing ones, restart the cycle.

```
Revision:
- Claim 2 needs change: middleware should also check API key for service-to-service
- New Claim 4: Rate limit login to 5 attempts per minute
```

The worker picks up the revised plan, executes only the new/changed claims, validates, presents again.

The log grows. The validation record grows. The full history of "we tried X, then changed to Y because Z" is preserved.

## Multiple Workers

This is where slots earn their keep.

```
Slot 1: Authentication (claims 1-3)
Slot 2: User profiles (claims 4-6)
Slot 3: Dashboard UI (claims 7-9)
```

Each slot has:
- Its own branch, ports, database
- Its own plan, log, validation, result files
- Its own Claude instance

They don't coordinate through shared state. They coordinate through **claims**: if Slot 3 needs auth (from Slot 1), its plan says:

```
Claim 7: Dashboard shows user name
├── Premise: GET /auth/me endpoint exists (depends on Slot 1, Claim 3)
└── Premise: UI calls /auth/me on load and displays response.name
```

The dependency is explicit. Slot 3 can mock Slot 1's output and work in parallel. When both merge, the integration is validated by the claims.

### Orchestration

```
Orchestrator (human or script)
├── Creates plan with all claims
├── Groups claims into slot-sized chunks
├── Spins up slots
├── Assigns claim groups to slots
├── Monitors validation status
├── Collects results
└── Runs goal-level validation across all slots
```

The orchestrator doesn't need to understand the code. It reads claim statuses:

```
Slot 1: ✅ ✅ ✅  (3/3 claims done)
Slot 2: ✅ ✅ ⏳  (2/3 claims done, 1 in progress)
Slot 3: ✅ ❌ ⏳  (1 done, 1 failed, 1 waiting)
```

Failed claim in Slot 3? Read the log. Understand why. Revise the claim or unblock the premise. The worker picks it back up.

## File Structure

```
project/
├── .claude/
│   ├── plans/
│   │   ├── slot-1.md          # What to do
│   │   └── auth.md            # Named slot plan
│   ├── logs/
│   │   ├── slot-1.md          # Why it was done that way
│   │   └── auth.md
│   ├── validations/
│   │   ├── slot-1.md          # Proof it works
│   │   └── auth.md
│   └── results/
│       ├── slot-1.md          # Summary for review
│       └── auth.md
```

All in `.claude/` — gitignored or committed per preference. The code is in git. The reasoning is in these files.

## The Principle

**The plan is the contract. Claims are the tests. Premises are the implementation guide. Logs are the audit trail. Results are the deliverable.**

A worker that follows this doesn't need to be smart about architecture. It needs to be disciplined about claims. Make each premise true. Validate. Move on. The architecture emerges from well-structured claims.

The human's job is writing good claims. The worker's job is making them true and proving it.
