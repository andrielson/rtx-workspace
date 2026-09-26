# Atlassian TWG CLI — install research (can it go through nix?)

## Executive summary

The Atlassian **TWG CLI** is the command line interface to the Atlassian **Teamwork Graph** ("a command line interface to the Atlassian Teamwork Graph and Cloud services"), an agent-first CLI that lets a coding agent (or a human) query Jira, Confluence, Bitbucket, Atlas, JSM, Assets, people and teams. The binary is called **`twg`**. It is a **standalone signed native binary** — the docs state plainly: "The TWG CLI binary does not require a separate runtime (for example, no Node.js)." Its public home is [github.com/atlassian/twg-cli](https://github.com/atlassian/twg-cli) (Apache-2.0, a "curated public front door" — "The private engineering source of truth remains Atlassian's internal TWG CLI repository").

Distribution is vendor-CDN-first: a curl-script installer (the only recommended POSIX channel), macOS `.pkg`, Windows PowerShell script and signed MSIs, plus a beta-channel script. An **official npm channel exists (`@atlassian/twg-cli`)** but is undocumented on the docs page and lags the direct channel (1.2.5 vs stable 1.3.1). Homebrew was retired in 1.0.9; there is no apt/yum repo and no Docker image.

**Nix verdict: not installable via nixpkgs today, and not a good nix fit anyway.**

- It is **not in nixpkgs** (checked `pkgs/by-name/tw` and `pkgs/by-name/at` listings plus a code search over `NixOS/nixpkgs` — details below).
- The `nodePackages` escape hatch is **gone**: nixpkgs removed the entire set in the 26.05 release notes.
- Upstream ships **no flake** (the public repo has docs/skills/plugins only, no packaging), and — decisively — `twg` has a **built-in self-rewriting upgrader** (`twg upgrade`, plus automatic upgrade checks during normal use), which a read-only store path forbids. That is exactly ADR 0003's `claude-code`/`opencode` carve-out criterion.

**Recommendation for this workspace:** a vendor-installer carve-out in the always-on `linux` bundle, using the documented script with unattended flags — `_curl https://teamwork-graph.atlassian.com/cli/install | bash -s -- --yes --skip-login --skip-skills` — landing the binary in `~/.local/bin/twg` (already on PATH). The npm channel is a documented fallback only (stale versions, and it would tie `twg` to the skippable, interactive-only `NODE` bundle).

Facts checked live in this workspace (read-only): `command -v twg` finds nothing — **no binary-name collision**; `fnm`, `node`, `npm` resolve (node via an fnm multishell), `nix` and `gh` from `~/.nix-profile/bin`; host is `x86_64`.

## What the CLI is and its channels

- Docs landing page: <https://developer.atlassian.com/cloud/twg-cli/> → installation guide at <https://developer.atlassian.com/cloud/twg-cli/getting-started/installation/>.
- Binary: `twg` (`twg.exe` on Windows). Current releases: **stable 1.3.1** (manifest `publishedAt` 2026-09-19), **beta 1.3.2** (2026-09-24, "Available through the beta channel only; not yet generally available" per the changelog).
- Runtime needs: none beyond glibc. Verified by downloading `twg-linux-x64-v1.3.1` (95,929,824 bytes; SHA256 matched the CDN's `SHA256SUMS-v1.3.1` entry `f158bc06…`): `ldd` shows only `libc.so.6`, `libm.so.6`, `libpthread.so.0`, `libdl.so.2` — no `libatomic1` need (unlike the Node precedent in ADR 0003), fine against the slim Ubuntu baseline.
- Platforms: the docs' "Before you begin" says "You need macOS (arm64 or x64), Linux (x64), or Windows (arm64 or x64)" — but the installer script accepts `arm64|aarch64` and `x86_64` on Linux, and the CDN publishes **both `twg-linux-x64-v1.3.1` and `twg-linux-arm64-v1.3.1`** with checksums (the npm channel mirrors this with `@atlassian/twg-cli-linux-arm64`). So linux aarch64 works in practice even though the docs sentence omits it — relevant because this image is multi-arch (`TARGETARCH`, aarch64 nix tarball in `src/Dockerfile`).
- Self-update: "Run the built-in upgrader: `twg upgrade`" and "TWG CLI checks for upgrades during normal use and notifies you when a new version is available." (installation guide). `AGENTS.md` and the changelog use `twg update` for the same mechanism, with `--channel beta|stable`, `--version <v>` pinning, and channel minimum-version policies. The upgrader rewrites the installed binary in place (MSI-managed installs are the exception: they must re-run the MSI).

## Distribution channels

| Channel                                              | Exact install command (from the docs / installer)                                                                                                                                                                                            | Self-updates?                                                                                      | linux x86_64 / aarch64?                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **curl script (recommended, macOS/Linux)**           | `curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install \| bash` — pin with `\| bash -s -- --version <v>` (or `TWG_VERSION` env); flags: `--yes`, `--skip-login`, `--skip-skills`, `--install-dir <path>`, `--plugin <agent>` | Yes — `twg upgrade` (`twg update`), plus automatic checks that notify; rewrites `~/.local/bin/twg` | x86_64 documented; aarch64 accepted by the script and published on the CDN |
| Beta channel (first install)                         | `bash <(curl -fsSL https://teamwork-graph.atlassian.com/cli/beta/install)`                                                                                                                                                                   | Same upgrader, `--channel beta`                                                                    | Same as stable                                                             |
| macOS `.pkg`                                         | Download `https://teamwork-graph.atlassian.com/cli/install.pkg`, run in Finder (or `/usr/sbin/installer -pkg … -target CurrentUserHomeDirectory`)                                                                                            | No — re-download the pkg                                                                           | n/a                                                                        |
| Windows PowerShell                                   | `curl.exe -fsSL https://teamwork-graph.atlassian.com/cli/install.ps1 -o twg-install.ps1` then `powershell -ExecutionPolicy Bypass -File .\twg-install.ps1` (not from Git Bash/MINGW/WSL)                                                     | Upgrader can't update MSI-managed installs; re-run the MSI                                         | n/a                                                                        |
| Windows MSI (signed)                                 | `https://teamwork-graph.atlassian.com/cli/twg-windows-x64.msi` / `…-arm64.msi` via `msiexec.exe /i …`                                                                                                                                        | No — re-run the latest MSI                                                                         | n/a                                                                        |
| **npm (official but undocumented on the docs page)** | `npm install --global @atlassian/twg-cli` — bin `twg` → `launcher.cjs` → platform pkg `@atlassian/twg-cli-linux-x64/bin/twg`; `engines: node >=22`; no postinstall                                                                           | npm-managed; the binary's own `twg upgrade` behavior under npm is not documented                   | Both, via `@atlassian/twg-cli-linux-{x64,arm64}`                           |
| Homebrew                                             | — retired: changelog 1.0.9 ("Custom Homebrew distribution path retired"); duplicates warned against since 1.0.0                                                                                                                              | —                                                                                                  | —                                                                          |
| apt / yum / Docker                                   | none documented                                                                                                                                                                                                                              | —                                                                                                  | —                                                                          |

Notes on the npm channel (verified against the npm registry and unpkg): maintained by `atlassianartifactteam` <eng-development-tooling-artifacts@atlassian.com>, repository `github.com/atlassian/twg-cli`, first publish 2026-08-11, only three versions (`1.2.4`, `1.1.1`, `1.2.5`, published out of chronological order), last on **2026-08-24** — a month behind the direct channel's 1.3.1. It exists and is genuinely Atlassian's, but it looks secondary and stale.

Integrity and versioning of the direct channel: the installer fetches `https://teamwork-graph.atlassian.com/cli/SHA256SUMS-v<version>` and verifies the download (the script has a `checksum_failed` error path), a `manifest.json` on the CDN names the current stable version, assets and checksums URL, and `--version`/`TWG_VERSION` pin a specific release. Caveats: the installer appends `export PATH="${HOME}/.local/bin:$PATH"` to the shell profile (guarded by a grep for its own exact string, so it appends once even though the Env loader already covers that dir — redundant but harmless), and it posts anonymous install telemetry to `as.atlassian.com` (best-effort, `|| true`).

## The nix verdict

**In nixpkgs? No.** Where I looked (all on `NixOS/nixpkgs` `master`, via the GitHub API and code search):

- `pkgs/by-name/tw/` directory listing (30 entries, `twa` … `twurl`): no `twg`.
- `pkgs/by-name/at/` listing: Atlassian presence is only `atlassian-plugin-sdk`; no `twg`.
- `gh search code --repo NixOS/nixpkgs twg`: only false positives (`sha256-…TWg…` base64/hash substrings, "WHATWG" mentions) — no package definition.

**Via `nodePackages`? Impossible now.** The nixpkgs 26.05 release notes (`doc/release-notes/rl-2605.section.md`, line 117) state: "The `nodePackages` package set has been removed entirely from nixpkgs. […] After a long time, this package set has been deprecated and removed. If you are using its package set in your own config, please use the top-level packages instead." The old `pkgs/development/node-packages/` directory (and its `node-packages.json`) no longer exists — the path 404s on `master`. So `nix profile add nixpkgs#nodePackages.<anything>` is not a route for any npm package anymore, and `@atlassian/twg-cli` was never among them anyway.

**Via a non-nixpkgs nix install? Technically possible, wrong here.** Nothing upstream packages it for nix: the public `atlassian/twg-cli` repo has no `flake.nix` (contents are `docs/`, `plugins/`, `skills/`, README/CHANGELOG/etc.), GitHub Releases are empty, and the real source repo is private. A hand-rolled derivation fetching the checksummed CDN binary would work mechanically, but this repo's Bootstrap only uses `nix profile add nixpkgs#…`, so it would mean maintaining an out-of-tree flake — and it collides with the store contract anyway: `twg upgrade` **rewrites its own binary**, which a read-only store path forbids. ADR 0003 already names this exact class: "the self-updating agent CLIs `claude-code` and `opencode` through their recommended install scripts (they rewrite their own binary, which a store path forbids)."

**Via the fnm-managed Node with `npm install --global`? Possible fallback.** The workspace already keeps npm globals outside the store (Node via `fnm`, ADR 0003), and `fnm install --lts` (currently Node 24) satisfies the package's `node >=22`. But it is the weaker path: the channel is undocumented on Atlassian's docs page, lags a month behind, `twg` would then resolve only in interactive shells (fnm is interactive-only, per `setup_node`), and it would live in the skippable `NODE` bundle while the maintainer asked for the always-on `linux` bundle.

**Recommended path for THIS workspace: the vendor-installer carve-out**, exactly like `claude-code`/`opencode`/`bun`/`rustup`/`uv`. It is the one channel Atlassian documents, checksums and pins; the binary lands outside the store where its self-upgrader can rewrite it.

## How it would land in the linux bundle

The `linux` bundle is "the always-on bundle, with no skip variable" (`src/user-install.sh`, `install_nix_profile`): its packages join the hard-coded `packages+=(…)` array and its setup steps run unconditionally in `install_bundles` (`setup_completions`, `setup_git`, `setup_ssh`) before the vendor bundles. Since `twg` needs a vendor installer, the natural landing is a step function there — not a `nixpkgs#…` array entry.

Proposed addition to `src/user-install.sh`:

```bash
install_twg() {
  _log 'Installing the Atlassian TWG CLI...'
  # bash has no long option for -s (read the installer from stdin). The flags
  # make the install unattended: consent (--yes), no OAuth login (it reads
  # /dev/tty), no agent-skills write into the agent harness homes.
  _curl https://teamwork-graph.atlassian.com/cli/install | bash -s -- --yes --skip-login --skip-skills
}
```

and in `install_bundles`, after `setup_ssh` (so the just-landed linux profile's `curl` is present) and before `run_bundle PYTHON …`:

```bash
setup_completions
setup_git
setup_ssh
install_twg
```

Why this holds against ADR 0003's carve-out criteria:

- **Self-update / store-rewrite**: `twg upgrade` is a built-in upgrader with automatic checks; it rewrites the binary the installer placed in `~/.local/bin/twg`. A nix profile generation could never host that — same reasoning that put `claude-code` and `opencode` on vendor scripts.
- **Vendor binary on the slim baseline**: the only observed dynamic dependencies are glibc's `libc`/`libm`/`libpthread`/`libdl` — no `libatomic1`-style gap; nothing to add to the apt baseline.
- **Everything the installer needs is already there**: `curl` arrives with the linux profile (and apt's copy exists as a bootstrap fallback), `~/.local/bin` is on PATH through the image `ENV` and the Env loader (`src/01-home-bash-env.sh` prepends it first), and the installer's own PATH-append to `~/.bashrc` is a harmless duplicate.
- **Unattended-clean**: with `--yes --skip-login --skip-skills` the installer's finalize step carries consent explicitly and passes `--allow-login-failure`; login (OAuth, `/dev/tty`) is deferred to the user. A partial-boot re-run is safe — the installer replaces the binary idempotently (`--wait-for-pid` exists precisely for replacing an in-use binary) and twg's own channel updates take over afterwards. A failure aborts the boot before the bun sentinel, so the next boot retries — the same partial-failure semantics as every other bundle step.
- **Multi-arch**: both `twg-linux-x64` and `twg-linux-arm64` are published with checksums, so the step works on the image's aarch64 builds too (the docs' "Linux (x64)" sentence understates the actual artifact matrix).
- **Integrity/reproducibility**: the installer verifies the CDN's `SHA256SUMS-v<version>`; if the maintainer ever wants a pinned first boot, `--version <v>` (or `TWG_VERSION`) is available — left unpinned here to match how bun/rustup/uv are handled.

## Open questions for the maintainer

1. **Auth UX (the real first-boot question).** `twg login` is OAuth-first and reads `/dev/tty`; headless container users must either run `twg login` interactively over SSH or set `TWG_TOKEN`/`TWG_USER` env vars (the changelog's CI/headless auth, 1.0.23). Recommendation: install with `--skip-login` and leave auth entirely to the user — but confirm, and decide whether the README should document `TWG_TOKEN`/`TWG_USER` for this workspace.
2. **Agent skills.** `twg setup` can install agent skills (`twg skills install`, canonical home location since 1.0.21). First boot skips them (`--skip-skills`); should a later step offer skills for the baked agent harnesses (`claude-code`, `opencode`), or stay opt-in? Opt-in is safer — those bundles are skippable and may not exist.
3. **Telemetry.** The installer (and per the changelog, the CLI) send anonymous telemetry to `as.atlassian.com`. No opt-out flag is documented on the install page; acceptable, or should we look for one before merging?
4. **Channel and pinning.** Stable latest (proposed), stable pinned via `--version`, or the beta channel (`twg upgrade --channel beta`)? Stable-unpinned matches the other vendor carve-outs.
5. **Skip gate.** "Bundle: linux" means always-on (that bundle deliberately has no skip variable). If an operator ever needs to opt out of just this CLI, the mechanism would be a new `run_bundle TWG install_twg` gate (`SKIP_USER_INSTALL_TWG=1`) — one line, but it departs from "linux has no skip variable". Confirm the always-on placement is intended.

## Sources

- Atlassian docs — TWG CLI landing: <https://developer.atlassian.com/cloud/twg-cli/>
- Atlassian docs — installation guide (quotes: platforms, curl command, `twg upgrade`, "no Node.js"): <https://developer.atlassian.com/cloud/twg-cli/getting-started/installation/>
- Atlassian docs — changelog (1.3.1/1.3.2, brew retirement, npm companion packages, `TWG_TOKEN`/`TWG_USER`, `--yes --skip-login --skip-skills` in 1.2.1): <https://developer.atlassian.com/cloud/twg-cli/changelog/>
- Installer script (inspected; usage block, platform matrix, `INSTALL_DIR`, checksum verification, telemetry): <https://teamwork-graph.atlassian.com/cli/install>
- Agent instructions (install path `$HOME/.local/bin/twg`, `twg update`, `/dev/tty` login): <https://teamwork-graph.atlassian.com/cli/AGENTS.md>
- Release manifest (stable 1.3.1, assets, checksums URL): <https://teamwork-graph.atlassian.com/cli/manifest.json>
- Release checksums (both linux arches published): <https://teamwork-graph.atlassian.com/cli/SHA256SUMS-v1.3.1>
- Public repo (front door, Apache-2.0, no flake, internal source private): <https://github.com/atlassian/twg-cli>
- npm registry — `@atlassian/twg-cli` (maintainers, versions, engines, bin): <https://registry.npmjs.org/@atlassian%2Ftwg-cli>, package page <https://www.npmjs.com/package/@atlassian/twg-cli>, launcher source <https://unpkg.com/@atlassian/twg-cli@1.2.5/launcher.cjs>
- nixpkgs `master` — `pkgs/by-name/tw` and `pkgs/by-name/at` listings and code search via the GitHub API; `nodePackages` removal in `doc/release-notes/rl-2605.section.md`: <https://github.com/NixOS/nixpkgs/blob/master/doc/release-notes/rl-2605.section.md>
- This repo — `/nix/ubuntu/andrielson/rtx-workspace/src/user-install.sh` (bundle mechanism), `/nix/ubuntu/andrielson/rtx-workspace/src/01-home-bash-env.sh` (`~/.local/bin` PATH), `/nix/ubuntu/andrielson/rtx-workspace/src/Dockerfile` (multi-arch), `/nix/ubuntu/andrielson/rtx-workspace/docs/adr/0003-nix-as-toolchain-mechanism.md` (carve-out criteria)
