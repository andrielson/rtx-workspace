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

  // Anchored on the definition line and the column-0 closing brace, so
  // Prettier wrapping the body into multiple lines stays harmless.
  const wrapperMatch = script.match(/^_curl\(\) \{[\s\S]*?^\}/m)
  const wrapper = wrapperMatch?.[0] ?? ''

  let workDir = ''
  let certPath = ''
  let keyPath = ''
  let wrapperPath = ''

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
})
