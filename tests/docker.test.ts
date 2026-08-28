import { $ } from "bun";
import { statSync } from "node:fs";
import { beforeAll, afterAll, test, expect } from "bun:test";

const project = "rtx-workspace-tests";
const file = "tests/docker-compose.yml";
// The Tests compose file lives under tests/, so compose would look for its
// interpolation .env there — inject the socket's real GID through the
// process env instead (it wins over any .env file).
const env = {
  ...process.env,
  DOCKER_GID: String(statSync("/var/run/docker.sock").gid),
};

// bun:test kills hooks after 5s by default; the stack lifecycle needs far
// longer (the up waits out the first-boot bootstrap, bounded by
// --wait-timeout 1800), so every hook carries an explicit timeout.
beforeAll(async () => {
  // Defensive teardown first: the afterAll guarantee does not cover SIGKILL.
  await $`docker compose -f ${file} -p ${project} down -v --remove-orphans`
    .env(env)
    .nothrow()
    .quiet();
  // Not quiet: compose progress echoes live, and a failure throws ShellError
  // with stderr attached. --wait blocks until the workspace healthcheck
  // passes (sshd is up, i.e. the first-boot bootstrap has finished).
  await $`docker compose -f ${file} -p ${project} up -d --wait --wait-timeout 1800`.env(
    env,
  );
}, 1_900_000);

afterAll(async () => {
  await $`docker compose -f ${file} -p ${project} down -v --remove-orphans`
    .env(env)
    .nothrow()
    .quiet();
}, 120_000);

test("2 + 2", () => {
  expect(2 + 2).toBe(4);
});
