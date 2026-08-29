// Pre-push hook: run the Docker test suite once per push. The suite (image
// build included) is too slow to gate every commit, so it gates pushes
// instead.
// Husky runs the extensionless shell shim `pre-push`, which delegates here.
// To skip it in an emergency: `git push --no-verify`.
import { $ } from 'bun'

const test = await $`bun run test`.nothrow()
if (test.exitCode !== 0) {
  console.error("pre-push: Docker test suite failed. Run 'bun run test' for details.")
  process.exit(1)
}
