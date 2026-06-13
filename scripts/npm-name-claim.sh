#!/usr/bin/env bash
#
# npm-name-claim.sh — one-time name-claim publish for any NEW
# @valve-tech/* workspace package that has never been published.
#
# Why this exists
# ---------------
# npm won't let you create an OIDC trusted-publisher record for a
# package that doesn't exist yet (chicken-and-egg). So a brand-new
# package's name must be claimed with one manual `npm publish` from a
# maintainer's machine BEFORE the tag-driven release workflow can ever
# publish it. This script does that for every never-published package
# in one go — so adding a new package is just: scaffold it, run this,
# configure its trusted-publisher record, done.
#
# What it deliberately does NOT do
# --------------------------------
# It never manually publishes an ALREADY-PUBLISHED package — not even a
# new, not-yet-on-npm version of one. Established packages publish ONLY
# through the tag-driven OIDC workflow (.github/workflows/release.yml),
# which keeps the synced-version lockstep and attaches the --provenance
# SLSA attestation. Hand-publishing a version bump would bypass both.
# Such packages are reported and skipped.
#
# Version note: a name-claim publishes the package's CURRENT
# package.json version. Run this BEFORE the synced release bump, so the
# claimed version is lower than the version the OIDC release will
# publish (npm rejects same-version republish — a same-version claim
# would turn the release's publish step red). The standard flow already
# satisfies this: scaffold at the current line, name-claim, THEN bump.
#
# Usage
# -----
#   scripts/npm-name-claim.sh            # claim all never-published pkgs (prompts)
#   scripts/npm-name-claim.sh --check    # report status only; no build/publish
#   scripts/npm-name-claim.sh --yes      # skip per-package confirmation
#   scripts/npm-name-claim.sh <name...>  # limit to specific package name(s)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CHECK_ONLY=0
ASSUME_YES=0
ONLY_NAMES=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) ONLY_NAMES="$ONLY_NAMES $arg" ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1" >&2; }

# Returns one of: published | unclaimed | version-pending | unknown
# - published:       name exists AND current version is already on npm
# - unclaimed:       name does not exist on npm (404) — name-claim candidate
# - version-pending: name exists but current version isn't on npm yet
#                    (an established package mid-release — OIDC's job)
# - unknown:         npm errored for some other reason (network/auth)
npm_state() {
  name="$1"; version="$2"
  if name_out="$(npm view "$name" version 2>&1)"; then
    if npm view "$name@$version" version >/dev/null 2>&1; then
      echo "published"
    else
      echo "version-pending"
    fi
  elif printf '%s' "$name_out" | grep -qiE 'E404|404 Not Found|is not in this registry'; then
    echo "unclaimed"
  else
    echo "unknown"
  fi
}

bold "==> npm login"
if ! NPM_USER="$(npm whoami 2>/dev/null)"; then
  red "Not logged in to npm. Run 'npm login' as a @valve-tech maintainer, then re-run."
  exit 1
fi
echo "Logged in as: $NPM_USER"
echo

CLAIMED=""
SKIPPED=""
NEEDS_META=""
CLAIM_LIST=""

for pkg_dir in packages/*/; do
  pkg_json="${pkg_dir}package.json"
  [ -f "$pkg_json" ] || continue

  is_private="$(node -p "require('./$pkg_json').private === true" 2>/dev/null || echo false)"
  [ "$is_private" = "true" ] && continue

  name="$(node -p "require('./$pkg_json').name")"
  version="$(node -p "require('./$pkg_json').version")"

  if [ -n "$ONLY_NAMES" ] && ! printf '%s' "$ONLY_NAMES" | grep -qw "$name"; then
    continue
  fi

  state="$(npm_state "$name" "$version")"

  case "$state" in
    published)
      echo "  $(green "published     ") $name@$version (latest line already on npm)"
      SKIPPED="$SKIPPED $name"
      ;;
    version-pending)
      echo "  $(yellow "release-pending") $name@$version (established pkg — publishes via the v* tag, NOT here)"
      SKIPPED="$SKIPPED $name"
      ;;
    unknown)
      red "  unknown        $name — npm view failed (network/auth?). Skipping to be safe."
      SKIPPED="$SKIPPED $name"
      ;;
    unclaimed)
      echo "  $(bold "UNCLAIMED      ") $name@$version (never published — name-claim candidate)"
      repo_url="$(node -p "(require('./$pkg_json').repository||{}).url||''")"
      if [ -z "$repo_url" ]; then
        NEEDS_META="$NEEDS_META $name"
      fi
      if [ "$CHECK_ONLY" -eq 0 ]; then
        CLAIM_LIST="$CLAIM_LIST $pkg_dir"
      fi
      ;;
  esac
done

# Surface a metadata problem before publishing anything: a missing
# repository.url name-claims fine but 422s the later OIDC publish.
if [ -n "$NEEDS_META" ]; then
  echo
  red "These unclaimed packages are MISSING package.json repository.url:"
  for n in $NEEDS_META; do red "  - $n"; done
  red "Name-claim works without it, but the first OIDC publish will 422."
  red "Add the repository block (mirror chain-source/package.json) first."
  exit 1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo
  bold "Check-only mode — nothing built or published."
  exit 0
fi

if [ -z "${CLAIM_LIST:-}" ]; then
  echo
  green "Nothing to claim — every publishable package already exists on npm."
  exit 0
fi

for pkg_dir in $CLAIM_LIST; do
  name="$(node -p "require('./${pkg_dir}package.json').name")"
  version="$(node -p "require('./${pkg_dir}package.json').version")"
  echo
  bold "==> Name-claiming $name@$version"

  yarn workspace "$name" build

  bold "Tarball contents (expect only the package.json 'files' allowlist):"
  ( cd "$pkg_dir" && npm pack --dry-run )

  if [ "$ASSUME_YES" -eq 0 ]; then
    echo
    echo "Publicly publishes $name@$version. Cannot be undone (except npm unpublish within 72h)."
    read -r -p "Publish? [y/N] " REPLY
    case "$REPLY" in
      y|Y|yes|YES) ;;
      *) yellow "Skipped $name."; SKIPPED="$SKIPPED $name"; continue ;;
    esac
  fi

  ( cd "$pkg_dir" && npm publish --access public )
  green "✓ claimed $name@$version"
  CLAIMED="$CLAIMED $name"
done

echo
bold "================ summary ================"
[ -n "$CLAIMED" ] && green "claimed:$CLAIMED" || echo "claimed: (none)"
[ -n "$SKIPPED" ] && echo "skipped:$SKIPPED"

if [ -n "$CLAIMED" ]; then
  cat <<EOF

NEXT — for EACH newly-claimed package, configure its trusted-publisher
record (web UI — cannot be scripted):
  https://npmjs.com/settings/valve-tech/publishing
    Publisher:         GitHub Actions
    Repository owner:  valve-tech
    Repository name:   evm-toolkit
    Workflow filename: release.yml
    Environment:       (leave BLANK)

And make sure each has a 'Publish <name>' step in
.github/workflows/release.yml (run: yarn verify:release-coverage).
Then bump the synced version and let the v* tag publish them via OIDC.
EOF
fi
