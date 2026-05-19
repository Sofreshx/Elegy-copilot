#!/usr/bin/env bash

resolve_hook_python() {
  local candidate
  for candidate in "${HOOK_PYTHON_BIN:-}" python.exe py.exe py python3 python; do
    if [[ -n "$candidate" ]] && command -v "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

normalize_hook_path_for_python() {
  local python_bin="$1"
  local input_path="$2"

  case "$python_bin" in
    *.exe|py)
      if command -v wslpath >/dev/null 2>&1; then
        wslpath -aw "$input_path"
        return 0
      fi
      if command -v cygpath >/dev/null 2>&1; then
        cygpath -aw "$input_path"
        return 0
      fi
      ;;
  esac

  printf '%s\n' "$input_path"
}

run_python_hook() {
  local script_dir="${1:?script_dir is required}"
  shift
  local python_bin
  python_bin="$(resolve_hook_python)" || {
    echo "Missing supported Python interpreter on PATH." >&2
    return 1
  }

  local normalized_script_dir
  normalized_script_dir="$(normalize_hook_path_for_python "$python_bin" "$script_dir")"

  local tmp_py
  tmp_py="$(mktemp "${TMPDIR:-/tmp}/ie-hook-XXXXXX.py")"
  cat >"$tmp_py"

  local python_entrypoint
  python_entrypoint="$(normalize_hook_path_for_python "$python_bin" "$tmp_py")"

  local had_errexit=0
  if [[ $- == *e* ]]; then
    had_errexit=1
    set +e
  fi

  HOOK_SCRIPT_DIR="$normalized_script_dir" "$python_bin" "$python_entrypoint" "$@" <&3
  local status=$?

  if (( had_errexit )); then
    set -e
  fi

  rm -f "$tmp_py"
  return $status
}
