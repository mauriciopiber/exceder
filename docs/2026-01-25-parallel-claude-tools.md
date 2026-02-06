---
type: note
status: active
stratum: reality
created: "2026-01-25"
tags: [claude, ai-agents, tmux, remote-access, tools]
---

# Parallel Claude Code Tools Research

Research into open source alternatives to Conductor for running multiple Claude Code instances.

## The Problem

How to:
1. Run multiple Claude Code agents in parallel
2. Access Claude Code remotely (from phone/mobile)
3. Isolate agent workspaces to avoid conflicts

---

## Tools Comparison

| Tool | Isolation | Remote Access | Open Source | Complexity |
|------|-----------|---------------|-------------|------------|
| DIY (tmux + ttyd) | tmux | ttyd web terminal | ✓ | Simple |
| Claude Squad | tmux + worktrees | No | ✓ | Simple |
| Sculptor | Docker containers | No | ✓ | Medium |
| Omnara | tmux | Web + Mobile | ✓ | Medium |
| Conductor | git worktrees | No | No | Simple |

---

## Tool Details

### Claude Squad
**GitHub:** https://github.com/smtg-ai/claude-squad
**Docs:** https://smtg-ai.github.io/claude-squad/

Terminal app using tmux + git worktrees for isolation.

```bash
brew install claude-squad
cs  # run
```

Features:
- tmux sessions for each agent
- Git worktrees for code isolation
- Review changes before applying
- Single terminal management

---

### Sculptor
**GitHub:** https://github.com/imbue-ai/sculptor
**Website:** https://imbue.com/sculptor/

Desktop app using Docker containers for isolation.

Features:
- Each Claude in its own container
- Full environment isolation
- "Pairing mode" syncs container to local repo
- No git worktrees needed
- Requires Docker Desktop
- Mac (Apple Silicon), Linux supported

---

### Omnara (YC S25)
**GitHub:** https://github.com/omnara-ai/omnara
**Website:** https://www.omnara.ai/

Remote-first agent control platform. **Best for mobile access.**

```bash
pip install omnara
# or
uv tool install omnara
```

Features:
- Web dashboard
- Mobile app
- Push notifications
- Real-time agent monitoring
- GitHub Actions integration
- Apache 2.0 license
- Built by ex-Meta, Microsoft, Amazon engineers

---

### claude-tmux (TUI Manager)
**GitHub:** https://github.com/nielsgroen/claude-tmux

Terminal UI for managing multiple Claude Code sessions within tmux.

Features:
- Centralized view of all Claude instances
- Quick switching between sessions
- Status monitoring
- Session lifecycle management

---

### tmux-claude-mcp-server
**GitHub:** https://github.com/michael-abdo/tmux-claude-mcp-server

MCP server for hierarchical Claude instances.

Features:
- Spawn sub-agents from Claude itself
- Project isolation with `--project` flag
- Hierarchical naming (exec_1, mgr_1_1, spec_1_1_1)
- Recovery with `--continue` flag

---

### claude-tmux (MCP Sub-agents)
**GitHub:** https://github.com/Ilm-Alan/claude-tmux

MCP server that lets Claude spawn autonomous sub-agents in parallel tmux sessions.

Features:
- `spawn(name, prompt, workdir)` - launch instances
- `read(names: ["a", "b", "c"])` - parallel wait on multiple sessions
- Returns all outputs when complete

---

## Related Resources

### Articles
- [LLM Codegen with Git Worktrees and Tmux](https://dev.to/skeptrune/llm-codegen-go-brrr-parallelization-with-git-worktrees-and-tmux-2gop)
- [How to run Claude Code in parallel - Ona](https://ona.com/stories/parallelize-claude-code)
- [Claude Code + tmux: Ultimate Terminal Workflow](https://www.blle.co/blog/claude-code-tmux-beautiful-terminal)

### Curated Lists
- [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) - Skills, hooks, orchestrators for Claude Code

---

## Recommendations

1. **For mobile access:** Omnara - purpose-built for this
2. **For simple local parallel:** Claude Squad - polished tmux + worktrees
3. **For maximum isolation:** Sculptor - Docker containers
4. **For DIY/custom:** tmux + ttyd (what we built in workflow app)

---

## Our Implementation

Built a POC in `apps/workflow/` with:
- tmux session management via API
- ttyd integration for web access
- MCP tools for Claude Code integration
- Dashboard UI
- Chat UI with SSE streaming

**Documentation:** `dev/workflow-operations.md` (single source of truth)

---

## Deep Dive: Omnara Architecture

Cloned and studied: https://github.com/omnara-ai/omnara

**Note:** Deprecated (moved to Claude Agent SDK), but architecture is valuable.

### Core Concept: PTY Wrapping

```
┌─────────────────────────────────────────────────────────────┐
│  omnara CLI                                                 │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   pty.fork() │───►│ Claude Code  │    │  WebSocket   │  │
│  │   (master)   │    │  (child)     │    │  to Relay    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   ▲          │
│         │    read output    │                   │          │
│         ├───────────────────┤                   │          │
│         │                   │    mirror to      │          │
│         └───────────────────┼───────────────────┘          │
│                             │                              │
│         write to local tty  │                              │
│         ─────────────────►  ▼                              │
│                        [Terminal]                          │
└─────────────────────────────────────────────────────────────┘
```

### Key Implementation Files

| File | Purpose |
|------|---------|
| `src/omnara/session_sharing.py` | PTY wrapper - intercepts Claude I/O via `pty.fork()` |
| `src/relay_server/websocket.py` | aiohttp WebSocket relay server |
| `src/relay_server/sessions.py` | Session management and broadcasting |
| `apps/web/` | React (Vite) dashboard |
| `apps/mobile/` | React Native mobile app |

### How It Works

1. **PTY Fork** (`pty.fork()` in Python)
   - Creates pseudo-terminal pair (master/slave)
   - Child process executes Claude Code via `os.execvpe()`
   - Parent process owns master fd, intercepts all I/O

2. **Frame Protocol** (binary over WebSocket)
   ```python
   FRAME_TYPE_OUTPUT = 0   # Claude → User
   FRAME_TYPE_INPUT = 1    # User → Claude
   FRAME_TYPE_RESIZE = 2   # Terminal size changes
   FRAME_TYPE_METADATA = 3 # Agent info
   ```

3. **Relay Server Architecture**
   - CLI connects via WebSocket to `wss://relay.omnara.com/agent`
   - Web/mobile connect to same relay
   - Relay broadcasts output to all observers
   - Relay routes input from any observer back to CLI

4. **Docker Services**
   - `postgres` - PostgreSQL database
   - `mcp-server` - Agent communication (port 8080)
   - `backend` - FastAPI for web dashboard (port 8000)
   - Relay server runs separately

### Authentication

- **Web users**: Supabase JWT
- **Agents/CLI**: Custom JWT with API keys (hashed SHA256)
- Two separate auth systems for different trust levels

### What Makes It Work

1. **PTY is the core trick** - Wrapping Claude in pseudo-terminal captures everything
2. **WebSocket relay** - Central hub broadcasts to multiple clients
3. **Binary framing** - Efficient terminal data transmission
4. **Reconnection logic** - Handles network drops gracefully

### Comparison: Our ttyd vs Omnara PTY

| Aspect | Our ttyd Approach | Omnara PTY Approach |
|--------|-------------------|---------------------|
| Complexity | Simple (use existing tool) | Complex (custom code) |
| Control | Limited | Full control over I/O |
| Features | Basic terminal sharing | Can parse/filter output |
| Auth | None built-in | JWT integration |
| Mobile | Browser-based | Native apps possible |
| Relay | Direct connection | Central server |

### Ideas for Future

1. **Build PTY wrapper in TypeScript/Node** for tighter integration
2. **Add WebSocket relay to workflow app** for remote access
3. **Parse Claude output** to extract questions, show in dashboard
4. **Push notifications** when Claude needs input

---

## Proof of Concept: Chat UI for Claude Code

**Question:** Can we render Claude Code sessions as a polished chat UI instead of raw terminal?

**Answer:** YES - feasible with [assistant-ui](https://www.assistant-ui.com/) + ExternalStoreRuntime

### Claude Code JSONL Format

Sessions stored in `~/.claude/projects/{project-key}/*.jsonl`

**Message Types:**
```
user, assistant, system, summary, file-history-snapshot, queue-operation
```

**User Message Structure:**
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "how to use multiple terminals?"
  },
  "uuid": "29057af1-...",
  "timestamp": "2026-01-22T13:11:10.751Z"
}
```

**Assistant Message Structure:**
```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "..." },
      { "type": "text", "text": "Here's how..." },
      { "type": "tool_use", "name": "Edit", "input": {...} }
    ]
  }
}
```

**Content Block Types (from real session):**
- `thinking` (838 occurrences) - Claude's reasoning
- `tool_use` (640) - Tool calls (Edit, Bash, Read, etc.)
- `text` (412) - Response text

### Mapping to assistant-ui

assistant-ui uses `ThreadMessageLike` format:

```typescript
interface ThreadMessageLike {
  role: "user" | "assistant" | "system";
  content: ContentPart[];
  id?: string;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolName: string; args: object }
  | { type: "reasoning"; text: string };
```

**Conversion function:**
```typescript
const convertClaudeMessage = (msg: ClaudeJSONL): ThreadMessageLike => {
  if (msg.type === "user") {
    return {
      role: "user",
      content: [{ type: "text", text: msg.message.content }],
      id: msg.uuid,
    };
  }

  if (msg.type === "assistant") {
    return {
      role: "assistant",
      content: msg.message.content.map(block => {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "thinking") return { type: "reasoning", text: block.thinking };
        if (block.type === "tool_use") return {
          type: "tool-call",
          toolName: block.name,
          args: block.input
        };
      }),
      id: msg.uuid,
    };
  }
};
```

### Implementation Plan

1. **Read JSONL** - Watch/poll session file for changes
2. **Parse & Convert** - Transform to ThreadMessageLike format
3. **Render with assistant-ui** - Use ExternalStoreRuntime
4. **Send Input** - Use `tmux send-keys` or `claude -p` for headless

### Key Libraries

- [assistant-ui](https://github.com/assistant-ui/assistant-ui) - Chat UI components
- [Vercel AI SDK](https://ai-sdk.dev/) - AI streaming/state management
- [@assistant-ui/react](https://www.assistant-ui.com/docs/api-reference/overview) - React integration

### Verdict

**Feasible!** Claude Code JSONL maps cleanly to assistant-ui's message format. Main work is:
1. File watcher for JSONL changes
2. Message converter function
3. tmux integration for sending input
