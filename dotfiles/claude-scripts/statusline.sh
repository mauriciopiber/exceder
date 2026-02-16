#!/bin/bash
# Custom status line showing subscription estimate + context

# Read JSON input from Claude Code
input=$(cat)

# Extract from Claude's JSON
MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
CONTEXT_PERCENT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | awk '{printf "%.0f", $1}')
SESSION_COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')

# Get weekly usage from ccusage (cached for performance)
CACHE_FILE="/tmp/ccusage_weekly_cache"
CACHE_AGE=300  # 5 minutes

# Check if cache exists and is fresh
if [ -f "$CACHE_FILE" ]; then
  CACHE_TIME=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null)
  NOW=$(date +%s)
  AGE=$((NOW - CACHE_TIME))
  if [ "$AGE" -lt "$CACHE_AGE" ]; then
    WEEKLY_COST=$(cat "$CACHE_FILE")
  fi
fi

# If no cache or stale, recalculate
if [ -z "$WEEKLY_COST" ]; then
  # Get this week's cost from ccusage
  WEEKLY_COST=$(ccusage weekly --json --offline 2>/dev/null | jq -r '.[-1].cost // 0' 2>/dev/null)
  [ -z "$WEEKLY_COST" ] && WEEKLY_COST=0
  echo "$WEEKLY_COST" > "$CACHE_FILE"
fi

# Max 20x rough weekly budget (API equivalent)
# Based on community data: ~$500-700/week before limits
WEEKLY_BUDGET=600

# Calculate subscription percentage used
if [ "$WEEKLY_BUDGET" -gt 0 ]; then
  SUB_PERCENT=$(echo "$WEEKLY_COST $WEEKLY_BUDGET" | awk '{printf "%.0f", ($1 / $2) * 100}')
else
  SUB_PERCENT=0
fi

# Color coding for subscription
if [ "$SUB_PERCENT" -lt 50 ]; then
  SUB_COLOR="\033[32m"  # Green
elif [ "$SUB_PERCENT" -lt 80 ]; then
  SUB_COLOR="\033[33m"  # Yellow
else
  SUB_COLOR="\033[31m"  # Red
fi
RESET="\033[0m"

# Context color
if [ "$CONTEXT_PERCENT" -lt 50 ]; then
  CTX_COLOR="\033[32m"
elif [ "$CONTEXT_PERCENT" -lt 80 ]; then
  CTX_COLOR="\033[33m"
else
  CTX_COLOR="\033[31m"
fi

# Build status line
printf "🤖 %s | ${SUB_COLOR}📊 ~%s%% weekly${RESET} | ${CTX_COLOR}🧠 %s%% ctx${RESET} | 💰 \$%.2f session" \
  "$MODEL" "$SUB_PERCENT" "$CONTEXT_PERCENT" "$SESSION_COST"
