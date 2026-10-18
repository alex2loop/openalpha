#!/bin/sh
# Installs or upgrades OpenAlpha from its latest GitHub release:
#   curl -fsSL https://raw.githubusercontent.com/alex2loop/openalpha/main/install.sh | sh
# It installs one self-contained binary with Bun built in, so nothing else is set up. Your data dir
# and config are never touched. Settings, all optional:
#   OPENALPHA_VERSION=v1.2.0     install that release instead of the latest
#   OPENALPHA_INSTALL_DIR=<dir>  where the binary goes (default ~/.local/bin)
#   OPENALPHA_NO_ONBOARD=1       skip the first-run model setup (also skipped when CI is set)
#   OPENALPHA_NO_MODIFY_PATH=1   leave shell profiles alone and print the PATH line instead
set -eu

REPOSITORY="alex2loop/openalpha"
COMMAND="openalpha"
INSTALL_DIR="${OPENALPHA_INSTALL_DIR:-$HOME/.local/bin}"

# say <english> <vietnamese>
say() {
  if [ "$MESSAGE_LANGUAGE" = "vi" ]; then
    printf '%s\n' "$2"
  else
    printf '%s\n' "$1"
  fi
}

fail() {
  say "$1" "$2" >&2
  exit 1
}

# HTTPS only, redirects included.
fetch() {
  curl --proto '=https' --tlsv1.2 "$@"
}

require() {
  command -v "$1" >/dev/null 2>&1 \
    || fail "I need $1 to $2. Install it, then run this again." \
         "Cần có $1 để $3. Cài $1 rồi chạy lại script này nhé."
}

# The file a login shell reads PATH from; empty for a shell we do not know how to edit.
shell_profile() {
  case "$(basename "${SHELL:-}")" in
    zsh) printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [ "$(uname -s)" = "Darwin" ]; then
        printf '%s' "$HOME/.bash_profile"
      else
        printf '%s' "$HOME/.bashrc"
      fi
      ;;
  esac
}

latest_tag() {
  fetch -fsSI "https://github.com/$REPOSITORY/releases/latest" \
    | tr -d '\r' \
    | awk 'tolower($1) == "location:" { n = split($2, part, "/"); print part[n] }'
}

# The release asset for this machine, named the way `bun run build:all` names it.
asset_name() {
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) fail "This script is for macOS and Linux. On Windows, run install.ps1 from PowerShell instead." \
         "Script này dành cho macOS và Linux. Trên Windows, hãy chạy install.ps1 trong PowerShell." ;;
  esac

  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    arm64 | aarch64) arch="arm64" ;;
    *) fail "There is no OpenAlpha build for a $(uname -m) processor." \
         "Chưa có bản OpenAlpha cho bộ xử lý $(uname -m)." ;;
  esac

  printf '%s' "$COMMAND-$os-$arch"
}

# shasum is a Perl script, and Perl warns on every run under a locale the OS lacks (vi_VN on macOS).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    LC_ALL=C shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

# Downloads next to the target and renames over it: a running daemon keeps its old file, and a cut
# download never leaves a half-written command on PATH.
install_binary() {
  base="https://github.com/$REPOSITORY/releases/download/$TAG"
  part="$INSTALL_DIR/.$COMMAND.download"
  sums="$INSTALL_DIR/.$COMMAND.sha256sums"
  trap 'rm -f "$part" "$sums"' EXIT

  mkdir -p "$INSTALL_DIR"
  { fetch -fsSL "$base/SHA256SUMS" -o "$sums" && fetch -fL --progress-bar "$base/$ASSET" -o "$part"; } \
    || fail "I couldn't download $TAG. Run this script again in a minute." \
         "Chưa tải được $TAG. Đợi một phút rồi chạy lại script này nhé."

  expected="$(awk -v name="$ASSET" '$2 == name { print $1 }' "$sums")"
  [ -n "$expected" ] && [ "$(sha256_of "$part")" = "$expected" ] \
    || fail "The download doesn't match its checksum, so I didn't install it. Run this script again." \
         "Tệp tải về không khớp mã kiểm tra nên tôi chưa cài. Chạy lại script này nhé."

  chmod 755 "$part"
  keep_previous
  mv -f "$part" "$INSTALL_DIR/$COMMAND"
}

# The release being replaced stays next to the new one as `.old`, as `openalpha upgrade` keeps it,
# so `upgrade --rollback` goes back to it. A filesystem without hard links gets a copy, written under
# a temporary name first so a copy cut short (a full disk) never becomes the rollback copy.
keep_previous() {
  [ -x "$INSTALL_DIR/$COMMAND" ] || return 0
  rm -f "$INSTALL_DIR/$COMMAND.old"
  ln "$INSTALL_DIR/$COMMAND" "$INSTALL_DIR/$COMMAND.old" 2>/dev/null && return 0
  if cp -p "$INSTALL_DIR/$COMMAND" "$INSTALL_DIR/$COMMAND.old.part" 2>/dev/null; then
    mv -f "$INSTALL_DIR/$COMMAND.old.part" "$INSTALL_DIR/$COMMAND.old"
  else
    rm -f "$INSTALL_DIR/$COMMAND.old.part"
  fi
}

wire_path() {
  PATH_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""
  PROFILE="$(shell_profile)"
  [ -z "${OPENALPHA_NO_MODIFY_PATH:-}" ] || PROFILE=""

  case ":$PATH:" in
    *":$INSTALL_DIR:"*) return ;;
  esac

  if [ -n "$PROFILE" ]; then
    grep -qsF "$PATH_LINE" "$PROFILE" || printf '\n# %s\n%s\n' "$COMMAND" "$PATH_LINE" >>"$PROFILE"
    NEW_TERMINAL="yes"
  else
    say "One more thing: put OpenAlpha on your PATH by adding this line to your shell profile:" \
      "Thêm một bước: đưa OpenAlpha vào PATH bằng cách thêm dòng này vào tệp cấu hình shell:"
    printf '  %s\n' "$PATH_LINE"
  fi
}

# `curl | sh` hands the script's stdin to the pipe, so the setup reads the terminal directly. It is
# left for the operator on an upgrade, without a terminal, in CI (where a pseudo-terminal would wait
# for a keypress forever) or when asked. A setup that stops prints its own reason.
run_onboard() {
  [ "$FIRST_INSTALL" = "yes" ] || return 0
  [ -z "${CI:-}" ] && [ -z "${OPENALPHA_NO_ONBOARD:-}" ] || return 0
  { : </dev/tty; } 2>/dev/null || return 0

  ONBOARD="stopped"
  "$INSTALL_DIR/$COMMAND" onboard </dev/tty && ONBOARD="done"

  # A stopped setup is not a failed install, and `set -e` would read this function's status as one.
  return 0
}

# Everything runs from here, called on the last line: a download cut off mid-script defines
# functions and runs nothing.
main() {
  case "${LC_ALL:-${LANG:-}}" in
    vi*) MESSAGE_LANGUAGE="vi" ;;
    *) MESSAGE_LANGUAGE="en" ;;
  esac

  require curl "install OpenAlpha" "cài OpenAlpha"
  ASSET="$(asset_name)"

  TAG="${OPENALPHA_VERSION:-$(latest_tag || true)}"
  TAG="v${TAG#v}"

  case "$TAG" in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "I couldn't find a release to install on GitHub. Check your connection, or pin one with OPENALPHA_VERSION=v1.2.0." \
         "Tôi chưa tìm được bản phát hành nào trên GitHub. Kiểm tra kết nối, hoặc chọn bản cụ thể với OPENALPHA_VERSION=v1.2.0." ;;
  esac

  FIRST_INSTALL="yes"
  [ -x "$INSTALL_DIR/$COMMAND" ] && FIRST_INSTALL="no"

  say "Installing OpenAlpha $TAG..." "Đang cài OpenAlpha $TAG..."
  install_binary

  NEW_TERMINAL="no"
  wire_path

  # An upgrade moves a background daemon onto the new binary and prints the version itself; a pinned
  # install must not be pulled past the release it asked for.
  if [ "$FIRST_INSTALL" = "no" ] && [ -z "${OPENALPHA_VERSION:-}" ]; then
    "$INSTALL_DIR/$COMMAND" upgrade || true
  else
    "$INSTALL_DIR/$COMMAND" version
  fi

  ONBOARD="skipped"
  [ "$FIRST_INSTALL" = "yes" ] || ONBOARD="upgraded"
  run_onboard

  if [ "$NEW_TERMINAL" = "yes" ]; then
    say "Open a new terminal so \`$COMMAND\` is on your PATH." \
      "Mở một terminal mới để dùng được lệnh \`$COMMAND\`."
  fi

  case "$ONBOARD" in
    done|upgraded) say "All set." "Xong rồi." ;;
    skipped) say "All set. Next, run \`$COMMAND onboard\` to pick your AI model." \
      "Xong rồi. Tiếp theo, chạy \`$COMMAND onboard\` để chọn mô hình AI." ;;
  esac
}

main "$@"
