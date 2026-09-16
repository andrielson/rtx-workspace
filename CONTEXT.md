# rtx-workspace

A container-based remote development workspace: one GPU-enabled Linux container the developer SSHes into, which fetches first-boot install assets from an nginx sibling. This context covers how the image and its Tests stack are described.

## Language

**Tests stack**:
The compose file under `tests/`; declared in full (no extends) with a throwaway identity — its own project name, container name, project-scoped volume, dummy environment, throwaway published SSH port — so it can run beside any live deployment, and both of its builds use the `src/` context through the tracked `tests/src` symlink.
_Avoid_: test compose, CI stack

**Web root**:
The nginx document root (`/usr/share/nginx/html/`) from which workspaces fetch the Bootstrap script at first boot; in-repo, the Tests stack's baked nginx image is the only mechanism that populates it (bind sources resolve daemon-side, where the repo's `/nix` volume paths do not exist) — any real deployment provides its own server.
_Avoid_: static files, www

**Bootstrap script**:
`user-install.sh`, the script a workspace fetches from nginx and runs as the ubuntu user when its `/nix` volume is fresh.
_Avoid_: installer, setup script

**Bundle**:
A named group of Bootstrap-script packages and setup steps toggled off by its `SKIP_USER_INSTALL_<NAME>` variable holding exactly `1`; `linux` is the always-on bundle the others lean on, and a skip variable shapes only the provisioning run — never an already-provisioned volume.
_Avoid_: feature, profile slice, package group

**User environment file**:
The single file in the ubuntu home that projects the container environment onto every shell surface; pure exports regenerated at every boot, never hand-edited and never carrying a PATH literal (the Env loader reconstructs PATH).
_Avoid_: bash env file, env file, profile

**Environment mirror**:
The entrypoint's one-way, every-boot regeneration of the User environment file from the container environment (image ENV, Compose env file, runtime-injected vars); the file is a projection of the container environment, never a second source of truth.
_Avoid_: env merge, env sync

**Env loader**:
The single static script wired into every shell-activation surface — login shells, interactive non-login shells, and non-interactive shells through `BASH_ENV` — that applies the PATH hooks and sources the User environment file.
_Avoid_: hook, profile script

**Default profile**:
The Nix profile the Bootstrap script installs in one unattended `nix profile add` of the union of the enabled bundles' `nixpkgs#` packages (the flake-registry shorthand resolves to nixpkgs-unstable); `yq` rides under the nixpkgs attr `yq-go`.
_Avoid_: tool set, package list

**Carve-outs**:
The tools deliberately installed outside the read-only Nix store, each through its bundle's vendor step: uv and the Python it manages (`python`) through uv's official installer, the self-updating agent CLIs (`claude`, `opencode`) through their vendor scripts, Node through fnm — interactive-only, as nvm was (`node`) — and Bun and Rust through their vendor installers (`bun`, `rust` — bun.sh and rustup both move faster than a pinned profile and self-update).
_Avoid_: exceptions, manual installs

**Image contract**:
What the workspace image delivers on its own, before the Bootstrap script ever runs: Nix itself (single-user as `ubuntu` under `/nix`), the slim apt runtime baseline, and the sshd/entrypoint/PATH-hook plumbing; the complement of what the first boot installs (the default Nix profile and user state).
_Avoid_: Dockerfile contract, base image contents

**Release**:
A versioned publication of the workspace image, identified by one semver `vX.Y.Z` tag shared by the git tag, the GitHub Release and the registry image tag; cut by merging a pull request that moves the version, never assembled by hand.
_Avoid_: deploy, rollout, version bump
