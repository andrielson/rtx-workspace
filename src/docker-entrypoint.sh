#!/bin/bash

# Fail on errors, unset vars, and pipefail for robust startup
set -euo pipefail

# id's exit status is irrelevant here: the string comparison is the check.
# shellcheck disable=SC2312
if [[ "$(id --user --name)" != 'root' ]]; then
  echo 'This entrypoint must be run as root.' >&2
  exit 1
fi

wait_for_user_install_url() {
  local url="${USER_INSTALL_URL:-http://nginx/user-install.sh}"
  local attempt

  # nginx may still be booting when a fresh stack starts both containers;
  # gate the one-shot install on reachability instead of racing it.
  for attempt in $(seq 1 60); do
    curl --fail --head --silent --show-error --output /dev/null "${url}" && return 0
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

command -v opencode > /dev/null || run_user_install

exec "$@"
