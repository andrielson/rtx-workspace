# Git's external runtime dependencies in the rtx-workspace

Research date: 2026-09-25. Trigger: `git branch` failed with "cannot run less: No such file or directory". All live checks were made read-only inside the running workspace (git 2.55.0, nixpkgs `26.11pre`); all source claims are pinned to the git `v2.55.0` tag and to current nixpkgs `master`.

## Executive summary

Git here comes from **nixpkgs** (`/nix/store/...-git-2.55.0`, an element of the default Nix profile), not from apt — `dpkg -l git` shows no package. That build is self-contained for its own code (it ships 168 man pages, bash completion, and a wrapped, store-absolute `PERL5LIB` for its Perl subcommands), but git by design shells out to four categories of external programs. The workspace supplies some and not others:

| External program             | Status in the live workspace                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pager (`less` by default)    | **Was missing** — the incident. Added ad hoc to the profile today (`nix profile list` shows `less 704`; `user-install.sh` does not list it).                                                                                                                                                 |
| Editor (`vi` by default)     | **Missing and unwired.** No `vi`/`vim`/`nvim`, and nothing sets `GIT_EDITOR`/`core.editor`/`VISUAL`/`EDITOR`. `nano` **is** installed (nixpkgs `nano`, already in the profile) — git just does not know about it.                                                                            |
| `man` (for `git help`)       | **Effectively broken.** `/usr/bin/man` is Ubuntu's minimized-image stub that prints a "run `unminimize`" message and exits 0 (`man.REAL` and `unminimize` do not exist; `man-db` and `groff` are not installed). The profile _does_ contain git's own man pages — only the reader is absent. |
| `ssh` (ssh remotes, signing) | **Present** — apt `openssh-client` 1:10.2p1 rides along with `openssh-server` in the apt baseline; `ssh-keygen` too.                                                                                                                                                                         |
| `gpg`                        | **Absent, and not needed**: this workspace signs with `gpg.format = ssh` (ADR 0009), which makes git call `ssh-keygen -Y` instead of gpg.                                                                                                                                                    |

Recommended fixes (argued in [Where fixes should land](#where-fixes-should-land)):

1. Add `nixpkgs#less` and `nixpkgs#man-db` to the always-on `linux` bundle of `install_nix_profile()` in `src/user-install.sh` (man-db from nixpkgs wraps its own `groff`, so no separate formatter is needed).
2. Add `git config --global core.editor nano` in `setup_git()` in `src/user-install.sh` — zero new packages, since nano is already in the profile.
3. Export `MANPATH="$HOME/.nix-profile/share/man"` from the Env loader (`src/01-home-bash-env.sh`) so bare `man git` and `apropos` see the profile's pages on every shell surface. (`git help git` already works without this, because git prepends its own man directory before invoking `man`.)

No apt-baseline change is required. Do not chase `more` (already present from apt `util-linux`), `wish` (the nixpkgs git build ships no `gitk`/`git gui` at all), or `gnupg` (ssh-format signing never invokes it).

## Dependency table

| Git dependency  | Git features that need it                                                                                                                                                                                                                   | Resolution chain (env → config → default)                                                                                                | Present in workspace? (empirical)                                                                                                             | nixpkgs attribute                                                                                                    | Size / notes                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Pager           | `branch` (list), `tag` (list), `config` (list), `log`, `show`, `whatchanged`, `reflog`, `diff`, `grep`, `blame`/`annotate`, `shortlog`, `range-diff` — whenever stdout is a TTY                                                             | `GIT_PAGER` → `core.pager` → `PAGER` → built-in `less` (empty or `cat` disables)                                                         | `less` after today's ad hoc profile add; **absent on every fresh volume**                                                                     | `less` (`pkgs/by-name/le/less/package.nix`, v704, outputs `out`+`man`)                                               | Closure measured here: **42.0 MiB** (ncurses + pcre2). Alternatives: `most`, or `cat` via config                         |
| Editor          | `commit` (no `-m`), `tag -a` (no `-m`), `rebase -i` (todo list), `add -e` / `add -p` hunk edit, `am --interactive`, `merge --edit` / conflict messages, `notes edit`, `revert -e`/`cherry-pick -e`, `config --edit`, `send-email --compose` | `GIT_EDITOR` → `core.editor` → `VISUAL` → `EDITOR` → built-in `vi`; `GIT_SEQUENCE_EDITOR` → `sequence.editor` → same chain (rebase todo) | **No.** `vi`/`vim`/`nvim`/`ed` missing; `nano` present but unwired                                                                            | none required (`nano` already profiled); options `vim` (`pkgs/applications/editors/vim/default.nix`), `neovim`       | nano closure measured: 52.9 MiB. Dumb/empty `TERM` + nothing set ⇒ git refuses with "Terminal is dumb, but EDITOR unset" |
| `man`           | `git help <topic>` (`help.format` defaults to `man`), `git <cmd> --help`                                                                                                                                                                    | `man.viewer`/`GIT_MAN_VIEWER` → `man`; git prepends its own `share/man` to `MANPATH` first                                               | **No** — `/usr/bin/man` is the Ubuntu minimized stub; `man-db`, `groff`, `apropos`, `whatis` all absent; profile man pages present but unread | `man-db` (`pkgs/by-name/ma/man-db/package.nix`, v2.13.1) or `mandoc` (`pkgs/by-name/ma/mandoc/package.nix`, v1.14.6) | man-db's wrapper bundles `groff`, `gzip`, `zstd` ⇒ no separate formatter. Needs `MANPATH` for bare `man` (see below)     |
| `ssh`           | `git@host:` / `ssh://` remotes, `core.sshCommand` users                                                                                                                                                                                     | `GIT_SSH_COMMAND` → `core.sshCommand` → `GIT_SSH` → `ssh` from `PATH`                                                                    | **Yes** — `/usr/bin/ssh` (apt `openssh-client`, dependency of the baseline's `openssh-server`)                                                | not needed (`openssh` exists)                                                                                        | nixpkgs git does **not** hardcode an ssh path (`withSsh ? false`), so the apt binary serves it                           |
| `ssh-keygen`    | commit/tag signing **and** verification in this workspace (`gpg.format = ssh`); the Bootstrap's key issuance                                                                                                                                | `gpg.ssh.program` (default `ssh-keygen`); `user.signingkey` path                                                                         | **Yes** — `/usr/bin/ssh-keygen` (apt)                                                                                                         | not needed                                                                                                           | Requires OpenSSH ≥ 8.2 (10.2p1 here)                                                                                     |
| `gpg`           | OpenPGP-format signing/verification (`gpg.format = openpgp`, the default)                                                                                                                                                                   | `gpg.openpgp.program` (default `gpg`)                                                                                                    | **No** — and irrelevant: ADR 0009 sets `gpg.format ssh`                                                                                       | `gnupg` (= `gnupg24`, `pkgs/top-level/all-packages.nix`)                                                             | Only needed if someone flips `gpg.format` back to `openpgp`                                                              |
| Diff/merge tool | `difftool`, `mergetool`                                                                                                                                                                                                                     | `diff.tool` / `merge.tool` → tool binary (`vimdiff` is a common default)                                                                 | `diff`, `diff3`, `cmp`, `patch` present (apt); `vi` missing so `vimdiff` unavailable; `merge.tool` unset → `mergetool` errors out             | any of `vim`, `meld`(GUI), …                                                                                         | Configuration gap, not a package gap                                                                                     |
| `wish` (Tcl/Tk) | `git gui`, `gitk`                                                                                                                                                                                                                           | none — separate binaries                                                                                                                 | **Not shipped at all**: nixpkgs git builds with `guiSupport ? false` and deletes `gitk`/`git-gui`                                             | `gitFull` (`git.override { guiSupport = true; ... }`)                                                                | Only matters if the full variant is installed (it wraps its own `tk`)                                                    |
| Browser         | `git help -w` / `git web--browse`                                                                                                                                                                                                           | `help.browser` → `web.browser` → auto-detect                                                                                             | **No** — `git help -w git` prints "No known browser available."                                                                               | any browser                                                                                                          | Headless container; skip                                                                                                 |
| Perl            | `git send-email`, `git add -i`, `svn`, `cvsserver`, `p4`, `filter-branch`                                                                                                                                                                   | none                                                                                                                                     | `perl` present (apt 5.40); nixpkgs git ships `git-send-email` **with a wrapped, store-absolute `PERL5LIB`** (self-contained)                  | already in the git closure                                                                                           | `git svn` is _not_ shipped (`svnSupport ? false`; use the `gitSVN` variant)                                              |
| httpd           | `git instaweb`                                                                                                                                                                                                                              | `instaweb.httpd` (default `lighttpd`)                                                                                                    | No                                                                                                                                            | `lighttpd`, …                                                                                                        | Skip                                                                                                                     |
| coreutils/shell | `request-pull`, `filter-branch`, `mergetool--lib`, hooks                                                                                                                                                                                    | —                                                                                                                                        | Present (apt)                                                                                                                                 | —                                                                                                                    | Fine                                                                                                                     |

## The pager: what happened to `git branch`

**Resolution order** (`pager.c`, `git_pager()`, git v2.55.0): if stdout is not a TTY git skips the pager entirely; otherwise `GIT_PAGER` env → `core.pager` config → `PAGER` env → the compile-time default. The default is `less` — `pager.c`:

```c
#ifndef DEFAULT_PAGER
#define DEFAULT_PAGER "less"
#endif
```

`Documentation/config/core.adoc` documents the same order. An empty value or `cat` at any level disables paging. Empirically confirmed here: `git var GIT_PAGER` → `less` (nothing is set anywhere — `git config --show-origin --get-regexp pager` is empty, `PAGER`/`GIT_PAGER` unset, and no `src/` file sets them); `GIT_PAGER= git var GIT_PAGER` → `cat`.

**Why `git branch` pages.** `git branch --list` pages by default **since git 2.16.0** — `Documentation/RelNotes/2.16.0.adoc`: "'git branch --list' learned to show its output through the pager by default when the output is going to a terminal, which is controlled by the pager.branch configuration variable. This is similar to a recent change to 'git tag --list'." (`git tag -l` gained it in 2.15.0, `Documentation/RelNotes/2.15.0.adoc`: "… and then 'git tag -l' is made to run pager by default.") In v2.55.0, `builtin/branch.c` sets `list = 1` for a bare `git branch` and then calls `setup_auto_pager("branch", 1)` — default on, `pager.<cmd>` overridable. Other commands that page by default in this build: `log`, `show`, `whatchanged`, `reflog` (all via `setup_pager()` in `cmd_log_init*`, `builtin/log.c`), `diff` (`setup_diff_pager`, `builtin/diff.c`), `grep` (`builtin/grep.c`), `blame`/`annotate` (`builtin/blame.c`), `shortlog` and `range-diff` (`USE_PAGER` in `git.c`'s command table), `tag --list` and `config --list`/`config --get-*` (`setup_auto_pager` call sites in `builtin/tag.c` and `builtin/config.c`).

**The failure.** With the pager binary absent and stdout a TTY, `pager.c` dies after the failed spawn. Reproduced on a pty in this workspace:

```
$ script --quiet --command 'env GIT_PAGER=no-such-pager git branch' /dev/null
error: cannot run no-such-pager: No such file or directory
fatal: unable to execute pager 'no-such-pager'
```

which is exactly the reported incident with `less`. Two details explain why it bites only interactively: git only tries a pager when stdout is a TTY (so piped/agent shells never saw it), and git exports `LESS=FRX`/`LV=-c` into the pager's environment unless already set (Makefile `PAGER_ENV = LESS=FRX LV=-c`), so nixpkgs' less behaves ideally with git out of the box — no wrapper needed.

**Note on `more`:** `more` was never missing — `/usr/bin/more` comes from apt `util-linux` (2.41.3, part of the Ubuntu base). Git never falls back to `more`; its only built-in default is `less`. The live profile history shows the detour: generation 3 added `nixpkgs#more` (util-linux 2.42.3), generation 4 added `nixpkgs#less`, generation 5 removed `more`. Nothing needs `more`.

## The editor

**Resolution order** (`editor.c`, `git_editor()`): `GIT_EDITOR` env → `core.editor` config → `VISUAL` env (skipped when `TERM` is unset/`dumb`) → `EDITOR` env → compile-time default `vi` (`#ifndef DEFAULT_EDITOR / #define DEFAULT_EDITOR "vi"`; the Makefile lets builds override it, lines 306–316 — nixpkgs does not). Documented in `Documentation/git-var.adoc` and `Documentation/config/core.adoc` (`core.editor`: "Commands such as `commit` and `tag` that let you edit messages by launching an editor…"). `git rebase -i`'s todo file uses a parallel chain: `GIT_SEQUENCE_EDITOR` → `sequence.editor` → the chain above.

Empirically confirmed in this workspace (with the environment stripped):

- `env -u GIT_EDITOR -u VISUAL -u EDITOR TERM=xterm git var GIT_EDITOR` → **`vi`**
- `VISUAL` beats `EDITOR`; `core.editor` beats both; `GIT_EDITOR` beats everything
- `TERM=dumb` with nothing set → `git var GIT_EDITOR` exits 1, and git errors with "Terminal is dumb, but EDITOR unset"

**The failure.** `vi` does not exist here (`vi`, `vim`, `nvim`, `ed` all missing). Reproduced in a scratch repo:

```
$ env -u GIT_EDITOR -u VISUAL -u EDITOR TERM=xterm git tag -a probe-tag
hint: Waiting for your editor to close the file... error: cannot run vi: No such file or directory
error: unable to start editor 'vi'
Please supply the message using either -m or -F option.
```

The same hits `git commit` without `-m`, `git commit --amend`, `git rebase -i`, `git add -e`, etc.

**Two workspace-specific wrinkles:**

- **The agent harness masks the bug.** This research session's own environment carries `GIT_EDITOR=true` (set by the Claude Code Bash tool), which is why agent-driven commits with `-m` never notice. A human over SSH has no such crutch. (Also worth knowing: `GIT_EDITOR=:` is git's documented "no editor" no-op — editor.c special-cases it.)
- **An editor is already installed.** `nixpkgs#nano` is in the default profile (`/nix/ubuntu/.nix-profile/bin/nano`, v9.2). The gap is pure wiring: nothing tells git about it. Setting `core.editor` (or `EDITOR`) to `nano` fixes every editor-launching git feature with zero new packages. If vim is preferred instead, `nixpkgs#vim` (`pkgs/applications/editors/vim/default.nix`) is the attribute; bare `vi` would then also satisfy git's default with no config at all.

## `man` and `git help`

`git help <topic>`/`git <cmd> --help` render man pages by default (`help.format` defaults to `man`; `web`/`html` need a browser, `info` needs the `info` viewer — `Documentation/config/help.adoc`, `Documentation/git-help.adoc`). `builtin/help.c` `exec_man_man()` simply does `execlp("man", "man", page)`; if `man` is missing, git warns "failed to exec 'man'" and dies with "no man viewer handled the request".

Here `/usr/bin/man` _exists_ but is Ubuntu's minimized-image stub (a 320-byte `#!/bin/sh` diverted in by dpkg) that prints "This system has been minimized… To restore this content, including manpages, you can run the 'unminimize' command. You will still need to ensure the 'man-db' package is installed." and exits 0 — so `git help git` looks like it succeeded while showing nothing. Neither `unminimize` nor `man.REAL` actually exists in the image, and `man-db`/`groff`/`apropos`/`whatis` are all absent.

Meanwhile **the man pages themselves are already on disk**: nixpkgs' git ships them in the main output (`withManual ? true` on x86_64-linux; the derivation's `postInstall` runs `make install install-html -C Documentation`), and `~/.nix-profile/share/man/man1/` holds 168 `git-*.1.gz` pages plus `git.1.gz` and `gitk.1.gz`, next to curl/ffmpeg/htop/etc. pages from the rest of the profile. What is missing is a reader and a formatter.

- **`nixpkgs#man-db`** (`pkgs/by-name/ma/man-db/package.nix`) is the drop-in choice. Its `postInstall` wraps every binary with a `PATH` prefix of `groff`, `gzip`, `zstd` — the formatter ships inside the closure, so no separate groff install. It provides `man`, `apropos` and `whatis` (one multi-call binary) and compiles `--with-pager=less`.
- **`nixpkgs#mandoc`** is the self-contained alternative (its own formatter, BSD-licensed), same reader role.
- **MANPATH nuance.** nixpkgs' man-db strips the mandatory manpaths and maps only the _system_ default profile (`/nix/var/nix/profiles/default`) — it does not know about a single-user `~/.nix-profile`. With `MANPATH` unset, a bare `man git` would find nothing. Two mitigations, both true:
  - `git help git` works without any wiring: git's `setup_man_path()` (builtin/help.c) prepends its own compiled-in man dir (Makefile `-DGIT_MAN_PATH`, resolved to the git store path's `share/man`) to `MANPATH` before exec'ing `man`, so git's own pages are always found.
  - Bare `man`/`apropos` need `MANPATH="$HOME/.nix-profile/share/man"` exported. Per manpath(5), an empty component (leading/trailing/double colon) splices in the default search path, so `MANPATH="$HOME/.nix-profile/share/man"` (or with a trailing colon to keep defaults) is the correct export for the Env loader. Caveat: `apropos` needs a whatis cache (`mandb` may need to run once; on this container `/var/cache/man` is root-owned).

**Why the Debian/Ubuntu split is a red herring here:** Debian's git source package builds `git`, `git-man`, `git-doc`, `git-cvs`, `git-svn`, `git-email`, `git-gui`, `gitk`, `gitweb`, `git-all` (sources.debian.org, `debian/control`) — so on apt, `git help` needs the separate `git-man` package plus `man-db`, both absent from slim images. This workspace's git is nixpkgs', which bundles the man pages; only the reader is missing.

## ssh

Present and fine. The apt baseline installs `openssh-server`, which pulls `openssh-client` — `/usr/bin/ssh`, `scp`, `sftp`, `ssh-agent`, `ssh-keygen` are all live. Git's resolution (`connect.c`, `get_ssh_command()`): `GIT_SSH_COMMAND` env → `core.sshCommand` config → `GIT_SSH` env (legacy, no shell) → plain `ssh` from `PATH`. nixpkgs' git only hardcodes an ssh path when built `withSsh = true` (its `ssh-path.patch`); the default build is `withSsh ? false`, so it happily uses `/usr/bin/ssh`. Nothing to install.

Two workspace notes: `setup_git()` rewrites `git@github.com:` to `https://github.com/` (`url.insteadOf`), so GitHub traffic never needs ssh keys — ssh remotes matter for other hosts; and the Bootstrap's signing key issuance itself uses `ssh-keygen` (apt), which also covers the signing path below.

## Signing: the ssh-keygen nuance (gpg is not needed)

ADR 0009 configures `user.signingkey ~/.ssh/git_user_signing_key.pub`, `gpg.format ssh`, `commit.gpgsign true`, `tag.gpgsign true`, `gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers`. With `gpg.format = ssh`, git signs through the ssh program instead of gpg — `Documentation/config/gpg.adoc`: "The default value for … `gpg.ssh.program` is 'ssh-keygen'" (i.e. `ssh-keygen -Y sign -f …`, with verification via `ssh-keygen -Y verify`/`-Y find-principals`, available since OpenSSH 8.2; this container has 10.2p1). Empirically, `gpg`/`gpg2` are absent and nothing breaks: the git binary even carries the helpful strings "ssh-keygen -Y sign is needed for ssh signing (available in openssh version 8.2p1+)".

So `gnupg` is only needed if someone flips `gpg.format` back to `openpgp` (attribute `gnupg` = `gnupg24`). One live observation: this volume booted without `GH_TOKEN`, so `setup_git_signing` was skipped and the signing block is not currently written — the config quirk is expected, not a regression.

## Optional-feature dependencies (brief)

- **`git gui` / `gitk`** — not shipped by the nixpkgs default build at all (`guiSupport ? false`; the derivation `rm`s `gitk` and `git-gui`). `wish`/`tclsh` are therefore moot. `gitFull` (`git.override { guiSupport = true; withSsh = true; svnSupport = true; sendEmailSupport = true; withLibsecret = true; }`, `pkgs/top-level/all-packages.nix`) exists if ever wanted, wrapping its own Tk.
- **`git svn`** — not shipped (`svnSupport ? false`); use the `gitSVN` variant if needed.
- **`git send-email`** — shipped and self-contained (bash wrapper with store-absolute `GITPERLLIB`; `sendEmailSupport ? perlSupport`, default on). It still needs SMTP configuration or an MTA — orthogonal.
- **`git difftool`/`mergetool`** — need a configured tool; `git mergetool` currently errors with "'merge.tool' is not configured". `diff`/`diff3`/`cmp`/`patch` (apt) are present; `vimdiff` is not (no vim). Configuration choice, not a missing system dependency.
- **`git help -w` / `git web--browse`** — "No known browser available." (headless container; the nix git _does_ install the HTML docs in its `doc` output). Skip.
- **`git instaweb`** — needs an httpd. Skip.
- **`git request-pull`, `filter-branch`, hooks, `mergetool--lib`** — plain shell + coreutils, all present.
- **Credential helpers** — `gh` is in the profile and `setup_git` writes the token credential helper; `git-credential-netrc`/`-store` ship with git; the libsecret helper requires `withLibsecret`/`gitFull` and a graphical keyring — irrelevant here.

## Where fixes should land

ADR 0003's boundary: the image bakes **Nix only** plus a slim apt baseline kept solely for vendor-binary compatibility; **everyday tools arrive with the default Nix profile at first boot**, with carve-outs only for self-updaters. Against that line:

1. **`less` → default Nix profile (linux bundle), not apt.** It is an everyday utility with zero vendor-binary interaction; apt would grow the image for every user while ADR 0003 deliberately starves the baseline. Concretely: add `nixpkgs#less` to the `packages+=()` array in `install_nix_profile()` (`src/user-install.sh`). The maintainer's ad hoc `nix profile add nixpkgs#less` today matches this verdict exactly — codifying it only makes fresh volumes get it. (42 MiB closure; the profile's `bin` shadows nothing that apt needs, and git's injected `LESS=FRX` needs no wrapper.) _Alternative considered:_ `core.pager = cat` or `GIT_PAGER=cat` — a config-side workaround that removes the pager everywhere; it hides a missing standard utility rather than fixing it, and degrades every other pager consumer too.
2. **Editor → config-side, in the Bootstrap.** Add `git config --global core.editor nano` in `setup_git()` (`src/user-install.sh`) — next to the existing identity/credential writes and _before_ the `GH_TOKEN` early-return (that block currently returns before signing setup, so the write must precede it to run on token-less boots too). Zero new packages: nano is already profiled. _Alternative:_ export `EDITOR=nano` (image `ENV` or the Env loader) — broader (every TUI benefits, consistent with ADR 0006's single-source-of-truth) but bakes a user-facing preference into image wiring; reasonable as a follow-up if the workspace wants a session-wide editor convention. _Alternative:_ install `nixpkgs#vim` so git's built-in `vi` default just works — valid, but adds ~50 MiB to serve a default nobody chose; nano is already there.
3. **`man` → profile + Env loader.** Add `nixpkgs#man-db` to the linux bundle, and export `MANPATH="$HOME/.nix-profile/share/man"` from the Env loader (`src/01-home-bash-env.sh`) so all three activation surfaces of ADR 0006 (login shells, interactive non-login, `BASH_ENV`) carry it. Second-order effects, all favorable: the nix `man` shadows the useless `/usr/bin/man` stub via the profile `PATH` hook; groff rides inside man-db's wrapper (no separate install, no apt); `git help` already works regardless because git prepends its own man dir; XDG is not involved (the profile's `share/man` is the target, and the Bootstrap's `--global` git config stays at `~/.gitconfig`). _Alternative:_ `mandoc` instead of man-db — smaller and self-contained, but the same MANPATH export and a nonstandard toolchain for users; _alternative:_ `help.format = web` — needs a browser this container will never have.
4. **Do nothing** for `more` (already present via apt `util-linux`; pulling nixpkgs `util-linux` would drag in ~200 binaries for nothing), `wish` (the build ships no gitk/git-gui), `gnupg` (ssh-format signing never invokes it), and `ssh` (already present, and nixpkgs git resolves it from `PATH` by design).

One documentation note worth keeping: agent shells that set `GIT_EDITOR=true` (Claude Code's Bash tool does) silently mask the editor gap — anyone debugging "works for the agent, breaks for me over SSH" should check `env | grep GIT_` first. And per the repo conventions, implementing 1–3 touches `src/` and therefore gates the `release` job: bump `package.json` and revisit `README.md` in the same change.

## Sources

Git source and docs, tag `v2.55.0` (canonical repo `git://git.kernel.org/pub/scm/git/git.git`, read via the GitHub mirror):

- `pager.c` — `DEFAULT_PAGER "less"`, `git_pager()` chain, `die("unable to execute pager …")`: <https://github.com/git/git/blob/v2.55.0/pager.c>
- `editor.c` — `DEFAULT_EDITOR "vi"`, `git_editor()` chain, dumb-terminal handling, error strings: <https://github.com/git/git/blob/v2.55.0/editor.c>
- `builtin/var.c` — what `git var GIT_PAGER`/`GIT_EDITOR` print: <https://github.com/git/git/blob/v2.55.0/builtin/var.c>
- `git.c` — `setup_auto_pager`, `USE_PAGER` command table: <https://github.com/git/git/blob/v2.55.0/git.c>
- `builtin/branch.c` (`if (list) setup_auto_pager("branch", 1)`), `builtin/tag.c`, `builtin/config.c`, `builtin/log.c` (`setup_pager`), `builtin/diff.c` (`setup_diff_pager`), `builtin/grep.c`, `builtin/blame.c`, `builtin/reflog.c` (`cmd_reflog_show` → `cmd_log_reflog`)
- `builtin/help.c` — `exec_man_man()`, `setup_man_path()`, viewer fallback: <https://github.com/git/git/blob/v2.55.0/builtin/help.c>
- `connect.c` — `get_ssh_command()`, `GIT_SSH` fallback: <https://github.com/git/git/blob/v2.55.0/connect.c>
- `Makefile` — `DEFAULT_EDITOR`/`DEFAULT_PAGER` knobs, `PAGER_ENV = LESS=FRX LV=-c`, `-DGIT_MAN_PATH`: <https://github.com/git/git/blob/v2.55.0/Makefile>
- `Documentation/config/core.adoc` (`core.pager`, `core.editor`, `core.sshCommand`), `Documentation/config/pager.adoc`, `Documentation/config/gpg.adoc` (`gpg.ssh.program` default `ssh-keygen`), `Documentation/config/help.adoc` (`help.format` default `man`)
- `Documentation/git-var.adoc` (editor/pager order), `Documentation/git-help.adoc` (formats, viewers)
- `Documentation/RelNotes/2.15.0.adoc` and `Documentation/RelNotes/2.16.0.adoc` (`git tag -l` / `git branch --list` page by default)

nixpkgs (current `master`, matching the `26.11pre` profile):

- `pkgs/by-name/gi/git/package.nix` — flags (`svnSupport ? false`, `guiSupport ? false`, `withManual ? !…useLLVM`, `sendEmailSupport ? perlSupport`, `withLibsecret ? false`, `withSsh ? false`), man-page install, gitk/git-gui removal, ssh-path patch: <https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/gi/git/package.nix>
- `pkgs/top-level/all-packages.nix` — `gitFull`, `gitSVN`, `gitMinimal`, `vim`, `neovim`, `gnupg` (= `gnupg24`): <https://github.com/NixOS/nixpkgs/blob/master/pkgs/top-level/all-packages.nix>
- `pkgs/by-name/le/less/package.nix`: <https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/le/less/package.nix>
- `pkgs/by-name/ma/man-db/package.nix` (groff/gzip/zstd wrapper, blanked mandatory manpaths): <https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/ma/man-db/package.nix>
- `pkgs/by-name/ma/mandoc/package.nix`: <https://github.com/NixOS/nixpkgs/blob/master/pkgs/by-name/ma/mandoc/package.nix>
- `pkgs/by-name/mo/most/package.nix`, `pkgs/by-name/ut/util-linux/package.nix`, `pkgs/by-name/gr/groff/package.nix`, `pkgs/applications/editors/vim/default.nix`

Man-db and Debian packaging:

- man-db `man(1)` / `manpath(5)` (MANPATH and empty-component semantics): <https://manpages.debian.org/unstable/man-db/man.1.en.html>, <https://manpages.debian.org/unstable/man-db/manpath.5.en.html>
- Debian git source package `debian/control` (binary split `git`, `git-man`, `git-doc`, `git-cvs`, `git-svn`, `git-email`, `git-gui`, `gitk`, `gitweb`, `git-all`): <https://sources.debian.org/src/git/1%3A2.55.0-1/debian/control/>
- Ubuntu minimized-image `man` stub: observed live at `/usr/bin/man` in this container.

Repository files (this repo):

- `/nix/ubuntu/andrielson/rtx-workspace/src/Dockerfile` — apt baseline (`ca-certificates build-essential curl openssh-server systemd-standalone-sysusers xz-utils`), image `ENV` PATH hook, no `PAGER`/`EDITOR` anywhere
- `/nix/ubuntu/andrielson/rtx-workspace/src/user-install.sh` — `install_nix_profile()` package list, `setup_git()`, `setup_git_signing()`
- `/nix/ubuntu/andrielson/rtx-workspace/src/01-home-bash-env.sh` — the Env loader where a `MANPATH` export would land
- `/nix/ubuntu/andrielson/rtx-workspace/docs/adr/0003-nix-as-toolchain-mechanism.md` — image/profile boundary
- `/nix/ubuntu/andrielson/rtx-workspace/docs/adr/0006-container-env-single-source-of-truth.md` — shell activation surfaces
- `/nix/ubuntu/andrielson/rtx-workspace/docs/adr/0009-bootstrap-issued-git-signing-keys.md` — ssh-format signing
