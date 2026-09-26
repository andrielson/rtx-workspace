import { readFileSync, writeFileSync } from 'node:fs'

// The Tests stack's per-worktree compose identity. The project name every
// Docker-global resource of a suite run derives from is recorded in the
// compose project directory's .env (tests/.env), which compose itself loads
// — so manual invocations without --project-name aim at the same project.
export const resolveComposeProject = (envPath: string): string => {
  // A missing or unreadable record is simply a fresh identity.
  let content: string
  try {
    content = readFileSync(envPath, 'utf8')
  } catch {
    content = ''
  }
  const recorded = /^COMPOSE_PROJECT_NAME=(rtx-workspace-tests-[0-9a-f]{8})\n?$/.exec(content)?.[1]
  if (recorded) return recorded

  // 32 random bits as exactly eight lowercase hex chars.
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  const project = `rtx-workspace-tests-${value.toString(16).padStart(8, '0')}`
  writeFileSync(envPath, `COMPOSE_PROJECT_NAME=${project}\n`)
  return project
}
