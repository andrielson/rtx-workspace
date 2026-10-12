# Pinned-registry package facts behind the workspace-refresh decisions

Research date: 2026-09-25. The short companion to the four deep dives in this directory: the checked package facts from the pinned registry that decide how the refresh lands in the [Bootstrap script](../../CONTEXT.md). Every attribute was read at the same nixpkgs commit the other documents pin — `e14062797f790ac8314a80733aa9be014b464b41` (2026-09-25, nixpkgs-unstable), the registry the [Default profile](../../CONTEXT.md)'s bare `nixpkgs#` shorthand resolves through per [ADR 0003](../adr/0003-nix-as-toolchain-mechanism.md).

## Executive summary

- **`glab` and `grpcurl` are packaged and free** — they ride the single pure `nix profile add` union of the `linux` bundle, no `NIXPKGS_ALLOW_UNFREE` escape hatch needed (the contrast to `acli`, see [atlassian-cli.md](atlassian-cli.md)).
- **The pin carries Gradle's two majors side by side**: `gradle_8` (8.14.4, the default) and `gradle_9` (9.7.1); bare `gradle` is a movable alias to the default major, so the workspace names `gradle_9` explicitly to follow the 9 line.
- **Corepack is already bundled by fnm's Node, and the nix package is rejected**: `corepack_22`/`corepack_24` duplicate a binary the fnm Node already ships and run nix's Node through their patched shebangs, clashing with fnm's per-shell selection.

## glab and grpcurl: packaged and free

| Attribute | Upstream                                                         | Version at the pin | License                  | nixpkgs path              |
| --------- | ---------------------------------------------------------------- | ------------------ | ------------------------ | ------------------------- |
| `glab`    | [gitlab-org/cli](https://gitlab.com/gitlab-org/cli) (GitLab CLI) | 1.114.0            | MIT (`lib.licenses.mit`) | `pkgs/by-name/gl/glab`    |
| `grpcurl` | [fullstorydev/grpcurl](https://github.com/fullstorydev/grpcurl)  | 1.9.4              | MIT (`lib.licenses.mit`) | `pkgs/by-name/gr/grpcurl` |

Both are free-licensed, so both join the [Default profile](../../CONTEXT.md) through the Bootstrap script's one pure `nix profile add "${packages[@]}"` union — the same shape as every other `linux`-bundle package. `glab` serves the GitLab issue-tracker agent skill; `grpcurl` covers gRPC endpoint probing. No `--impure` add, no unfree admission, no Hydra caveat: nothing of the `acli` landing (a separate `NIXPKGS_ALLOW_UNFREE=1 nix profile add --impure`, see [atlassian-cli.md](atlassian-cli.md)) applies here.

## gradle vs gradle_9: the two-major split in the pin

The pinned registry exposes Gradle's two supported majors as separate attributes, not as one upgradable package:

- `gradle_8` → **8.14.4** — the default major;
- `gradle_9` → **9.7.1** — the newer line;
- bare `gradle` → an **alias to the default** (`gradle = gradle_8` in `pkgs/development/tools/build-managers/gradle/default.nix`; the top level wires `gradle = gradle-packages.gradle.wrapped`).

The consequence for the [Bundle](../../CONTEXT.md) pin: `nixpkgs#gradle` in the JAVA bundle does not hold a major. It follows nixpkgs' default choice and flips from 8.x to 9.x — or back — whenever nixpkgs moves the alias. The workspace explicitly follows the 9 line, so the pin names the versioned attribute `nixpkgs#gradle_9`: an attribute switch that survives registry updates, at the cost of tracking a pinned major that goes end-of-life before the alias does.

## corepack: already bundled by fnm's Node — the nix package rejected

Corepack ships inside Node.js itself (bundled since 16.9), and the NODE [Bundle](../../CONTEXT.md)'s Node comes from fnm's official distributions — so every fnm-installed Node arrives with its own matching corepack. There is nothing for nix to add:

- **Version duplication.** nixpkgs has no bare `corepack` attribute, only `corepack_22`/`corepack_24`, and neither is an independent release: `pkgs/development/web/nodejs/corepack.nix` inherits the version of the nix Node it wraps (`nodejs-slim_22`/`nodejs-slim_24`) and merely runs that Node's bundled corepack (`corepack enable --install-directory $out/bin`). Installing it would put a second corepack — a copy pinned to the nix Node major — beside the one the fnm Node already provides.
- **Patched-shebang interpreter clash.** Those generated shims bind to the nix store's `nodejs-slim` of the major the package was built against: their shebangs are patched to the absolute store path, so they always run nix's Node — never the fnm-managed Node the active shell selected. That inverts the fnm arrangement (runtimes owned per shell, per ADR 0003's [Carve-outs](../../CONTEXT.md)) and makes the shim's Node diverge from `node` on the very PATH it serves.

The rejection is therefore structural, not a version lag: the NODE bundle instead drives fnm's own corepack (`corepack enable`, then `corepack install --global pnpm@latest yarn@latest`), so the package managers ride the exact Node installation they belong to and re-enable naturally with each new Node.

## References

- [ADR 0003](../adr/0003-nix-as-toolchain-mechanism.md) — Nix as the toolchain mechanism, the pinned registry, the pure-profile rule and the unfree escape hatch
- [atlassian-cli.md](atlassian-cli.md) — the unfree counterpart: `acli` cannot ride the pure union
- [ruby-version-managers.md](ruby-version-managers.md) — the fnm precedent (manager in the profile, runtimes in home) mise follows
