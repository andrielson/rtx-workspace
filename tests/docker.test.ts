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
