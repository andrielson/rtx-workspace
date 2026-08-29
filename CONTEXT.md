# rtx-workspace

A container-based remote development workspace: one GPU-enabled Linux container the developer SSHes into, plus an nginx sidecar serving first-boot install assets. This context covers how that stack is described and layered.

## Language

**Base compose**:
The compose file under `docker/` that is the single source of truth for the workspace service (everything except GPU reservation), its named home volume, and the nginx service; every stack derives from it by `extends`.
_Avoid_: main compose, source-of-truth compose

**Prod overlay**:
The root compose file; extends the Base compose into the real, long-running stack by adding the GPU reservation, the gateway network, the stable container name, and the SSH port.
_Avoid_: production compose, docker-compose.prod

**Tests stack**:
The compose file under `tests/`; extends the Base compose with a throwaway identity — overridden container name, isolated network, fresh volume, dummy environment — so it can run beside the real stack.
_Avoid_: test compose, CI stack

**Web root**:
The directory (`web/`) of artifacts nginx serves to workspaces; the Bootstrap script is fetched from here.
_Avoid_: static files, www

**Bootstrap script**:
`user-install.sh`, the script a workspace fetches from nginx and runs as the ubuntu user when its home volume is fresh.
_Avoid_: installer, setup script

**Image contract**:
The tools, files, and permissions the workspace image delivers on its own, before the Bootstrap script ever runs; the complement of what the first boot installs.
_Avoid_: Dockerfile contract, base image contents
