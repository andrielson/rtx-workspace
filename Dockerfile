# syntax=docker/dockerfile:1
ARG TARGETARCH

FROM buildpack-deps:26.04 AS base

COPY --link \
  docker-entrypoint.sh \
  /home/ubuntu/.local/bin/docker-entrypoint

# OpenSSH server configuration
COPY --link \
  sshd_config \
  /home/ubuntu/.local/sshd/sshd_config

RUN chmod --verbose 500 /home/ubuntu/.local/bin/docker-entrypoint && \
  chmod --verbose 400 /home/ubuntu/.local/sshd/sshd_config

# =============================================================================
# Install and configure system packages for all runtime stages.
FROM buildpack-deps:26.04 AS root-install

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean && \
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache && \
  apt-get -qqy --fix-missing update && \
  apt-get -qqy --fix-missing dist-upgrade && \
  install --directory /etc/ssh && \
  touch \
    /etc/ssh/ssh_host_rsa_key \
    /etc/ssh/ssh_host_ecdsa_key \
    /etc/ssh/ssh_host_ed25519_key && \
  apt-get -qqy --fix-missing install --no-install-recommends \
    brotli \
    bubblewrap \
    ffmpeg \
    htop \
    jq \
    lz4 \
    nano \
    openssh-server \
    php-cli \
    ripgrep \
    rsync \
    sudo \
    systemd-standalone-sysusers \
    tmux \
    xz-utils \
    zip \
    zstd \
  && rm -f \
    /etc/ssh/ssh_host_rsa_key \
    /etc/ssh/ssh_host_ecdsa_key \
    /etc/ssh/ssh_host_ed25519_key && \
  echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu && \
  chmod 0440 /etc/sudoers.d/ubuntu

COPY --from=base --chown=ubuntu:ubuntu /home/ubuntu/.local /home/ubuntu/.local

USER ubuntu

ENV PATH="/home/ubuntu/.local/bin:/home/ubuntu/.cargo/bin:/home/ubuntu/.opencode/bin:$PATH" \
  BUN_INSTALL="/home/ubuntu/.local" \
  CARGO_HOME="/home/ubuntu/.cargo" \
  GOBIN="/home/ubuntu/.local/bin" \
  NVM_DIR="/home/ubuntu/.nvm" \
  RUSTUP_HOME="/home/ubuntu/.rustup" \
  SDKMAN_DIR="/home/ubuntu/.sdkman" \
  UV_COMPILE_BYTECODE=1 \
  UV_MALWARE_CHECK=1 \
  UV_MANAGED_PYTHON=1 \
  UV_PREVIEW_FEATURES="python-install-default"

VOLUME /home

WORKDIR /home/ubuntu

ENTRYPOINT [ "docker-entrypoint" ]