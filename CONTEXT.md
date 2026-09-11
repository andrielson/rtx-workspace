# rtx-workspace

A container-based remote development workspace: one GPU-enabled Linux container the developer SSHes into, plus an nginx sidecar serving first-boot install assets. This context covers how that stack is described and layered.

## Language

**Base compose**:
The compose file under `src/` that is the single source of truth for the workspace service (everything except GPU reservation), its named `/nix` volume, and the nginx service; every stack derives from it by `extends`.
_Avoid_: main compose, source-of-truth compose

**Prod overlay**:
The root compose file; extends the Base compose into the real, long-running stack by adding the GPU reservation, the gateway network, the stable container name, and the SSH port.
_Avoid_: production compose, docker-compose.prod

**Tests stack**:
The compose file under `tests/`; extends the Base compose with a throwaway identity — overridden container name, isolated network, fresh volume, dummy environment, throwaway published SSH port — so it can run beside the real stack.
_Avoid_: test compose, CI stack

**Web root**:
The nginx document root (`/usr/share/nginx/html/`) where the Base compose bind-mounts the Bootstrap script and from which workspaces fetch it.
_Avoid_: static files, www

**Bootstrap script**:
`user-install.sh`, the script a workspace fetches from nginx and runs as the ubuntu user when its `/nix` volume is fresh.
_Avoid_: installer, setup script

**Default profile**:
The Nix profile the Bootstrap script installs in one unattended `nix profile add` of `nixpkgs#` packages (the flake-registry shorthand resolves to nixpkgs-unstable) — every stable toolchain and everyday CLI (GraalVM CE and the JVM build tools, Go, PHP + Composer, the daily CLIs, the everyday utilities); `yq` rides under the nixpkgs attr `yq-go`.
_Avoid_: tool set, package list

**Carve-outs**:
The tools deliberately installed outside the read-only Nix store: uv through its official installer, the self-updating agent CLIs (Claude Code, OpenCode) through their vendor scripts, Node through fnm (interactive-only, as nvm was), and Bun and Rust through their vendor installers (bun.sh, rustup — both move faster than a pinned profile and self-update).
_Avoid_: exceptions, manual installs

**Image contract**:
What the workspace image delivers on its own, before the Bootstrap script ever runs: Nix itself (single-user as `ubuntu` under `/nix`), the slim apt runtime baseline, and the sshd/entrypoint/PATH-hook plumbing; the complement of what the first boot installs (the default Nix profile and user state).
_Avoid_: Dockerfile contract, base image contents
