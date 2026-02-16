#!/bin/bash
# Combined status line: Real usage % + ccusage details
# Shows actual subscription usage from Anthropic API

# Read JSON input from Claude Code
input=$(cat)

# Extract model from Claude's JSON
MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
CONTEXT_PERCENT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | awk '{printf "%.0f", $1}')
SESSION_COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')

# --- Fetch REAL usage from API (cached) ---
CACHE_FILE="/tmp/claude_real_usage_cache"
CACHE_AGE=60

REAL_USAGE=""
if [ -f "$CACHE_FILE" ]; then
  CACHE_TIME=$(stat -f %m "$CACHE_FILE" 2>/dev/null)
  NOW=$(date +%s)
  AGE=$((NOW - CACHE_TIME))
  if [ "$AGE" -lt "$CACHE_AGE" ]; then
    REAL_USAGE=$(cat "$CACHE_FILE")
  fi
fi

if [ -z "$REAL_USAGE" ]; then
  # Get OAuth token
  CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
  TOKEN=$(echo "$CREDS" | jq -r '.claudeAiOauth.accessToken // .accessToken' 2>/dev/null)

  if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
    # Fetch from API
    API_RESP=$(curl -s "https://api.anthropic.com/api/oauth/usage" \
      -H "Authorization: Bearer $TOKEN" \
      -H "anthropic-beta: oauth-2025-04-20" \
      -H "Content-Type: application/json" 2>/dev/null)

    if [ -n "$API_RESP" ] && ! echo "$API_RESP" | jq -e '.error' >/dev/null 2>&1; then
      FIVE_HOUR=$(echo "$API_RESP" | jq -r '.five_hour.utilization // 0')
      SEVEN_DAY=$(echo "$API_RESP" | jq -r '.seven_day.utilization // 0')
      FIVE_RESET=$(echo "$API_RESP" | jq -r '.five_hour.resets_at // ""')

      # Time until reset
      if [ -n "$FIVE_RESET" ]; then
        RESET_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${FIVE_RESET%%.*}" "+%s" 2>/dev/null || echo "0")
        NOW_EPOCH=$(date +%s)
        REMAINING=$((RESET_EPOCH - NOW_EPOCH))
        if [ "$REMAINING" -gt 0 ]; then
          HOURS=$((REMAINING / 3600))
          MINS=$(((REMAINING % 3600) / 60))
          TIME_LEFT="${HOURS}h${MINS}m"
        else
          TIME_LEFT="reset"
        fi
      else
        TIME_LEFT="?"
      fi

      REAL_USAGE="${FIVE_HOUR}|${SEVEN_DAY}|${TIME_LEFT}"
      echo "$REAL_USAGE" > "$CACHE_FILE"
    fi
  fi
fi

# Parse cached usage
if [ -n "$REAL_USAGE" ]; then
  FIVE_HOUR=$(echo "$REAL_USAGE" | cut -d'|' -f1)
  SEVEN_DAY=$(echo "$REAL_USAGE" | cut -d'|' -f2)
  TIME_LEFT=$(echo "$REAL_USAGE" | cut -d'|' -f3)
else
  FIVE_HOUR="?"
  SEVEN_DAY="?"
  TIME_LEFT="?"
fi

# Color function
color_code() {
  local val=$1
  local val_int=${val%.*}
  if [ "$val_int" = "?" ]; then
    echo "37"  # White
  elif [ "$val_int" -lt 50 ]; then
    echo "32"  # Green
  elif [ "$val_int" -lt 80 ]; then
    echo "33"  # Yellow
  else
    echo "31"  # Red
  fi
}

# Context color
ctx_color() {
  local val=$1
  local val_int=${val%.*}
  if [ "$val_int" -lt 50 ]; then
    echo "32"
  elif [ "$val_int" -lt 80 ]; then
    echo "33"
  else
    echo "31"
  fi
}

C5=$(color_code "$FIVE_HOUR")
C7=$(color_code "$SEVEN_DAY")
CC=$(ctx_color "$CONTEXT_PERCENT")

# Build status line
printf "🤖 %s | ⚡ \033[%sm%.0f%%\033[0m 5h | 📅 \033[%sm%.0f%%\033[0m 7d | ⏱️ %s | 🧠 \033[%sm%s%%\033[0m ctx | 💰 \$%.2f" \
  "$MODEL" "$C5" "$FIVE_HOUR" "$C7" "$SEVEN_DAY" "$TIME_LEFT" "$CC" "$CONTEXT_PERCENT" "$SESSION_COST"
