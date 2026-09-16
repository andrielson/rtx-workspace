#!/bin/bash

# Fail on errors, unset vars, and pipefail for robust startup
set -euo pipefail

wait_for_user_install_url() {
  local url="${USER_INSTALL_URL:-https://raw.githubusercontent.com/andrielson/rtx-workspace/refs/heads/main/src/user-install.sh}"
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
  curl --fail --silent --show-error --location "${USER_INSTALL_URL:-https://raw.githubusercontent.com/andrielson/rtx-workspace/refs/heads/main/src/user-install.sh}" | gosu ubuntu bash
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

mirror_user_environment() {
  # The Environment mirror: a one-way projection of the container
  # environment into the User environment file, regenerated wholesale at
  # every boot — a container recreated with new or removed variables stays
  # projected onto every shell surface (see ADR 0006). It runs before the
  # first-boot decision so fresh and kept volumes alike carry today's
  # environment; a failure aborts the boot rather than serving a stale file.
  gosu ubuntu home-env-mirror
}

main() {
  # id's exit status is irrelevant here: the string comparison is the check.
  # shellcheck disable=SC2312
  if [[ "$(id --user --name)" != 'root' ]]; then
    echo 'This entrypoint must be run as root.' >&2
    exit 1
  fi

  local user_install_check

  ensure_docker_socket_group
  mirror_user_environment

  # The bootstrap sentinel: the command whose presence marks the volume as
  # already provisioned. Defaults to bun — the last bundle the Bootstrap
  # script runs — so a failed bundle before it leaves the sentinel missing
  # and the next boot re-runs the bootstrap; ENTRYPOINT_USER_INSTALL_CHECK
  # overrides it for deployments whose essential command differs. A value
  # containing whitespace is a typo that could never resolve and would
  # silently re-provision on every boot — validated on every boot, not just
  # provisioning ones, so it cannot lurk unnoticed behind the kill-switch.
  user_install_check="${ENTRYPOINT_USER_INSTALL_CHECK:-bun}"
  if [[ "${user_install_check}" =~ [[:space:]] ]]; then
    echo "ENTRYPOINT_USER_INSTALL_CHECK must be a single command name, got '${user_install_check}'." >&2
    exit 1
  fi

  # SKIP_USER_INSTALL=1 skips first-boot provisioning on any boot — the
  # escape hatch for coming up without the bootstrap (and its nginx
  # dependency). Exactly '1': anything else, including '0' or empty, boots
  # as usual.
  if [[ "${SKIP_USER_INSTALL:-}" != '1' ]]; then
    command -v "${user_install_check}" > /dev/null || run_user_install
  fi

  # sshd has no long options; -D stays in the foreground, -e logs to stderr,
  # -f selects the ubuntu-only config.
  exec /usr/sbin/sshd -D -e -f /etc/sshd/sshd_config_ubuntu
}

# Arguments replace the boot flow entirely: a one-off container runs its
# command directly — no root requirement, no socket-group setup, no nginx
# wait, no provisioning. exec never returns, so main is reached only when
# the entrypoint was invoked with zero arguments.
if [[ $# -gt 0 ]]; then
  exec "$@"
fi

main
