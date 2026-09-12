# Make the container environment the single source of truth for the ubuntu user

ZCode's Bash tool, run inside the SSH'd workspace, could not see the variables
in `~/.bash_env`: it spawns a local non-interactive non-login `bash -c` as a
child of its server process, and that shell reads no init file of its own —
only the file named by `BASH_ENV`, which nothing set. The file itself loaded
exclusively through `/etc/profile.d` (login shells), the image ENV never
crossed sshd (OpenSSH builds each session's environment from scratch under
`UsePAM no`), and Ubuntu's Debian rc patch only reaches sshd-spawned command
shells (socket stdin), not local spawns — established live with marker tests,
a `bash -v` probe and a `BASH_ENV` proof in the debugging session that
produced this record. We therefore adopt the container environment — image
`ENV`, the Compose env file (`.env.service`) and runtime-injected variables
(NVIDIA) — as the single source of truth for the ubuntu user, and project it
onto every shell surface: the entrypoint runs `home-env-mirror` as ubuntu via
gosu at every boot, before the first-boot decision and fatally on failure,
regenerating `~/.bash_env` (the User environment file) wholesale as pure
exports — skipping what sshd and bash set themselves, shell bookkeeping, the
entrypoint's own inputs, `PATH`, `BASH_ENV` and the loader's idempotence flag
— and never a PATH literal, so a stale capture can never shadow profile
changes; personal variables belong in `.env.service`, deletions propagate on
recreate, and no second writer exists (the bootstrap's `write_bashrc_env` is
removed). Activation rides one Env loader, `/etc/profile.d/01-home-bash-env.sh`
(an exported `RTX_ENV_LOADED` flag makes double-sourcing a no-op;
membership-guarded PATH hooks for `~/.local/bin`, `~/.cargo/bin` and
`~/.nix-profile/bin`, mirroring the image ENV set; then the file is sourced),
reached three ways: `/etc/profile.d` for login shells (SSH logins,
`bash --login -c`), the top of `/etc/bash.bashrc` for interactive non-login
shells (VS Code terminals, `docker exec -it ... bash`; `/etc/profile` also
sources that file for interactive logins, which the flag absorbs) and —
pinned empirically: pipe-spawned bash reads `BASH_ENV`, socket-spawned
sshd command shells do not — for `ssh host <cmd>` too, since Debian's bash
patch routes that shell around `BASH_ENV` and into `/etc/bash.bashrc`,
whose own non-interactive guard would stop anything below it, and sshd's
`SetEnv BASH_ENV=/etc/profile.d/01-home-bash-env.sh` for everything a
session's server processes spawn locally without an init file of their own
— the VS Code Remote/Zed servers and the coding agents' Bash tools down
their trees (Claude Code and Codex spawn bash, Codex even injecting its own
`BASH_ENV` to the same target when shell snapshots are on; OpenCode
defaults to `/bin/sh`, which is dash and ignores `BASH_ENV` — `shell: bash`
in its config opts in).
`docker exec` needs no wiring: it carries the container environment natively
(the image ENV PATH hook stays). `~/.bashrc` is stock again — the build-time
prepend is gone and `02-home-nix-profile.sh` retires, its hooks folded into
the loader. Known boundaries, accepted: root execs (`HOME=/root`) miss the
home wiring (an admin escape hatch, as before); non-bash children of
long-lived servers see only the inherited environment until the server
restarts (a fresh session fixes it, and recreate kills every process
anyway); and `/etc/bash.bashrc` is a package conffile — an in-container
`apt upgrade` of bash could drop the head lines, which a rebuild restores.
Evidence: the probes above plus the suite — sshd_config and `/etc/bash.bashrc`
wiring assertions, a stock `~/.bashrc`, `printenv BASH_ENV` and a nested
`bash -c` carrying mirrored variables on the SSH surface, the generation
header after a restart, and a `MIRROR_PROBE` variable added at recreate
reaching the SSH surface through the regenerated file.

## Amendments
