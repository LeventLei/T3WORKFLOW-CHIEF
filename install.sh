#!/usr/bin/env bash
# Install the self-contained skill; optionally merge a managed project block.
# Usage: bash install.sh [existing-project-directory]
set -euo pipefail

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[[ $# -le 1 ]] || die 'expected at most one project directory'
[[ $# -eq 0 || -n $1 ]] || die 'project directory must not be empty'
[[ -n ${HOME:-} ]] || die 'HOME must not be empty'
[[ -n ${CHIEF_SKILL_DIR-unset} ]] || die 'CHIEF_SKILL_DIR must not be empty'
for command_name in realpath dirname basename awk cmp cp mkdir mktemp mv iconv tr; do
  command -v "$command_name" >/dev/null || die "missing command: $command_name"
done

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SKILL_SRC="$REPO_DIR/skills/chief-t3"
AGENTS_SRC="$REPO_DIR/AGENTS.md"
PAYLOAD=(SKILL.md templates/HANDOFF.md templates/TASK.md templates/TASK.report.md templates/TASK.review.md)
BEGIN_MARK='<!-- chief-t3:begin -->'
END_MARK='<!-- chief-t3:end -->'

# Resolve without creating directories; reject symlinks before resolving them.
check_components() {
  local path="$1" parent
  while :; do
    [[ ! -L $path ]] || die "symlink path is not supported: $path"
    parent="$(dirname -- "$path")"
    [[ $parent != "$path" ]] || break
    path="$parent"
  done
}
canonical() {
  [[ $1 != *$'\n'* && $1 != *$'\r'* ]] || die 'newline in path'
  check_components "$1"
  local path="$1"
  case "$OSTYPE" in
    msys*|cygwin*)
      command -v cygpath >/dev/null || die 'missing command: cygpath'
      path="$(cygpath -au -- "$path")" ;;
  esac
  # Check before realpath so a symlink cannot be hidden by canonicalization.
  check_components "$path"
  realpath -m -- "$path"
}
validate_dir() {
  local path="$1"
  check_components "$path"
  while [[ ! -e $path ]]; do path="$(dirname -- "$path")"; done
  [[ -d $path && -w $path && -x $path ]] || die "directory is not writable: $path"
}
validate_file_target() {
  local path="$1"
  check_components "$path"
  [[ ! -e $path || ( -f $path && -r $path && -w $path ) ]] || die "invalid file target: $path"
  validate_dir "$(dirname -- "$path")"
}
validate_source() {
  check_components "$1"
  [[ -f $1 && -r $1 && -s $1 ]] || die "missing or invalid source: $1"
}
overlap() {
  local first="$1" second="$2"
  case "$OSTYPE" in msys*|cygwin*) first="${first,,}"; second="${second,,}" ;; esac
  [[ $first == "$second" || $first == "$second/"* || $second == "$first/"* ]]
}
filesystem_root() {
  [[ $1 == / ]] && return 0
  case "$OSTYPE" in msys*|cygwin*) [[ $1 =~ ^/[a-zA-Z]$ ]] && return 0 ;; esac
  return 1
}

# Managed text must be UTF-8 without NUL bytes. Reject UTF-16/32 and
# malformed input before any destination, backup, or ledger is written.
validate_utf8() {
  iconv -f UTF-8 -t UTF-8 "$1" >/dev/null 2>&1 || die "expected UTF-8 text: $1"
  cmp -s -- "$1" <(LC_ALL=C tr -d '\000' < "$1") || die "NUL bytes / UTF-16 or UTF-32 are not supported: $1"
}

# Duplicate, nested or unmatched managed markers are rejected pre-write.
validate_markers() {
  validate_utf8 "$1"
  awk -v BINMODE=3 -v begin="$BEGIN_MARK" -v end="$END_MARK" -v required="$2" '
    { line=$0; sub(/\r$/, "", line) }
    line==begin { if (inside || count) exit 1; inside=1; count++; next }
    line==end { if (!inside) exit 1; inside=0; next }
    END { if (inside || (required && count!=1)) exit 1 }
  ' "$1" || die "invalid Chief markers: $1"
}

SKILL_DST="$(canonical "${CHIEF_SKILL_DIR-$HOME/.agents/skills/chief-t3}")"
filesystem_root "$SKILL_DST" && die 'cannot install into filesystem root'
overlap "$SKILL_SRC" "$SKILL_DST" && die 'skill source and destination must not be identical or nested'
validate_dir "$SKILL_DST"
for relative in "${PAYLOAD[@]}"; do
  validate_source "$SKILL_SRC/$relative"
  validate_file_target "$SKILL_DST/$relative"
done
validate_source "$AGENTS_SRC"
validate_markers "$AGENTS_SRC" 1

PROJECT=''
if [[ $# -eq 1 ]]; then
  PROJECT="$(canonical "$1")"
  [[ -d $PROJECT ]] || die "project directory must already exist: $PROJECT"
  filesystem_root "$PROJECT" && die 'cannot use filesystem root as project'
  validate_dir "$PROJECT"
  overlap "$PROJECT" "$SKILL_DST" && die 'project and skill destination must not overlap'
  TARGET="$PROJECT/AGENTS.md"
  validate_file_target "$TARGET"
  [[ ! -e $TARGET ]] || validate_markers "$TARGET" 0
  LEDGER="$(canonical "$HOME/.t3-tasks/$(basename -- "$PROJECT")")"
  overlap "$LEDGER" "$SKILL_DST" && die 'ledger and skill destination must not overlap'
  overlap "$LEDGER" "$PROJECT" && die 'ledger and project must not overlap'
  validate_dir "$LEDGER"
  validate_file_target "$LEDGER/HANDOFF.md"
fi

# Render without touching a file so comparisons and validation precede writes.
render_agents() {
  awk -v BINMODE=3 -v template="$AGENTS_SRC" -v begin="$BEGIN_MARK" -v end="$END_MARK" '
    function block( i) { for (i=1; i<=n; i++) print lines[i] }
    BEGIN { while ((getline line < template)>0) lines[++n]=line; close(template) }
    { line=$0; sub(/\r$/, "", line) }
    line==begin { block(); inside=1; found=1; next }
    line==end { inside=0; next }
    !inside { print }
    END { if (!found) { if (NR) print ""; block() } }
  ' "${1:-/dev/null}"
}

# All input preflight is complete. Back up each differing owned file first;
# unknown files and existing ledger contents are never removed or overwritten.
mkdir -p -- "$SKILL_DST"
SKILL_BACKUP=''
for relative in "${PAYLOAD[@]}"; do
  source_file="$SKILL_SRC/$relative"
  target_file="$SKILL_DST/$relative"
  if [[ -f $target_file ]] && cmp -s -- "$source_file" "$target_file"; then continue; fi
  if [[ -f $target_file ]]; then
    if [[ -z $SKILL_BACKUP ]]; then
      SKILL_BACKUP="$(mktemp -d "$SKILL_DST/.chief-t3-backup.XXXXXXXX")"
      printf 'Backup: %s\n' "$SKILL_BACKUP"
    fi
    mkdir -p -- "$SKILL_BACKUP/$(dirname -- "$relative")"
    cp -p -- "$target_file" "$SKILL_BACKUP/$relative"
  fi
  mkdir -p -- "$(dirname -- "$target_file")"
  stage_file="$(mktemp "$(dirname -- "$target_file")/.chief-t3-stage.XXXXXXXX")"
  cp -p -- "$source_file" "$stage_file"
  mv -f -- "$stage_file" "$target_file"
done
printf 'Skill: %s\n' "$SKILL_DST"

if [[ -n $PROJECT ]]; then
  if [[ ! -e $TARGET ]] || ! cmp -s -- "$TARGET" <(render_agents "$TARGET"); then
    if [[ -f $TARGET ]]; then
      project_backup="$(mktemp "$TARGET.bak.XXXXXXXX")"
      cp -p -- "$TARGET" "$project_backup"
      printf 'Backup: %s\n' "$project_backup"
    fi
    stage_file="$(mktemp "$PROJECT/.chief-t3-agents.XXXXXXXX")"
    [[ ! -f $TARGET ]] || cp -p -- "$TARGET" "$stage_file"
    if [[ -e $TARGET ]]; then render_agents "$TARGET" > "$stage_file";
    else render_agents > "$stage_file"; fi
    mv -f -- "$stage_file" "$TARGET"
  fi
  mkdir -p -- "$LEDGER"
  [[ -f $LEDGER/HANDOFF.md ]] || cp -- "$SKILL_SRC/templates/HANDOFF.md" "$LEDGER/HANDOFF.md"
  printf 'Project: %s\nLedger: %s\n' "$TARGET" "$LEDGER"
fi
printf 'Installation complete. Reload skills using your provider-supported method.\n'
