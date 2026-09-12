# syntax=docker/dockerfile:1
# The image bakes Nix only: the package manager itself, installed at build
# time single-user as ubuntu, plus the slim runtime baseline everything else
# needs. Toolchains arrive with the default Nix profile at first boot (see
# ADR 0003 and the Bootstrap script).
ARG TARGETARCH
ARG NIX_VERSION=2.35.2


FROM scratch AS scratch-amd64

ARG NIX_VERSION

ADD --link https://releases.nixos.org/nix/nix-${NIX_VERSION}/nix-${NIX_VERSION}-x86_64-linux.tar.xz /nix-linux.tar.xz


FROM scratch AS scratch-arm64

ARG NIX_VERSION

ADD --link https://releases.nixos.org/nix/nix-${NIX_VERSION}/nix-${NIX_VERSION}-aarch64-linux.tar.xz /nix-linux.tar.xz


FROM scratch-${TARGETARCH} AS scratch-target-arch


# =============================================================================
# Slim runtime baseline: only what the container itself needs to boot and
# serve SSH. curl stays in apt because the entrypoint fetches the Bootstrap
# script before any profile exists; build-essential covers compilation-based
# installs such as `go install` (gcc), with libatomic1 riding along
# transitively — vendor binaries still link it, while Nix binaries are
# self-contained via store RPATHs. xz-utils extracts the Nix release tarball
# during the build. The everyday utilities and toolchains arrive with the
# default Nix profile on first boot.
FROM ubuntu:26.04 AS scratch-root

# The UV_* knobs stay baked: uv keeps installing through its official
# installer outside the read-only Nix store, and these defaults are
# user-independent.
ENV BUN_INSTALL="/nix/ubuntu/.local" \
  CARGO_HOME="/nix/ubuntu/.cargo" \
  RUSTUP_HOME="/nix/ubuntu/.rustup" \
  UV_COMPILE_BYTECODE=1 \
  UV_MALWARE_CHECK=1 \
  UV_MANAGED_PYTHON=1 \
  UV_PREVIEW_FEATURES="python-install-default" \
  UV_PYTHON="3.14" \
  UV_TORCH_BACKEND="cpu"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  rm --force /etc/apt/apt.conf.d/docker-clean && \
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache && \
  apt-get --quiet --quiet --yes --fix-missing update && \
  apt-get --quiet --quiet --yes --fix-missing dist-upgrade && \
  apt-get --quiet --quiet --yes --fix-missing install --no-install-recommends \
    ca-certificates \
    build-essential \
    curl \
    openssh-server \
    systemd-standalone-sysusers \
    xz-utils \
  && mkdir --parents --verbose \
    /nix \
    /run/sshd \
  && mv --verbose /home/ubuntu /nix && \
  chown --recursive ubuntu:ubuntu \
    /nix \
    /opt \
  && usermod --home /nix/ubuntu --password '*' ubuntu && \
  ln --verbose --symbolic /nix/ubuntu /home/ubuntu


# =============================================================================
# Install Nix single-user as ubuntu, with the home moved under /nix so one
# named volume persists store, profiles and user state across recreation.
FROM scratch-root AS scratch-nix

COPY --from=scratch-target-arch --chown=ubuntu:ubuntu /nix-linux.tar.xz /opt/nix-linux.tar.xz

# USER is exported because the official installer consults it while Docker
# only sets the uid/gid for USER.
USER ubuntu

ENV USER=ubuntu

RUN tar --directory=/tmp --extract --strip-components=1 --file=/opt/nix-linux.tar.xz \
  && /tmp/install \
    --no-channel-add \
    --no-daemon \
    --yes \
  && mkdir --parents --verbose ~/.config/nix \
  && printf '%s\n' \
    'experimental-features = nix-command flakes' \
    'sandbox = false' \
    >> ~/.config/nix/nix.conf


FROM ubuntu:26.04 AS scratch-copies

# gosu
COPY --link --from=tianon/gosu:latest /gosu /__SCRATCH__/usr/local/bin/gosu

# nix
COPY --link --from=scratch-nix /nix /__SCRATCH__/nix

COPY --link docker-entrypoint.sh /__SCRATCH__/usr/local/bin/docker-entrypoint

# The Environment mirror the entrypoint runs as ubuntu at every boot.
COPY --link home-env-mirror.sh /__SCRATCH__/usr/local/bin/home-env-mirror

# Env loader: sourced through /etc/profile.d by login shells, through the
# tail of /etc/bash.bashrc by interactive non-login shells, and through
# BASH_ENV — which sshd's SetEnv (sshd_config_ubuntu) injects into every
# session — by the non-interactive shells that read no init file of their
# own (the Bash tools of the coding agents). It applies the PATH hooks and
# sources the User environment file (see ADR 0006).
COPY --link 01-home-bash-env.sh /__SCRATCH__/etc/profile.d/

COPY --link sshd_config_ubuntu /__SCRATCH__/etc/sshd/

RUN chown --recursive ubuntu:ubuntu /__SCRATCH__/nix \
  && chmod --recursive go-w /__SCRATCH__/nix/ubuntu/ \
  && chmod --verbose 0755 \
    /__SCRATCH__/usr/local/bin/docker-entrypoint \
    /__SCRATCH__/usr/local/bin/home-env-mirror \
    /__SCRATCH__/etc/profile.d/*


# =============================================================================
# Final stage: the Nix seed lands under /nix (the volume's copy-up source)
# and the PATH hooks are wired for every activation surface.
FROM scratch-root

COPY --from=scratch-copies /__SCRATCH__/ /

# The interactive non-login surface (VS Code terminals, `docker exec -it ...
# bash`) and the sshd-spawned command surface: interactive shells read
# /etc/bash.bashrc in full, while Debian's bash patch makes an
# `ssh host <cmd>` shell source it instead of reading BASH_ENV — and both
# paths stop at the file's non-interactive guard, so the loader rides at
# the very top. The loader's idempotence flag keeps the login double path
# (profile.d plus this file, which /etc/profile also sources) harmless.
# ~/.bashrc stays stock — nothing user-owned carries image wiring (see
# ADR 0006). Prepending line-by-line (no ${} expansion — the Dockerfile
# would substitute shell variables before sh ever sees them).
RUN { printf '%s\n' \
    '# rtx-workspace: activate the user environment (see ADR 0006).' \
    'source /etc/profile.d/01-home-bash-env.sh' \
    ''; \
  cat /etc/bash.bashrc; \
  } > /etc/bash.bashrc.new \
  && mv /etc/bash.bashrc.new /etc/bash.bashrc

# PATH hook: image ENV — the only activation a bare `docker exec ... <tool>`
# (no shell at all) ever sees. docker exec already carries the container
# environment natively — the single source of truth the Environment mirror
# projects onto every shell surface (see ADR 0006).
ENV PATH="/nix/ubuntu/.nix-profile/bin:/nix/ubuntu/.cargo/bin:/nix/ubuntu/.local/bin:$PATH"

VOLUME /nix

# No CMD on purpose: the entrypoint owns the default command (sshd) and
# replaces the boot flow entirely when invoked with arguments.
ENTRYPOINT ["docker-entrypoint"]
