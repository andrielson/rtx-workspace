# Issue the git signing key from the Bootstrap script against the GitHub account

Signed commits leaving the workspace should arrive on GitHub with the
Verified badge, and the first design explored for that pushed the key to
the deployment: an environment variable — a path to a key pair the
operator mounts, or the private key material itself, mirroring `GH_TOKEN` —
plus conditional git config written when it is set. It failed its own
grill: git reads no signing environment variable of its own (only the
identity vars and the generic `GIT_CONFIG_*` injection, which static
Compose YAML cannot correlate — an emptied `user.signingkey` beside a
lingering `commit.gpgsign=true` would break every commit in the
workspace), the private-material variant parks a secret in the environment
of every process, and the path variant pushes key logistics onto
deployments the repository deliberately knows nothing about. We instead
make the Bootstrap script the issuer: with `GH_TOKEN` present, `setup_git`
fetches the profile once and `setup_git_signing` generates one ed25519
pair without a passphrase at `~/.ssh/git_user_signing_key(.pub)` — a name
kept clear of the login key `SSH_AUTHORIZED_KEY` provisions — validates the
public half with `ssh-keygen -l`, registers that half with the
authenticated account via
`gh ssh-key add --type signing --title "rtx-workspace: <hostname>"`, and
only then writes the config block: `user.signingkey` pointing at the `.pub`
path (git hands it to `ssh-keygen -Y sign -f` verbatim; ssh-keygen resolves
the private half by stripping `.pub`), `gpg.format ssh`, `commit.gpgsign`
and `tag.gpgsign` true, and `gpg.ssh.allowedSignersFile` over a generated
`~/.ssh/allowed_signers` whose single entry is `<email> <pubkey>` — the
principal is the committer email, or the `*` wildcard when none resolved,
because git's ssh verification matches the key first and falls back to
`find-principals`, making the principal a name, not a gate (pinned
empirically with git 2.55: verification passes even with an unrelated
principal and fails only when the key itself is missing from the file).
The whole setup is opt-out, not opt-in: `SKIP_GIT_USER_SIGNING_KEY=1` —
exactly `1`, mirroring `SKIP_USER_INSTALL` in the entrypoint; anything
else, including empty or `0`, leaves it on — because the token's own
permission surface is the real opt-in. Registration failures split by
cause: a 403 means this token cannot manage signing keys (a classic PAT
without `write:ssh_signing_key`, a fine-grained PAT without the "SSH
signing keys" permission, or an Actions `GITHUB_TOKEN`, which has no such
permission at all) and skips the entire setup with a logged line — scopes
cannot be pre-checked, since gh exposes them only for classic PATs while
fine-grained and App tokens enumerate nothing — whereas any other failure
(network, 5xx) stays fatal like every other gh call in the script.
Identity gains unconditional fallbacks in the same sweep: a profile
without a public name or email would otherwise configure the literal
string `null` (gh's jq prints JSON null as text, which `-z` checks pass),
so `user.name` falls back to the login and `user.email` to the ID-based
noreply address `ID+LOGIN@users.noreply.github.com` — required for the
badge anyway, whose pipeline resolves the committer email to an account
(`no_user` and `unverified_email` are `verified:false` reasons) and which
the noreply address always satisfies. A partial first boot re-enters the
function with the pair already on disk: the pair is reused, never
regenerated (gh's registration is idempotent by key content, and every
write below is idempotent), with the public half rebuilt from the private
one should the crash have landed between the two files. Known boundaries,
accepted: every fresh `/nix` volume registers one more signing key on the
account — GitHub imposes no limit, cleanup needs the stronger
`admin:ssh_signing_key` scope, and deletion stays a manual note in the
README rather than a title-based dedup, which would demand `admin` from
every deployment and could delete a key a live volume still uses; rotation
likewise means reprovisioning, since the Bootstrap runs once per volume;
a 403 boot still leaves the generated key pair on disk — only the
registration and every config write are skipped; and the suite exercises
only the unconfigured no-token path end to end — the 403, opt-out and
configured paths need a real scoped token writing to a real account and
stay manual checks, while the pure helpers (identity fallbacks, principal,
enable predicate) are unit-tested by lifting them from the script by name.

## Amendments
