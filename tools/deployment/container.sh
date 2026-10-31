#!/usr/bin/env bash
set -euo pipefail

engine=${CONTAINER_ENGINE:-docker}
image=visomi-stack:ci
container=visomi-stack-ci-$$

"$engine" build --target runtime --tag "$image" .
test "$("$engine" image inspect --format '{{.Config.User}}' "$image")" = node
"$engine" run --detach --read-only --tmpfs /tmp --name "$container" --publish 127.0.0.1::8080 "$image"
trap '"$engine" rm --force "$container" >/dev/null' EXIT
endpoint=$("$engine" port "$container" 8080/tcp)
origin=http://$endpoint

for attempt in $(seq 1 60); do
  if curl --fail --silent "$origin/api/" >/dev/null; then
    break
  fi
  sleep 1
done

node tools/deployment/smoke.mjs "$origin"
"$engine" exec "$container" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { existsSync } from "node:fs";
  assert.notEqual(process.getuid(), 0);
  for (const path of ["node_modules/nx", "node_modules/typescript", "node_modules/vitest", "/usr/local/bin/pnpm"]) {
    assert.equal(existsSync(path), false, "Build tooling must stay outside the runtime image");
  }
'
"$engine" stop --time 10 "$container" >/dev/null
test "$("$engine" inspect --format '{{.State.ExitCode}}' "$container")" = 0
