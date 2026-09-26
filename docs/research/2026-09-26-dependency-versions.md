# Dependency versions — pinned vs. latest stable

Research date: **2026-09-26**. All version and date claims were retrieved on that date from the two primary sources below; no aggregators or blog posts were used.

- npm registry (first-party publishing source): `https://registry.npmjs.org/<package>` — `dist-tags` and the `time` map
- GitHub Releases via the `gh` CLI: `https://github.com/<owner>/<repo>/releases`

Findings apply to the repo root [`package.json`](../../package.json). No package files were modified for this research.

## Summary

| Package                                                             | Pinned                                                             | Latest stable                | Delta                          | Semver level            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------- | ------------------------------ | ----------------------- |
| [@biomejs/biome](https://registry.npmjs.org/@biomejs/biome)         | 2.5.11                                                             | 2.5.14 (2026-09-16)          | +3 patch releases              | patch                   |
| [@types/bun](https://registry.npmjs.org/@types/bun)                 | `latest` (floating; resolves to 1.4.2 today; lockfile holds 1.4.0) | 1.4.2 (2026-09-08)           | 1.4.0 → 1.4.2 for the lockfile | patch (on next install) |
| [husky](https://registry.npmjs.org/husky)                           | 9.1.7                                                              | 9.1.7 (2024-11-18)           | none                           | —                       |
| [lint-staged](https://registry.npmjs.org/lint-staged)               | 17.4.1                                                             | 17.5.1 (2026-09-10)          | +1 minor, +1 patch             | minor                   |
| [prettier](https://registry.npmjs.org/prettier)                     | 3.9.6                                                              | 3.9.9 (2026-09-23)           | +3 patch releases              | patch                   |
| [prettier-plugin-sh](https://registry.npmjs.org/prettier-plugin-sh) | 0.19.0                                                             | 0.20.2 (2026-09-24)          | +1 minor, +2 patch             | minor (0.x)             |
| [typescript](https://registry.npmjs.org/typescript)                 | 7.0.2                                                              | 7.0.2 (npm time: 2026-07-08) | none                           | —                       |
| [bun](https://registry.npmjs.org/bun) (`packageManager`)            | 1.4.2                                                              | 1.4.2 (2026-09-05)           | none                           | —                       |

No package has a MAJOR jump available today, so no breaking-change migration is forced by any update. Four packages have updates (biome, @types/bun-on-install, lint-staged, prettier, prettier-plugin-sh); three pins plus the Bun runtime are already at the latest stable.

## Per-package detail

### @biomejs/biome — 2.5.11 → 2.5.14 (patch)

- Pinned: 2.5.11. Latest stable: **2.5.14**, published 2026-09-16 ([registry](https://registry.npmjs.org/@biomejs/biome), retrieved 2026-09-26; [GitHub release](https://github.com/biomejs/biome/releases/tag/%40biomejs%2Fbiome%402.5.14)).
- Update exists: yes, three patch releases (2.5.12 on 2026-09-03, 2.5.13 on 2026-09-10, 2.5.14 on 2026-09-16 — [releases list](https://github.com/biomejs/biome/releases), retrieved 2026-09-26).
- Not a major bump, so no breaking changes to itemize. Highlights from the release bodies (retrieved 2026-09-26):
  - 2.5.12 is almost entirely Astro parser fixes (attribute expressions, `is:raw`, script/style children, template-literal attributes) — [release notes](https://github.com/biomejs/biome/releases/tag/%40biomejs%2Fbiome%402.5.12).
  - 2.5.13 restores type-aware lint performance for large libraries such as Zod by no longer fully inferring imported generic declarations — [release notes](https://github.com/biomejs/biome/releases/tag/%40biomejs%2Fbiome%402.5.13).
  - 2.5.14 adds nursery rules (`noReturnInFinally`, `noSvelteAtDebugTags`, `useValidTestTitle`) and fixes `source.fixAll.biome` ignoring `formatter.formatWithErrors` — [release notes](https://github.com/biomejs/biome/releases/tag/%40biomejs%2Fbiome%402.5.14).
- Other dist-tags: `beta` → 2.0.0-beta.6 (published 2025-06-02) and `nightly` → 1.9.5-nightly.81fdedb (published 2024-11-26) — both older than `latest`, i.e. stale, not a newer prerelease ([registry](https://registry.npmjs.org/@biomejs/biome), retrieved 2026-09-26).

### @types/bun — `latest` (floating) → 1.4.2 today (patch on next install)

- Pinned: the literal `latest` dist-tag, so the pin floats. Today that tag resolves to **1.4.2**, published 2026-09-08 ([registry](https://registry.npmjs.org/@types/bun), retrieved 2026-09-26). The registry is the authoritative source for this package; per-release GitHub notes are not meaningful for DefinitelyTyped output.
- The lockfile currently holds `@types/bun@1.4.0`, so the next `bun install` drifts to 1.4.2 — a patch-level move ([bun.lock](../../bun.lock)).
- Other dist-tags: per-TypeScript-version tags (`ts5.2` … `ts6.0`) all currently point at 1.4.2 as well ([registry](https://registry.npmjs.org/@types/bun), retrieved 2026-09-26).

### husky — 9.1.7 (no update)

- Pinned: 9.1.7. Latest stable: **9.1.7**, npm publish 2024-11-18 ([registry](https://registry.npmjs.org/husky), retrieved 2026-09-26); confirmed by the [v9.1.7 GitHub release](https://github.com/typicode/husky/releases/tag/v9.1.7) (published 2024-11-18), which is also the repo's latest release ([releases list](https://github.com/typicode/husky/releases), retrieved 2026-09-26).
- Update exists: no. The project has not shipped a release in roughly 22 months; it is stable/inactive rather than deprecated — the registry metadata carries no deprecation notice on 9.1.7.
- Other dist-tags: none; `latest` is the only tag ([registry](https://registry.npmjs.org/husky), retrieved 2026-09-26).

### lint-staged — 17.4.1 → 17.5.1 (minor)

- Pinned: 17.4.1 (published 2026-08-27). Latest stable: **17.5.1**, published 2026-09-10 ([registry](https://registry.npmjs.org/lint-staged), retrieved 2026-09-26; [GitHub release](https://github.com/lint-staged/lint-staged/releases/tag/v17.5.1)).
- Update exists: yes, minor level (17.5.0 on 2026-09-05, then 17.5.1 on 2026-09-10 — [releases list](https://github.com/lint-staged/lint-staged/releases), retrieved 2026-09-26).
- Not a major bump. One behavioral change worth knowing from the 17.5.0 notes: lint-staged now refuses to run when files were staged with `--intent-to-add`, because Git stash does not support them (previously an unhandled error) — [17.5.0 release notes](https://github.com/lint-staged/lint-staged/releases/tag/v17.5.0), retrieved 2026-09-26. 17.5.1 is a TypeScript fix for `defineConfig()` (`TS1254`, const → function signature) — [17.5.1 release notes](https://github.com/lint-staged/lint-staged/releases/tag/v17.5.1), retrieved 2026-09-26.
- Other dist-tags: `next` → 13.1.4 (2023-03-06) and `beta` → 11.3.0-beta.2 (2021-10-30) — both far older than `latest`; stale, ignore them ([registry](https://registry.npmjs.org/lint-staged), retrieved 2026-09-26).

### prettier — 3.9.6 → 3.9.9 (patch)

- Pinned: 3.9.6 (published 2026-07-21). Latest stable: **3.9.9**, published 2026-09-23 ([registry](https://registry.npmjs.org/prettier), retrieved 2026-09-26; [GitHub release](https://github.com/prettier/prettier/releases/tag/3.9.9)).
- Update exists: yes, three patch releases (3.9.7 on 2026-09-16, 3.9.8 on 2026-09-17, 3.9.9 on 2026-09-23 — [releases list](https://github.com/prettier/prettier/releases), retrieved 2026-09-26).
- Not a major bump. Scope of the patches per the release bodies (retrieved 2026-09-26): 3.9.7 adds Angular 22.2 support and fixes v3.9 regressions; 3.9.8 keeps Liquid objects from interrupting Markdown paragraphs; 3.9.9 fixes Markdown text with `$` being parsed as math.
- Other dist-tags: `next` → **4.0.0-alpha.13** (published 2025-11-18) — a v4 alpha line exists. It is a pre-release of the next major, older than the current `latest` publish; worth tracking but not install-worthy today ([registry](https://registry.npmjs.org/prettier), retrieved 2026-09-26).

### prettier-plugin-sh — 0.19.0 → 0.20.2 (minor, 0.x)

- Pinned: 0.19.0 (published 2026-07-10). Latest stable: **0.20.2**, published 2026-09-24 ([registry](https://registry.npmjs.org/prettier-plugin-sh), retrieved 2026-09-26; [GitHub release](https://github.com/un-ts/prettier/releases/tag/prettier-plugin-sh%400.20.2)).
- Update exists: yes, minor level in 0.x terms (0.20.0, 0.20.1, 0.20.2 — all published 2026-09-24 — [releases list](https://github.com/un-ts/prettier/releases), retrieved 2026-09-26). Under 0.x semantics a minor bump can carry breaks, but the 0.20.0 body lists a single additive change: a new opt-in `simplify` option that removes redundant shell syntax — [0.20.0 release notes](https://github.com/un-ts/prettier/releases/tag/prettier-plugin-sh%400.20.0), retrieved 2026-09-26. 0.20.1/0.20.2 are provenance/republish fixes only.
- Repository note: the package's GitHub home moved — npm metadata points at the `un-ts/prettier` monorepo (`packages/sh`), and `un-ts/prettier-plugin-sh` as a standalone repo now returns 404 ([registry repository field](https://registry.npmjs.org/prettier-plugin-sh), retrieved 2026-09-26). The `.shellcheckrc`/`.prettierrc` shell policy in this repo is unaffected by the move.
- Other dist-tags: `alpha` → 0.13.0-alpha.1 (2023-04-13), stale ([registry](https://registry.npmjs.org/prettier-plugin-sh), retrieved 2026-09-26).

### typescript — 7.0.2 (no update)

- Pinned: 7.0.2. Latest stable: **7.0.2** — npm `time` records its publish as 2026-07-08 ([registry](https://registry.npmjs.org/typescript), retrieved 2026-09-26); the corresponding [v7.0.2 GitHub release](https://github.com/microsoft/TypeScript/releases/tag/v7.0.2) is dated 2026-08-20 (the two sources disagree on the date; both are cited as reported).
- Update exists: no. 7.0.2 is the newest stable ([releases list](https://github.com/microsoft/TypeScript/releases), retrieved 2026-09-26).
- Other dist-tags: `next` → 7.1.0-dev.20260925.1 (daily dev builds of the upcoming 7.1); `rc` → 7.0.1-rc (2026-06-18, superseded by stable 7.0.2); `beta` → 6.0.0-beta (stale) ([registry](https://registry.npmjs.org/typescript), retrieved 2026-09-26).

### bun runtime (`packageManager`) — 1.4.2 (no update)

- Pinned: `bun@1.4.2`. Latest stable: **1.4.2**, GitHub release `bun-v1.4.2` published 2026-09-05 ([release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2), retrieved 2026-09-26); the npm `bun` package's `latest` tag agrees at 1.4.2 (published 2026-09-05 — [registry](https://registry.npmjs.org/bun), retrieved 2026-09-26).
- Update exists: no — the pin is the newest stable ([releases list](https://github.com/oven-sh/bun/releases), retrieved 2026-09-26).
- Other dist-tags: `canary` → 1.4.2-canary.20260925.1 (daily canary, not a release channel) ([registry](https://registry.npmjs.org/bun), retrieved 2026-09-26).

## Practical read for an upgrade pass

- Safe, zero-migration updates today: `@biomejs/biome` 2.5.14, `lint-staged` 17.5.1, `prettier` 3.9.9, `prettier-plugin-sh` 0.20.2 — all patch/minor with no breaking changes listed in their release notes.
- `@types/bun` needs no edit (it floats on `latest`); a plain `bun install` refreshes the lockfile from 1.4.0 to 1.4.2.
- `husky`, `typescript`, and the `bun` runtime pin are already current.
- Watch items: prettier 4.0.0-alpha on the `next` tag, and TypeScript 7.1.0-dev on `next` — both signal the next round of major work.
