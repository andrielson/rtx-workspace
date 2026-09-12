#!/bin/bash

# Fail on errors, unset vars, and pipefail for robust startup
set -euo pipefail

# id's exit status is irrelevant here: the string comparison is the check.
# shellcheck disable=SC2312
if [[ "$(id --user --name)" != 'ubuntu' ]]; then
  echo 'This entrypoint must be run as the ubuntu user.' >&2
  exit 1
fi

cd "${HOME}"

SSH_AUTHORIZED_KEYS_FILE="${HOME}/.ssh/authorized_keys"

_curl() {
  # Vendor endpoints fail transiently (one observed outage served ~45 s of
  # 503s), and a single --fail exit under set -e aborts the whole first
  # boot. --retry re-fetches on curl's own transient class — 5xx responses,
  # timeouts, resets, and refused connections (--retry-connrefused) — while
  # permanent errors such as 404 still fail on the first attempt;
  # --retry-all-errors would blur that line and is deliberately absent.
  # Ten retries five seconds apart ride out the observed outage window.
  # Retrying is side-effect-free: only the fetch side of each
  # fetch-and-run pipe retries, never the installer it feeds.
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 10 --retry-delay 5 --retry-connrefused "$@"
}

_log() {
  # A failing date must not abort the script; the timestamp is best-effort.
  # shellcheck disable=SC2312
  echo "[$(date --iso-8601=seconds)] $*"
}

setup_git() {
  local github_name
  local github_email

  # The helper is intentionally single-quoted: git must expand $GH_TOKEN when
  # it invokes the credential helper, not when this script runs.
  # shellcheck disable=SC2016
  git config --global credential.https://github.com.helper '!f() { echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f'
  git config --global url.'https://github.com/'.insteadOf 'git@github.com:'

  if [[ -z ${GH_TOKEN:-} ]]; then
    echo 'GH_TOKEN is not set. Skipping GitHub setup.'
    return
  fi

  gh auth status
  github_name="$(gh api user --jq '.name')"
  github_email="$(gh api user --jq '.email')"

  if [[ -z ${GIT_AUTHOR_NAME:-} ]] || [[ -z ${GIT_COMMITTER_NAME:-} ]]; then
    git config --global user.name "${github_name}"
  fi

  if [[ -z ${GIT_AUTHOR_EMAIL:-} ]] || [[ -z ${GIT_COMMITTER_EMAIL:-} ]]; then
    git config --global user.email "${github_email}"
  fi
}

setup_ssh() {
  local authorized_keys_tmp

  mkdir --parents "${HOME}/.ssh"
  chmod --verbose 700 "${HOME}/.ssh"

  if [[ -n ${SSH_AUTHORIZED_KEY:-} ]]; then
    authorized_keys_tmp="$(mktemp "${HOME}/.ssh/authorized_keys.XXXXXX")"
    printf '%s\n' "${SSH_AUTHORIZED_KEY}" > "${authorized_keys_tmp}"
    chmod --verbose 600 "${authorized_keys_tmp}"

    # ssh-keygen has no long options; -l lists the fingerprint and -f
    # names the key file.
    if ! ssh-keygen -l -f "${authorized_keys_tmp}" > /dev/null; then
      rm --force --verbose "${authorized_keys_tmp}"
      echo 'SSH_AUTHORIZED_KEY is not a valid SSH public key.' >&2
      exit 1
    fi

    mv --verbose "${authorized_keys_tmp}" "${SSH_AUTHORIZED_KEYS_FILE}"
  elif [[ ! -e ${SSH_AUTHORIZED_KEYS_FILE} ]]; then
    install --mode=600 /dev/null "${SSH_AUTHORIZED_KEYS_FILE}"
  fi

  chmod --verbose 600 "${SSH_AUTHORIZED_KEYS_FILE}"
}

install_nix_profile() {
  _log 'Installing the default Nix profile...'

  # One unattended install of every stable toolchain and everyday utility,
  # all free-licensed so the evaluation stays pure. yq rides under yq-go:
  # nixpkgs' top-level yq is the Python one. git lands here too — the slim
  # image bakes none, and setup_git below needs it. curl and wget land for
  # newer versions than apt carries, the profile bin shadowing apt's copies
  # once installed (apt's curl stays regardless: the entrypoint fetches this
  # script before any profile exists). unzip serves the vendor installers
  # below (bun's unpacks its archive). The profile bin is on PATH from the
  # image ENV hook, so every command resolves the moment this lands.
  nix profile add \
    nixpkgs#bash-completion \
    nixpkgs#brotli \
    nixpkgs#bubblewrap \
    nixpkgs#curl \
    nixpkgs#docker-client \
    nixpkgs#ffmpeg \
    nixpkgs#fnm \
    nixpkgs#gh \
    nixpkgs#git \
    nixpkgs#go \
    nixpkgs#graalvmPackages.graalvm-ce \
    nixpkgs#gradle \
    nixpkgs#htop \
    nixpkgs#jq \
    nixpkgs#kotlin \
    nixpkgs#lz4 \
    nixpkgs#maven \
    nixpkgs#nano \
    nixpkgs#php \
    nixpkgs#phpPackages.composer \
    nixpkgs#quarkus \
    nixpkgs#ripgrep \
    nixpkgs#rsync \
    nixpkgs#scala \
    nixpkgs#shellcheck \
    nixpkgs#shfmt \
    nixpkgs#tmux \
    nixpkgs#unzip \
    nixpkgs#wget \
    nixpkgs#yq-go \
    nixpkgs#zip \
    nixpkgs#zstd
}

setup_completions() {
  _log 'Wiring bash completion into the interactive shell init...'

  # bash-completion left apt with the other utilities; its core script needs
  # one source line in the interactive init to activate the completions the
  # profile carries. The line is single-quoted on purpose: $HOME must expand
  # when an interactive shell sources ~/.bashrc, not here. The grep guard
  # keeps a partial-failure re-run from appending the line twice.
  # shellcheck disable=SC2016
  if ! grep --quiet --fixed-strings 'share/bash-completion/bash_completion' "${HOME}/.bashrc"; then
    printf '%s\n' 'source "${HOME}/.nix-profile/share/bash-completion/bash_completion"' >> "${HOME}/.bashrc"
  fi
}

install_bun() {
  _log 'Installing Bun...'
  _curl https://bun.sh/install | bash
}

install_rustup() {
  _log 'Installing Rustup...'
  # bash has no long option for -s (read the installer from stdin), and
  # rustup-init has no long form for -y (unattended install).
  _curl https://sh.rustup.rs | bash -s -- --no-modify-path --profile default -y
}

install_uv() {
  _log 'Installing UV...'
  _curl https://astral.sh/uv/install.sh | bash

  _log 'Installing Python'
  uv python install --default

  _log 'Installing graphifyy...'
  uv tool install graphifyy

  _log 'Installing ruff...'
  uv tool install ruff

  _log 'Installing ty...'
  uv tool install ty
}

install_claude_code() {
  _log 'Installing Claude Code...'
  _curl https://claude.ai/install.sh | bash
}

install_opencode() {
  _log 'Installing OpenCode...'
  # bash has no long option for -s (read the installer from stdin).
  _curl https://opencode.ai/install | bash -s -- --no-modify-path
  ln --verbose --symbolic "${HOME}"/.opencode/bin/* "${HOME}/.local/bin/"
}

setup_node() {
  _log 'Wiring fnm into the interactive shell init...'

  # Interactive-only, as nvm was: Node resolves just for interactive shells.
  # The eval is single-quoted on purpose: $(fnm env) must run when an
  # interactive shell sources ~/.bashrc, not here. The grep guard keeps a
  # partial-failure re-run from appending the line twice.
  # shellcheck disable=SC2016
  if ! grep --quiet --fixed-strings 'fnm env --shell bash' "${HOME}/.bashrc"; then
    printf '%s\n' 'eval "$(fnm env --shell bash)"' >> "${HOME}/.bashrc"
  fi

  _log 'Installing Node.js LTS via fnm...'
  fnm install --lts
  fnm default lts-latest

  # Smoke-test the default Node the same way the .bashrc snippet loads it.
  # fnm env is evaluated for its side effects; a failure surfaces on the
  # next fnm invocation.
  # shellcheck disable=SC2312
  eval "$(fnm env --shell bash)"
  node --version
}

install_everything() {
  install_nix_profile
  setup_completions
  install_bun
  install_rustup
  install_uv
  install_claude_code
  install_opencode
  setup_node
}

install_everything
setup_git
setup_ssh
