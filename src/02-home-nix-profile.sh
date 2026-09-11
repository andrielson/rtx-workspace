# PATH hooks for the Nix profile. This exact snippet is wired into the image
# twice (see ADR 0003): as /etc/profile.d/02-home-nix-profile.sh for SSH login
# shells (VS Code Remote SSH, Zed) — /etc/profile resets whatever the image ENV
# had set — and prepended above Debian's interactive guard in ~/.bashrc for
# sshd-spawned non-interactive shells (`ssh host <cmd>`) and
# `docker exec -it ... bash`. $HOME is used instead of a literal so
# non-ubuntu shells stay harmless (their profile dir simply does not exist);
# .local/bin rides along because the uv installer targets it, outside the
# read-only store.

if [[ -d "${HOME}/.local/bin" ]]; then
  PATH="${HOME}/.local/bin:${PATH}"
fi

if [[ -d "${HOME}/.nix-profile/bin" ]]; then
  PATH="${HOME}/.nix-profile/bin:${PATH}"
fi

export PATH
