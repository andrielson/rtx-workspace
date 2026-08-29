BASH_ENV_FILE="${HOME}.bash_env"

if [[ -s ${BASH_ENV_FILE} ]]; then
  source "${BASH_ENV_FILE}"
fi

# brew shellenv is evaluated for its side effects; a failure surfaces on the
# next brew invocation.
# shellcheck disable=SC2312
if [[ -z ${HOMEBREW_REPOSITORY:-} ]] && [[ -s /home/linuxbrew/.linuxbrew/bin/brew ]]; then
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"
fi

# NVM_DIR comes from the image environment (Dockerfile ENV), never from an
# assignment in this script.
# shellcheck disable=SC2154
if [[ -z ${NVM_BIN:-} ]] && [[ -s "${NVM_DIR}/nvm.sh" ]]; then
  source "${NVM_DIR}/nvm.sh"
fi

# SDKMAN_DIR likewise comes from the image environment (Dockerfile ENV).
# shellcheck disable=SC2154
if [[ -z ${SDKMAN_PLATFORM:-} ]] && [[ -s "${SDKMAN_DIR}/bin/sdkman-init.sh" ]]; then
  source "${SDKMAN_DIR}/bin/sdkman-init.sh"
fi
