#!/bin/bash

# Fail on errors, unset vars, and pipefail for robust startup
set -euo pipefail

if [ "$(id --user --name)" != "root" ]; then
  echo "This entrypoint must be run as root." >&2
  exit 1
fi

wait_for_user_install_url() {
  local url="${USER_INSTALL_URL:-http://nginx/user-install.sh}"
  local attempt

  # nginx may still be booting when a fresh stack starts both containers;
  # gate the one-shot install on reachability instead of racing it.
  for attempt in $(seq 1 60); do
    curl --fail --silent --show-error --output /dev/null "$url" && return 0
    echo "Waiting for ${url} (attempt ${attempt}/60)..." >&2
    sleep 2
  done

  echo "Timed out waiting for ${url}." >&2
  return 1
}

run_user_install() {
  wait_for_user_install_url
  curl --fail --silent --show-error --location "${USER_INSTALL_URL:-http://nginx/user-install.sh}" | gosu ubuntu bash
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
