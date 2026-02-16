#!/bin/bash
# Fetch REAL Claude subscription usage from API
# Shows actual 5-hour and 7-day utilization percentages

CACHE_FILE="/tmp/claude_real_usage_cache"
CACHE_AGE=60  # Cache for 60 seconds (don't spam API)

# Check cache
if [ -f "$CACHE_FILE" ]; then
  CACHE_TIME=$(stat -f %m "$CACHE_FILE" 2>/dev/null)
  NOW=$(date +%s)
  AGE=$((NOW - CACHE_TIME))
  if [ "$AGE" -lt "$CACHE_AGE" ]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Get OAuth token from Keychain
CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
if [ -z "$CREDS" ]; then
  echo "❌ No credentials"
  exit 1
fi

TOKEN=$(echo "$CREDS" | jq -r '.claudeAiOauth.accessToken // .accessToken' 2>/dev/null)
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ No token"
  exit 1
fi

# Fetch usage from API
USAGE=$(curl -s "https://api.anthropic.com/api/oauth/usage" \
  -H "Authorization: Bearer $TOKEN" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "Content-Type: application/json" \
  2>/dev/null)

if [ -z "$USAGE" ] || echo "$USAGE" | jq -e '.error' >/dev/null 2>&1; then
  echo "❌ API error"
  exit 1
fi

# Parse response
FIVE_HOUR=$(echo "$USAGE" | jq -r '.five_hour.utilization // 0')
SEVEN_DAY=$(echo "$USAGE" | jq -r '.seven_day.utilization // 0')
FIVE_RESET=$(echo "$USAGE" | jq -r '.five_hour.resets_at // ""')

# Calculate time until reset
if [ -n "$FIVE_RESET" ]; then
  RESET_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${FIVE_RESET%%.*}" "+%s" 2>/dev/null || echo "0")
  NOW_EPOCH=$(date +%s)
  REMAINING=$((RESET_EPOCH - NOW_EPOCH))
  if [ "$REMAINING" -gt 0 ]; then
    HOURS=$((REMAINING / 3600))
    MINS=$(((REMAINING % 3600) / 60))
    TIME_LEFT="${HOURS}h${MINS}m"
  else
    TIME_LEFT="resetting"
  fi
else
  TIME_LEFT="?"
fi

# Color coding
color_for_percent() {
  local pct=$1
  local pct_int=${pct%.*}
  if [ "$pct_int" -lt 50 ]; then
    echo "32"  # Green
  elif [ "$pct_int" -lt 80 ]; then
    echo "33"  # Yellow
  else
    echo "31"  # Red
  fi
}

C5=$(color_for_percent "$FIVE_HOUR")
C7=$(color_for_percent "$SEVEN_DAY")

# Format output
OUTPUT="⚡ \033[${C5}m${FIVE_HOUR}%\033[0m 5h | 📅 \033[${C7}m${SEVEN_DAY}%\033[0m 7d | ⏱️ ${TIME_LEFT}"

# Cache it
echo -e "$OUTPUT" > "$CACHE_FILE"
echo -e "$OUTPUT"
