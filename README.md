# rtx-workspace

A GPU-capable remote development workspace delivered as a Docker Compose
stack: one Linux container you SSH into for day-to-day work (the
**workspace**), plus an **nginx** sidecar that serves the first-boot install
assets. The image bakes Nix — the package manager — and nothing else
tool-wise: every toolchain and everyday utility arrives on first boot when the
Bootstrap script installs the default Nix profile, so a fresh `/nix` volume
becomes a fully equipped environment on its own.

## Prerequisites

- **Docker** with the **Compose** (`docker compose`, 2.24+ for the optional
  env files) and **Buildx** plugins — the stack, the tests harness and the
  image builds all go through them, and the Dockerfile's
  `syntax=docker/dockerfile:1` directive requires BuildKit.
- **Bun** — runs the test suite, the git hooks, and every
  lint/format/type-check script; `bun install` also activates the hooks.
- **ShellCheck** (0.10+) — shell linting. Shell _formatting_ needs no host
  binary: it goes through Prettier and `prettier-plugin-sh`.
- **openssh-client** — the test suite's real-SSH assertions (`ssh` and
  `ssh-keygen`) log into the Tests stack through a throwaway generated key
  and a random published port (on every interface, so the suite also runs
  from inside a workspace).
- **openssl** (1.1.1+) and **curl** — the Bootstrap script's unit tests
  stand up a loopback HTTPS stand-in for a vendor endpoint (throwaway
  self-signed certificate) and drive the real curl wrapper against it.

## How the stack is layered

The Compose files are layered through service-level `extends:` (the reasoning
is recorded in [ADR 0001](docs/adr/0001-extends-based-compose-layering.md)):

| File                        | Role                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/docker-compose.yml`    | **Base compose** — the single source of truth: the `workspace` service, its named `nix` volume, and the `nginx` service every stack needs                                                                               |
| `docker-compose.yml` (root) | **Prod overlay** — the real, long-running stack: adds the NVIDIA GPU reservation, the external `gateway` network, the stable `workspace` container name, and publishes SSH on port 2222                                 |
| `tests/docker-compose.yml`  | **Tests stack** — a throwaway sibling of the real stack (own container name, project-scoped volume, dummy environment, throwaway SSH port, self-built nginx image) so tests run beside a live stack without touching it |

## The workspace image

`src/Dockerfile` builds on `ubuntu:26.04` with a slim runtime baseline and
Nix itself as the only tool-side content (the reasoning is recorded in
[ADR 0003](docs/adr/0003-nix-as-toolchain-mechanism.md)):

- applies `apt-get dist-upgrade` and installs only what the container itself
  needs — `openssh-server`, `curl` (the entrypoint fetches the Bootstrap
  script from the Web root before any profile exists), `ca-certificates`,
  `systemd-standalone-sysusers`, `xz-utils` (the Nix tarball is xz-compressed
  and extracted during the build), and `build-essential` — compilation-based
  installs such as `go install` need gcc, and `libatomic1` rides along
  transitively through it (vendor binaries still link it; Nix binaries are
  self-contained via store RPATHs);
- installs Nix from the pinned official release tarball (2.35.2),
  single-user as `ubuntu` — no channel, no daemon, flakes enabled,
  `sandbox = false` — with the home moved to `/nix/ubuntu` so a single
  `/nix` volume persists store, profiles and user state across container
  recreation;
- makes the container environment the single source of truth and projects it
  onto every shell surface through one Env loader,
  `/etc/profile.d/01-home-bash-env.sh` (the reasoning is recorded in
  [ADR 0006](docs/adr/0006-container-env-single-source-of-truth.md)): login
  shells reach it via `/etc/profile.d`, interactive non-login shells and
  `ssh host <cmd>` via the top of `/etc/bash.bashrc` (Debian's bash patch
  routes sshd-spawned command shells there, around `BASH_ENV`), and the
  non-interactive bash a session's servers spawn locally — the coding
  agents' Bash tools — via the `BASH_ENV` that sshd's `SetEnv` injects;
  `~/.bashrc` stays stock, and a bare `docker exec` needs no wiring (it
  carries the container environment natively);
- copies `gosu` (from `tianon/gosu`) into `/usr/local/bin` and drops
  configuration into place: `docker-entrypoint`, `home-env-mirror` (the
  Environment mirror), the `01-home-bash-env.sh` Env loader and
  `sshd_config_ubuntu`. The `ubuntu` user's password is locked — access is
  SSH-key only — and there is no sudo anywhere in the image;
- declares `VOLUME /nix` and runs as `ENTRYPOINT ["docker-entrypoint"]` with
  no `CMD`: invoked without arguments the entrypoint boots the workspace and
  ends in the foreground sshd; invoked with arguments it `exec`s them
  directly, so a one-off `docker run rtx-workspace <cmd>` skips the boot
  flow (socket-group setup, nginx wait, provisioning) entirely.

On every boot `src/docker-entrypoint.sh` also enrolls `ubuntu` in a group
matching the mounted Docker socket's GID, creating the group when the image
carries none: SSH sessions rebuild their groups from `/etc/group`, which
compose's `group_add` grant never reaches, so without this the socket would
deny every docker call made from a login shell.

At every boot it first runs `home-env-mirror` — the **Environment mirror** —
regenerating `~/.bash_env` (the **User environment file**) as a one-way
projection of the container environment, so a container recreated with new
or removed variables stays projected onto every shell surface; personal
variables belong in `.env.service`, the Compose env file that feeds the
container environment. On first boot the entrypoint then waits until nginx
is reachable and pipes `src/user-install.sh` — the **Bootstrap script** —
through `gosu` as `ubuntu`. The bootstrap runs only while the volume is
fresh (once OpenCode is present, subsequent boots skip straight to sshd),
and `SKIP_USER_INSTALL=1` skips provisioning on any boot — the escape hatch
for bringing a container up without waiting on the bootstrap or its nginx
dependency. It configures git against GitHub through `GH_TOKEN`, and
installs the public key from `SSH_AUTHORIZED_KEY`. Its install half is one
unattended `nix profile add` of
`nixpkgs#` packages (the flake-registry shorthand resolves to
nixpkgs-unstable): the **default profile** carries SDKMAN's set with GraalVM
CE (Gradle, Kotlin, Maven, Quarkus, Scala), Go, PHP + Composer, gh, git, yq
(under the nixpkgs attr `yq-go`), shellcheck, shfmt, the docker CLI (compose
plugin included), fnm, and the everyday utilities — all free-licensed, so
the install evaluates pure. Five **carve-outs** stay outside the read-only
store: uv through its official installer (the `UV_*` knobs are baked into
the image, with `UV_TORCH_BACKEND=cpu` as the default — CPU torch wheels
suit the common GPU-less case; override the env for CUDA), the
self-updating agent CLIs Claude Code and OpenCode through their vendor
scripts (they rewrite their own binary), and Node via fnm — `fnm install
--lts` with `lts-latest` as the default, wired interactive-only into
`~/.bashrc` as nvm was. Bun and Rust round out the carve-outs through their
vendor installers (bun.sh, rustup): both release faster than a pinned
profile tracks, and both self-update (`bun upgrade`, `rustup update`).

## Getting started

Besides the tools listed under [Prerequisites](#prerequisites), you need a
Docker socket at `/var/run/docker.sock` and — for the GPU reservation — an
NVIDIA GPU with the NVIDIA container toolkit configured.

1. Configure the service environment from the example (gitignored, holds
   secrets):

   ```bash
   cp .env.service.example .env.service
   # then fill in SSH_AUTHORIZED_KEY, GH_TOKEN, and the API keys
   ```

   The stack starts even without this file (it is declared `required: false`),
   but without `SSH_AUTHORIZED_KEY` nobody can SSH into the workspace.

2. Create the external network the Prod overlay attaches to:

   ```bash
   docker network create gateway
   ```

3. Bring the stack up from the repo root (the Prod overlay is the default
   compose file there). `--wait` gates on both services being healthy:

   ```bash
   docker compose up --detach --wait
   ```

4. SSH in. First boot takes a while: the entrypoint runs the full bootstrap
   before sshd answers.

   ```bash
   ssh -p 2222 ubuntu@localhost
   ```

## Testing

The suite is two Bun test files driven through Bun Shell:

```bash
bun test
```

Bun's test runner is built in — no `test` script needed.

The Docker file (`tests/docker.test.ts`) needs a running Docker daemon,
`/var/run/docker.sock` (its GID is injected into the Tests stack so the
container can reach the host daemon) and `openssh-client` on the test host
(see [Prerequisites](#prerequisites)). Global hooks build the image through
the Tests stack (`build --pull`, so expect a slow first run) and tear the
whole project down afterwards. The Tests stack's nginx builds from
`tests/Dockerfile.nginx` (the repository root as context, filtered by the
root `.dockerignore`) rather than bind-mounting the Bootstrap script — bind
sources resolve on the host, where the paths inside a workspace's `/nix`
volume do not exist — so the suite also runs from inside a workspace (see
[ADR 0004](docs/adr/0004-baked-nginx-bootstrap-script-for-tests-stack.md)).

- `describe("Dockerfile")` verifies the **Image contract**: what the image
  alone delivers before the Bootstrap script ever runs. A one-off workspace
  container (entrypoint replaced by `sleep infinity`, dependencies skipped)
  is probed with `docker compose exec` as the `ubuntu` user (plus one bare
  `docker exec` for the image-ENV PATH hook) across nine groups — nix,
  retired toolchains and managers, environment, env loading, files and
  permissions, privileges, image config, entrypoint, and system packages.
- `describe("user-install")` (in `tests/docker.test.ts`) exercises the full
  first-boot flow through nginx: the Tests stack's `up --wait` gates on the
  sshd healthcheck (which by construction only turns healthy after
  provisioning finishes), then bare-exec assertions run every
  default-profile tool, the carve-outs coexist (uv, Claude Code, OpenCode,
  Bun and Rust via their vendor installers; fnm/Node in an interactive
  shell), the retired managers leave no
  remnants, and a container restart proves the already-bootstrapped
  detection skips provisioning on a second boot.
- `describe("SSH surfaces")` (inside `user-install`) proves the remaining
  shell surfaces on the real sshd: the suite generates a throwaway keypair,
  injects the public half through the same `SSH_AUTHORIZED_KEY` env var
  production uses, and publishes a random port on every interface (a
  loopback-bound one would be unreachable from inside a workspace —
  [ADR 0005](docs/adr/0005-tests-stack-ssh-on-all-interfaces.md)) — then
  asserts that an SSH login shell (`/etc/profile.d`), a bare
  `ssh host <cmd>` (the loader at the top of `/etc/bash.bashrc`, through
  Debian's ssh patch) and a non-interactive `bash -c` under SSH (the
  coding-agent pattern) resolve default-profile tools and carry the mirrored
  environment. The key and the
  port are throwaway and leave no residue: the key directory is deleted in
  teardown, the port dies with the container.
- `describe("recreate")` (inside `user-install`) protects the `/nix`
  volume's persistence promise: the stack comes down keeping volumes and
  back up, the recreated container gates on the sshd healthcheck again,
  every default-profile tool and carve-out resolves from the kept volume
  (the profile bin, `~/.cargo/bin` or `~/.local/bin`, never the apt
  baseline), and the
  Bootstrap script never re-runs — the stack also comes back with a new
  `MIRROR_PROBE` variable, proving the Environment mirror projects
  container-environment changes onto the SSH surfaces.
- `tests/user-install.test.ts` unit-tests the Bootstrap script itself,
  Docker-free: the shared curl wrapper every vendor-installer fetch goes
  through is lifted out of the script by name and run against a loopback
  HTTPS stand-in for a vendor endpoint (self-signed throwaway certificate,
  passed through the wrapper's own `"$@"`). It pins the retry contract — a
  transient 503 is retried and the fetch still succeeds, a permanent 404
  fails on the first attempt, and the wrapper stays the only curl
  invocation in the script — so first boot keeps riding out vendor-endpoint
  flakiness instead of dying to it.

## Lint, formatting and type checking

Formatting is split between two tools with strict ownership — they never
touch the same file (the decision is recorded in
[ADR 0002](docs/adr/0002-husky-lint-staged-prettier-quality-gate.md)):

- **Biome** owns the TS family (`ts`, `tsx`, `js`, `jsx`, `json`, `jsonc`):
  lint, formatting and import organization, configured in `biome.json`.
- **Prettier** owns markdown, YAML, shell and Dockerfile, configured in
  `.prettierrc` with `prettier-plugin-sh` (which embeds shfmt's engine for
  shell). `.prettierignore` excludes the Biome-owned extensions so a
  repo-wide Prettier run never crosses the boundary.

```bash
bun run lint         # Biome check (TS family)
bun run lint:fix     # Biome check --write
bun run format       # Prettier --write (markdown/yaml/shell/Dockerfile)
bun run format:check # Prettier --check, no changes applied
bun run lint:sh      # ShellCheck over the first-party scripts
bun run lint:compose # docker compose config over all three Compose files
bun run typecheck    # tsc --noEmit
```

`.shellcheckrc` holds the ShellCheck policy (bash dialect, optional rules
enabled, known-noise codes disabled). The Compose validation checks the
compose-spec schema and the `extends` layering; the gitignored env files
are declared `required: false`, so it also works on fresh clones.

## Git hooks (Husky)

Hooks run through [Husky](https://typicode.github.io/husky/) and activate
themselves: the `prepare` lifecycle script runs on every `bun install` and
points `core.hooksPath` at `.husky/_`, so a fresh clone needs zero manual
setup. Hook logic is TypeScript executed by Bun; since Husky runs hook
files through `sh`, each extensionless hook under `.husky/` is a minimal
shell shim delegating to its sibling `.ts` implementation — the same files
`lint` and `typecheck` cover.

- `pre-commit` — lint-staged runs the fixers on staged files and re-stages
  what changed (Biome on the TS family, Prettier on its own types,
  configured in `.lintstagedrc.json`); then the blocking gates: ShellCheck
  on staged shell files, Compose validation when YAML is staged, and the
  full type check.
- `pre-push` — the `Dockerfile` block of the Docker suite only
  (`bun test --only-failures --test-name-pattern Dockerfile`), so the slow
  tests run once per push instead of per commit. The `user-install` half
  hits real vendor endpoints and fails intermittently on network hiccups,
  which made a full-suite push gate unreliable; run the full suite
  manually with `bun test`.
- `post-checkout` / `post-merge` — rerun `bun install` so `node_modules`
  never goes stale after a checkout, merge or pull.

Escape hatches for emergencies: `git commit --no-verify` (or
`git push --no-verify`) skips the hook once, and `HUSKY=0` disables Husky
entirely (e.g. `HUSKY=0 bun install` skips hook activation).

VS Code is preconfigured (`.vscode/`) to format on save with the same tools
as the hooks: Biome for the TS family, the Prettier extension for markdown,
YAML, shell and Dockerfile.

## Agent tooling

The repository versions ZCode agent tooling alongside the stack itself:

- **DeepWiki MCP** — `.zcode/config.json` declares the `deepwiki` MCP server
  (`https://mcp.deepwiki.com/mcp`), a free, no-authentication service that
  answers questions about public GitHub repositories from AI-generated
  documentation. ZCode auto-connects workspace-scoped servers at session
  start. Precedence caveat: for a same-named server, user scope
  (`~/.zcode/cli/config.json`) overrides the workspace, so a personal
  `deepwiki` entry shadows the project's one and edits to this file stop
  having effect until the personal entry is removed.
- **Project skills** — skill content lives in `.agents/skills/`, with
  `.zcode/skills/` holding one symlink per skill (both versioned). The
  `deepwiki` skill describes when and how to use the MCP tools. Skills
  installed from `mattpocock/skills` are tracked in `skills-lock.json`;
  first-party skills are not.

## Repository map

- `src/` — the main source: Dockerfile, entrypoint, the Environment mirror and Env loader, sshd config, Base compose, and the Bootstrap script (`user-install.sh`) nginx serves
- `tests/` — the Tests stack and the Bun test suite
- `CONTEXT.md` — the project glossary (canonical vocabulary, e.g. _Base compose_, _Bootstrap script_, _Image contract_)
- `docs/adr/` — architecture decision records
- `docs/agents/` — workflows for coding agents (issue tracker, triage labels, domain docs); start at [AGENTS.md](AGENTS.md)
- `.zcode/` — ZCode agent tooling: the DeepWiki MCP server config and the project skills (content in `.agents/skills/`, symlinks in `.zcode/skills/`)

## Conventions

- All repository content is written in English.
- Commands use long options wherever the tool provides them (e.g.
  `docker compose --file ... --project-name ...`).
- Compose files use the long syntax for volumes and ports.
- Compose files layer through service-level `extends:`
  ([ADR 0001](docs/adr/0001-extends-based-compose-layering.md)).
- Formatting is split with strict ownership: Biome enforces lint,
  formatting and import ordering for the TS family; Prettier formats
  markdown, YAML, shell and Dockerfile. `tsc --noEmit` checks types. Git
  hooks (Husky + lint-staged) run the fixers and gates on every commit —
  see [Git hooks](#git-hooks-husky).
- Shell strings prefer single quotes for literals without expansions;
  double quotes once a string contains a variable or command substitution.
  prettier-plugin-sh preserves quote style, so this is an authoring
  convention, not a tool-enforced one.
