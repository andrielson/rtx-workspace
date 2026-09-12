import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { $ } from 'bun'

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every docker compose invocation in this suite goes through this prefix:
// the Tests compose file plus the shared project name. Bun Shell expands an
// interpolated array into separate arguments.
const compose = ['docker', 'compose', '--file', 'tests/docker-compose.yml', '--project-name', 'rtx-workspace-tests']
// The Tests compose file lives under tests/, so compose would look for its
// interpolation .env there — inject the socket's real GID through the
// process env instead (it wins over any .env file).
const env = {
  ...process.env,
  DOCKER_GID: String(statSync('/var/run/docker.sock').gid),
}

// bun:test kills hooks after 5s by default; the --pull build fetches base
// images over the network and can take far longer, so every hook carries an
// explicit timeout.
beforeAll(async () => {
  // Defensive teardown first: the afterAll guarantee does not cover SIGKILL.
  await $`${compose} down --volumes --remove-orphans`.env(env).nothrow().quiet()
  // Not quiet: build progress echoes live, and a failure throws ShellError
  // with stderr attached.
  await $`${compose} build --pull`.env(env)
}, 1_900_000)

afterAll(async () => {
  await $`${compose} down --volumes --remove-orphans`.env(env).nothrow().quiet()
}, 120_000)

// The Dockerfile block verifies the Image contract: what the image alone
// delivers before the Bootstrap script ever runs — Nix itself, the slim
// runtime baseline, and none of the formerly baked toolchains. A one-off
// container of the workspace service stands in for a booted workspace — its
// entrypoint is replaced with `sleep infinity` so the first-boot install
// never happens, and --no-deps keeps nginx (a dependency only that install
// needs) out of it.
describe('Dockerfile', () => {
  // compose exec resolves one-off `run` containers too (preferring a regular
  // `up` container when one exists); the only workspace container this
  // project ever runs is the one-off below.
  const container = 'workspace-test-dockerfile'
  // The image tag declared by the Base compose.
  const image = 'rtx-workspace:latest'

  // Commands default to the ubuntu user: it is the real consumer of
  // everything under /nix/ubuntu, so a mis-owned file fails here as it
  // would in production.
  const execInWorkspace = async (script: string, options: { asRoot: boolean } = { asRoot: false }) =>
    $`${compose} exec --user ${options.asRoot ? 'root' : 'ubuntu'} workspace bash -c ${script}`
      .env(env)
      .text()
      .then((stdout) => stdout.trim())

  beforeAll(async () => {
    // Defensive teardown first: the afterAll guarantee does not cover SIGKILL.
    await $`docker rm --force --volumes ${container}`.nothrow().quiet()
    await $`${compose} run --detach --name ${container} --no-deps --entrypoint sleep workspace infinity`.env(env)
  }, 300_000)

  afterAll(async () => {
    await $`docker rm --force --volumes ${container}`.nothrow().quiet()
  }, 120_000)

  describe('nix', () => {
    test('runs through the image ENV PATH hook via bare docker exec', async () => {
      // No shell, no --user: the plainest exec surface, resolved purely by
      // the image ENV (PATH hook #1 of 3).
      const version = await $`docker exec ${container} nix --version`.text()
      expect(version.trim()).toMatch(/^nix \(Nix\) 2\.\d+(\.\d+)?$/)
    })

    test('resolves for the ubuntu user through compose exec', async () => {
      expect(await execInWorkspace('nix --version')).toMatch(/^nix \(Nix\) 2\.\d+(\.\d+)?$/)
    })

    test('nix.conf enables flakes and disables the sandbox', async () => {
      const conf = await execInWorkspace('cat ~/.config/nix/nix.conf')
      expect(conf.split('\n').map((line) => line.trim())).toContain('experimental-features = nix-command flakes')
      expect(conf.split('\n').map((line) => line.trim())).toContain('sandbox = false')
    })

    test('~/.nix-profile exists and points into the store', async () => {
      // readlink has no long options; -f resolves the whole chain.
      expect(await execInWorkspace('readlink -f ~/.nix-profile')).toMatch(/^\/nix\/store\//)
    })
  })

  describe('retired toolchains and managers', () => {
    // command -v returns non-zero when the command is absent, which would
    // throw inside execInWorkspace; `|| true` keeps the empty string as the
    // assertion input.
    test.each([
      'rustup',
      'rustc',
      'cargo',
      'go',
      'bun',
      'bunx',
      'docker',
      'shellcheck',
      'shfmt',
      'brew',
      'nvm',
      'sdk',
      'sudo',
    ])('%s does not resolve', async (command) => {
      expect(await execInWorkspace(`command -v ${command} || true`)).toBe('')
    })

    // test's file predicates are single characters; no long forms exist.
    test('the sudoers drop-in is gone', async () => {
      await execInWorkspace('test ! -e /etc/sudoers.d/ubuntu')
    })
  })

  describe('environment', () => {
    test('PATH leads with the Nix profile directories', async () => {
      const path = (await execInWorkspace('printenv PATH')).split(':')
      expect(path.slice(0, 3)).toEqual([
        '/nix/ubuntu/.nix-profile/bin',
        '/nix/ubuntu/.cargo/bin',
        '/nix/ubuntu/.local/bin',
      ])
    })

    // The UV_* defaults stay baked: uv installs through its official
    // installer outside the read-only store, so the image carries its knobs.
    test.each([
      ['UV_COMPILE_BYTECODE', '1'],
      ['UV_MALWARE_CHECK', '1'],
      ['UV_MANAGED_PYTHON', '1'],
      ['UV_PREVIEW_FEATURES', 'python-install-default'],
      ['UV_PYTHON', '3.14'],
      ['UV_TORCH_BACKEND', 'cpu'],
    ])('%s keeps its default', async (name, expected) => {
      expect(await execInWorkspace(`printenv ${name}`)).toBe(expected)
    })
  })

  describe('PATH hooks', () => {
    test.each(['/etc/profile.d/01-home-bash-env.sh', '/etc/profile.d/02-home-nix-profile.sh'])(
      '%s is executable',
      async (path) => {
        await execInWorkspace(`test -x ${path}`)
      },
    )

    test('the bashrc export sits above the interactive guard', async () => {
      // sshd-spawned non-interactive shells (`ssh host <cmd>`) source
      // ~/.bashrc but stop at Debian's interactive guard — the hook only
      // works above it.
      const bashrc = await execInWorkspace('cat ~/.bashrc')
      const hook = bashrc.indexOf('.nix-profile/bin')
      const guard = bashrc.indexOf('case $- in')
      expect(hook).toBeGreaterThanOrEqual(0)
      expect(guard).toBeGreaterThan(hook)
    })
  })

  describe('files and permissions', () => {
    test.each(['/usr/local/bin/docker-entrypoint', '/etc/sshd/sshd_config_ubuntu'])('%s exists', async (path) => {
      await execInWorkspace(`test -e ${path}`)
    })

    test('/run/sshd is a directory', async () => {
      await execInWorkspace('test -d /run/sshd')
    })

    test("/nix/ubuntu is ubuntu's home and is owned by ubuntu", async () => {
      expect((await execInWorkspace('getent passwd ubuntu')).split(':')[5]).toBe('/nix/ubuntu')
      expect(await execInWorkspace('stat --format=%U:%G /nix/ubuntu')).toBe('ubuntu:ubuntu')
    })

    // find's predicates are single characters; no long forms exist.
    // Symbolic links are excluded: Linux gives every symlink mode 0777 and
    // never consults those bits, so they carry no writable-file risk.
    test('nothing under /nix/ubuntu is group- or other-writable', async () => {
      expect(await execInWorkspace('find /nix/ubuntu ! -type l -perm /go+w -print -quit')).toBe('')
    })
  })

  describe('privileges', () => {
    test("ubuntu's password is locked", async () => {
      const status = await execInWorkspace('passwd --status ubuntu', {
        asRoot: true,
      })
      expect(status.split(/\s+/)[1]).toBe('L')
    })

    test('gosu reports its version', async () => {
      expect(await execInWorkspace('gosu --version', { asRoot: true })).toMatch(/^\d+\.\d+/)
    })

    test('gosu runs a command as ubuntu', async () => {
      expect(await execInWorkspace('gosu ubuntu id --user --name', { asRoot: true })).toBe('ubuntu')
    })
  })

  describe('image config', () => {
    const inspectConfig = async (configPath: string) => {
      const template = `{{json .Config.${configPath}}}`
      return JSON.parse(await $`docker inspect --format ${template} ${image}`.text())
    }

    test('ENTRYPOINT is the workspace entrypoint', async () => {
      expect(await inspectConfig('Entrypoint')).toEqual(['docker-entrypoint'])
    })

    test('CMD runs the ubuntu sshd', async () => {
      expect(await inspectConfig('Cmd')).toEqual(['/usr/sbin/sshd', '-D', '-e', '-f', '/etc/sshd/sshd_config_ubuntu'])
    })

    test('declares /nix as a volume', async () => {
      expect(await inspectConfig('Volumes')).toEqual({ '/nix': {} })
    })

    test('the ENV declares the Nix PATH hook', async () => {
      const envPairs = (await inspectConfig('Env')) as string[]
      const pathPair = envPairs.find((pair) => pair.startsWith('PATH='))
      expect(pathPair).toStartWith('PATH=/nix/ubuntu/.nix-profile/bin:/nix/ubuntu/.cargo/bin:/nix/ubuntu/.local/bin')
    })
  })

  // Binary names differ from their apt packages: openssh-server is sshd.
  // ca-certificates, libatomic1 and systemd-standalone-sysusers ship no
  // everyday binary (systemd-sysusers is an admin tool, deliberately not
  // asserted on PATH); presence goes through dpkg.
  describe('system packages', () => {
    test.each(['sshd', 'curl', 'xz'])('%s is on PATH', async (command) => {
      await execInWorkspace(`command -v ${command}`)
    })

    test.each(['ca-certificates', 'libatomic1', 'systemd-standalone-sysusers'])(
      'package %s is installed',
      async (pkg) => {
        // dpkg-query exits non-zero (and throws here) when the package is
        // absent, so resolving at all is the check; the arch qualifier
        // (:amd64/:arm64) rides along in the package column.
        expect(await execInWorkspace(`dpkg-query --show ${pkg}`)).toMatch(new RegExp(`^${pkg}(:\\S+)?\\s`))
      },
    )
  })
})

// The user-install block verifies the first-boot flow end to end: the real
// entrypoint fetches the Bootstrap script from the Web root and provisions
// the fresh /nix volume. `up --wait` gates on the workspace's sshd
// healthcheck — healthy by construction only once provisioning has finished,
// since sshd is the entrypoint's exec'd command — so the stack reaching a
// healthy state is itself the no-manual-steps acceptance check.
describe('user-install', () => {
  // The Tests stack's container_name for the workspace service.
  const container = 'workspace-test'

  // The plainest surface: docker exec with no --user, resolved purely by the
  // image ENV (PATH hook #1 of 3). The bash -c wrapper only merges stderr
  // for tools that print their version there (kotlin, scala); bash has no
  // long-form options for -c, and the wrapper sources no init files, so
  // PATH resolution is identical to a bare exec.
  const execBare = async (script: string) =>
    $`docker exec ${container} bash -c ${script}`.text().then((stdout) => stdout.trim())

  // The interactive surface: as ubuntu (HOME=/nix/ubuntu from passwd),
  // bash -ic sources ~/.bashrc through its interactive region — where the
  // bootstrap's fnm eval lives (bash has no long form for -i either). Root
  // execs would get HOME=/root and miss the home wiring entirely (an admin
  // escape hatch, not a surface). The job-control noise bash prints without
  // a tty goes to stderr.
  const execInteractive = async (script: string) =>
    $`docker exec --user ubuntu ${container} bash -ic ${script}`.text().then((stdout) => stdout.trim())

  // The SSH-surface harness. A throwaway keypair is generated on the test
  // host; its public half rides the existing SSH_AUTHORIZED_KEY env var —
  // the Tests stack declares it under `environment`, so compose interpolates
  // it from this process — and the Bootstrap script's setup_ssh wires it
  // into authorized_keys on first boot. The Tests stack publishes sshd on a
  // random port on every interface, resolved below through `compose port`.
  // Both are throwaway: the key directory goes in afterAll, the port dies
  // with the container in the global teardown's down.
  let keyDir = ''
  let keyPath = ''
  let sshPort = ''
  // The env every `up` against this stack must carry: a later `up` without
  // the key would look like config drift and recreate the container. Typed
  // wider than env's inferred literal so the key can join it.
  let stackEnv: Record<string, string | undefined> = env

  // Where the published SSH port is reached from. A plain host uses its
  // own loopback; a runner inside a container (marked by /.dockerenv)
  // cannot reach the host's loopback, only the host itself through the
  // default route's gateway — the one host address a container can use to
  // reach a published port.
  const defaultGateway = () => {
    const routes = readFileSync('/proc/net/route', 'utf8')
    for (const line of routes.split('\n').slice(1)) {
      const [, destination, gateway] = line.trim().split(/\s+/)
      if (destination === '00000000' && gateway) {
        // /proc/net/route stores the gateway little-endian.
        const bytes = gateway.match(/../g) ?? []
        if (bytes.length === 4) {
          const [b0 = '', b1 = '', b2 = '', b3 = ''] = bytes
          return [b3, b2, b1, b0].map((byte) => Number.parseInt(byte, 16)).join('.')
        }
      }
    }
    throw new Error('no default route in /proc/net/route')
  }
  const sshHost = existsSync('/.dockerenv') ? defaultGateway() : '127.0.0.1'

  // Real-SSH helpers for the PATH-hook surfaces below. ssh has no long
  // options: -i names the identity, -p the port. BatchMode never prompts,
  // IdentitiesOnly ignores any agent, accept-new pins the container's host
  // key inside the throwaway key directory (not the host's known_hosts), and
  // LogLevel silences the added-host banner. Bun Shell expands an
  // interpolated array into separate arguments.
  const sshOptions = () => [
    '-i',
    keyPath,
    '-p',
    sshPort,
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `UserKnownHostsFile=${join(keyDir, 'known_hosts')}`,
    '-o',
    'LogLevel=ERROR',
    '-o',
    'ConnectTimeout=15',
  ]

  // The login-shell surface: no remote command, so sshd execs ubuntu's shell
  // as `-bash` and it reads the script from stdin.
  const sshLogin = async (script: string) =>
    $`echo ${script} | ssh ${sshOptions()} ubuntu@${sshHost}`.text().then((stdout) => stdout.trim())

  // The non-interactive surface: `ssh host <cmd>`.
  const sshCommand = async (script: string) =>
    $`ssh ${sshOptions()} ubuntu@${sshHost} ${script}`.text().then((stdout) => stdout.trim())

  beforeAll(async () => {
    keyDir = mkdtempSync(join(tmpdir(), 'rtx-workspace-tests-ssh-'))
    keyPath = join(keyDir, 'id_ed25519')
    // ssh-keygen has no long options; -q quiets the banner, -t names the
    // type, -N takes the (empty) passphrase, -C the comment, -f the file.
    await $`ssh-keygen -q -t ed25519 -N '' -C rtx-workspace-tests -f ${keyPath}`.quiet()
    stackEnv = { ...env, SSH_AUTHORIZED_KEY: readFileSync(`${keyPath}.pub`, 'utf8').trim() }

    // The full stack, nginx included — the entrypoint fetches the Bootstrap
    // script from it before provisioning can start. The effective ceiling
    // is the healthcheck budget (start_period 60s + 110 retries × 10s ≈
    // 19 min, many times the ~2 min measured first boot): a slow-network
    // boot surfaces as compose's own "unhealthy" failure, and
    // --wait-timeout is only a backstop beyond it.
    await $`${compose} up --detach --wait --wait-timeout 1500`.env(stackEnv)

    // The Tests stack publishes sshd on a random port on every interface (a
    // loopback-bound port would be unreachable from a workspace — ADR 0005);
    // `compose port` names it as `<address>:<port>`. stackEnv keeps every
    // command against this stack interpolating from the same environment.
    const published = (await $`${compose} port workspace 22`.env(stackEnv).text()).trim()
    expect(published).toMatch(/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/)
    sshPort = published.split(':')[1] ?? ''
  }, 1_800_000)

  // The throwaway keypair leaves no residue; the published port goes with
  // the container in the global teardown's down.
  afterAll(() => {
    if (keyDir) rmSync(keyDir, { recursive: true, force: true })
  })

  describe('default profile', () => {
    // One row per default-profile tool, run on the bare-exec surface. The
    // expected shapes stay loose: versions float with nixpkgs-unstable by
    // design (ADR 0003). quarkus and shfmt print a bare semver; the yq row
    // asserts the Go implementation (the nixpkgs yq-go rename gotcha); the
    // compose row pins the CLI plugin nixpkgs' docker-client bundles
    // (composeSupport) — the workspace speaks `docker compose` out of the
    // box, not just the bare CLI.
    test.each([
      ['java --version', /GraalVM CE/],
      ['gradle --version', /Gradle \d+\.\d+/],
      ['kotlin -version 2>&1', /Kotlin version \d+\.\d+/],
      ['mvn --version', /Apache Maven \d+\.\d+/],
      ['quarkus --version', /^\d+\.\d+\.\d+$/],
      ['scala -version 2>&1', /Scala code runner version:? \d+\.\d+/],
      ['rustc --version', /^rustc \d+\.\d+/],
      ['cargo --version', /^cargo \d+/],
      ['go version', /^go version go\d+\.\d+/],
      ['php --version', /^PHP \d+\.\d+/],
      ['composer --version', /^Composer version \d+\.\d+/],
      ['bun --version', /^\d+\.\d+/],
      ['gh --version', /^gh version \d+/],
      ['git --version', /^git version \d+\.\d+/],
      ['yq --version', /mikefarah/],
      ['shellcheck --version', /version: \d+\.\d+/],
      ['shfmt --version', /^\d+\.\d+\.\d+$/],
      ['docker --version', /^Docker version \d+/],
      ['docker compose version', /Docker Compose version v?\d+\.\d+/],
      ['fnm --version', /^fnm \d+/],
      ['ffmpeg -version', /^ffmpeg version \d+/],
      ['rg --version', /^ripgrep \d+/],
      ['rsync --version', /^rsync\s+version \d+/],
      ['tmux -V', /^tmux \d+/],
      ['jq --version', /^jq-\d+\.\d+/],
    ])(
      '%s runs',
      async (command, expected) => {
        expect(await execBare(command)).toMatch(expected)
      },
      60_000,
    )
  })

  describe('carve-outs', () => {
    // Outside the read-only store, on ~/.local/bin (PATH hook #1 covers
    // it): uv by its official installer, the agent CLIs by their vendor
    // scripts (they rewrite their own binary).
    test.each([
      ['uv --version', /^uv \d+/],
      ['claude --version', /Claude Code/],
      ['opencode --version', /^\d+\.\d+\.\d+$/],
    ])(
      '%s runs outside the store',
      async (command, expected) => {
        expect(await execBare(command)).toMatch(expected)
      },
      120_000,
    )

    test("node resolves in an interactive shell with fnm's LTS default", async () => {
      expect(await execInteractive('node --version')).toMatch(/^v\d+\.\d+\.\d+/)
    }, 120_000)

    test('fnm, node, profile tools and the carve-outs coexist in one shell', async () => {
      // command -v exits non-zero when any named command is missing, so
      // resolving all six at once is the check — one shell carrying the
      // Nix profile, fnm's Node, and the store-outside carve-outs.
      expect((await execInteractive('command -v node java fnm uv claude opencode')).split('\n')).toHaveLength(6)
    }, 120_000)

    test('node stays interactive-only, as nvm was', async () => {
      expect(await execBare('command -v node || true')).toBe('')
    }, 60_000)
  })

  describe('retired managers', () => {
    test.each(['.nvm', '.sdkman', '.linuxbrew', 'linuxbrew'])(
      '%s left no remnants in the home directory',
      async (entry) => {
        await $`docker exec --user ubuntu ${container} test ! -e /nix/ubuntu/${entry}`
      },
      60_000,
    )

    test('brew, nvm and sdk do not resolve', async () => {
      expect(await execBare('command -v brew nvm sdk || true')).toBe('')
    }, 60_000)
  })

  // The remaining two PATH-hook surfaces, end to end through the real
  // sshd. sshd builds every session's environment from scratch (UsePAM no:
  // PATH comes from a compiled-in default, not the container env), so the
  // image ENV hook reaches neither surface — only the shell-init hooks
  // below can put the default profile on PATH.
  describe('SSH surfaces', () => {
    // A login shell runs /etc/profile, which resets PATH; the
    // /etc/profile.d hooks are what restore the profile (PATH hook #2 of 3).
    test('a login shell resolves and runs default-profile tools', async () => {
      expect(await sshLogin('command -v rg')).toBe('/nix/ubuntu/.nix-profile/bin/rg')
      expect(await sshLogin('rg --version')).toMatch(/^ripgrep \d+/)
    }, 60_000)

    // A bare `ssh host <cmd>` is a non-login bash that reaches only the
    // head of ~/.bashrc, above Debian's interactive guard (PATH hook #3 of
    // 3).
    test('a bare ssh command resolves and runs them too', async () => {
      expect(await sshCommand('command -v jq')).toBe('/nix/ubuntu/.nix-profile/bin/jq')
      expect(await sshCommand('jq --version')).toMatch(/^jq-\d+/)
    }, 60_000)

    // The socket-group regression: compose's group_add grants the docker
    // socket's GID only to the container's process tree, but sshd rebuilds
    // each session's groups from /etc/group — the entrypoint must
    // materialize the group and ubuntu's membership there, or every docker
    // call from an SSH shell dies on EACCES at the socket.
    test('a login shell carries the docker socket group', async () => {
      expect((await sshLogin('id --groups')).split(/\s+/)).toContain(env.DOCKER_GID)
    }, 60_000)
  })

  // The Bootstrap script's distinctive first log line (install_nix_profile
  // in user-install.sh) — its absence proves a boot skipped provisioning.
  const bootstrapMarker = 'Installing the default Nix profile'

  describe('second boot', () => {
    test('a restart skips provisioning and comes back with tools intact', async () => {
      // The entrypoint's already-bootstrapped detection (opencode on PATH)
      // must skip the Bootstrap script when the volume already carries it.
      // A restart re-runs the entrypoint — the second boot — without
      // touching the container (the recreate-with-kept-volume cycle is the
      // recreate block below).
      const since = new Date().toISOString()
      await $`${compose} restart workspace`.env(env).quiet()
      // up --wait re-gates on the sshd healthcheck: the restarted
      // workspace must come back healthy. stackEnv (not env) keeps the
      // interpolated SSH_AUTHORIZED_KEY identical to the create-time
      // config, so this up never sees drift and recreates the container.
      await $`${compose} up --detach --wait --wait-timeout 600`.env(stackEnv)

      // The bootstrap's marker line must not appear again…
      const logs = await $`docker logs --since ${since} ${container}`.text()
      expect(logs).not.toContain(bootstrapMarker)
      // …and the provisioned tools must survive the restart.
      expect(await execBare('java --version')).toMatch(/GraalVM CE/)
    }, 300_000)
  })

  // The /nix volume's persistence promise: tear the stack down keeping
  // volumes, bring it back — the fresh container must boot straight to sshd
  // with every provisioned tool intact and the Bootstrap script never
  // re-running. The spike measured a ~6 s recreate boot; no timing is
  // asserted here, the absent marker line is the evidence.
  describe('recreate', () => {
    test('down keeping volumes, then up, boots provisioned without re-bootstrapping', async () => {
      // No --volumes: the named nix volume is exactly what must survive
      // the recreate.
      await $`${compose} down --remove-orphans`.env(stackEnv).quiet()
      // up --wait re-gates on the sshd healthcheck: the recreated
      // workspace must come back healthy (a bare volume would have to
      // re-provision first, which the log check below forbids).
      await $`${compose} up --detach --wait --wait-timeout 600`.env(stackEnv)

      // The new container's logs cover its whole life, so no --since: the
      // bootstrap's marker line must be absent…
      const logs = await $`docker logs ${container}`.text()
      expect(logs).not.toContain(bootstrapMarker)

      // …every default-profile tool and carve-out still resolves, one
      // command per name (node stays interactive-only, as ever)…
      const tools =
        'java gradle kotlin mvn quarkus scala rustup cargo go php composer bun gh git yq shellcheck shfmt docker fnm ffmpeg rg rsync tmux jq uv claude opencode'.split(
          ' ',
        )
      const paths = (await execBare(`command -v ${tools.join(' ')}`)).split('\n')
      expect(paths).toHaveLength(tools.length)
      // …each from the kept volume — the profile bin or ~/.local/bin,
      // never the apt baseline…
      for (const path of paths) {
        expect(path).toMatch(/^\/nix\/ubuntu\/\.(nix-profile|cargo|local)\/bin\//)
      }
      // …and a representative tool runs.
      expect(await execBare('java --version')).toMatch(/GraalVM CE/)
    }, 300_000)
  })
})
