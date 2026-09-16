import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { $ } from 'bun'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The unit complement to the Docker suite's end-to-end user-install block:
// the Bootstrap script's shared curl wrapper is the single funnel for every
// vendor-installer fetch, and its retry contract is checkable without a
// boot. The script cannot be sourced (its tail provisions a home
// directory), so the wrapper is lifted out of the script text by name into
// a standalone file that runs it with the bootstrap's own error semantics.
describe('user-install', () => {
  const script = readFileSync(join(import.meta.dir, '..', 'src', 'user-install.sh'), 'utf8')

  // Both lifts anchor on the definition line and the column-0 closing
  // brace, so Prettier wrapping a body into multiple lines stays harmless.
  const liftHelper = (name: string) => script.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0] ?? ''
  const wrapper = liftHelper('_curl')

  // The pure helpers behind the git-signing setup — the identity
  // fallbacks, the allowed_signers principal, the enable predicate —
  // lifted by name the same way, into one file whose trailing "$@" lets
  // the first argument name the function under test.
  const helperNames = ['_identity_name', '_identity_email', '_allowed_signers_principal', '_git_signing_enabled']
  const helpers = helperNames.map(liftHelper).join('\n\n')

  let workDir = ''
  let certPath = ''
  let keyPath = ''
  let wrapperPath = ''
  let helpersPath = ''

  beforeAll(async () => {
    expect(wrapper, '_curl wrapper not found in user-install.sh — renamed?').not.toBe('')
    workDir = mkdtempSync(join(tmpdir(), 'rtx-workspace-user-install-'))

    // The wrapper pins --proto '=https', so the stand-in vendor endpoint
    // must speak real TLS. One throwaway self-signed certificate with a
    // 127.0.0.1 SAN; curl trusts it through a --cacert passed after the
    // URL — the wrapper forwards "$@" verbatim, and curl accepts options
    // after the URL. openssl has no long options.
    certPath = join(workDir, 'cert.pem')
    keyPath = join(workDir, 'key.pem')
    await $`openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1 -keyout ${keyPath} -out ${certPath}`.quiet()

    wrapperPath = join(workDir, 'wrapper.sh')
    writeFileSync(wrapperPath, `set -euo pipefail\n${wrapper}\n_curl "$@"\n`)

    expect(helperNames.map(liftHelper), 'a lifted helper is missing from user-install.sh — renamed?').not.toContain('')
    helpersPath = join(workDir, 'helpers.sh')
    writeFileSync(helpersPath, `set -euo pipefail\n${helpers}\n"$@"\n`)
  }, 30_000)

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  // A stand-in vendor endpoint: loopback HTTPS that answers `failFirst`
  // requests with `status` (forever, when Infinity) and every later one
  // with a trivial installer body. `hits` counts requests so the
  // assertions can see whether a retry happened.
  const vendorEndpoint = (failFirst: number, status: number) => {
    const hits = { count: 0 }
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      tls: { cert: Bun.file(certPath), key: Bun.file(keyPath) },
      fetch: () => {
        hits.count += 1
        if (hits.count <= failFirst) return new Response('service unavailable', { status })
        return new Response('echo installer-ran\n')
      },
    })
    return {
      hits,
      url: `https://127.0.0.1:${server.port}/install`,
      stop: () => server.stop(true),
    }
  }

  const fetchThroughWrapper = async (url: string) => {
    const proc = await $`bash ${wrapperPath} ${url} --cacert ${certPath}`.nothrow().quiet()
    return proc.exitCode
  }

  // A lifted helper run: the helpers file's trailing "$@" dispatches to the
  // function named by the first argument with the rest as its arguments.
  // The printf helpers speak pure stdout (no trailing newline); the
  // predicate speaks exit status.
  const runHelper = async (args: string[]) => {
    const proc = await $`bash ${helpersPath} ${args}`.nothrow().quiet()
    return { exitCode: proc.exitCode, stdout: proc.stdout.toString() }
  }

  describe('curl wrapper', () => {
    test('is the only curl invocation in the Bootstrap script', () => {
      // Command position only — the curl at the start of a line (after
      // indentation) or behind a pipe. \b does not split _curl (the
      // underscore is a word character), and nixpkgs#curl in the profile
      // list is a package name, not an invocation; comments are dropped
      // first. One match means every vendor fetch funnels through the
      // wrapper.
      const curlInvocations = script
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .filter((line) => /^(\s*|\|\s*)curl\b/.test(line))
      expect(curlInvocations).toHaveLength(1)
    })

    test('retries transient errors while permanent ones stay fatal', () => {
      // The invocation only: the wrapper's comment prose may name the
      // very flags the assertions reason about.
      const invocation = wrapper
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n')
      expect(invocation).toContain('--retry')
      expect(invocation).toContain('--retry-connrefused')
      expect(invocation).not.toContain('--retry-all-errors')
    })
  })

  describe('transient vendor errors', () => {
    test('a 503 is retried and the fetch still succeeds', async () => {
      const endpoint = vendorEndpoint(1, 503)
      try {
        const exitCode = await fetchThroughWrapper(endpoint.url)
        expect(endpoint.hits.count).toBe(2) // one 503 absorbed, one success
        expect(exitCode).toBe(0)
      } finally {
        endpoint.stop()
      }
    }, 30_000)

    test('a permanent 404 fails on the first attempt', async () => {
      const endpoint = vendorEndpoint(Number.POSITIVE_INFINITY, 404)
      try {
        const exitCode = await fetchThroughWrapper(endpoint.url)
        expect(endpoint.hits.count).toBe(1) // 404 is permanent: no retries
        expect(exitCode).toBe(22) // curl --fail's HTTP-error exit
      } finally {
        endpoint.stop()
      }
    })
  })

  // A GitHub profile may expose no public name or email; gh's `// empty`
  // jq collapses those to no output, and these helpers substitute what
  // always exists: the login for the name, the ID-based noreply address
  // for the email — the address commit verification can always map back
  // to the account (see ADR 0009).
  describe('identity fallbacks', () => {
    test('user.name keeps the profile name and falls back to the login', async () => {
      expect((await runHelper(['_identity_name', 'Jane Doe', 'jane'])).stdout).toBe('Jane Doe')
      expect((await runHelper(['_identity_name', '', 'jane'])).stdout).toBe('jane')
    })

    test('user.email keeps the public email and falls back to the noreply address', async () => {
      expect((await runHelper(['_identity_email', 'jane@example.com', '4242', 'jane'])).stdout).toBe('jane@example.com')
      expect((await runHelper(['_identity_email', '', '4242', 'jane'])).stdout).toBe(
        '4242+jane@users.noreply.github.com',
      )
    })
  })

  describe('git signing helpers', () => {
    test('the allowed_signers principal is the committer email, or the wildcard', async () => {
      expect((await runHelper(['_allowed_signers_principal', 'jane@example.com'])).stdout).toBe('jane@example.com')
      expect((await runHelper(['_allowed_signers_principal', ''])).stdout).toBe('*')
    })

    test('signing is on with a token unless the opt-out is exactly 1', async () => {
      expect((await runHelper(['_git_signing_enabled', 'gh_token_value', ''])).exitCode).toBe(0)
      expect((await runHelper(['_git_signing_enabled', 'gh_token_value', '0'])).exitCode).toBe(0)
      expect((await runHelper(['_git_signing_enabled', 'gh_token_value', 'yes'])).exitCode).toBe(0)
      expect((await runHelper(['_git_signing_enabled', 'gh_token_value', '1'])).exitCode).toBe(1)
    })

    test('without a token nothing enables signing', async () => {
      expect((await runHelper(['_git_signing_enabled', '', ''])).exitCode).toBe(1)
      expect((await runHelper(['_git_signing_enabled', '', '1'])).exitCode).toBe(1)
    })
  })
})
