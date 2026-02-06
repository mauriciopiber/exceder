28
Claude Code Configuration Guide
  Overview
  This setup creates a structured workflow with:
  1. Custom skills (slash commands) for common workflows
  2. Hard rules that auto-trigger certain skills based on conditions
  3. Sub-agent delegation for MCP operations to reduce context window usage
  Core Principle: Sub-Agent Delegation
  When working with MCP connections (Jira, Gmail, Vanta), delegate operations to sub-agents using the Task tool with subagent_type: "general-purpose".
  This keeps the main context lean:
  - Sub-agent executes MCP calls and processes verbose responses
  - Only a concise summary returns to the main context
  - Use this for searches, bulk operations, or any MCP task returning substantial data
  Example: Instead of directly calling Gmail search tools, spawn a sub-agent:
  Task tool → general-purpose agent → "Search Gmail for emails from X about Y, summarize the 5 most relevant"
  File Structure
  ~/.claude/
  ├── CLAUDE.md       # Global instructions (hard rules, sub-agent taxonomy)
  ├── ui-patterns.md    # Design system patterns
  ├── commands/       # Skill definitions (one .md file per skill)
  │   ├── debug-start.md
  │   ├── debug-log.md
  │   ├── docs-context.md
  │   └── ... (other skills)
  CLAUDE.md Content
  # Global Instructions
  ## Hard Rules — MUST Follow
  These are mandatory triggers. Do NOT suggest — execute automatically.
  | Trigger | Action |
  |---------|--------|
  | User specifies a project to work on | ALWAYS run `/docs-context` before doing anything else. Wait for its output and acknowledge the summary. |
  | First failed fix/error encountered | ALWAYS run `/debug-start` to create a decision log |
  | Each subsequent failed attempt | ALWAYS run `/debug-log` to record what was tried |
  | Before suggesting a new debugging approach | ALWAYS run `/debug-status` to check what's been tried |
  | All UI/UX tasks completed | ALWAYS run `/design-audit` to check work against patterns |
  | End of significant work block or user wrapping up | ALWAYS run `/docs-session` to log what was done |
  ## Sub-Agent Taxonomy
  ### Managed Workflows (auto-triggered by hard rules above)
  - `/docs-context` — Project onboarding (also handles first-time init)
  - `/debug-start`, `/debug-log`, `/debug-status` — Debug lifecycle
  - `/design-audit` — Post-UI-work compliance check
  - `/docs-session` — Session logging on wrap-up
  ### User-Invocable Sub-Agents
  **Decision Log (Debugging):**
  - `/debug-start "description"` - Start tracking approaches
  - `/debug-log` - Record an attempt outcome
  - `/debug-status` - Review what's been tried
  - `/debug-suggest` - Get suggestions that avoid failed approaches
  - `/debug-resolve` - Archive when solved
  **Documentation (Project Context):**
  - `/docs-context` - View project context (also initializes docs/ if missing)
  - `/docs-update` - Update docs based on recent work
  - `/docs-session` - Log what was done in a session
  - `/docs-backlog` - Manage project backlog
  **Project Setup (Scaffolding):**
  - `/project-init` - Scaffold from planning documents
  - `/project-new "name"` - Quick new project with defaults
  - `/project-add "feature"` - Add auth, database, email, etc.
  - `/project-explain` - Explain current project structure
  **UI/UX:**
  - `/design-audit` - Audit modified UI files against ui-patterns.md
  - `/ui-patterns` - Show design patterns
  - `/ui-fix` - Fix UI issues
  - `/ui-review` - Review component
  - `/ui-component` - Generate component
  - `/ui-refine` - Refine pattern file
  - `/ui-extract` - Extract patterns from codebase
  **QA:**
  - `/qa-run` - Run automated tests
  ## MCP Operations
  For Jira, Gmail, and Vanta operations, use the Task tool with `subagent_type: "general-purpose"` to delegate work. The sub-agent handles verbose MCP
  responses and returns only relevant summaries. This reduces main context usage significantly.
  ## Design Patterns
  UI patterns are defined in `~/.claude/ui-patterns.md`. Always check this file before making UI decisions.
  ## Documentation Location
  Project documentation lives in `docs/` within each project (git-ignored). The `/docs-context` command handles both initialization and display.
  Setting Up Skills
  Each skill is a .md file in ~/.claude/commands/. The file contains the prompt that executes when the skill is invoked.
  Skills needed:
  - debug-start.md, debug-log.md, debug-status.md, debug-suggest.md, debug-resolve.md
  - docs-context.md, docs-update.md, docs-session.md, docs-backlog.md
  - project-init.md, project-new.md, project-add.md, project-explain.md
  - ui-patterns.md, ui-fix.md, ui-review.md, ui-component.md, ui-refine.md, ui-extract.md
  - design-audit.md
  - qa-run.md
  Key Behaviors
  1. Auto-triggers: Hard rules fire automatically without user prompting
  2. MCP delegation: Always consider spawning sub-agents for MCP work
  3. Context efficiency: Sub-agents process verbose data, return summaries
  4. Project onboarding: /docs-context runs first when a project is specified
