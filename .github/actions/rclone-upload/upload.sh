#!/usr/bin/env bash
#
# Pushes a directory of installers to a cloud folder with rclone, so the folder
# always holds the newest nightly build and nothing older.
#
# The backend is a parameter, so moving between providers is a config change rather
# than a rewrite: 'dropbox' needs only the token, while an S3-compatible bucket
# (Cloudflare R2, Backblaze B2) takes its static keys through extra-config and has
# no OAuth involved at all. For the OAuth backends the token is whatever
# `rclone authorize "<backend>"` prints -- no cloud console, no service account.
#
# "Replace the previous version" is an upload of everything in the build followed by
# the removal of the artifacts the build no longer produces, so last night's
# XGENIA-2.1.0.dmg goes when XGENIA-2.1.1.dmg arrives. On Dropbox that lands in
# Deleted files, recoverable for 30 days. Both halves are bounded by the same
# artifact filter and only ever look at the top level of the target, so notes and
# sub-folders sitting alongside the builds cannot be touched.
#
# Note the deliberate copy-then-delete instead of `rclone sync`: sync also prunes
# directories it considers empty, and with an artifact filter applied every
# sub-folder of the target looks empty to it -- in testing it removed one.
#
# Everything arrives by environment variable, so no credential reaches a command
# line where it could show up in a process listing.
#
# Linux runners only. rclone is pinned: the official release zip for the version pinned
# below is downloaded, checked against a hash carried in this script, and that binary is
# the one every call uses -- never whatever happens to be on PATH. Ubuntu's apt package is
# 1.60.1 (2022) while this script is developed against 1.75, and the two disagree about
# which flags `rclone copy` accepts, so "some rclone" is not good enough. The
# `rclone-version` action input can override the pin; see that block for what it costs.
set -euo pipefail

REMOTE_TYPE="${RCLONE_REMOTE_TYPE:-}"
REMOTE_PATH="${RCLONE_REMOTE_PATH:-}"
TOKEN="${RCLONE_TOKEN:-}"
EXTRA_CONFIG="${RCLONE_EXTRA_CONFIG:-}"
SOURCE_DIR="${RCLONE_SOURCE_DIR:-}"
INCLUDE_PATTERNS="${RCLONE_INCLUDE_PATTERNS:-}"
REQUIRE_EXTENSIONS="${RCLONE_REQUIRE_EXTENSIONS:-}"
FOLDER_URL="${RCLONE_FOLDER_URL:-}"
DRY_RUN="${RCLONE_DRY_RUN:-false}"

die() {
  echo "::error::$*"
  exit 1
}

[ -n "$REMOTE_TYPE" ] || die "remote-type is required."
[ -n "$SOURCE_DIR" ] || die "source-dir is required."
[ -d "$SOURCE_DIR" ] || die "source-dir '$SOURCE_DIR' does not exist."

if [ -z "$TOKEN" ] && [ -z "$EXTRA_CONFIG" ]; then
  echo "::warning::No credentials configured, so the build artifacts were not uploaded." \
    "Run 'rclone authorize \"$REMOTE_TYPE\"' and store the JSON it prints as the rclone token secret to enable it."
  exit 0
fi

TARGET="nightly:${REMOTE_PATH}"

# --- the filter that selects what to upload and bounds what may be removed -----
PATTERN_FILE="$(mktemp)"
printf '%s\n' "$INCLUDE_PATTERNS" | tr -d '\r' | sed -e 's/[[:space:]]*$//' -e '/^[[:space:]]*$/d' > "$PATTERN_FILE"
grep -qvE '^[[:space:]]*[#;]' "$PATTERN_FILE" \
  || die "include-patterns is empty. Refusing to run, because an empty filter would match nothing at all."
echo "Artifact patterns (nothing outside these can be uploaded or removed):"
sed 's/^/  /' "$PATTERN_FILE"

# --- refuse to upload a build that is missing a platform ------------------------
# Without this, a platform whose build produced no installer would look exactly like
# "this artifact is gone now", and the previous version would be removed for it.
if [ -n "$REQUIRE_EXTENSIONS" ]; then
  missing=""
  IFS=',' read -ra wanted <<< "$REQUIRE_EXTENSIONS"
  for ext in "${wanted[@]}"; do
    ext="${ext//[[:space:]]/}"
    ext="${ext#.}"
    [ -n "$ext" ] || continue
    if ! compgen -G "$SOURCE_DIR/*.${ext}" > /dev/null; then
      missing="$missing .$ext"
    fi
  done
  [ -z "$missing" ] || die "The build output has no$missing in it. Refusing to upload, because that would" \
    "remove the previous$missing from the folder. Check the platform build jobs, or set require-extensions to '' to override."
fi

echo "Files to upload:"
ls -lh "$SOURCE_DIR" | tail -n +2 | sed 's/^/  /'

# --- rclone --------------------------------------------------------------------
# The hash is for the pinned default only. Overriding the version means there is
# nothing to compare against locally, so the download is verified against the
# SHA256SUMS rclone publishes beside it and the weaker check is called out.
PINNED_VERSION="1.75.0"
PINNED_SHA256_amd64="aa2804e08f48250e71009c727124b6341cd0288465804a9a09d14663cabafbaa"
PINNED_SHA256_arm64="d0ad88ba4c8e285b7c9efa591e0ab643280a91741e13c27f3a9c0957ccfa5203"

# Deliberately not called RCLONE_VERSION: rclone reads exported RCLONE_<FLAG>
# variables as flags, and --version is one, which would make every call print the
# version and exit.
VERSION="${UPLOAD_RCLONE_VERSION:-$PINNED_VERSION}"
VERSION="${VERSION#v}"

case "$(uname -m)" in
  x86_64 | amd64) ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) die "Unsupported architecture '$(uname -m)'. This action runs on linux amd64 or arm64." ;;
esac

RCLONE_BIN="$(command -v rclone || true)"
if [ -n "$RCLONE_BIN" ] && [ "$("$RCLONE_BIN" version 2> /dev/null | head -1)" = "rclone v$VERSION" ]; then
  echo "Using the rclone already on this runner, which is the pinned v$VERSION"
else
  ARCHIVE="rclone-v${VERSION}-linux-${ARCH}"
  WORK="$(mktemp -d)"
  echo "Downloading rclone v$VERSION ($ARCH)"
  curl -fsSL --retry 3 --retry-delay 2 \
    -o "$WORK/$ARCHIVE.zip" "https://downloads.rclone.org/v${VERSION}/${ARCHIVE}.zip" \
    || die "Could not download rclone v$VERSION for $ARCH. Check that the version exists at downloads.rclone.org."

  sha_var="PINNED_SHA256_${ARCH}"
  expected="${!sha_var:-}"
  if [ "$VERSION" != "$PINNED_VERSION" ]; then
    echo "::warning::rclone v$VERSION was requested instead of the pinned v$PINNED_VERSION," \
      "so it is verified against the published SHA256SUMS rather than a hash pinned in this action."
    expected="$(curl -fsSL --retry 3 "https://downloads.rclone.org/v${VERSION}/SHA256SUMS" \
      | awk -v f="${ARCHIVE}.zip" '$2 == f { print $1 }')"
    [ -n "$expected" ] || die "No published checksum for ${ARCHIVE}.zip. Refusing to run an unverified binary."
  fi

  actual="$(sha256sum "$WORK/$ARCHIVE.zip" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || die "Checksum mismatch on ${ARCHIVE}.zip." \
    "Expected $expected but got $actual. Refusing to run it."

  unzip -q -o "$WORK/$ARCHIVE.zip" -d "$WORK" || die "Could not unpack ${ARCHIVE}.zip."
  RCLONE_BIN="$WORK/$ARCHIVE/rclone"
  chmod +x "$RCLONE_BIN"
  echo "Verified sha256 $actual"
fi

"$RCLONE_BIN" version | head -1

# A throwaway config file rather than RCLONE_CONFIG_* env vars, so that rclone has
# somewhere to write a refreshed token instead of logging a failure every run. It
# holds a live credential, so it goes away with the step -- on a self-hosted runner
# the temp directory outlives the job.
export RCLONE_CONFIG="$(mktemp)"
chmod 600 "$RCLONE_CONFIG"
cleanup() {
  rm -f "$RCLONE_CONFIG"
  # The unpacked rclone is not a credential, but a self-hosted runner keeps its
  # temp directory, so it goes too.
  [ -n "${WORK:-}" ] && rm -rf "$WORK"
  return 0
}
trap cleanup EXIT
{
  echo "[nightly]"
  echo "type = $REMOTE_TYPE"
  if [ -n "$TOKEN" ]; then
    printf 'token = %s\n' "$(printf '%s' "$TOKEN" | tr -d '\r\n')"
  fi
  if [ -n "$EXTRA_CONFIG" ]; then
    printf '%s\n' "$EXTRA_CONFIG" | tr -d '\r' | sed -e '/^[[:space:]]*$/d'
  fi
} > "$RCLONE_CONFIG"

DRY_ARGS=()
if [ "$DRY_RUN" = "true" ]; then
  DRY_ARGS=(--dry-run)
  echo "::notice::Dry run: reporting what would change without uploading or deleting anything."
fi

# Proves the credential works and that we can write, and creates the destination on
# the first run. mkdir is a no-op when it is already there.
echo "Checking access to $TARGET"
"$RCLONE_BIN" mkdir "$TARGET" "${DRY_ARGS[@]}" \
  || die "Could not reach '$TARGET'. Check that the rclone token is valid and that the path exists" \
    "or can be created by this account."

# --include-from and --max-depth are filter flags every command takes. --files-only
# is a *listing* flag: recent rclone happens to accept it on `copy` too, but the
# apt-installed rclone on the runner rejects it outright ("unknown flag:
# --files-only"), so the transfer and the listings cannot share one array. It is
# only needed on the listings anyway, to keep sub-folder names out of the
# comparison that decides what gets deleted.
FILTER=(--include-from "$PATTERN_FILE" --max-depth 1)
LIST_FILTER=("${FILTER[@]}" --files-only)

"$RCLONE_BIN" copy "$SOURCE_DIR" "$TARGET" \
  "${FILTER[@]}" \
  --verbose --stats-one-line --stats 30s --stats-log-level NOTICE \
  "${DRY_ARGS[@]}"

# A previous version is an artifact that is in the folder but not in this build.
# Reading both sides through the same filter, files only and top level only, means
# nothing else in the folder can end up on the list. A listing failure is tolerated
# as "nothing there yet" -- access was already proven above, and an empty list can
# only ever mean fewer deletions.
REMOTE_LIST="$(mktemp)"
SOURCE_LIST="$(mktemp)"
STALE_LIST="$(mktemp)"
"$RCLONE_BIN" lsf "$TARGET" "${LIST_FILTER[@]}" 2> /dev/null | sort > "$REMOTE_LIST" || true
"$RCLONE_BIN" lsf "$SOURCE_DIR" "${LIST_FILTER[@]}" | sort > "$SOURCE_LIST"
comm -23 "$REMOTE_LIST" "$SOURCE_LIST" > "$STALE_LIST"

if [ -s "$STALE_LIST" ]; then
  echo "Previous versions to remove (recoverable from the provider's trash):"
  sed 's/^/  /' "$STALE_LIST"
  if [ "$DRY_RUN" = "true" ]; then
    echo "Dry run: leaving them in place."
  else
    "$RCLONE_BIN" delete "$TARGET" --files-from "$STALE_LIST" --verbose
  fi
else
  echo "No previous versions to remove."
fi

# --- report --------------------------------------------------------------------
listing="$("$RCLONE_BIN" lsf "$TARGET" "${LIST_FILTER[@]}" --format "ps" --separator "|" 2> /dev/null || true)"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Nightly builds on ${REMOTE_TYPE^}"
    echo
    if [ "$DRY_RUN" = "true" ]; then
      echo "_Dry run -- the folder was left as it was._"
      echo
    fi
    if [ -n "$FOLDER_URL" ]; then
      echo "[Open the shared folder]($FOLDER_URL)"
      echo
    fi
    echo "| File | Size |"
    echo "| --- | --- |"
    printf '%s\n' "$listing" | awk -F'|' 'NF >= 2 {
      size = $2; unit = "B";
      if (size >= 1048576) { size = size / 1048576; unit = "MB" }
      else if (size >= 1024) { size = size / 1024; unit = "KB" }
      printf "| %s | %.1f %s |\n", $1, size, unit
    }'
  } >> "$GITHUB_STEP_SUMMARY"
fi

echo "::notice::$REMOTE_TYPE now holds $(printf '%s\n' "$listing" | grep -c . ) build artifact(s) in ${REMOTE_PATH:-the remote root}"
