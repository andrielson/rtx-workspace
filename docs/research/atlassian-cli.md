# Atlassian CLI (`acli`) — install research for the `linux` bundle

## Executive summary

The **Atlassian Command Line Interface** — docs call it "Atlassian Command Line Interface (CLI)", binary **`acli`** — is Atlassian's official CLI for operating Jira Cloud and the Atlassian organization from the terminal: command groups `jira` (work items, projects, sprints, boards, filters, fields), `admin` (user lifecycle, org governance), `feedback`, and a beta AI-agent subcommand `acli rovodev`. It is a **native, closed-source vendor binary** distributed from Atlassian's own package host (`acli.atlassian.com`): apt and yum repos, Homebrew tap (macOS), curl-able binaries, `.tar.gz`/`.deb`/`.rpm` artifacts for linux amd64 and arm64. It is **not** an npm package — `@atlassian/acli` returns 404 from the npm registry and npm is never mentioned in its docs (third-party guides citing `npm install -g @atlassian/acli` are stale). It does **not** self-update — upgrades flow through the package manager (`apt upgrade -y acli`, `yum update -y acli`, `brew upgrade acli`) or a manual binary swap — which removes the ADR 0003 self-update reason for a vendor carve-out.

Distinction from the sibling research item: the **TWG CLI** (`developer.atlassian.com/cloud/twg-cli/`) is a different product — "a command line interface to the Atlassian Teamwork Graph and Cloud services" that lets AI coding agents (Claude Code, Codex, Gemini, Cursor) query and act across Atlassian tools in plain language; its binary is **`twg`**, installed by a curl script from `teamwork-graph.atlassian.com`, and it **does** self-update (`twg upgrade`, stable/beta channels). `acli` is the human/scripted ops CLI; `twg` is the agent-facing graph CLI. Their current docs do not cross-reference each other (verified in both directions), and their binaries do not collide (`acli` vs `twg`).

**Nix verdict: yes — and it is already packaged.** nixpkgs carries it at `pkgs/by-name/ac/acli/` (added 2025-12-06, actively bumped; currently 1.3.36-stable) for `x86_64-linux` and `aarch64-linux`, verified live through this workspace's pinned `nixpkgs#` registry. One caveat decides the shape of the landing: the nixpkgs package is marked **`unfree`**, so it cannot ride the Bootstrap's single pure `nix profile add` union — it needs its own `NIXPKGS_ALLOW_UNFREE=1 nix profile add --impure nixpkgs#acli` invocation (the escape hatch ADR 0003 already records for ad-hoc unfree needs).

## What the CLI is (from the owning docs)

- Landing page: "Atlassian Command Line Interface (CLI)" — "Streamline your workflow and save valuable time by using the command line to interact with Atlassian organization and products"; audience is "Admins and technical users who prefer the speed, control, and flexibility of the command-line for managing their organization."
- Binary name: `acli` — every example runs `acli ...` (`acli --version`, `acli jira auth login`, `acli admin user activate`); nixpkgs sets `mainProgram = "acli"` to the same effect.
- Platforms: "Designed to be compatible with multiple platforms such as MacOS, Windows, and Linux". "Atlassian Government Cloud is not supported by Atlassian CLI."
- Versioning/channel: `-stable`-suffixed releases (e.g. 1.3.36-stable); support policy "Each Atlassian CLI version will only be supported 6 months after release" with a recommendation to "regularly update". The changelog page lags the release feed — it lists 1.3.15-stable (2026-03-25) as latest while nixpkgs already packages 1.3.36-stable.
- Runtime: a standalone native binary — no Node.js requirement appears anywhere in its docs. The nixpkgs packaging confirms it is a vendor binary (`sourceProvenance = [ binaryNativeCode ]`) that needs an FHS userspace: the Linux package wraps it in `buildFHSEnv` with `cacert`, `openssl`, `zlib`, `libffi`, `sqlite` (the last three commented "For rovodev").
- Auth (first-boot relevant): three methods — API token for Jira (`echo <token> | acli jira auth login --site "mysite.atlassian.net" --email "user@atlassian.com" --token`, token arrives via stdin; since v1.2.1 `acli admin auth login` "now requires --email"), API key for admin commands ("All admin commands require an API key"), and OAuth (`acli jira auth login --web`, which launches a browser). No token env var is documented.
- Container behavior: no auto-update checks, telemetry disclosure, or first-run wizard are mentioned on any guide page. Upgrades are always user-initiated through the install channel.

## Distribution channels

| Channel                       | Exact install command (quoted from the docs)                                                                                                                                                                                         | Self-updates?                                                                 | linux x86_64 / aarch64                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| apt repo (Debian-based)       | keyring setup from `https://acli.atlassian.com/gpg/public-key.asc`, then a `deb ... https://acli.atlassian.com/linux/deb stable main` sources entry, then `sudo apt update && sudo apt install -y acli`                              | No — `sudo apt upgrade -y acli`                                               | Yes — repo entry uses `arch=$(dpkg --print-architecture)` |
| yum repo (Red Hat-based)      | `sudo yum-config-manager --add-repo https://acli.atlassian.com/linux/rpm/acli.repo` then `sudo yum install -y acli`                                                                                                                  | No — `sudo yum update -y acli`                                                | Yes                                                       |
| Standalone binary (curl)      | `curl -LO "https://acli.atlassian.com/linux/latest/acli_linux_amd64/acli"` (or `..._arm64...`), `chmod +x ./acli`, then `sudo install -o root -g root -m 0755 acli /usr/local/bin/acli`; rootless variant moves it to `~/.local/bin` | No — re-download and swap manually (the documented Windows method; same idea) | Yes — separate amd64/arm64 URLs                           |
| Tarball / deb / rpm artifacts | `https://acli.atlassian.com/linux/latest/acli_linux_amd64.tar.gz` (also arm64, `.deb`, `.rpm`; darwin `.tar.gz`; windows raw `acli.exe`)                                                                                             | No                                                                            | Yes — amd64 + arm64 for all three formats                 |
| Homebrew (macOS)              | `brew tap atlassian/homebrew-acli` then `brew install acli`                                                                                                                                                                          | No — `brew update && brew upgrade acli`                                       | n/a (macOS)                                               |
| npm                           | **None.** `@atlassian/acli` returns 404 from registry.npmjs.org; the docs never mention npm.                                                                                                                                         | —                                                                             | —                                                         |

No checksums are published on the download page. Only nixpkgs pins integrity (`sources.json` carries sha256 per artifact).

### Version channels / upgrade story

There is no `acli upgrade` command. The upgrade guide routes through the install channel (apt/yum/brew) or a manual binary swap; verification is `acli --version`. The one wrinkle is `acli rovodev` (the beta AI agent): per the changelog, since v1.3.0 Rovo Dev "can now be updated independently of Atlassian CLI" — a component that updates separately from the `acli` binary itself. Where that independent update writes is not documented (see Open questions); it does not change the fact that the `acli` binary never rewrites itself.

## The nix verdict

**In nixpkgs: yes.** Where I looked and what I found:

- `pkgs/by-name/ac/acli/` exists on nixpkgs master: `package.nix`, `unwrapped.nix`, `sources.json`, `update.py`. `package.nix` describes "Atlassian Command Line Interface" with homepage `https://developer.atlassian.com/cloud/acli/guides/introduction` — unambiguously this CLI.
- Commit history (GitHub API, path `pkgs/by-name/ac/acli`): added 2025-12-06 ("acli: init at 1.3.7"), 17 commits since, actively maintained — version bumps on 2026-08-14 (1.3.22→1.3.23), 2026-08-23 (→1.3.29), 2026-09-02 (→1.3.36). `x86_64-darwin` was dropped on 2026-07-15 (upstream stopped shipping it); linux and arm64-darwin remain.
- `sources.json`: version 1.3.36-stable with sha256-pinned tarballs for `x86_64-linux`, `aarch64-linux`, `aarch64-darwin` — both linux architectures the workspace images use.
- Verified live in this workspace (read-only): `nix eval nixpkgs#acli.version` → `1.3.36-stable`, license `unfree`, `meta.broken` false, platforms `["aarch64-darwin","aarch64-linux","x86_64-linux"]`, resolving through the same pinned registry (nixpkgs-unstable, 26.11pre) the Bootstrap's bare `nixpkgs#` shorthand uses.
- Packaging quality: `stdenvNoCC` derivation that installs the vendor binary (`install -Dm755 acli $out/bin/acli`), generates bash/zsh/fish/powershell completions at build time, runs a version check hook, and has an automated `update.py` — plus the Linux `buildFHSEnv` wrap that supplies the FHS libraries (`openssl`, `zlib`, `libffi`, `sqlite`) a raw vendor binary would otherwise miss on the slim apt baseline.

**Via nodePackages: not applicable.** There is no npm package to wrap — `@atlassian/acli` 404s on the registry, so nixpkgs' node-packages collection cannot contain it (nothing to check), and the npm-through-fnm path is equally unavailable.

**Vendor-installer carve-out: not warranted.** ADR 0003's carve-outs exist for tools that self-update and rewrite their own binary (`bun upgrade`, `rustup update`, claude-code, opencode) or need vendor installers for other reasons. `acli` documents no self-update; new versions are just new versions of the same package, which the pinned-registry profile already models. Conversely, a raw `curl` install of the binary into `~/.local/bin` would skip the FHS-library problem only by luck — nixpkgs' own decision to `buildFHSEnv`-wrap it (with rovodev's `zlib`/`libffi`/`sqlite`) is direct evidence the binary is not self-contained, which is exactly the "vendor binaries against the slim baseline" residual risk ADR 0003 calls out.

**The one complication: `unfree`.** `meta.license = lib.licenses.unfree` (the vendor binary is proprietary), so the pure evaluation the Bootstrap relies on refuses it. Verified read-only with a dry-run:

```
error: Refusing to evaluate package 'acli-1.3.36-stable' in .../pkgs/by-name/ac/acli/package.nix:18
because it has an unfree license (‘unfree’)
```

and the documented escape hatch works (dry-run evaluates; standard store deps substitute, the tarball fetches from `acli.atlassian.com`):

```
NIXPKGS_ALLOW_UNFREE=1 nix build --dry-run --impure nixpkgs#acli
```

This is precisely the case ADR 0003 anticipates: "ad-hoc unfree needs `NIXPKGS_ALLOW_UNFREE=1` plus `--impure`". A consequence worth knowing: Hydra does not build unfree packages, so the small FHS-env derivation builds locally on first install (seconds) instead of substituting.

**Recommended path for this workspace: `nix profile add nixpkgs#acli`, in its own impure invocation, kept out of the pure union.**

## How it would land in the `linux` bundle

The `linux` bundle is the always-on baseline: its packages join the `packages+=(...)` union inside `install_nix_profile()` (src/user-install.sh) and it has **no skip variable** — every other bundle leans on it. That creates a decision:

- **(Rejected) add `nixpkgs#acli` to the union array.** The single `nix profile add "${packages[@]}"` would then need `NIXPKGS_ALLOW_UNFREE=1` and `--impure` for the whole invocation, making every first-boot install impure to admit one unfree package.
- **(Recommended) a dedicated add right after the pure union**, inside `install_nix_profile()`:

```bash
nix profile add "${packages[@]}"

# acli cannot join the pure union above: nixpkgs marks it unfree, and an
# unfree add requires NIXPKGS_ALLOW_UNFREE=1 plus --impure — flags that
# would taint the whole union command. Its own invocation keeps every
# other package pure (the ADR 0003 unfree escape hatch, structural for
# this one package). The add is idempotent like the union's: a re-run
# that finds it installed just warns and moves on.
NIXPKGS_ALLOW_UNFREE=1 nix profile add --impure nixpkgs#acli
```

Mechanism notes:

- The `--impure` flag applies to a whole command, never a single package argument — the separate invocation is what isolates the impurity, not the ordering.
- `nix profile add` merges into the same profile generation chain, so acli still lands on the profile-PATH every hook (image `ENV`, `/etc/profile.d`, `BASH_ENV`) already exports; nothing new to wire.
- The vendor command name is `acli`; a live check in this workspace confirms no collision — `command -v acli twg rovodev atlassian` all miss today, while `fnm`/`node`/`npm` resolve from the expected fnm/nix paths.
- Version freshness: bare `nixpkgs#` resolves through the pinned registry to nixpkgs-unstable, and acli's nixpkgs maintenance is fast (three bumps in Aug–Sep 2026), so the ~monthly vendor releases and the 6-month support window are tracked without any bootstrap-side pinning.
- Because `linux` has no skip variable, acli installs unconditionally on every first boot, per the maintainer's "Bundle: linux". If that ever needs to become opt-out, it would be the first skip variable on the always-on bundle — a separate decision, not smuggled in here.

Against ADR 0003's carve-out criteria: no self-update, no store-rewrite of the binary, no vendor installer needed — the only carve-out-adjacent property is the unfree license, handled above. The read-only store is still worth one caveat: the beta `acli rovodev` component "can now be updated independently" (changelog v1.3.0); if that independent update ever tries to rewrite something inside the binary's install location, a store path would forbid it — unknown today (see Open questions), but contained to the beta subcommand.

## Open questions for the maintainer

1. **Auth/first-boot UX:** `acli` has no documented token env var — login is interactive (OAuth `--web` browser flow) or an API token piped via stdin. The Bootstrap has no Atlassian credential channel today (unlike `GH_TOKEN`/`SSH_AUTHORIZED_KEY`), so first use will require a manual `acli jira auth login`. Is that acceptable, or should a credential env var be designed first?
2. **Unfree posture:** confirming you are comfortable with one structural `NIXPKGS_ALLOW_UNFREE=1 ... --impure` line in the always-on `linux` bundle (ADR 0003 records the mechanism, but as an ad-hoc escape hatch — this would be its first structural use).
3. **`acli rovodev` vs TWG CLI overlap:** `acli` embeds a beta AI coding agent (`acli rovodev run`) while the separate TWG CLI (`twg`, the sibling research item) is Atlassian's agent-facing CLI. No binary collision (`acli` vs `twg`), but if both land the workspace will carry two overlapping agent surfaces plus `acli`'s independently-updating rovodev component — worth an explicit line in the README distinguishing the two CLIs, since third-party material regularly conflates them (stale `npm install -g @atlassian/acli` instructions are already circulating for tools that ship no npm package today).
4. **Where rovodev's independent update writes** (store path vs `~/.acli`-style user state) — undocumented; only matters if the beta `acli rovodev` commands get used from the store-installed binary.

## Sources

- Atlassian CLI guides (owning docs):
  - https://developer.atlassian.com/cloud/acli/guides/introduction/
  - https://developer.atlassian.com/cloud/acli/guides/install-acli/
  - https://developer.atlassian.com/cloud/acli/guides/install-linux/
  - https://developer.atlassian.com/cloud/acli/guides/install-macos/
  - https://developer.atlassian.com/cloud/acli/guides/install-windows/ (referenced by the upgrade guide; not fetched in full)
  - https://developer.atlassian.com/cloud/acli/guides/update-install-guide/
  - https://developer.atlassian.com/cloud/acli/guides/download-supported-packages/
  - https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/
  - https://developer.atlassian.com/cloud/acli/guides/frequently-asked-questions/
  - https://developer.atlassian.com/cloud/acli/changelog/
  - https://developer.atlassian.com/cloud/acli/reference/commands/rovodev/
  - https://developer.atlassian.com/cloud/acli/sitemap.xml (page inventory)
- TWG CLI (for the distinction only; the sibling research item owns the depth):
  - https://developer.atlassian.com/cloud/twg-cli/
  - https://developer.atlassian.com/cloud/twg-cli/getting-started/installation/
- nixpkgs:
  - https://github.com/NixOS/nixpkgs/tree/master/pkgs/by-name/ac/acli — `package.nix`, `unwrapped.nix`, `sources.json`, `update.py`
  - https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/by-name/ac/acli/package.nix
  - https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/by-name/ac/acli/unwrapped.nix
  - https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/by-name/ac/acli/sources.json
  - Commit history for that path via the GitHub API (`repos/NixOS/nixpkgs/commits?path=pkgs/by-name/ac/acli`)
- npm registry (primary): https://registry.npmjs.org/@atlassian/acli (404 — package absent)
- Workspace files: `src/user-install.sh` (bundle mechanism), `docs/adr/0003-nix-as-toolchain-mechanism.md` (toolchain boundary and carve-outs)
- Live read-only checks in this workspace: `nix eval nixpkgs#acli.{version,meta.license.shortName,meta.broken,meta.platforms}`, `nix build --dry-run` (pure and `NIXPKGS_ALLOW_UNFREE=1 ... --impure` variants), `command -v acli twg rovodev atlassian fnm node npm nix`
