// Post-merge hook: keep node_modules fresh after a merge or pull, since
// merged changes may update the lockfile; `bun install` is idempotent when
// they did not.
import { $ } from "bun";

const install = await $`bun install`.nothrow();
process.exit(install.exitCode);
