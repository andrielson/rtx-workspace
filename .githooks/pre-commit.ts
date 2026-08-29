// Pre-commit hook: lint staged source files with Biome, lint and format-check
// staged shell files with ShellCheck/shfmt, validate staged Compose YAML,
// then type check the whole repo.
// Git runs this because `bun install` sets `core.hooksPath` to `.githooks` (see package.json).
// To skip it in an emergency: `git commit --no-verify`.
import { $ } from "bun";

const stagedFiles = async (...pathspecs: string[]): Promise<string[]> => {
  // Bun Shell interpolates each array element as its own escaped argument,
  // so filenames with whitespace are safe here.
  const listing =
    await $`git diff --cached --name-only --diff-filter=ACMR -- ${pathspecs}`
      .quiet()
      .nothrow()
      .text();
  return listing.split("\n").filter((file) => file.length > 0);
};

const sourceFiles = await stagedFiles(
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.json",
  "*.jsonc",
);

if (sourceFiles.length > 0) {
  const biome =
    await $`bunx biome check --no-errors-on-unmatched ${sourceFiles}`.nothrow();
  if (biome.exitCode !== 0) {
    console.error(
      "pre-commit: Biome found issues. Run 'bun run lint:fix', then stage the fixes.",
    );
    process.exit(1);
  }
}

const shellFiles = await stagedFiles("*.sh", "*.bash");

if (shellFiles.length > 0) {
  const shellcheck = await $`shellcheck --shell=bash ${shellFiles}`.nothrow();
  if (shellcheck.exitCode !== 0) {
    console.error(
      "pre-commit: ShellCheck found issues. Run 'bun run lint:sh' for the full report.",
    );
    process.exit(1);
  }

  const shfmt = await $`shfmt --diff ${shellFiles}`.nothrow();
  if (shfmt.exitCode !== 0) {
    console.error(
      "pre-commit: shfmt found formatting diffs. Run 'bun run format:sh'.",
    );
    process.exit(1);
  }
}

const yamlFiles = await stagedFiles("*.yml", "*.yaml");

if (yamlFiles.length > 0) {
  const compose = await $`bun run lint:compose`.nothrow();
  if (compose.exitCode !== 0) {
    console.error(
      "pre-commit: Compose validation failed. Run 'bun run lint:compose' for details.",
    );
    process.exit(1);
  }
}

const typecheck = await $`bun run typecheck`.nothrow();
if (typecheck.exitCode !== 0) {
  console.error(
    "pre-commit: type checking failed. Run 'bun run typecheck' for details.",
  );
  process.exit(1);
}
