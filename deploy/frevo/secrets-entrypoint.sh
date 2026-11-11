#!/bin/sh
# For every FOO_FILE variable, exports FOO with the file's contents. It serves
# docker compose: the keys arrive as files in /run/secrets, and the code reads
# the same variables it reads on Railway (OPENROUTER_API_KEY, FAL_KEY, ...).
# On Railway no *_FILE exists, so this only `exec`s. Never prints a value.
set -eu
for name in $(env | sed -n 's/^\([A-Z][A-Z0-9_]*\)_FILE=.*/\1/p'); do
  eval "file=\${${name}_FILE}"
  if [ -r "$file" ]; then
    # $(...) drops the trailing newline, if any.
    value="$(cat "$file")"
    export "${name}=${value}"
  else
    echo "secrets-entrypoint: ${name}_FILE points at an unreadable file; ${name} stays unset" >&2
  fi
done
exec "$@"
