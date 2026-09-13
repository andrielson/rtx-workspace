# Layer compose files with service-level `extends:`

The stack needs one source of truth for the workspace + nginx services (the Base compose in `src/`), consumed by both the real stack (Prod overlay at the root) and the Tests stack with per-stack overrides — container name, ports, networks, env — since the tests stack must run beside the live stack. We layer with service-level `extends:` because `include:` cannot modify included services at all, and `-f` layering forces flags onto every invocation and ties `.env`/relative-path resolution to the first file's directory.

> **Superseded 2026-09-13:** the extends layering is gone. The repository's product is now the workspace image itself: the Base compose and the Prod overlay were deleted, and the Tests stack became a standalone compose file whose two builds share the `src/` context through a tracked symlink. See [ADR 0007](0007-standalone-tests-compose-symlink-context.md).
