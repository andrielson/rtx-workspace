# AGENTS.md

## Repository

A GPU-capable remote development workspace delivered as a Docker Compose stack: a **workspace** container the developer SSHes into (port 2222 via the Prod overlay), plus an **nginx** sidecar serving the first-boot install assets. Run `bun install` after cloning — it also activates the git hooks.

- `src/` — the image and its runtime: `Dockerfile`, `docker-entrypoint.sh`, `01-home-bash-env.sh`, `sshd_config_ubuntu`, the Base compose, and the Bootstrap script (`user-install.sh`)
- `tests/` — the Tests compose stack and the Bun test suite
- `CONTEXT.md` — the project glossary (canonical terms: _Base compose_, _Prod overlay_, _Tests stack_, _Bootstrap script_, _Image contract_, ...); use this vocabulary
- `docs/adr/` — architecture decision records
- `docs/agents/` — agent workflow docs (issue tracker, triage labels, domain docs)

## Architecture boundaries

- The three Compose files layer through service-level `extends:` (ADR 0001): **Base compose** (`src/docker-compose.yml`) is the single source of truth; the root `docker-compose.yml` (**Prod overlay**) and `tests/docker-compose.yml` (**Tests stack**) only extend it. Shared changes go in the Base compose; each overlay adds only what is unique to it.
- **Image contract**: the image alone (Dockerfile + entrypoint) delivers the heavy toolchains; everything user-specific is installed on first boot by the Bootstrap script. Decide which side a new tool belongs to before adding it.

## Testing

`bun run test` (wraps `bun test tests/`) runs both test files. `tests/docker.test.ts` needs a running Docker daemon and `/var/run/docker.sock`; global hooks build the image through the Tests stack (`build --pull`, so the first run is slow) and tear the project down afterwards. `describe("Dockerfile")` asserts the Image contract; `describe("user-install")` exercises the first-boot flow end to end. `tests/user-install.test.ts` is Docker-free: it unit-tests the Bootstrap script's shared curl wrapper against a loopback HTTPS stand-in for a vendor endpoint (host `openssl` and `curl` required).

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
- Lint, formatting and type checking are enforced by two formatters with strict ownership plus `tsc` (the reasoning is recorded in [ADR 0002](docs/adr/0002-husky-lint-staged-prettier-quality-gate.md)). Biome owns the TS family (`ts`, `tsx`, `js`, `jsx`, `json`, `jsonc`) via `bun run lint` (check) and `bun run lint:fix` (auto-fix); Prettier owns markdown, YAML, shell and Dockerfile via `bun run format` (write) and `bun run format:check`, using `prettier-plugin-sh` (policy in `.prettierrc`); `bun run typecheck` runs `tsc --noEmit`. The two formatters must never own the same file — `.prettierignore` excludes the Biome-owned extensions so a repo-wide Prettier run never crosses the boundary.
- Git hooks run through Husky and activate themselves: the `prepare` lifecycle script runs on every `bun install` and points `core.hooksPath` at `.husky/_`, so a fresh clone needs zero manual setup. Escape hatches: `git commit --no-verify` (and `git push --no-verify`) skips a hook once, `HUSKY=0` disables Husky entirely. Hook logic is always written in TypeScript executed by Bun. Because Husky runs hook files through `sh` (a Bun shebang would not be honored), every extensionless hook under `.husky/` is a minimal shell shim delegating to its sibling `.ts` implementation — `exec bun "$(dirname -- "$0")/<hook>.ts" "$@"` — which is the only place Biome and `tsc` see the hooks (`tsconfig.json` and `biome.json` include `.husky/` explicitly, since `**` skips dot-directories); new hooks must follow this shape. To run subprocesses, hooks use the Bun Shell — `import { $ } from "bun";` — whenever possible, in preference to `Bun.spawn`. Four hooks exist: `pre-commit` runs lint-staged first — the fixers in `.lintstagedrc.json` (Biome and Prettier on staged files, re-staging whatever changed; blocking verifiers deliberately stay out of lint-staged because it runs glob groups concurrently and a checker racing a writer is not deterministic) — then the gates: ShellCheck on staged shell files, Compose validation when YAML is staged, and the full type check; `pre-push` runs the full test suite (`bun run test`, the Docker suite plus the Docker-free unit file) once per push; `post-checkout` and `post-merge` rerun `bun install` unconditionally (a no-op install is sub-second, and file checkouts can also restore dependency manifests from another commit).
- Whenever information about a third-party project is needed (APIs, CLI, runtime behavior, releases, internals), research it through the `deepwiki` MCP against that project's GitHub repository (e.g., Bun via `oven-sh/bun`). The `deepwiki` skill in `.agents/skills/deepwiki/` describes the workflow.
- Shell scripts are linted with ShellCheck via `bun run lint:sh`, using the local `shellcheck` binary (see the README prerequisites); `.shellcheckrc` holds the repo-wide ShellCheck policy (bash dialect, enabled optional rules, disabled codes). Formatting goes through Prettier with `prettier-plugin-sh`, which embeds the shfmt engine — no host `shfmt` binary is needed — via `bun run format` / `bun run format:check`, with the shell policy (indent, `switchCaseIndent`, `spaceRedirects`, `binaryNextLine`) living in `.prettierrc`. The pre-commit hook runs ShellCheck on staged shell files; their formatting rides the same lint-staged Prettier task as every other Prettier-owned file.
- In shell scripts, prefer single quotes for literal strings without expansions; switch to double quotes as soon as the string contains a variable or command substitution (ShellCheck's SC2016 flags the mistake). prettier-plugin-sh preserves quote style, so this is an authoring convention enforced by review, not by tooling.
- The Compose files (Base compose, Prod overlay, Tests stack) are validated with `bun run lint:compose`, which runs `docker compose config --quiet` over all three files — checking the compose-spec schema and the `extends:` layering. The pre-commit hook runs it when staged files include YAML.
