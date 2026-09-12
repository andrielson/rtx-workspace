#!/bin/bash

# The Environment mirror: regenerates the User environment file (~/.bash_env)
# from the current container environment. The entrypoint runs this as ubuntu
# at every boot, so a container recreated with new or removed variables stays
# projected onto every shell surface (see ADR 0006). The file is a one-way
# projection — never hand-edited; personal variables belong in the Compose env
# file (.env.service), the only channel that feeds the container environment
# with user-specific values.

# Fail on errors, unset vars, and pipefail for robust startup
set -euo pipefail

# id's exit status is irrelevant here: the string comparison is the check.
# shellcheck disable=SC2312
if [[ "$(id --user --name)" != 'ubuntu' ]]; then
  echo 'This script must be run as the ubuntu user.' >&2
  exit 1
fi

bash_env="${HOME}/.bash_env"

# Same atomic shape as the Bootstrap script's authorized_keys swap: write the
# replacement beside the target, then rename over it. A failure anywhere above
# aborts the entrypoint (the environment contract is worth a failed boot, not a
# silently stale file).
bash_env_tmp="$(mktemp "${HOME}/.bash_env.XXXXXX")"

{
  echo '# Generated at every boot from the container environment (see ADR 0006).'
  echo '# Do not edit: personal variables belong in the Compose env file.'
  # If the env in the process substitution fails there is simply nothing left
  # to export, which is not a reason to abort the mirror.
  # shellcheck disable=SC2312
  while IFS= read -r -d '' entry; do
    key="${entry%%=*}"
    value="${entry#*=}"

    # Skip what sshd and bash set themselves, shell bookkeeping, the
    # entrypoint's own inputs (potentially multi-line), and this design's own
    # loading machinery. PATH is never projected: the Env loader reconstructs
    # it on every surface, so a stale literal can never shadow profile changes.
    case "${key}" in
      '' | BASH_ENV | HOME | LOGNAME | MAIL | OLDPWD | PATH | PWD | RTX_ENV_LOADED | SHELL | SHLVL | SSH_AUTHORIZED_KEY | TERM | USER | _)
        continue
        ;;
      *)
        # Everything else falls through to the export below.
        ;;
    esac

    case "${value}" in
      '')
        continue
        ;;
      *)
        # Non-empty values fall through to the export below.
        ;;
    esac

    printf 'export %s=%q\n' "${key}" "${value}"
  done < <(env --null)
} > "${bash_env_tmp}"

chmod 600 "${bash_env_tmp}"
mv --verbose "${bash_env_tmp}" "${bash_env}"
