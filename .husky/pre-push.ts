// Pre-push hook: run the Dockerfile test block (Image contract) once per
// push. The full suite is too slow to gate every commit, and its
// user-install half depends on real vendor endpoints — intermittent
// network failures made a full-suite push gate unreliable.
// Husky runs the extensionless shell shim `pre-push`, which delegates here.
// To skip it in an emergency: `git push --no-verify`.
import { $ } from 'bun'

// A plain string would interpolate as a single escaped argument; an array
// expands to one argument per element in Bun Shell.
const testCommand = ['bun', 'test', '--only-failures', '--test-name-pattern', 'Dockerfile']

const test = await $`${testCommand}`.nothrow()
if (test.exitCode !== 0) {
  console.error(`pre-push: Docker test suite failed. Run '${testCommand.join(' ')}' for details.`)
  process.exit(1)
}
