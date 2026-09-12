# Env loader: the single activation point of the user environment. Every shell
# surface reaches this script — /etc/profile.d for login shells (SSH logins,
# `bash --login`), the top of /etc/bash.bashrc for interactive non-login
# shells (VS Code terminals, `docker exec -it ... bash`) and, through
# Debian's bash patch (which routes sshd-spawned command shells around
# BASH_ENV and into /etc/bash.bashrc), for `ssh host <cmd>` too, and BASH_ENV
# — injected by sshd's SetEnv into every session and inherited by everything
# its server processes spawn locally — for the non-interactive shells with
# no init file of their own (the Bash tools of the coding agents: ZCode,
# Claude Code, Codex; OpenCode needs shell=bash). One shell may arrive
# through two paths (a login shell runs /etc/profile.d and, being
# interactive, /etc/bash.bashrc), so the exported flag makes
# double-sourcing a no-op. $HOME is used instead of a literal so non-ubuntu
# shells stay harmless (their User environment file simply does not exist).

if [[ -n "${RTX_ENV_LOADED:-}" ]]; then
  return 0
fi

export RTX_ENV_LOADED=1

# PATH hooks for the Nix profile (see ADR 0003): login shells arrive here
# after /etc/profile resets PATH; every other surface inherits a PATH that may
# already carry the directories — hence the membership guard instead of a bare
# prepend. .local/bin rides along because the uv installer targets it and
# .cargo/bin because rustup does, both outside the read-only store; the set
# mirrors the image ENV PATH, the docker-exec surface.
for profile_bin in "${HOME}/.local/bin" "${HOME}/.cargo/bin" "${HOME}/.nix-profile/bin"; do
  if [[ -d "${profile_bin}" ]]; then
    case ":${PATH:-}:" in
      *":${profile_bin}:"*) ;;
      *)
        PATH="${profile_bin}:${PATH:-}"
        ;;
    esac
  fi
done

unset profile_bin

export PATH

# The User environment file: a projection of the container environment,
# regenerated at every boot by the Environment mirror (see ADR 0006).
if [[ -s "${HOME}/.bash_env" ]]; then
  source "${HOME}/.bash_env"
fi
