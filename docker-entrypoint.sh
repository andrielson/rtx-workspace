#!/bin/bash

# Fail on errors, unset vars, and pipefail for robust startup
set -euo pipefail

if [ "$(id -un)" != "root" ]; then
  echo "This entrypoint must be run as root." >&2
  exit 1
fi

run_user_install() {
  curl -fsSL "${USER_INSTALL_URL:-http://nginx/user-install.sh}" | gosu ubuntu bash
}

load_env() {
  if [ -z "${HOMEBREW_REPOSITORY:-}" ] && [ -s /home/linuxbrew/.linuxbrew/bin/brew ]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"
  fi

  if [ -z "${NVM_BIN:-}" ] && [ -s "${NVM_DIR}/nvm.sh" ]; then
    source "${NVM_DIR}/nvm.sh"
  fi

  if [ -z "${SDKMAN_PLATFORM:-}" ] && [ -s "${SDKMAN_DIR}/bin/sdkman-init.sh" ]; then
    set +euo pipefail
    source "${SDKMAN_DIR}/bin/sdkman-init.sh"
    set -euo pipefail
  fi
}

load_env

command -v opencode >/dev/null || run_user_install

exec "$@"
