BASH_ENV_FILE="${HOME}.bash_env"

if [[ -s ${BASH_ENV_FILE} ]]; then
  source "${BASH_ENV_FILE}"
fi
