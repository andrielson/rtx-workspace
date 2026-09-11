# Install Nix into the Ubuntu image as the workspace toolchain mechanism

The tool-install half of the Bootstrap script (Homebrew, SDKMAN, nvm, curl-script
CLIs) plus the image's scratch-copied toolchains (rust, go, bun, shellcheck,
shfmt, the docker CLI) delivered dev tools with no shared mechanism, and the
ad-hoc any-version-side-by-side requirement ruled out apt pinning. We adopt Nix —
the package manager, not NixOS — installed into the Ubuntu image at build time,
single-user as `ubuntu` from the pinned official tarball (2.35.2 in the spike;
`--no-channel-add --no-daemon`, flakes on, `sandbox = false`, the standard
container posture): home moves to `/nix/ubuntu` so a single `/nix` named volume
persists store, profiles (XDG layout, `~/.local/state/nix/profiles`) and user
state across container recreation, `/home` and the scratch-copy stages retire in
favour of a slim apt baseline that keeps `libatomic1` (vendor binaries link it;
Nix binaries are self-contained via store RPATHs), Homebrew is dropped (ad-hoc
dependencies go through `nix profile install`) and `sudo` goes with it, as it
existed for Homebrew. The image bakes Nix only — 445 MB, 121 MB of it the `/nix`
seed the volume copy-up duplicates — while the nginx sidecar and the
fetch-until-bootstrapped loop stay exactly as they are: the Bootstrap script is
still downloaded and run at first boot (with `setup_git`, `setup_ssh` and
`write_bashrc_env` unchanged), now performing one unattended `nix profile
install` of the default profile (measured: 31 s first boot, ≈ 4 GB substituted
from cache.nixos.org; 6 s recreates once the provisioning marker skips it; 4.4 GB
volume). The default profile takes every stable toolchain and CLI — SDKMAN's set
including GraalVM CE, rust, go, php + composer, bun, gh, yq (as `yq-go`),
shellcheck, shfmt, the docker CLI — while three carve-outs stay outside the
read-only store: `uv` through its official installer (unchanged, torch `cu132`
under `UV_TORCH_BACKEND`; uv-managed CPython and torch wheels bundle their own
runtimes and never touch the store — the residual risk is vendor binaries
against the slim baseline, Node's `libatomic1` need being the precedent,
mitigated by baseline additions as discovered), the self-updating agent CLIs
`claude-code` and `opencode` through their recommended install scripts (they
rewrite their own binary, which a store path forbids), and Node binaries via
`fnm` from the Nix profile, replacing nvm (`fnm install --lts`, interactive-only
as before). The version UX stays ad-hoc: any version a nixpkgs revision carries,
side by side, with latest-on-demand defaulting to
`github:NixOS/nixpkgs/nixpkgs-unstable#…` (bare `nixpkgs#` resolves through the
pinned registry, not a moving ref). Nothing in the default profile is unfree, so
first-boot installs run pure; ad-hoc unfree needs `NIXPKGS_ALLOW_UNFREE=1` plus
`--impure` (`allow-unfree` is not a `nix.conf` setting). Activation rides three
PATH hooks — image `ENV` for bare `docker exec`, `/etc/profile.d` for SSH login
shells, and a guarded export above the interactive guard in `~/.bashrc` for
`ssh host <cmd>`; root execs get `HOME=/root` and miss the home wiring (an admin
escape hatch, not a surface), and the `/dev/tcp` sshd probe leaves harmless
"Connection closed" noise in `docker logs`. Evidence: the throwaway spike on
branch `prototype/nix-layer-a-spike`, 26/26 checks. Executing the migration is
the next effort, and the CONTEXT.md terms that move — Image contract, Bootstrap
script, Web root — change in that effort, not before.

## Amendments

- 2026-09-10, during the migration (#13): Bun and Rust left the default
  profile and joined the carve-outs through their vendor installers (bun.sh,
  rustup) — both release faster than a pinned profile tracks, and both
  self-update (`bun upgrade`, `rustup update`).
- 2026-09-10: the baked `UV_TORCH_BACKEND` default flipped from `cu132` to
  `cpu` — the workspace targets a broad audience where a GPU is the
  exception, not the rule; GPU boots override the env per run.
- 2026-09-10: `build-essential` joined the apt baseline (compilation-based
  installs such as `go install` need gcc); `libatomic1` stays present
  transitively through it.
- 2026-09-10: the Bootstrap script installs with `nix profile add nixpkgs#…`
  — `nix profile install` is that command's deprecated alias, and the
  registry shorthand resolves to nixpkgs-unstable exactly like the explicit
  flake ref.
