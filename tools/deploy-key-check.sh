#!/usr/bin/env bash
# Writes the deploy key from $DEPLOY_KEY to the file named by $1 and checks it,
# saying what's wrong in plain words (ssh itself only says "error in
# libcrypto"). Used by .github/workflows/deploy.yml. Prints the key's
# fingerprint, never the key.
set -uo pipefail
key="$1"
fail() { echo "::error title=SBREADER_DEPLOY_KEY::$1"; exit 1; }

[ -n "${DEPLOY_KEY:-}" ] || fail "The secret is missing or empty. Add it in UnweidlyKhan349/sbreader: Settings > Secrets and variables > Actions."

# Windows line endings and a missing final newline both make ssh reject a key.
printf '%s\n' "$DEPLOY_KEY" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' > "$key"
chmod 600 "$key"

if grep -q '^ssh-' "$key"; then
  fail "This is the public key (the .pub file). The secret needs the private key: the file without .pub."
fi
head -1 "$key" | grep -q -- '-----BEGIN .*PRIVATE KEY-----' \
  || fail "The secret doesn't start with a -----BEGIN ... PRIVATE KEY----- line. Paste the whole private key file, first line to last."
tail -1 "$key" | grep -q -- '-----END .*PRIVATE KEY-----' \
  || fail "The secret doesn't end with an -----END ... PRIVATE KEY----- line, so it was cut off. Paste the whole private key file, first line to last."
[ "$(wc -l < "$key")" -gt 2 ] \
  || fail "The key is all on one line, so its line breaks were lost. Paste the file as it is, line breaks included."

if ! ssh-keygen -y -P '' -f "$key" > "$key.pub" 2> "$key.err"; then
  if grep -qi 'passphrase' "$key.err"; then
    fail "The key has a passphrase, and Actions can't type one. Make a new key with no passphrase (ssh-keygen -t ed25519 -N '' -f sbreader_deploy) and replace both halves."
  fi
  fail "ssh can't read the key ($(sed 's/^Load key "[^"]*": //' "$key.err" | tr '\n' ' ')). It's probably damaged; make a new one and replace both halves."
fi

echo "Deploy key is readable. Its fingerprint, to compare with sbreader/sbreader.github.io > Settings > Deploy keys:"
ssh-keygen -lf "$key.pub"
