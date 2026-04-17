#!/usr/bin/env bash
#
# migrate to sns-hub: bundle github-trending-video + coffee-daily-video
# into a single parent folder so one Claude Code session can drive both.
#
# Prereqs:
#   - No active Claude Code session inside either source folder
#   - git status clean (or at least no WIP you care about) in both repos
#
# Usage:
#   bash docs/sns-hub/migrate.sh
#
# After completion:
#   cd ~/projects/sns-hub
#   claude    # start fresh session, then paste SESSION-KICKOFF.md contents

set -euo pipefail

HUB="$HOME/projects/sns-hub"
TRENDING="$HOME/projects/github-trending-video"
COFFEE="$HOME/projects/coffee-daily-video"

die() { echo "ERROR: $*" >&2; exit 1; }

# --- Preflight checks ---
[ -d "$TRENDING" ] || die "Source not found: $TRENDING"
[ -d "$COFFEE" ]   || die "Source not found: $COFFEE"
[ -e "$HUB" ]      && die "Destination already exists: $HUB"

# Warn if any worktrees are still attached
for repo in "$TRENDING" "$COFFEE"; do
  if git -C "$repo" worktree list | wc -l | awk '{exit !($1>1)}'; then
    echo "NOTE: $repo has extra worktrees:"
    git -C "$repo" worktree list
    echo
    read -r -p "Continue anyway? [y/N] " yn
    [[ "$yn" == "y" || "$yn" == "Y" ]] || die "Aborted."
  fi
done

# --- Move ---
echo "Creating $HUB"
mkdir -p "$HUB"

echo "Moving $TRENDING → $HUB/"
mv "$TRENDING" "$HUB/"

echo "Moving $COFFEE → $HUB/"
mv "$COFFEE" "$HUB/"

# --- Place handoff docs at the hub root ---
HANDOFF="$HUB/github-trending-video/docs/sns-hub"

echo "Placing hub-level docs from $HANDOFF"
cp "$HANDOFF/CLAUDE.md"           "$HUB/CLAUDE.md"
cp "$HANDOFF/SESSION-KICKOFF.md"  "$HUB/SESSION-KICKOFF.md"
mkdir -p "$HUB/docs"
cp "$HANDOFF/shared-patterns.md"  "$HUB/docs/shared-patterns.md"

# --- Summary ---
cat <<EOF

Done. Layout:

  $HUB/
  ├── CLAUDE.md                    (parent-level overview)
  ├── SESSION-KICKOFF.md           (paste into new Claude session)
  ├── docs/
  │   └── shared-patterns.md       (technical gotchas)
  ├── github-trending-video/       (independent git repo)
  └── coffee-daily-video/          (independent git repo)

Next:
  cd $HUB
  claude        # then paste contents of SESSION-KICKOFF.md
EOF
