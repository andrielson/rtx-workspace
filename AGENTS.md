# AGENTS.md

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
- In every `package.json`, always keep the entries of `scripts`, `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` and any other dependency block sorted alphabetically, in strict lexicographic order (a shorter prefix comes first — e.g., `lint` before `lint:fix`).
- Keep `README.md` current. Whenever the project is modified, check whether the README still reflects reality — objective, architecture, setup commands, tests — and update it in the same change whenever it does not.
- Lint, formatting and type checking are enforced by Biome plus `tsc`, via `bun run lint` (check), `bun run lint:fix` (auto-fix) and `bun run typecheck` (`tsc --noEmit`). The pre-commit hook `.githooks/pre-commit` runs Biome on staged TS/JS/JSON files plus the full type check; Git finds the hook because `bun install` sets `core.hooksPath` to `.githooks` through the `postinstall` script. Indentation style is 2 spaces everywhere (see `.editorconfig` and `biome.json`).
- Shell scripts (including `.githooks/pre-commit`) are linted with ShellCheck and formatted with shfmt, via `bun run lint:sh`, `bun run format:sh` and `bun run format:sh:check`, using the local `shellcheck` and `shfmt` binaries (see the README prerequisites). `.shellcheckrc` holds the repo-wide ShellCheck policy. The pre-commit hook runs both checks on staged shell files.
- The Compose files (Base compose, Prod overlay, Tests stack) are validated with `bun run lint:compose`, which runs `docker compose config --quiet` over all three files — checking the compose-spec schema and the `extends:` layering. The pre-commit hook runs it when staged files include YAML.
