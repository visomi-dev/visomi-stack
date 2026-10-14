# Optional isolated extractors

The backend `shared` package exports `extractorManifest`, `runExtractor`, and
their types. This is an optional execution primitive: the template does not
discover plugins, expose an upload endpoint, select an image, or start a container
automatically. The caller authorizes the selected document and validates the
result according to its own domain.

## Caller contract

Approve and build an image locally, then use its immutable `sha256:` image ID or
repository digest in a version-1 manifest. The manifest requires an identifier,
`network: 'none'`, and `secrets: []`. Unknown fields, tags, mounts, network access,
and credential requests are rejected before any engine invocation.

```ts
import { z } from 'zod';

import { runExtractor } from 'shared';

const resultSchema = z.strictObject({ text: z.string().max(10_000) });

async function extractSelectedDocument(bytes: Uint8Array, approvedImageId: string, signal: AbortSignal) {
  const result = await runExtractor(
    { version: 1, id: 'document-text', image: approvedImageId, network: 'none', secrets: [] },
    bytes,
    { engine: 'podman', signal, parseResult: (value) => resultSchema.parse(value) },
  );

  return result;
}
```

Engine selection is trusted caller configuration, separate from the manifest.
Podman uses `--remote=false`. Docker defaults to the local Unix socket; a trusted
operator can supply `dockerSocket` for another local Unix socket, such as a
rootless daemon. Ambient remote-daemon settings do not select the destination.

The container receives one JSON request on standard input:
`{ "version": 1, "document": "<base64 bytes>" }`. It writes one UTF-8 JSON value
on standard output. Successful exit, valid JSON, and caller validation are all
required. This primitive does not interpret the result as an approved action or
persist it automatically.

## Execution limits

| Boundary              | Contract                                                           |
| --------------------- | ------------------------------------------------------------------ |
| Selected document     | Nonempty; at most 1,048,576 bytes                                  |
| Output                | At most 64,000 bytes each on stdout and stderr                     |
| Engine probe          | Ten seconds                                                        |
| Execution             | Thirty seconds after the local engine probe                        |
| Cleanup               | Ten seconds, awaited on success and failure                        |
| Network and host data | No network, host mounts, or passed-through environment variables   |
| Process authority     | UID/GID 65534, no capabilities, no privilege escalation            |
| Resources             | 64 processes, 256 MiB memory, one CPU, 16 MiB temporary filesystem |
| Filesystem            | Read-only root; writable no-exec/no-suid `/tmp`                    |

Only the invocation's randomly named container is removed. Cancellation, timeout
and output overflow kill the engine client, then remove that exact container.
Podman's `--time=0` avoids its default stop grace consuming the cleanup deadline.
The caller's input buffer is preserved. Errors use bounded codes such as
`plugin_invalid_output` or `plugin_cleanup_failed`; raw engine, stderr and
validation details are not returned.

Container isolation complements authorization and trusted image approval. The
host still needs an installed local engine with resource-limit support. The
result parser should be synchronous, bounded, and free of application writes.

## Verification

Ordinary `shared:test` runs mocked rejection, resource-bound, timeout, cancellation
and cleanup cases. Real Podman tests require an explicit locally built image:

```sh
podman --remote=false build --pull=never --network=none \
  --file libs/backend/shared/src/lib/plugins/fixtures/extractor-fixture.dockerfile \
  --tag localhost/stack-extractor-fixture \
  libs/backend/shared/src/lib/plugins/fixtures
export EXTRACTOR_ISOLATION_IMAGE="sha256:$(podman --remote=false image inspect localhost/stack-extractor-fixture --format '{{.Id}}')"
export NX_DAEMON=false
pnpm nx run shared:test --skip-nx-cache --args='--runInBand --testPathPatterns=plugins/extractor'
```

Use the inspected full image ID, not the tag, for the test environment variable.
The fixture verifies UID, capabilities, root filesystem, temporary storage,
network interfaces, absence of an ambient secret, output bounds, cancellation and
container cleanup. It preserves preexisting containers. Real Docker acceptance
and third-party image certification are separate operator checks.

The cleanup contracts follow the official
[Podman removal](https://docs.podman.io/en/latest/markdown/podman-rm.1.html) and
[Docker removal](https://docs.docker.com/reference/cli/docker/container/rm/)
documentation. The realtime lifecycle is documented separately in
[architecture](architecture.md).
