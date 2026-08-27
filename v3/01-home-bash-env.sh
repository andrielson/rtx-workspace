BASH_ENV_FILE="${HOME}.bash_env"

if [ -s "${BASH_ENV_FILE}" ]; then
  . "${BASH_ENV_FILE}"
fi