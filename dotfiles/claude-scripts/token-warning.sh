#!/bin/bash
# Token warning hook for Claude Code
# Warns when context is getting large

# Get current session stats from ccusage
STATS=$(ccusage statusline --json 2>/dev/null)

if [ -z "$STATS" ]; then
  exit 0
fi

# Parse values
SESSION_COST=$(echo "$STATS" | jq -r '.session_cost // 0' 2>/dev/null)
SESSION_TOKENS=$(echo "$STATS" | jq -r '.total_tokens // 0' 2>/dev/null)

# Convert to integer for comparison
TOKENS_INT=${SESSION_TOKENS%.*}
COST_INT=$(echo "$SESSION_COST" | awk '{printf "%.0f", $1 * 100}')

# Warning thresholds
WARN_TOKENS=50000000    # 50M tokens
DANGER_TOKENS=100000000 # 100M tokens
WARN_COST=50            # $0.50 in cents
DANGER_COST=200         # $2.00 in cents

# Check and warn
if [ "$TOKENS_INT" -gt "$DANGER_TOKENS" ] 2>/dev/null || [ "$COST_INT" -gt "$DANGER_COST" ] 2>/dev/null; then
  echo ""
  echo "🔴 DANGER: Session at \$${SESSION_COST} / ${SESSION_TOKENS} tokens"
  echo "   Consider: /clear or start a new session"
  echo ""
  # macOS notification
  osascript -e 'display notification "Session burning tokens fast!" with title "Claude Code Warning"' 2>/dev/null
elif [ "$TOKENS_INT" -gt "$WARN_TOKENS" ] 2>/dev/null || [ "$COST_INT" -gt "$WARN_COST" ] 2>/dev/null; then
  echo ""
  echo "🟡 WARNING: Session at \$${SESSION_COST} / ${SESSION_TOKENS} tokens"
  echo "   Tip: /clear if switching tasks"
  echo ""
fi
