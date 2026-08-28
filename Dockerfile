# syntax=docker/dockerfile:1
ARG TARGETARCH

FROM oven/bun:debian AS scratch-bun

RUN mkdir --parents --verbose \
    /scratch-home-ubuntu/.local/bin \
    /scratch-home-ubuntu/.local/share/bash-completion/completions \
  && cd /scratch-home-ubuntu/.local/share/bash-completion/completions && \
  SHELL=bash bun completions > ./bun.completion.bash && \
  cd /scratch-home-ubuntu/.local/bin && \
  mv --verbose /usr/local/bin/bun . && \
  ln --symbolic --verbose ./bun ./bunx


FROM docker:latest AS scratch-docker

RUN mkdir --parents --verbose /scratch-home-ubuntu/.docker /scratch-home-ubuntu/.local/bin && \
  mv --verbose /usr/local/libexec/docker/cli-plugins/ /scratch-home-ubuntu/.docker/cli-plugins/ && \
  cd /scratch-home-ubuntu/.local/bin && \
  mv --verbose /usr/local/bin/docker . && \
  ln -sv ../../.docker/cli-plugins/* .


FROM rust:slim AS scratch-rust

RUN RUSTUP_PREVIOUS_TOOLCHAIN=$(rustup show active-toolchain | awk '{print $1}') && \
  rustup set profile default && \
  rustup default stable && \
  rustup toolchain uninstall ${RUSTUP_PREVIOUS_TOOLCHAIN} && \
  mkdir --parents --verbose /scratch-home-ubuntu/.local && \
  cd /scratch-home-ubuntu/.local && \
  mv /usr/local/cargo . && \
  mv /usr/local/rustup .


FROM ubuntu:26.04 AS scratch-copy

# golang
COPY --link --from=golang:latest \
  /usr/local/go \
  /scratch/home/ubuntu/.local/go

# gosu
COPY --link --from=tianon/gosu:latest \
  /gosu \
  /scratch/usr/local/bin/gosu

# Bun
COPY --link --from=scratch-bun \
  /scratch-home-ubuntu/ \
  /scratch/home/ubuntu/

# Docker
COPY --link --from=scratch-docker \
  /scratch-home-ubuntu/ \
  /scratch/home/ubuntu/

# Rust
COPY --link --from=scratch-rust \
  /scratch-home-ubuntu/ \
  /scratch/home/ubuntu/

# docker-entrypoint
COPY --link \
  docker-entrypoint.sh \
  /scratch/usr/local/bin/docker-entrypoint

COPY --link \
  01-home-bash-env.sh \
  /scratch/etc/profile.d/

COPY --link \
  sshd_config_ubuntu \
  /scratch/etc/sshd/

RUN chmod --recursive go-w /scratch/home/ubuntu/ && \
  chown --recursive ubuntu:ubuntu /scratch/home/ubuntu/ && \
  chmod --verbose +x \
    /scratch/etc/profile.d/* \
    /scratch/usr/local/bin/docker-entrypoint


# =============================================================================
# Install and configure system packages for all runtime stages.
FROM buildpack-deps:26.04

ENV PATH="/home/ubuntu/.local/bin:/home/ubuntu/.local/bun/bin:/home/ubuntu/.local/cargo/bin:/home/ubuntu/.local/go/bin:$PATH" \
  BUN_INSTALL="/home/ubuntu/.local/bun" \
  CARGO_HOME="/home/ubuntu/.local/cargo" \
  GOBIN="/home/ubuntu/.local/go/bin" \
  NVM_DIR="/home/ubuntu/.nvm" \
  RUSTUP_HOME="/home/ubuntu/.local/rustup" \
  SDKMAN_DIR="/home/ubuntu/.sdkman" \
  UV_COMPILE_BYTECODE=1 \
  UV_MALWARE_CHECK=1 \
  UV_MANAGED_PYTHON=1 \
  UV_PREVIEW_FEATURES="python-install-default" \
  UV_PYTHON="3.14" \
  UV_TORCH_BACKEND="cu132"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean && \
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache && \
  apt-get -qqy --fix-missing update && \
  apt-get -qqy --fix-missing dist-upgrade && \
  apt-get -qqy --fix-missing install --no-install-recommends \
    bash-completion \
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
  && mkdir --parents --verbose /run/sshd && \
  usermod --password '*' ubuntu && \
  echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu && \
  chmod --verbose 0440 /etc/sudoers.d/ubuntu

COPY --from=scratch-copy /scratch/ /

VOLUME /home

ENTRYPOINT [ "docker-entrypoint" ]

CMD [ "/usr/sbin/sshd", "-D", "-e", "-f", "/etc/sshd/sshd_config_ubuntu" ]
