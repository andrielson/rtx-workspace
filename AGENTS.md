# AGENTS.md

## Repository

A GPU-capable remote development workspace delivered as a Docker Compose stack: a **workspace** container the developer SSHes into (port 2222 via the Prod overlay), plus an **nginx** sidecar serving the first-boot install assets. Run `bun install` after cloning — it also activates the git hooks.

- `src/` — the image and its runtime: `Dockerfile`, `docker-entrypoint.sh`, `01-home-bash-env.sh`, `sshd_config_ubuntu`, the Base compose, and the Bootstrap script (`user-install.sh`)
- `tests/` — the Tests compose stack and the Bun test suite
- `CONTEXT.md` — the project glossary (canonical terms: *Base compose*, *Prod overlay*, *Tests stack*, *Bootstrap script*, *Image contract*, ...); use this vocabulary
- `docs/adr/` — architecture decision records
- `docs/agents/` — agent workflow docs (issue tracker, triage labels, domain docs)

## Architecture boundaries

- The three Compose files layer through service-level `extends:` (ADR 0001): **Base compose** (`src/docker-compose.yml`) is the single source of truth; the root `docker-compose.yml` (**Prod overlay**) and `tests/docker-compose.yml` (**Tests stack**) only extend it. Shared changes go in the Base compose; each overlay adds only what is unique to it.
- **Image contract**: the image alone (Dockerfile + entrypoint) delivers the heavy toolchains; everything user-specific is installed on first boot by the Bootstrap script. Decide which side a new tool belongs to before adding it.

## Testing

`bun test tests/docker.test.ts` — needs a running Docker daemon and `/var/run/docker.sock`; global hooks build the image through the Tests stack (`build --pull`, so the first run is slow) and tear the project down afterwards. `describe("Dockerfile")` asserts the Image contract; `describe("user-install")` is the Bootstrap-script placeholder.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (Andrielson/rtx-workspace), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default triage label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Conventions

- Write everything the agent produces in English, regardless of the language the user speaks in the conversation (e.g., Portuguese). This covers code, code comments, documentation and any other files added to the repo, commit messages, GitHub content created via `gh` (issues, issue comments, pull request descriptions, review comments), written plans and design/spec documents produced before or during implementation, and any other generated artifact or written output. Only direct conversational replies in chat may mirror the user's language.
- Always use the long format for command arguments (e.g., `docker compose --file ... --project-name ...`, not `-f`/`-p`) — it is easier to read for someone unfamiliar with the options. This covers shell commands in general, including `RUN` statements in Dockerfiles and shell scripts such as `docker-entrypoint.sh` and `user-install.sh`. Where a tool has no long options (e.g., BusyBox utilities in Alpine-based images), short flags are fine — leave a comment saying so.
- In Docker Compose files, prefer the long syntax too: volumes as `type:`/`source:`/`target:` entries and ports as `target:`/`published:`, not the `- source:target` or `- host:container` shorthand.
- Prefer nested `.gitignore` files (e.g., `tests/.gitignore`) instead of including everything in the root `.gitignore`.
- Keep `README.md` current. Whenever the project is modified, check whether the README still reflects reality — objective, architecture, setup commands, tests — and update it in the same change whenever it does not.
- Lint, formatting and type checking are enforced by Biome plus `tsc`, via `bun run lint` (check), `bun run lint:fix` (auto-fix) and `bun run typecheck` (`tsc --noEmit`). The pre-commit hook is written in TypeScript and executed by Bun: `.githooks/pre-commit` is a shim importing the implementation in `.githooks/pre-commit.ts`, and it runs Biome on staged TS/JS/JSON files plus the full type check; Git finds the hook because `bun install` sets `core.hooksPath` to `.githooks` through the `postinstall` script.
- Git hooks under `.githooks/` are always written in TypeScript executed by Bun, with the `#!/usr/bin/env bun` shebang. Because git requires each hook at its exact extensionless filename, every hook is a two-line shim importing its implementation from the sibling `.ts` file (as `.githooks/pre-commit` imports `.githooks/pre-commit.ts`); new hooks must follow this shape instead of being shell scripts. To run subprocesses, hooks use the Bun Shell — `import { $ } from "bun";` — whenever possible, in preference to `Bun.spawn`. Besides `pre-commit`, `post-checkout` and `post-merge` share the same shim + `.ts` layout, rerunning `bun install` whenever a branch switch or merge changed `bun.lock` or `package.json`.
- Whenever information about a third-party project is needed (APIs, CLI, runtime behavior, releases, internals), research it through the `deepwiki` MCP against that project's GitHub repository (e.g., Bun via `oven-sh/bun`). The `deepwiki` skill in `.agents/skills/deepwiki/` describes the workflow.
- Shell scripts are linted with ShellCheck and formatted with shfmt, via `bun run lint:sh`, `bun run format:sh` and `bun run format:sh:check`, using the local `shellcheck` and `shfmt` binaries (see the README prerequisites). `.shellcheckrc` holds the repo-wide ShellCheck policy (bash dialect, enabled optional rules, disabled codes) and `.editorconfig` holds the repo-wide shfmt policy (the `[*.{sh,bash}]` section). Both tools are always invoked without parser/printer flags — any such flag (e.g. `-s`, `-i`) makes shfmt ignore `.editorconfig` entirely. The pre-commit hook runs both checks on staged shell files.
- In shell scripts, prefer single quotes for literal strings without expansions; switch to double quotes as soon as the string contains a variable or command substitution (ShellCheck's SC2016 flags the mistake). shfmt preserves quote style, so this is an authoring convention enforced by review, not by tooling.
- The Compose files (Base compose, Prod overlay, Tests stack) are validated with `bun run lint:compose`, which runs `docker compose config --quiet` over all three files — checking the compose-spec schema and the `extends:` layering. The pre-commit hook runs it when staged files include YAML.
