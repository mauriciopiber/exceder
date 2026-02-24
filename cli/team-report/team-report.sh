#!/bin/bash
set -euo pipefail

# team-report: Daily team activity report using gh + claude
# Usage: team-report [--days N] [--raw]

REPOS=(
  "Edgevanta/ai-platform"
  "Edgevanta/ai-platform-dbt"
  "Edgevanta/dot-sync"
)

TEAM=(
  "giovanni-pucci:Giovanni Pucci"
  "brunowego:Bruno Wego"
  "mauriciopiber:Mauricio Piber"
  "MarioEdgevanta:Mario"
)

DAYS=1
RAW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days) DAYS="$2"; shift 2 ;;
    --raw) RAW=true; shift ;;
    -h|--help)
      echo "Usage: team-report [--days N] [--raw]"
      echo "  --days N   Look back N days (default: 1)"
      echo "  --raw      Print raw data without Claude summary"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SINCE=$(date -v-${DAYS}d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -d "${DAYS} days ago" +%Y-%m-%dT00:00:00Z)

DATA=""

for REPO in "${REPOS[@]}"; do
  REPO_NAME="${REPO#*/}"

  # Commits
  COMMITS=$(gh api "/repos/${REPO}/commits?since=${SINCE}&per_page=100" \
    --jq '.[] | "- \(.commit.author.name) | \(.commit.message | split("\n") | .[0]) | \(.sha[:7])"' 2>/dev/null || echo "  (no access or no commits)")

  # PRs updated in the period (with description snippet)
  PRS=$(gh api "/repos/${REPO}/pulls?state=all&sort=updated&direction=desc&per_page=50" \
    --jq --arg since "$SINCE" '.[] | select(.updated_at >= $since) | "- #\(.number) \(.title) [\(.state)] by \(.user.login)\n  Description: \(.body | split("\n") | map(select(length > 0)) | .[0:5] | join(" | "))"' 2>/dev/null || echo "  (no access or no PRs)")

  DATA+="
## ${REPO_NAME} (${REPO})

### Commits
${COMMITS:-  (none)}

### Pull Requests
${PRS:-  (none)}
"
done

# Build team member list for the prompt
TEAM_LIST=""
for MEMBER in "${TEAM[@]}"; do
  GH_USER="${MEMBER%%:*}"
  NAME="${MEMBER#*:}"
  TEAM_LIST+="- ${NAME} (GitHub: ${GH_USER})\n"
done

if [ "$RAW" = true ]; then
  echo "$DATA"
  exit 0
fi

echo "$DATA" | claude -p "You are generating a daily team activity report. Below is raw git data (commits and PRs) from the last ${DAYS} day(s) across multiple repositories.

Team members:
${TEAM_LIST}

Instructions:
1. Start with a brief overall summary (2-3 sentences, factual, no judgment)
2. List activity grouped by team member. Use their real name. Include ALL team members - if someone has no activity, say so without commentary.
3. For each person: list what they worked on based on commits and PRs. Use the PR descriptions to understand what the work actually does, not just the title.
4. Be factual and neutral. Do not rank, compare, or highlight anyone as 'most active'. Each person's contributions have equal weight regardless of commit count.
5. End with a 'Notable Items' section only if there are cross-repo efforts or large features.
6. End the report with this disclaimer exactly:

---
*Disclaimer: This report reflects only commits merged to main branches and PRs updated during the period. It does not account for work-in-progress, code reviews, planning, debugging, or other activities not captured in git history. All changes listed still require validation on staging before being considered production-ready.*

Keep it professional and scannable. No emojis. Use markdown formatting.

Raw data:
"
