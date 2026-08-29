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
- **Bun** — runs the test suite, the pre-commit hook, and every
  lint/format/type-check script; `bun install` also activates the hook.
- **ShellCheck** (0.10+) and **shfmt** (3.13+) — lint and formatting for the
  shell scripts.

## How the stack is layered

The Compose files are layered through service-level `extends:` (the reasoning
is recorded in [ADR 0001](docs/adr/0001-extends-based-compose-layering.md)):

| File | Role |
| ---- | ---- |
| `docker/docker-compose.yml` | **Base compose** — the single source of truth: the `workspace` service, its named `home` volume, and the `nginx` service every stack needs |
| `docker-compose.yml` (root) | **Prod overlay** — the real, long-running stack: adds the NVIDIA GPU reservation, the external `gateway` network, the stable `workspace` container name, and publishes SSH on port 2222 |
| `tests/docker-compose.yml` | **Tests stack** — a throwaway sibling of the real stack (own container name, project-scoped volume, dummy environment) so tests run beside a live stack without touching it |

## The workspace image

`docker/Dockerfile` builds on `buildpack-deps:26.04` and:

- applies `apt-get dist-upgrade` and installs system packages — `openssh-server`, `sudo`, `jq`, `ripgrep`, `ffmpeg`, `tmux`, and others;
- copies ready-to-run tool trees out of official images into `/home/ubuntu/.local`: Go (from `golang`), rustup/cargo (from `rust`), Bun with its completions (from `oven/bun`), the Docker CLI with the compose plugin (from `docker`), and `gosu`;
- drops configuration into place: `docker-entrypoint`, the `01-home-bash-env.sh` profile loader, `sshd_config_ubuntu`, and a passwordless-sudoers drop-in for the `ubuntu` user (whose password is locked — access is SSH-key only);
- declares `VOLUME /home`, runs as `ENTRYPOINT [ "docker-entrypoint" ]`, and starts sshd as the default command.

On first boot `docker/docker-entrypoint.sh` waits until nginx is reachable,
then pipes `web/user-install.sh` — the **Bootstrap script** — through `gosu`
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
bun test tests/docker.test.ts
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

Biome lints, formats and organizes imports (configured in `biome.json`,
2-space indent per `.editorconfig`), and `tsc --noEmit` checks types:

```bash
bun run lint          # check everything
bun run lint:fix      # auto-fix lint and formatting issues
bun run typecheck     # tsc --noEmit
```

A pre-commit hook runs Biome over the staged TS/JS/JSON files, checks
staged shell files with ShellCheck and shfmt, and runs the full type check.
The hook is written in TypeScript and executed by Bun: `.githooks/pre-commit`
is a two-line shim (git requires that extensionless name) importing the
implementation in `.githooks/pre-commit.ts`. It activates itself:
`bun install` points `core.hooksPath` at `.githooks`. VS Code is
preconfigured (`.vscode/`) to format with Biome on save and to organize
imports alongside it.

Two more hooks keep dependencies fresh, with the same shim + `.ts` layout:
`post-checkout` reruns `bun install` when a branch switch (or a fresh
clone/worktree) changed `bun.lock` or `package.json`, and `post-merge`
reruns it after every merge or pull.

Shell scripts get the same treatment through ShellCheck and shfmt:

```bash
bun run lint:sh          # ShellCheck over the first-party scripts
bun run format:sh        # shfmt --write (reads .editorconfig)
bun run format:sh:check  # shfmt --diff, no changes applied
```

Both tools are local binaries (see [Prerequisites](#prerequisites)).

The Compose files are validated with `bun run lint:compose`, which runs
`docker compose config` over all three Compose files — schema and the
`extends` layering included. The pre-commit hook runs it when YAML is staged.
The gitignored env files are declared `required: false`, so validation also
works on fresh clones.

## Repository map

- `docker/` — Dockerfile, entrypoint, profile loader, sshd config, Base compose
- `web/` — what nginx serves: the Bootstrap script (`user-install.sh`)
- `tests/` — the Tests stack and the Bun test suite
- `CONTEXT.md` — the project glossary (canonical vocabulary, e.g. *Base compose*, *Bootstrap script*, *Image contract*)
- `docs/adr/` — architecture decision records
- `docs/agents/` — workflows for coding agents (issue tracker, triage labels, domain docs); start at [AGENTS.md](AGENTS.md)

## Conventions

- All repository content is written in English.
- Commands use long options wherever the tool provides them (e.g.
  `docker compose --file ... --project-name ...`).
- Compose files use the long syntax for volumes and ports.
- Compose files layer through service-level `extends:`
  ([ADR 0001](docs/adr/0001-extends-based-compose-layering.md)).
- Biome enforces lint, formatting and import ordering; `tsc --noEmit` checks
  types. A pre-commit hook runs both on every commit.
