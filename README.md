# rtx-workspace

A GPU-capable remote development workspace delivered as a Docker Compose
stack: one Linux container you SSH into for day-to-day work (the
**workspace**), plus an **nginx** sidecar that serves the first-boot install
assets. The image ships the heavy toolchains — Go, Rust, Bun, the Docker CLI —
while everything user-specific is installed on first boot by a bootstrap
script, so a fresh home volume becomes a fully equipped environment on its own.

## Prerequisites

- **Docker** with the **Compose** (`docker compose`, 2.24+ for the optional
  env files) and **Buildx** plugins — the stack, the tests harness and the
  image builds all go through them, and the Dockerfile's
  `syntax=docker/dockerfile:1` directive requires BuildKit.
- **Bun** — runs the test suite, the git hooks, and every
  lint/format/type-check script; `bun install` also activates the hooks.
- **ShellCheck** (0.10+) — shell linting. Shell _formatting_ needs no host
  binary: it goes through Prettier and `prettier-plugin-sh`.

## How the stack is layered

The Compose files are layered through service-level `extends:` (the reasoning
is recorded in [ADR 0001](docs/adr/0001-extends-based-compose-layering.md)):

| File                        | Role                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/docker-compose.yml`    | **Base compose** — the single source of truth: the `workspace` service, its named `home` volume, and the `nginx` service every stack needs                                              |
| `docker-compose.yml` (root) | **Prod overlay** — the real, long-running stack: adds the NVIDIA GPU reservation, the external `gateway` network, the stable `workspace` container name, and publishes SSH on port 2222 |
| `tests/docker-compose.yml`  | **Tests stack** — a throwaway sibling of the real stack (own container name, project-scoped volume, dummy environment) so tests run beside a live stack without touching it             |

## The workspace image

`src/Dockerfile` builds on `buildpack-deps:26.04` and:

- applies `apt-get dist-upgrade` and installs system packages — `openssh-server`, `sudo`, `jq`, `ripgrep`, `ffmpeg`, `tmux`, and others;
- copies ready-to-run tools out of official images: Go (from `golang`), rustup/cargo (from `rust`), Bun with its completions (from `oven/bun`), and the Docker CLI with the compose plugin (from `docker`) into `/home/ubuntu/.local`, ShellCheck (from `koalaman/shellcheck`) and shfmt (from `mvdan/shfmt`) into `/home/ubuntu/.local/bin`, and `gosu` (from `tianon/gosu`) into `/usr/local/bin`;
- drops configuration into place: `docker-entrypoint`, the `01-home-bash-env.sh` profile loader, `sshd_config_ubuntu`, and a passwordless-sudoers drop-in for the `ubuntu` user (whose password is locked — access is SSH-key only);
- declares `VOLUME /home`, runs as `ENTRYPOINT ["docker-entrypoint"]`, and starts sshd as the default command.

On first boot `src/docker-entrypoint.sh` waits until nginx is reachable,
then pipes `src/user-install.sh` — the **Bootstrap script** — through `gosu`
as `ubuntu`. It runs only while the home volume is fresh (once OpenCode is
present, subsequent boots skip straight to sshd). The bootstrap installs the
user-level toolchain (Homebrew, NVM + Node.js, SDKMAN + JVM toolchains,
uv + Python, GitHub CLI, yq, Composer, Claude Code, OpenCode, ...), writes
`~/.bash_env` so SSH sessions inherit the container environment, configures
git against GitHub through `GH_TOKEN`, and installs the public key from
`SSH_AUTHORIZED_KEY`.

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

The suite is a Bun test file that drives the Docker CLI through Bun Shell:

```bash
bun run test # wraps: bun test tests/docker.test.ts
```

It needs only a running Docker daemon and `/var/run/docker.sock` — the
socket's GID is injected into the Tests compose so the container can reach
the host daemon. Global hooks build the image through the Tests stack
(`build --pull`, so expect a slow first run) and tear the whole project down
afterwards.

- `describe("Dockerfile")` verifies the **Image contract**: what the image
  alone delivers before the Bootstrap script ever runs. A one-off workspace
  container (entrypoint replaced by `sleep infinity`, dependencies skipped)
  is probed with `docker compose exec` as the `ubuntu` user across six
  groups — copied tools, environment, copied files and permissions,
  privileges, image config, and system packages.
- `describe("user-install")` is a placeholder for future Bootstrap-script
  tests, which will exercise the full first-boot flow through nginx.

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
- `pre-push` — the Docker test suite (`bun run test`), so the slow suite
  runs once per push instead of per commit.
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

- `src/` — the main source: Dockerfile, entrypoint, profile loader, sshd config, Base compose, and the Bootstrap script (`user-install.sh`) nginx serves
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
