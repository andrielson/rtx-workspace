import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { $ } from 'bun'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The Env loader is pure wiring — exports and the PATH hooks, no install
// steps — so, unlike the Bootstrap script, it can be sourced directly in a
// sandbox home to pin what it puts on every shell surface. The variables it
// exports are git's runtime environment: the profile's man directory for
// bare man/apropos and the editor git's EDITOR chain falls back to. Each
// run is a fresh bash with the sandbox home and this runner's own
// RTX_ENV_LOADED/EDITOR/MANPATH stripped, so nothing can short-circuit or
// pollute the sourcing.
describe('Env loader', () => {
  const loaderPath = join(import.meta.dir, '..', 'src', '01-home-bash-env.sh')

  let home = ''

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'rtx-workspace-env-loader-'))
  })

  afterAll(() => {
    if (home) rmSync(home, { recursive: true, force: true })
  })

  // Sources the loader in a fresh bash under the sandbox home and prints
  // the variable the argument names. The unset runs inside the child: Bun
  // Shell merges the runner's own environment over whatever .env() gets —
  // this suite's runner can genuinely carry RTX_ENV_LOADED — so only a
  // child-side unset guarantees the loader cannot mistake this shell for
  // an already-loaded one, and that an exported value is traceable to the
  // loader alone (or to the User environment file a test wrote).
  const printAfterSource = async (variable: string) => {
    const proc = await $`bash -c 'unset RTX_ENV_LOADED EDITOR MANPATH && source ${loaderPath} && printenv ${variable}'`
      .env({ ...process.env, HOME: home })
      .nothrow()
      .quiet()
    return { exitCode: proc.exitCode, stdout: proc.stdout.toString().trim() }
  }

  // The profile's man directory, with manpath(5)'s trailing empty
  // component: a trailing colon splices man-db's default search path in
  // behind it, so the nix man-db still finds the system Nix profile's own
  // pages after the user profile's.
  test('exports the profile man directory as MANPATH', async () => {
    expect((await printAfterSource('MANPATH')).stdout).toBe(`${home}/.nix-profile/share/man:`)
  })

  test('exports nano as EDITOR', async () => {
    expect((await printAfterSource('EDITOR')).stdout).toBe('nano')
  })

  // The User environment file is sourced after the exports, so a value the
  // Environment mirror projected from the container environment — the
  // deployment's own choice — wins over both defaults.
  test('a User environment file value overrides both defaults', async () => {
    writeFileSync(join(home, '.bash_env'), 'export EDITOR=deploy-editor\nexport MANPATH=/deploy/man\n')
    expect((await printAfterSource('EDITOR')).stdout).toBe('deploy-editor')
    expect((await printAfterSource('MANPATH')).stdout).toBe('/deploy/man')
  })
})
