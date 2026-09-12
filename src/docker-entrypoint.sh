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

# group_add decorates only the container's own process tree; sshd rebuilds
# every session's groups from /etc/group (initgroups — UsePAM is off), so
# without a matching entry there, docker calls from an SSH shell die on
# EACCES at the socket. The socket's own group is the GID source of truth:
# it is what the kernel checks, and it needs no compose interpolation.
ensure_docker_socket_group() {
  local docker_gid

  # Every stack mounts the socket, but the image must boot without one too —
  # a missing socket is a no-op, not a boot failure.
  [[ -S /var/run/docker.sock ]] || return 0
  docker_gid="$(stat --format=%g /var/run/docker.sock)"

  if ! getent group "${docker_gid}" > /dev/null; then
    groupadd --gid "${docker_gid}" 'docker-socket'
  fi
  usermod --append --groups "${docker_gid}" ubuntu
}

ensure_docker_socket_group

command -v opencode > /dev/null || run_user_install

exec "$@"
