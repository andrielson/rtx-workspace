// Post-checkout hook: keep node_modules fresh across branch switches.
// Git calls it as `post-checkout <previous-head> <new-head> <flag>`, where
// <flag> is 1 for branch checkouts and 0 for file checkouts.
import { $ } from 'bun'

const [previousHead = '', newHead = '', branchFlag = ''] = process.argv.slice(2)

// File checkouts (e.g. `git checkout <commit> -- <path>`) never change the
// dependency set.
if (branchFlag !== '1') {
  process.exit(0)
}

// On a fresh clone or `git worktree add` the previous head is all zeros:
// install unconditionally. Otherwise install only when the checkout changed
// the dependency manifest.
if (!/^0+$/.test(previousHead)) {
  const changed = await $`git diff --name-only ${previousHead} ${newHead} -- bun.lock package.json`
    .quiet()
    .nothrow()
    .text()
  if (changed.trim().length === 0) {
    process.exit(0)
  }
}

const install = await $`bun install`.nothrow()
process.exit(install.exitCode)
