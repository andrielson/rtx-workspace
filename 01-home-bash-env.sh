BASH_ENV_FILE="${HOME}.bash_env"

if [ -s "${BASH_ENV_FILE}" ]; then
  source "${BASH_ENV_FILE}"
fi

if [ -z "${HOMEBREW_REPOSITORY:-}" ] && [ -s /home/linuxbrew/.linuxbrew/bin/brew ]; then
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv bash)"
fi

if [ -z "${NVM_BIN:-}" ] && [ -s "${NVM_DIR}/nvm.sh" ]; then
  source "${NVM_DIR}/nvm.sh"
fi

if [ -z "${SDKMAN_PLATFORM:-}" ] && [ -s "${SDKMAN_DIR}/bin/sdkman-init.sh" ]; then
  source "${SDKMAN_DIR}/bin/sdkman-init.sh"
fi
