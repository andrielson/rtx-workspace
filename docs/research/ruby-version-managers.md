# Ruby version managers: alternatives to RVM and their fit for this workspace

Research date: 2026-09-25. Question from the maintainer: RVM's installation looked complex — what alternatives exist, which are available via `nix`, and how do they fit the toolchain mechanism of [ADR 0003](../adr/0003-nix-as-toolchain-mechanism.md)?

**Recommendation up front: use [mise](https://mise.jdx.dev), installed from the Nix profile (`nix profile add nixpkgs#mise`).** The nixpkgs mise package explicitly disables mise's self-update command (it ships a `.disable-self-update` marker), so mise is store-safe by construction — the exact self-rewriting-binary behavior that ADR 0003 carves out of the store cannot happen. mise installs Ruby as precompiled glibc binaries into `~/.local/share/mise` (the home volume, outside the read-only store), which is the same shape as the existing fnm precedent for Node. RVM's complexity is confirmed by its own install page (GPG key import, curl-pipe-bash installer, autolibs that installs system packages); it is not packaged in nixpkgs and its last tagged release dates from January 2021. Of the six managers surveyed, mise, asdf (`asdf-vm`), rbenv, and chruby are packaged in nixpkgs; ruby-build, ruby-install, frum, and RVM are not. Skipping a version manager entirely is also viable: nixpkgs carries `ruby_3_3` (3.3.10, security maintenance), `ruby_3_4` (3.4.9, the default `ruby` attribute, normal maintenance) and `ruby_4_0` (4.0.7, normal maintenance) — but several versions cannot coexist in one profile (all provide `bin/ruby` and collide), which pushes multi-version use toward `nix shell`, separate profiles, or mise.

## Comparison table

| Manager                     | Mechanism                                                                                                                                                                                | Install method & complexity                                                           | In nixpkgs? (attr)                     | Multiple versions side by side                                       | Maintenance (last release)                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| RVM                         | Shell function; compiles Rubies into `~/.rvm`; gemsets; autolibs installs system deps                                                                                                    | GPG key import + `curl -sSL https://get.rvm.io \| bash -s stable`; highest complexity | No                                     | Yes (`rvm use`, per-project `.ruby-version`, gemsets)                | Tagged 1.29.12, 2021-01-15; master still sees commits (2026-09-15)         |
| rbenv (+ ruby-build plugin) | PATH shims (`~/.rbenv/shims`), `.ruby-version` file; ruby-build compiles from source into `~/.rbenv/versions`                                                                            | Low (brew/apt/git checkout + `rbenv init`); ruby-build needed for installs            | rbenv yes (`rbenv`); ruby-build no     | Yes (shim dispatch per directory)                                    | rbenv v1.3.2, 2025-01-08; ruby-build v20260924, 2026-09-24                 |
| asdf + asdf-ruby            | Plugin CLI, shims (`~/.asdf/shims`), `.tool-versions`; asdf-ruby delegates to ruby-build (compiles)                                                                                      | Low-Medium (binary/brew/go + shims PATH + `asdf plugin add`)                          | Yes (`asdf-vm`)                        | Yes (shim dispatch, per-project `.tool-versions`)                    | asdf v0.20.2, 2026-09-22; asdf-ruby active on master (2026-09-25, no tags) |
| mise (formerly rtx)         | Rust binary; `mise.toml`/`.tool-versions`; shims or shell activation; Ruby precompiled binaries from `jdx/ruby`, source via ruby-build as fallback; installs under `~/.local/share/mise` | Low (curl mise.run, brew, apt, nix, ...); activation optional                         | Yes (`mise`)                           | Yes (per-project config, activation auto-switches)                   | v2026.9.14, 2026-09-25 (dated releases, very active)                       |
| chruby + ruby-install       | ~100-LOC shell function switching `PATH`/`GEM_HOME`/`GEM_PATH`; ruby-install compiles into `~/.rubies` or `/opt/rubies`                                                                  | chruby low (make install/brew); ruby-install compiles, needs gcc                      | chruby yes (`chruby`); ruby-install no | Yes (rubies as directories; optional `.ruby-version` auto-switching) | chruby v0.3.9, 2023-04-20 (stable/done); ruby-install v0.10.2, 2026-01-13  |
| frum                        | Rust binary, PATH-based (versions under `~/.frum`), compiles official tarballs                                                                                                           | Low (brew/cargo/binary)                                                               | No                                     | Yes (`.ruby-version`)                                                | v0.1.2, 2021-11-28; last commit 2022-05-13 — dormant                       |

Attribute names and paths were verified against nixpkgs `master` at commit `e14062797f790ac8314a80733aa9be014b464b41` (2026-09-25): `mise` at [pkgs/by-name/mi/mise](https://github.com/NixOS/nixpkgs/tree/master/pkgs/by-name/mi/mise), `asdf-vm` at [pkgs/by-name/as/asdf-vm](https://github.com/NixOS/nixpkgs/tree/master/pkgs/by-name/as/asdf-vm), `rbenv` at [pkgs/by-name/rb/rbenv](https://github.com/NixOS/nixpkgs/tree/master/pkgs/by-name/rb/rbenv), `chruby` as a legacy-path package at `../development/tools/misc/chruby` ([all-packages.nix](https://github.com/NixOS/nixpkgs/blob/master/pkgs/top-level/all-packages.nix), `chruby = callPackage ../development/tools/misc/chruby { rubies = null; };`). `ruby-build`, `ruby-install`, `frum`, and `rvm` have neither a `pkgs/by-name/.../package.nix` nor an `all-packages.nix` attribute on that commit.

## RVM — the strawman

- Mechanism: a shell function installed under `~/.rvm`; `rvm install` compiles Ruby interpreters from source into `~/.rvm/rubies` with per-version gemsets, and `rvm use` switches the current shell ([README](https://github.com/rvm/rvm)).
- Install (verified against [rvm.io/rvm/install](https://rvm.io/rvm/install)): first import the signing keys (`gpg --keyserver keyserver.ubuntu.com --recv-keys 409B6B1796C275462A1703113804BB82D39DC0E3 7D2BAF1CF37B13E2069D6956105BD0E739499BDB`), then `\curl -sSL https://get.rvm.io | bash -s stable --ruby`, then `source ~/.rvm/scripts/rvm` and verify `rvm is a function`. Ubuntu users are pointed at a dedicated package repo ([rvm/ubuntu_rvm](https://github.com/rvm/ubuntu_rvm)). The maintainer's impression is accurate: two-step key verification plus a curl-pipe-bash installer, with an autolibs system that by default tries to install OS packages itself, and multi-user installs that the docs themselves flag as a security risk if done without understanding umask. It also self-updates in place (`rvm get stable`).
- Maintenance: last tagged release 1.29.12 on 2021-01-15 ([releases](https://github.com/rvm/rvm/releases)); the repository is not archived and master still receives commits (last push 2026-09-15), but nothing has been tagged stable in over five years.
- nixpkgs: not packaged.
- Verdict for this workspace: fails on every axis — unpackaged, self-updating, curl-pipe-bash bootstrap, and its dependency auto-install assumes apt privileges the slim image deliberately dropped.

## rbenv + ruby-build

- Mechanism ([README, "How It Works"](https://github.com/rbenv/rbenv)): rbenv injects `~/.rbenv/shims` at the front of `PATH`; every `ruby`/`gem` invocation goes through a shim that reads `.ruby-version` (walking up from the current directory) and dispatches to the matching interpreter under `~/.rbenv/versions/`. Notably, the README states an entry in `~/.rbenv/versions` "can also be a symlink to a Ruby version installed elsewhere on the filesystem" — so rbenv can select Rubies it did not install.
- Install: `brew install rbenv` (or apt/pacman/dnf/zypper, or a git checkout into `~/.rbenv`) plus `rbenv init` to hook the shell. Simple.
- The catch: `rbenv install` does not ship with rbenv — it comes from the [ruby-build](https://github.com/rbenv/ruby-build) plugin, and ruby-build **compiles Ruby from source**: "Downloads an official tarball of Ruby source code; ... Executes `./configure --prefix=...`; Runs `make install`", warning that it "mostly does not verify that system dependencies are present" and that it "will try to link Ruby to the appropriate OpenSSL version, even if that means downloading and compiling OpenSSL itself". So rbenv-in-nixpkgs covers the switcher but not the installer.
- Maintenance: rbenv v1.3.2 (2025-01-08) — mature and low-churn; ruby-build is released on a dated cadence, v20260924 on 2026-09-24.
- nixpkgs: `rbenv` packaged (v1.3.2, [package.nix](https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/rb/rbenv/package.nix)); `ruby-build` not packaged.

## asdf + asdf-ruby

- Mechanism ([docs](https://asdf-vm.com/guide/getting-started.html)): one CLI for all languages via per-language plugins; every shell gets `~/.asdf/shims` on `PATH`; versions resolve just-in-time from `.tool-versions` in the current directory upwards (legacy `.ruby-version` readable via `asdfrc`). Ruby support is the [asdf-ruby](https://github.com/asdf-vm/asdf-ruby) plugin: `asdf plugin add ruby https://github.com/asdf-vm/asdf-ruby.git`.
- The plugin's README is explicit that "Under the hood, asdf-ruby uses [ruby-build](https://github.com/rbenv/ruby-build) to build and install Ruby" and asks users to have the ruby-build suggested build environment installed first — so Ruby installs are source compiles into `~/.asdf/installs`, same dependency story as rbenv+ruby-build.
- Install: pre-compiled binary from GitHub Releases, `brew install asdf`, or `go install github.com/asdf-vm/asdf/cmd/asdf@v0.20.2`; then add the shims dir to `PATH`. Low-to-medium complexity.
- Maintenance: asdf v0.20.2 released 2026-09-22 — actively maintained; asdf-ruby has no tags/releases but its master was last active 2026-09-25.
- nixpkgs: yes, as `asdf-vm` ([package.nix](https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/as/asdf-vm/package.nix); 0.20.2 on master, 0.20.1 in the registry pin this workspace resolves). Plugins live under `~/.asdf` (home), so the store is not a problem for them.
- Verdict: a perfectly reasonable packaged option; its Ruby installs are compiles, and it offers nothing over mise for this workspace (mise reads `.tool-versions` too).

## mise (formerly rtx) — recommended

- Mechanism ([README](https://github.com/jdx/mise), [docs](https://mise.jdx.dev)): a single Rust binary ("dev tools, env vars, task runner") that manages tool versions from `mise.toml`; it also reads asdf's `.tool-versions` by default, and supports `.ruby-version` (and `Gemfile`) as opt-in idiomatic version files via `idiomatic_version_file_enable_tools` ([configuration docs](https://mise.jdx.dev/configuration.html)); shims and/or shell activation. Renamed from `rtx` to `mise` in January 2024 ([rename discussion](https://github.com/jdx/mise/discussions/1338)).
- Ruby specifics ([mise Ruby docs](https://mise.jdx.dev/lang/ruby.html)): "By default, mise installs a precompiled Ruby binary when one is available and falls back to compiling from source". Precompiled binaries come from the `jdx/ruby` GitHub repo and cover Linux x86_64 and arm64 **glibc** (manylinux2014) plus macOS arm64 — this workspace's Ubuntu base qualifies, so no local compilation on the happy path. Source builds go through ruby-build (or optionally ruby-install via `ruby.ruby_install`); `ruby.compile=false` can forbid them entirely.
- Where Rubies land: under `MISE_DATA_DIR`, default `~/.local/share/mise` — "the directory where mise stores plugins and tool installs" ([configuration docs](https://mise.jdx.dev/configuration.html)) — i.e. the persistent home volume, not the read-only store.
- Install: `curl https://mise.run | sh`, brew, apt/dnf/pacman/apk/zypper/snap/npm/cargo, GitHub Releases — and **nix is an officially documented method** ([installing-mise](https://mise.jdx.dev/installing-mise.html): `nix-env -iA nixpkgs.mise`, plus the `github:jdx/mise` flake package).
- Self-update: mise has `mise self-update` (downloads from GitHub Releases), but the docs state "Packagers can disable this command so that mise is updated through the package manager instead" ([self-update docs](https://mise.jdx.dev/cli/self-update.html)) — and the nixpkgs package does exactly that: its [package.nix](https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/mi/mise/package.nix) runs `touch $out/lib/mise/.disable-self-update`. The self-rewriting-binary hazard that ADR 0003 carves out of the store is switched off in the packaged build; updates flow through `nix profile upgrade`.
- Maintenance: v2026.9.14 released 2026-09-25 — extremely active, dated releases.
- nixpkgs: yes, as `mise` (2026.8.6 both on master and in this workspace's pinned-registry resolution; the pin trails upstream by about a month, the usual registry lag ADR 0003 already documents).

## chruby + ruby-install

- Mechanism ([chruby README](https://github.com/postmodern/chruby)): deliberately minimal (~100 LOC) shell function; `chruby ruby-3.4` rewrites `PATH` to point at a Ruby directory under `~/.rubies` or `/opt/rubies`, sets `GEM_HOME`/`GEM_PATH` (user gems go to `~/.gem/$ruby/$version`, never into the Ruby install), and calls `hash -r`. No shims, no `cd` hook by default (auto-switching via `.ruby-version` is an opt-in script). It does not install Rubies at all.
- [ruby-install](https://github.com/postmodern/ruby-install) is the companion installer: fetches the latest versions and checksums from the ruby-versions catalog ("Does not require upgrading every time a new Ruby version comes out" — unlike ruby-build), then compiles into `~/.rubies` (users) or `/opt/rubies` (root), requiring gcc/clang and friends; it can install build dependencies from the system package manager.
- Install: chruby via tarball + `sudo make install` (or brew/AUR/FreeBSD); ruby-install likewise. Simple, sudo-ish, classic make-install.
- Maintenance: chruby v0.3.9 (2023-04-20) — small, stable, effectively feature-complete; ruby-install v0.10.2 (2026-01-13) — active.
- nixpkgs: `chruby` yes (attr `chruby`, legacy path `pkgs/development/tools/misc/chruby`, version 0.3.9); `ruby-install` no.

## frum

- Mechanism ([README](https://github.com/TaKO8Ki/frum)): a Rust reimplementation of the rbenv idea ("Pure Rust implementation not using `ruby-build`"); `eval "$(frum init)"` wires the shell; versions live under `~/.frum`; installs download official Ruby tarballs from `cache.ruby-lang.org` and compile them locally (configure pass-through like `--with-openssl-dir=`). Works with `.ruby-version`.
- Install: brew, AUR, `cargo install frum`, or a release binary. Low complexity.
- Caveats: the repository has moved — `github.com/frum/frum` now returns 404; the project lives at [TaKO8Ki/frum](https://github.com/TaKO8Ki/frum). Maintenance is effectively dormant: last release v0.1.2 on 2021-11-28, last push 2022-05-13.
- nixpkgs: not packaged.
- Verdict: the concept (compiled-Rust single binary) is sound but the project looks abandoned; not a candidate. (A newer entrant in the same space, `rv` at [spinel-coop/rv](https://github.com/spinel-coop/rv), surfaced in a web search; it was not assessed here and is not in nixpkgs as of the inspected commit.)

## Ruby straight from nixpkgs (no version manager)

Verified against nixpkgs `master` @ `e14062797f790ac8314a80733aa9be014b464b41` (2026-09-25), and cross-checked with read-only `nix eval nixpkgs#…` against this workspace's pinned registry (Nix 2.35.2).

### Attributes that exist

From [pkgs/top-level/all-packages.nix](https://github.com/NixOS/nixpkgs/blob/master/pkgs/top-level/all-packages.nix):

- `ruby_3_3` — 3.3.10 (security maintenance on the [Ruby branches page](https://www.ruby-lang.org/en/downloads/branches/); EOL expected 2027-03-31)
- `ruby_3_4` — 3.4.9 (normal maintenance)
- `ruby_4_0` — 4.0.7 (normal maintenance; released 2025-12-25)
- `ruby = ruby_3_4` (the default), plus per-version gem sets `rubyPackages_3_3`, `rubyPackages_3_4`, `rubyPackages_4_0`
- Other implementations: `jruby` (all-packages.nix) and `mruby` ([pkgs/by-name/mr/mruby](https://github.com/NixOS/nixpkgs/tree/master/pkgs/by-name/mr/mruby))

All are built in [pkgs/development/interpreters/ruby/default.nix](https://github.com/NixOS/nixpkgs/blob/master/pkgs/development/interpreters/ruby/default.nix) from the official `cache.ruby-lang.org` tarballs against **Nix** libraries — `openssl`, `zlib`, `libyaml`, `libffi`, `readline`, `ncurses`, `gdbm` are all store paths in `buildInputs`, with `strictDeps` and YJIT on for x86_64/aarch64. A nixpkgs Ruby therefore links nix OpenSSL and nix libyaml, never the system ones — no `--with-openssl-dir` games, and no system OpenSSL version skew. (Contrast: rubies installed by ruby-build "will try to link Ruby to the appropriate OpenSSL version, even if that means downloading and compiling OpenSSL itself", and ruby-build warns it "mostly does not verify that system dependencies are present".)

### Several versions side by side

You cannot put two Rubies in one profile: both `ruby_3_3` and `ruby_4_0` provide `bin/ruby` with different contents, and the Nix profile builder raises `BuildEnvFileConflictError` when two entries collide with equal priority (Nix 2.35.2, [src/libstore/builtins/buildenv.cc](https://github.com/NixOS/nix/blob/2.35.2/src/libstore/builtins/buildenv.cc), the `prevPriority == priority` branch); with different priorities the loser's file is simply not linked — you get shadowing, not coexistence. So side by side means:

- `nix shell nixpkgs#ruby_3_3` — one Ruby per shell, on demand (the nixpkgs manual's Ruby chapter frames `nix-shell` as "akin to a combined `chruby` or `rvm` and `bundle exec`", [ruby.section.md](https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/ruby.section.md));
- separate named profiles (`nix profile --profile .../ruby-3.3 add nixpkgs#ruby_3_3`) and addressing each profile's `bin/`;
- per-project flake dev shells that each pin their `ruby_3_x`;
- or one default `ruby` in the main profile, everything else ephemeral.

### Gem-install caveats

- The store is read-only: a nixpkgs Ruby's own gem directory is `$out/lib/ruby/gems/<libDir>` inside its store path (the derivation sets `GEM_HOME` there while bundling its default gems), and a setup hook appends each Ruby's `gemPath` to `GEM_PATH` (see `addGemPath` in the ruby `default.nix`). Runtime `gem install` therefore cannot write to the default destination — user gems must go to a home location (e.g. `GEM_HOME=~/.gems`), which works fine because `GEM_PATH` search finds both.
- The nixpkgs-sanctioned way to consume gems is declarative instead: `ruby.withPackages (p: with p; [ nokogiri ])`, or `bundlerEnv` + `bundix` for a `Gemfile.lock` ([ruby.section.md](https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/ruby.section.md)). Gems with native extensions get their build flags patched in centrally by `pkgs/development/ruby-modules/gem-config`; the [NixOS wiki Ruby page](https://wiki.nixos.org/wiki/Ruby) notes the remaining failure mode: a few gems hardcode include paths (`/usr/local/include`, `/opt/local/include`) in `extconf.rb` and need patching.
- For ad-hoc `gem install` with native extensions, compilation happens against the nix Ruby's headers with the system compiler — the image's `build-essential` baseline (ADR 0003 amendment) satisfies gcc, but the nix-library include/lib dirs are only automatically visible to gems packaged through nix; hand-installed native gems may need explicit `--with-...-dir` flags pointing at nix packages.

## Recommendation for this workspace

ADR 0003's carve-out test is precise: a tool leaves the store only if it self-updates by rewriting its own binary (claude-code, opencode, bun, rustup, uv), or ships vendor binaries that can't be trusted against the slim baseline. Everything else goes through `nix profile add nixpkgs#…`. Applied to Ruby:

- The **manager** should be a plain binary from the store.
- The **Rubies** it installs must land outside the store (home volume) — that is where both mise (`~/.local/share/mise`) and ruby-build/ruby-install/asdf-ruby (`~/.rbenv`, `~/.rubies`, `~/.asdf`) put them, so no conflict there for any option.
- What separates the candidates is who compiles what, and whether self-update exists.

### Candidate A (first choice): mise via the Nix profile

`nix profile add nixpkgs#mise` (a natural addition to the Bootstrap script's default profile), then `mise use --global ruby@3.4` and per-project `mise.toml`.

- The binary is store-managed and **cannot** self-rewrite: nixpkgs ships `.disable-self-update` in the package, the packager-sanctioned way to keep updates flowing through the package manager — the carve-out criterion is satisfied by the package itself, not by convention.
- Rubies arrive precompiled (glibc manylinux2014 binaries from `jdx/ruby`) into `~/.local/share/mise` — no source compiles, no apt build deps, nix store untouched. This is structurally identical to the fnm precedent ADR 0003 already blessed for Node: manager in the profile, runtimes in home, installed on demand.
- mise is the most actively maintained project surveyed (v2026.9.14, 2026-09-25) and reads asdf `.tool-versions` by default, with `.ruby-version` support one settings entry away — so it interops with existing projects regardless of which manager teammates use.
- Ruby releases (and the precompiled rebuilds) move far faster than the pinned registry — exactly the class of thing ADR 0003 keeps out of the profile (the bun/rust amendment rationale), which mise's home-dir runtime model handles cleanly.

### Candidate B: plain nixpkgs Rubies, no manager

Default `ruby` (3.4.9) in the profile; other versions via `nix shell nixpkgs#ruby_3_3`/`ruby_4_0` or per-project dev shells.

- Zero new moving parts; nix-pinned OpenSSL and libyaml; binaries are self-contained via store RPATHs (the ADR's own reason for trusting nix binaries against the slim baseline).
- Costs: newest patch releases lag the pinned registry; multiple versions cannot share a profile (the `bin/ruby` collision above), so "any version side by side" (an explicit ADR 0003 requirement for the version UX) needs profiles or shells; and the gem story pushes toward `withPackages`/`bundlerEnv` rather than plain `gem install`.
- Best if the workspace only ever needs one blessed Ruby plus rare exceptions. It is also a fine complement to Candidate A (a baseline `nixpkgs#ruby` for zero-config scripting, mise for the long tail).

### Candidate C: chruby (+ ruby-install) via profile/vendor install

`nix profile add nixpkgs#chruby` for the switcher; rubies from ruby-install (not packaged — vendor install) or symlinked nix Rubies in `~/.rubies` (chruby only rewrites `PATH`/`GEM_HOME`, and nix-built Rubies link nix OpenSSL).

- chruby is packaged, tiny, self-update-free — cleanest possible fit for the store half.
- But its installer half (ruby-install, or ruby-build) always compiles from source — the image's `build-essential` covers the compiler, yet each install is minutes of compilation that mise's precompiled path avoids, and it drags in a non-nixpackaged tool, which is exactly the ad-hoc-install drift ADR 0003 exists to remove.

### Verdict

**Adopt Candidate A: add `mise` to the default `nix profile` and let it own Ruby (and, if desired later, other versioned runtimes) in `~/.local/share/mise`.** It is the only option that is packaged in nixpkgs, store-safe against self-update by its own packaging, installs precompiled Rubies into the home volume with no compiler involvement, matches the existing fnm precedent, and is the most actively maintained of the surveyed managers. RVM specifically should be rejected: the installation complexity the maintainer noticed is real, it is not in nixpkgs, it self-updates in place, and its autolibs feature assumes a privileged system package manager this image no longer has. asdf (`asdf-vm`) is the packaged runner-up if the team prefers a pure plugin model, accepting that its Ruby installs are always source compiles.

## Sources

Project sites and repositories (all fetched 2026-09-25):

- RVM: <https://rvm.io/rvm/install>, <https://github.com/rvm/rvm> (README master; releases; repo metadata)
- rbenv: <https://github.com/rbenv/rbenv> (README master; release v1.3.2)
- ruby-build: <https://github.com/rbenv/ruby-build> (README master; release v20260924)
- asdf: <https://asdf-vm.com/guide/getting-started.html>, <https://github.com/asdf-vm/asdf> (release v0.20.2)
- asdf-ruby: <https://github.com/asdf-vm/asdf-ruby> (README master; latest commit 2026-09-25)
- mise: <https://github.com/jdx/mise> (README; release v2026.9.14), <https://mise.jdx.dev/lang/ruby.html>, <https://mise.jdx.dev/installing-mise.html>, <https://mise.jdx.dev/cli/self-update.html>, <https://mise.jdx.dev/configuration.html>, rename: <https://github.com/jdx/mise/discussions/1338>
- chruby: <https://github.com/postmodern/chruby> (README master; release v0.3.9)
- ruby-install: <https://github.com/postmodern/ruby-install> (README master; release v0.10.2)
- frum: <https://github.com/TaKO8Ki/frum> (README; release v0.1.2; repo metadata)

nixpkgs and Nix (master @ `e14062797f790ac8314a80733aa9be014b464b41` unless noted):

- <https://github.com/NixOS/nixpkgs/blob/master/pkgs/top-level/all-packages.nix> (ruby/ruby_3_3/ruby_3_4/ruby_4_0, chruby, jruby attributes)
- <https://github.com/NixOS/nixpkgs/blob/master/pkgs/development/interpreters/ruby/default.nix> (versions 3.3.10/3.4.9/4.0.7; nix buildInputs incl. openssl; gemPath and setup hook)
- <https://github.com/NixOS/nixpkgs/tree/master/pkgs/by-name/mi/mise> and <https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/mi/mise/package.nix> (version 2026.8.6; `.disable-self-update`)
- <https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/rb/rbenv/package.nix> (version 1.3.2)
- <https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/as/asdf-vm/package.nix> (version 0.20.2 on master)
- <https://github.com/NixOS/nixpkgs/blob/master/doc/languages-frameworks/ruby.section.md> (nixpkgs manual, Ruby chapter)
- <https://github.com/NixOS/nix/blob/2.35.2/src/libstore/builtins/buildenv.cc> (profile file-collision behavior)
- <https://wiki.nixos.org/wiki/Ruby> (native gem troubleshooting)

Other:

- <https://www.ruby-lang.org/en/downloads/branches/> (Ruby branch maintenance status)
- [ADR 0003](../adr/0003-nix-as-toolchain-mechanism.md) (carve-out rationale, fnm precedent, pinned-registry note)
- Local read-only verification on this workspace (Nix 2.35.2): `nix eval nixpkgs#<attr>.version` → ruby 3.4.9, ruby_3_3 3.3.10, ruby_3_4 3.4.9, ruby_4_0 4.0.7, mise 2026.8.6, chruby 0.3.9, asdf-vm 0.20.1, rbenv 1.3.2
