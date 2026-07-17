#!/usr/bin/env bash
#
# sync-upstream-tags.sh — keep this fork's tags in sync with upstream.
#
# Mirrors version tags from the upstream repo (earendil-works/pi) into this fork
# (origin). Each synced tag points at the *exact same commit* upstream tagged —
# we fetch the tag object from upstream and push it straight to origin, so your
# fork "has" the same release points as upstream.
#
# Usage:
#   scripts/sync-upstream-tags.sh                 # sync the LATEST missing tag only
#   scripts/sync-upstream-tags.sh --all           # sync every tag upstream has that origin lacks
#   scripts/sync-upstream-tags.sh --list          # just print which tags are missing (no fetch/push)
#   scripts/sync-upstream-tags.sh --dry-run       # show what would happen, fetch/push nothing
#   scripts/sync-upstream-tags.sh --tag v0.80.2   # sync one specific tag
#   scripts/sync-upstream-tags.sh --force         # allow overwriting a tag that already exists on origin
#
# Network notes (especially relevant behind the GFW, where github.com is flaky):
#   * Every network op (ls-remote / fetch / push) is retried with backoff.
#   * GIT_TERMINAL_PROMPT=0 — a missing credential fails fast instead of hanging.
#   * If you proxy/VPN GitHub, set the usual https_proxy env var before running.

set -euo pipefail

UPSTREAM_URL="https://github.com/earendil-works/pi.git"
UPSTREAM_NAME="upstream"

MODE="latest"          # latest | all | tag | list
DRY_RUN=0
FORCE=0
TARGET_TAG=""

usage() { sed -n '3,21p' "$0" | sed 's/^# \{0,1\}//'; }

# --- parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)     MODE="all";  shift ;;
    --list)    MODE="list"; shift ;;
    --dry-run) DRY_RUN=1;   shift ;;
    --force)   FORCE=1;     shift ;;
    --tag)     MODE="tag"; TARGET_TAG="${2:?--tag requires a value, e.g. v0.80.2}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"   # always run from repo root
export GIT_TERMINAL_PROMPT=0            # never block on a credential prompt

# Retry a flaky network-bound command (GitHub over unstable links dies with
# SSL_ERROR_SYSCALL mid-handshake). 5 tries, exponential backoff.
retry() {
  local tries=5 delay=3 i=1
  until "$@"; do
    if (( i >= tries )); then
      echo "!! Command failed after $tries attempts: $*" >&2
      return 1
    fi
    echo "   (attempt $i failed, retrying in ${delay}s…)" >&2
    sleep "$delay"
    i=$((i + 1)); delay=$((delay * 2))
  done
}

# --- make sure the upstream remote exists and points at the right place ---
if ! git remote get-url "$UPSTREAM_NAME" >/dev/null 2>&1; then
  echo "==> Adding remote '$UPSTREAM_NAME' -> $UPSTREAM_URL"
  git remote add "$UPSTREAM_NAME" "$UPSTREAM_URL"
elif [[ "$(git remote get-url "$UPSTREAM_NAME")" != "$UPSTREAM_URL" ]]; then
  echo "==> Fixing remote '$UPSTREAM_NAME' URL -> $UPSTREAM_URL"
  git remote set-url "$UPSTREAM_NAME" "$UPSTREAM_URL"
fi

echo "==> origin  : $(git remote get-url origin)"
echo "==> upstream: $UPSTREAM_URL"
echo

# --- collect version-tag names from each remote ---
# ls-remote --tags prints "<sha>\trefs/tags/<name>" and, for annotated tags, an
# extra "<sha>\trefs/tags/<name>^{}" deref line. Strip deref lines and the
# "refs/tags/" prefix, keep only vX.Y.Z release tags. Fail loudly on net errors.
remote_version_tags() {
  local remote="$1" raw
  raw="$(retry git ls-remote --tags "$remote" 2>/dev/null)" || return 1
  printf '%s\n' "$raw" \
    | grep -v '\^{}$' \
    | awk -F'\t' '{print $2}' \
    | sed 's#^refs/tags/##' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+' \
    || true
}

UP_FILE="$(mktemp)"; OR_FILE="$(mktemp)"; MISSING_FILE="$(mktemp)"
trap 'rm -f "$UP_FILE" "$OR_FILE" "$MISSING_FILE"' EXIT

UP_RAW="$(remote_version_tags "$UPSTREAM_NAME")" \
  || { echo "!! Cannot reach $UPSTREAM_NAME. Check network/VPN/proxy." >&2; exit 1; }
OR_RAW="$(remote_version_tags "origin")" \
  || { echo "!! Cannot reach origin. Check network/VPN/proxy." >&2; exit 1; }

printf '%s\n' "$UP_RAW" | sort -u > "$UP_FILE"
printf '%s\n' "$OR_RAW" | sort -u > "$OR_FILE"
# missing = upstream tags origin doesn't have, version-ordered
grep -vxFf "$OR_FILE" "$UP_FILE" | sort -V > "$MISSING_FILE" || true

latest_up="$(sort -V "$UP_FILE" | tail -n1 || true)"
latest_or="$(sort -V "$OR_FILE" | tail -n1 || true)"
missing_count="$(grep -c . "$MISSING_FILE" || true)"

echo "Latest upstream tag : ${latest_up:-<none>}"
echo "Latest origin tag   : ${latest_or:-<none>}"
echo "Missing on origin   : ${missing_count}"

if [[ "$missing_count" -eq 0 ]]; then
  echo "==> Already in sync. Nothing to do."
  exit 0
fi

if [[ "$MODE" == "list" ]]; then
  echo; echo "Tags on upstream but not on origin:"; sed 's/^/  - /' "$MISSING_FILE"
  exit 0
fi

# --- decide which tag(s) to sync ---
case "$MODE" in
  latest) mapfile -t TARGETS < <(tail -n1 "$MISSING_FILE") ;;
  all)    mapfile -t TARGETS < "$MISSING_FILE" ;;
  tag)
    [[ -n "$TARGET_TAG" ]] || { echo "--tag needs a value." >&2; exit 2; }
    grep -Fxq "$TARGET_TAG" "$UP_FILE" \
      || { echo "Tag '$TARGET_TAG' does not exist on upstream." >&2; exit 1; }
    TARGETS=( "$TARGET_TAG" )
    grep -Fxq "$TARGET_TAG" "$OR_FILE" \
      && echo "==> '$TARGET_TAG' already on origin; pass --force to overwrite." \
      || true
    ;;
esac

echo "Will sync (${MODE}): ${TARGETS[*]}"
[[ "$DRY_RUN" -eq 1 ]] && { echo "[dry-run] Not fetching or pushing anything."; exit 0; }

# --- fetch each tag from upstream, then push it to origin ---
push_flag=(); [[ "$FORCE" -eq 1 ]] && push_flag=(--force)

synced=0
for tag in "${TARGETS[@]}"; do
  echo
  echo "==> Fetching $tag from $UPSTREAM_NAME"
  retry git fetch "$UPSTREAM_NAME" "refs/tags/$tag:refs/tags/$tag"
  echo "==> Pushing $tag to origin"
  retry git push "${push_flag[@]}" origin "refs/tags/$tag:refs/tags/$tag"
  synced=$((synced + 1))
done

echo
echo "Done. Synced $synced tag(s) to origin."
if [[ "$MODE" == "latest" ]];then
  echo "(Tip: re-run with --all to catch up any remaining older tags.)"
fi
