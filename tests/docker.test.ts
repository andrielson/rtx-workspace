import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { $ } from "bun";

const project = "rtx-workspace-tests";
const file = "tests/docker-compose.yml";
// The Tests compose file lives under tests/, so compose would look for its
// interpolation .env there — inject the socket's real GID through the
// process env instead (it wins over any .env file).
const env = {
  ...process.env,
  DOCKER_GID: String(statSync("/var/run/docker.sock").gid),
};

// bun:test kills hooks after 5s by default; the --pull build fetches base
// images over the network and can take far longer, so every hook carries an
// explicit timeout.
beforeAll(async () => {
  // Defensive teardown first: the afterAll guarantee does not cover SIGKILL.
  await $`docker compose --file ${file} --project-name ${project} down --volumes --remove-orphans`
    .env(env)
    .nothrow()
    .quiet();
  // Not quiet: build progress echoes live, and a failure throws ShellError
  // with stderr attached.
  await $`docker compose --file ${file} --project-name ${project} build --pull`.env(
    env,
  );
}, 1_900_000);

afterAll(async () => {
  await $`docker compose --file ${file} --project-name ${project} down --volumes --remove-orphans`
    .env(env)
    .nothrow()
    .quiet();
}, 120_000);

test("2 + 2", () => {
  expect(2 + 2).toBe(4);
});

// The Dockerfile block verifies the Image contract: what the image alone
// delivers before the Bootstrap script ever runs. A one-off container of the
// workspace service stands in for a booted workspace — its entrypoint is
// replaced with `sleep infinity` so the first-boot install never happens,
// and --no-deps keeps nginx (a dependency only that install needs) out of it.
describe("Dockerfile", () => {
  // compose exec resolves one-off `run` containers too (preferring a regular
  // `up` container when one exists); the only workspace container this
  // project ever runs is the one-off below.
  const container = "workspace-test-dockerfile";
  // The image tag declared by the Base compose.
  const image = "rtx-workspace:latest";

  // Commands default to the ubuntu user: it is the real consumer of
  // everything under /home/ubuntu, so a mis-owned file fails here as it
  // would in production.
  const execInWorkspace = async (
    script: string,
    options: { asRoot: boolean } = { asRoot: false },
  ) =>
    $`docker compose --file ${file} --project-name ${project} exec --user ${options.asRoot ? "root" : "ubuntu"} workspace bash -c ${script}`
      .env(env)
      .text()
      .then((stdout) => stdout.trim());

  beforeAll(async () => {
    // Defensive teardown first: the afterAll guarantee does not cover SIGKILL.
    await $`docker rm --force --volumes ${container}`.nothrow().quiet();
    await $`docker compose --file ${file} --project-name ${project} run --detach --name ${container} --no-deps --entrypoint sleep workspace infinity`.env(
      env,
    );
  }, 300_000);

  afterAll(async () => {
    await $`docker rm --force --volumes ${container}`.nothrow().quiet();
  }, 120_000);

  describe("copied tools", () => {
    test("go runs from the copied tree", async () => {
      expect(await execInWorkspace("go version")).toMatch(/go1\.\d+(\.\d+)?/);
      expect(await execInWorkspace("go env GOROOT")).toBe(
        "/home/ubuntu/.local/go",
      );
    });

    test("rustup resolves the stable default toolchain", async () => {
      expect(await execInWorkspace("rustup show active-toolchain")).toMatch(
        /^stable-\S+ \(default\)$/,
      );
    });

    test("cargo runs", async () => {
      expect(await execInWorkspace("cargo --version")).toMatch(
        /cargo \d+\.\d+\.\d+/,
      );
    });

    test("rustc runs", async () => {
      expect(await execInWorkspace("rustc --version")).toMatch(
        /rustc \d+\.\d+\.\d+/,
      );
    });

    test("bun runs", async () => {
      expect(await execInWorkspace("bun --version")).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("bunx runs", async () => {
      expect(await execInWorkspace("bunx --version")).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
    });

    test("docker CLI runs", async () => {
      expect(await execInWorkspace("docker --version")).toMatch(
        /Docker version \d+\.\d+\.\d+/,
      );
    });

    test("docker compose plugin is discovered", async () => {
      expect(await execInWorkspace("docker compose version")).toMatch(
        /Docker Compose version v\d+/,
      );
    });

    test("gosu reports its version", async () => {
      expect(await execInWorkspace("gosu --version", { asRoot: true })).toMatch(
        /^\d+\.\d+/,
      );
    });

    test("gosu runs a command as ubuntu", async () => {
      expect(
        await execInWorkspace("gosu ubuntu id --user --name", { asRoot: true }),
      ).toBe("ubuntu");
    });
  });

  describe("environment", () => {
    test("PATH leads with the copied tool directories", async () => {
      const path = (await execInWorkspace("printenv PATH")).split(":");
      expect(path.slice(0, 4)).toEqual([
        "/home/ubuntu/.local/bin",
        "/home/ubuntu/.local/bun/bin",
        "/home/ubuntu/.local/cargo/bin",
        "/home/ubuntu/.local/go/bin",
      ]);
    });

    test.each([
      ["BUN_INSTALL", "/home/ubuntu/.local/bun"],
      ["CARGO_HOME", "/home/ubuntu/.local/cargo"],
      ["GOBIN", "/home/ubuntu/.local/go/bin"],
      ["NVM_DIR", "/home/ubuntu/.nvm"],
      ["RUSTUP_HOME", "/home/ubuntu/.local/rustup"],
      ["SDKMAN_DIR", "/home/ubuntu/.sdkman"],
    ])("%s points at the copied location", async (name, expected) => {
      expect(await execInWorkspace(`printenv ${name}`)).toBe(expected);
    });
  });

  describe("copied files and permissions", () => {
    // test's file predicates are single characters; no long forms exist.
    test.each([
      "/usr/local/bin/docker-entrypoint",
      "/etc/profile.d/01-home-bash-env.sh",
    ])("%s is executable", async (path) => {
      await execInWorkspace(`test -x ${path}`);
    });

    test.each([
      "/etc/sshd/sshd_config_ubuntu",
      "/home/ubuntu/.local/share/bash-completion/completions/bun.completion.bash",
    ])("%s exists", async (path) => {
      await execInWorkspace(`test -f ${path}`);
    });

    test.each(["/run/sshd", "/home/ubuntu/.docker/cli-plugins"])(
      "%s is a directory",
      async (path) => {
        await execInWorkspace(`test -d ${path}`);
      },
    );

    test("the sudoers drop-in is root-owned mode 0440", async () => {
      expect(
        await execInWorkspace("stat --format=%a /etc/sudoers.d/ubuntu"),
      ).toBe("440");
      expect(
        await execInWorkspace("stat --format=%U:%G /etc/sudoers.d/ubuntu"),
      ).toBe("root:root");
    });

    test("/home/ubuntu is owned by ubuntu", async () => {
      expect(await execInWorkspace("stat --format=%U:%G /home/ubuntu")).toBe(
        "ubuntu:ubuntu",
      );
    });

    // find's predicates are single characters; no long forms exist.
    // Symbolic links are excluded: Linux gives every symlink mode 0777 and
    // never consults those bits, so they carry no writable-file risk.
    test("nothing under /home/ubuntu is group- or other-writable", async () => {
      expect(
        await execInWorkspace(
          "find /home/ubuntu ! -type l -perm /go+w -print -quit",
        ),
      ).toBe("");
    });

    test("the docker CLI plugins are symlinked onto PATH", async () => {
      expect(
        await execInWorkspace(
          "find /home/ubuntu/.local/bin -maxdepth 1 -type l -print -quit",
        ),
      ).not.toBe("");
    });
  });

  describe("privileges", () => {
    test("ubuntu has passwordless sudo", async () => {
      expect(await execInWorkspace("sudo --non-interactive id --user")).toBe(
        "0",
      );
    });

    test("ubuntu's password is locked", async () => {
      const status = await execInWorkspace("passwd --status ubuntu", {
        asRoot: true,
      });
      expect(status.split(/\s+/)[1]).toBe("L");
    });
  });

  describe("image config", () => {
    const inspectConfig = async (configPath: string) => {
      const template = `{{json .Config.${configPath}}}`;
      return JSON.parse(
        await $`docker inspect --format ${template} ${image}`.text(),
      );
    };

    test("ENTRYPOINT is the workspace entrypoint", async () => {
      expect(await inspectConfig("Entrypoint")).toEqual(["docker-entrypoint"]);
    });

    test("CMD runs the ubuntu sshd", async () => {
      expect(await inspectConfig("Cmd")).toEqual([
        "/usr/sbin/sshd",
        "-D",
        "-e",
        "-f",
        "/etc/sshd/sshd_config_ubuntu",
      ]);
    });

    test("declares /home as a volume", async () => {
      expect(await inspectConfig("Volumes")).toEqual({ "/home": {} });
    });
  });

  // Binary names differ from their apt packages: ripgrep is rg,
  // openssh-server is sshd, php-cli is php, bubblewrap is bwrap, and
  // xz-utils is xz.
  describe("system packages", () => {
    test.each([
      "brotli",
      "bwrap",
      "ffmpeg",
      "htop",
      "jq",
      "lz4",
      "nano",
      "php",
      "rg",
      "rsync",
      "sshd",
      "sudo",
      "systemd-sysusers",
      "tmux",
      "xz",
      "zip",
      "zstd",
    ])("%s is on PATH", async (command) => {
      await execInWorkspace(`command -v ${command}`);
    });
  });
});

describe("user-install", () => {
  /*TODO*/
});
