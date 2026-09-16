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

# The helpers below are pure stdout/exit-status functions, so the unit
# suite can lift and drive them by name (tests/user-install.test.ts).

# The user.name a profile without a public name gets: its login, which
# always exists. Empty means absent — gh's `// empty` jq upstream collapses
# JSON null to no output, never the literal "null" jq would print.
_identity_name() {
  if [[ -n ${1:-} ]]; then
    printf '%s' "${1}"
  else
    printf '%s' "${2}"
  fi
}

# The user.email a profile without a public email gets: the ID-based
# noreply address, which GitHub's commit verification can always map back
# to the account (see ADR 0009).
_identity_email() {
  if [[ -n ${1:-} ]]; then
    printf '%s' "${1}"
  else
    printf '%s+%s@users.noreply.github.com' "${2}" "${3}"
  fi
}

# The allowed_signers principal: the committer email when one resolved, the
# * wildcard otherwise — git's ssh verification matches the key first and
# consults find-principals when the email misses, so the principal only
# names the entry.
_allowed_signers_principal() {
  if [[ -n ${1:-} ]]; then
    printf '%s' "${1}"
  else
    printf '*'
  fi
}

# Whether the git signing setup runs: a token must be present and the
# opt-out unset — exactly '1' disables, mirroring SKIP_USER_INSTALL in the
# entrypoint; anything else, including '0' or empty, leaves it on.
_git_signing_enabled() {
  [[ -n ${1:-} && ${2:-} != '1' ]]
}

setup_git() {
  local github_name
  local github_login
  local github_id
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
  # `// empty` collapses a profile's absent name or email to no output;
  # without it gh prints JSON null as the literal string "null", which
  # every -z check below would treat as a value.
  github_name="$(gh api user --jq '.name // empty')"
  github_login="$(gh api user --jq '.login')"
  github_id="$(gh api user --jq '.id')"
  github_email="$(gh api user --jq '.email // empty')"

  # The identity a profile without a public name or email gets: the login
  # and the ID-based noreply address (see ADR 0009) — both always resolve,
  # and the email maps back to the account, which GitHub's commit
  # verification requires of the committer.
  github_name="$(_identity_name "${github_name}" "${github_login}")"
  github_email="$(_identity_email "${github_email}" "${github_id}" "${github_login}")"

  if [[ -z ${GIT_AUTHOR_NAME:-} ]] || [[ -z ${GIT_COMMITTER_NAME:-} ]]; then
    git config --global user.name "${github_name}"
  fi

  if [[ -z ${GIT_AUTHOR_EMAIL:-} ]] || [[ -z ${GIT_COMMITTER_EMAIL:-} ]]; then
    git config --global user.email "${github_email}"
  fi

  # The predicate's exit status is the answer by design; nothing inside it
  # can fail under set -e.
  # shellcheck disable=SC2310
  if _git_signing_enabled "${GH_TOKEN}" "${SKIP_GIT_USER_SIGNING_KEY:-}"; then
    setup_git_signing "${github_email}"
  fi
}

# SSH signing for commits and tags (see ADR 0009): one ed25519 key pair per
# volume under ~/.ssh/git_user_signing_key(.pub), its public half
# registered with the authenticated account as a GitHub signing key — the
# Verified badge needs both that registration and a committer email the
# account maps back to — and the local config plus allowed_signers entry to
# sign and verify. Reuse over regeneration: a partial first boot that
# already wrote the pair keeps it, since gh's registration is idempotent by
# key content and every write below is idempotent by nature.
setup_git_signing() {
  local committer_email="${1:-}"
  local signing_key="${HOME}/.ssh/git_user_signing_key"
  local allowed_signers="${HOME}/.ssh/allowed_signers"
  local principal
  local gh_output

  mkdir --parents "${HOME}/.ssh"

  if [[ ! -e ${signing_key}.pub ]]; then
    if [[ ! -e ${signing_key} ]]; then
      _log 'Generating the per-volume git signing key...'
      # ssh-keygen has no long options; -q quiets the banner, -t names the
      # type, -N takes the (empty) passphrase, -C the comment, -f the file.
      ssh-keygen -q -t ed25519 -N '' -C "rtx-workspace ${HOSTNAME}" -f "${signing_key}"
    else
      # A partial first boot can leave the private half alone; rebuild the
      # public half from it. stdin stays /dev/null so a key that asks for a
      # passphrase fails instead of consuming the script itself on stdin.
      # ssh-keygen has no long options; -y prints the public half and -f
      # names the key file.
      ssh-keygen -y -f "${signing_key}" < /dev/null > "${signing_key}.pub"
    fi
  fi

  chmod --verbose 600 "${signing_key}" "${signing_key}.pub"

  # ssh-keygen has no long options; -l lists the fingerprint and -f names
  # the key file.
  if ! ssh-keygen -l -f "${signing_key}.pub" > /dev/null; then
    echo 'The git signing key pair is not a valid SSH public key.' >&2
    exit 1
  fi

  _log 'Registering the git signing key with GitHub...'
  # A 403 means this token cannot manage signing keys — a classic PAT
  # without write:ssh_signing_key, a fine-grained PAT without the "SSH
  # signing keys" permission, or an Actions GITHUB_TOKEN — and the whole
  # setup is skipped rather than failing a legitimate boot; scopes cannot
  # be pre-checked for fine-grained and App tokens. Every other failure is
  # as real and fatal as the other gh calls in this script.
  if ! gh_output="$(gh ssh-key add "${signing_key}.pub" --type signing --title "rtx-workspace: ${HOSTNAME}" 2>&1)"; then
    if grep --quiet 'HTTP 403' <<< "${gh_output}"; then
      _log 'The token cannot manage GitHub signing keys. Skipping git signing setup.'
      printf '%s\n' "${gh_output}" >&2
      return 0
    fi
    printf '%s\n' "${gh_output}" >&2
    exit 1
  fi
  printf '%s\n' "${gh_output}"

  git config --global user.signingkey "${signing_key}.pub"
  git config --global gpg.format ssh
  git config --global commit.gpgsign true
  git config --global tag.gpgsign true
  git config --global gpg.ssh.allowedSignersFile "${allowed_signers}"

  # The principal is the committer email (or the wildcard when none
  # resolved); git's verification matches the key first, so the principal
  # only names the entry.
  principal="$(_allowed_signers_principal "${committer_email}")"
  printf '%s %s\n' "${principal}" "$(< "${signing_key}.pub")" > "${allowed_signers}"
  chmod --verbose 600 "${allowed_signers}"

  _log 'Git signing configured.'
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

# A bundle is enabled unless its SKIP_USER_INSTALL_<NAME> variable holds
# exactly '1' — the same exactly-'1' contract as the entrypoint's global
# SKIP_USER_INSTALL kill-switch, where '0', empty, unset and any other
# value boot as usual. The name arrives uppercase so it doubles as the
# variable suffix. SC2310: the gate is always invoked in a condition
# context, which disables set -e inside it — nothing to mask, since the
# single comparison's exit status is the answer itself, which is why every
# call site carries the same inline disable.
bundle_enabled() {
  local skip_variable="SKIP_USER_INSTALL_${1}"

  [[ "${!skip_variable:-}" != '1' ]]
}

# The skip line every bundle's omission prints — under the exact variable
# name an operator would set or unset, so the omission stays visible in the
# boot log whether the bundle carries vendor steps or profile packages.
log_bundle_skipped() {
  _log "Skipping the ${1} bundle (SKIP_USER_INSTALL_${1}=1)."
}

# Runs one bundle's steps unless its skip variable holds '1'.
run_bundle() {
  local bundle="${1}"
  shift

  # shellcheck disable=SC2310
  if ! bundle_enabled "${bundle}"; then
    log_bundle_skipped "${bundle}"
    return 0
  fi

  "${@}"
}

# Appends one bundle's packages to the install_nix_profile union, unless
# its skip variable holds '1'. Reaches the union array through bash's
# dynamic scoping: packages is local to install_nix_profile, the only
# caller.
bundle_packages() {
  local bundle="${1}"
  shift

  # shellcheck disable=SC2310
  if ! bundle_enabled "${bundle}"; then
    log_bundle_skipped "${bundle}"
    return 0
  fi

  packages+=("${@}")
}

install_nix_profile() {
  _log 'Installing the default Nix profile...'

  # The profile lands as one unattended `nix profile add` of the union of
  # every enabled bundle's packages: one evaluation, one atomic profile
  # generation, and a partial-failure re-run that finds a package already
  # installed just warns and moves on (the add is idempotent). All
  # free-licensed, so the evaluation stays pure. yq rides under yq-go:
  # nixpkgs' top-level yq is the Python one. curl and wget land for newer
  # versions than apt carries, the profile bin shadowing apt's copies once
  # installed (apt's curl stays regardless: the entrypoint fetches this
  # script before any profile exists). unzip serves the vendor installers
  # (bun's unpacks its archive). The profile bin is on PATH from the image
  # ENV hook, so every command resolves the moment this lands.
  local packages=()

  # linux — the always-on bundle, with no skip variable: every other bundle
  # leans on it (curl for the vendor installers, git and gh for setup_git,
  # unzip for bun's archive), and its steps wire the interactive shell and
  # the SSH surface below.
  packages+=(
    nixpkgs#bash-completion
    nixpkgs#brotli
    nixpkgs#bubblewrap
    nixpkgs#curl
    nixpkgs#ffmpeg
    nixpkgs#gh
    nixpkgs#git
    nixpkgs#htop
    nixpkgs#jq
    nixpkgs#lz4
    nixpkgs#nano
    nixpkgs#ripgrep
    nixpkgs#rsync
    nixpkgs#shellcheck
    nixpkgs#shfmt
    nixpkgs#tmux
    nixpkgs#unzip
    nixpkgs#wget
    nixpkgs#yq-go
    nixpkgs#zip
    nixpkgs#zstd
  )

  bundle_packages DOCKER nixpkgs#docker-client
  bundle_packages GOLANG nixpkgs#go
  bundle_packages JAVA \
    nixpkgs#graalvmPackages.graalvm-ce \
    nixpkgs#gradle \
    nixpkgs#kotlin \
    nixpkgs#maven \
    nixpkgs#quarkus \
    nixpkgs#scala
  bundle_packages NODE nixpkgs#fnm
  bundle_packages PHP nixpkgs#php nixpkgs#phpPackages.composer

  nix profile add "${packages[@]}"
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

install_python() {
  _log 'Installing uv...'
  _curl https://astral.sh/uv/install.sh | bash

  _log 'Installing Python'
  uv python install --default

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

install_bundles() {
  install_nix_profile

  # The linux bundle's setup steps, always on like its packages: completions
  # for the interactive shell, git and gh configured against GitHub, the SSH
  # surface. They precede the vendor bundles because nothing down the line
  # depends on those, while setup_git needs the just-landed profile.
  setup_completions
  setup_git
  setup_ssh

  # The vendor bundles, in a fixed order that ends with bun: the entrypoint
  # names bun as its default bootstrap sentinel
  # (ENTRYPOINT_USER_INSTALL_CHECK), so any earlier bundle's failure leaves
  # the sentinel missing and the next boot re-runs the bootstrap instead of
  # coming up silently incomplete.
  run_bundle PYTHON install_python
  run_bundle RUST install_rustup
  run_bundle CLAUDE install_claude_code
  run_bundle OPENCODE install_opencode
  run_bundle NODE setup_node
  run_bundle BUN install_bun
}

install_bundles
