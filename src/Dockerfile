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

# --chown because the ubuntu-user stage below must be able to prepend the
# snippet to ~/.bashrc and then delete it from sticky /tmp.
COPY --chown=ubuntu:ubuntu 02-home-nix-profile.sh /tmp/02-home-nix-profile.sh

# USER is exported because the official installer consults it while Docker
# only sets the uid/gid for USER.
USER ubuntu

ENV USER=ubuntu

RUN tar --directory=/tmp --extract --strip-components=1 --file /opt/nix-linux.tar.xz \
  && /tmp/install \
    --no-channel-add \
    --no-daemon \
    --yes \
  && mkdir --parents --verbose ~/.config/nix \
  && printf '%s\n' \
    'experimental-features = nix-command flakes' \
    'sandbox = false' \
    >> ~/.config/nix/nix.conf \
  && cat /tmp/02-home-nix-profile.sh ~/.bashrc > ~/.bashrc.new \
  && mv ~/.bashrc.new ~/.bashrc \
  && rm /tmp/02-home-nix-profile.sh


FROM ubuntu:26.04 AS scratch-copies

# gosu
COPY --link --from=tianon/gosu:latest /gosu /__SCRATCH__/usr/local/bin/gosu

# nix
COPY --link --from=scratch-nix /nix /__SCRATCH__/nix

COPY --link docker-entrypoint.sh /__SCRATCH__/usr/local/bin/docker-entrypoint

COPY --link 01-home-bash-env.sh /__SCRATCH__/etc/profile.d/

# PATH hook #2 of 3: /etc/profile.d, sourced by SSH login shells (VS Code
# Remote SSH, Zed); /etc/profile resets whatever the image ENV had set.
COPY --link 02-home-nix-profile.sh /__SCRATCH__/etc/profile.d/

COPY --link sshd_config_ubuntu /__SCRATCH__/etc/sshd/

RUN chown --recursive ubuntu:ubuntu /__SCRATCH__/nix \
  && chmod --recursive go-w /__SCRATCH__/nix/ubuntu/ \
  && chmod --verbose 0755 \
    /__SCRATCH__/usr/local/bin/docker-entrypoint \
    /__SCRATCH__/etc/profile.d/*


# =============================================================================
# Final stage: the Nix seed lands under /nix (the volume's copy-up source)
# and the PATH hooks are wired for every activation surface.
FROM scratch-root

COPY --from=scratch-copies /__SCRATCH__/ /

# PATH hook #1 of 3: image ENV — the only hook a bare `docker exec ... <tool>`
# (no shell at all) ever sees. Hook #3 lives inside ~/.bashrc, prepended
# above Debian's interactive guard in the scratch-nix stage so
# `ssh host <cmd>` and `docker exec -it ... bash` resolve the profile too.
ENV PATH="/nix/ubuntu/.nix-profile/bin:/nix/ubuntu/.cargo/bin:/nix/ubuntu/.local/bin:$PATH"

VOLUME /nix

# No CMD on purpose: the entrypoint owns the default command (sshd) and
# replaces the boot flow entirely when invoked with arguments.
ENTRYPOINT ["docker-entrypoint"]
