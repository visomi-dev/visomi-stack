# Explicit offline PIN unlock — VIS-79

Michael selected a short PIN (4–6 decimal digits) with offline use as an alternative
for clients without passkeys/PRF. This is an explicit product choice after explaining
that copied encrypted storage permits offline enumeration. It is not equivalent to
PRF, an independent audit, or production security approval.

## Cryptographic and storage profile

`pin-argon2id` identifies one fixed profile: Argon2id v19, 64 MiB, three iterations,
parallelism one, 32-byte output and a random 32-byte salt encoded as `methodId`.
Parameters are fixed by the method rather than accepted from untrusted storage.
`hash-wasm` 4.12.0 is already installed. Only one derivation runs at a time in a JS
module instance, bounding application memory use; this is not an attacker limit.

The derived secret feeds the existing contextual HKDF-SHA-256/AES-256-GCM wrapper.
Data keys remain random 256-bit keys; the PIN never directly encrypts data. The
existing wrapping AAD binds product/domain/key scope/generation, owner, device,
origin and unlock method. Existing PRF/recovery bytes are unchanged. Old clients
reject an unknown method; PIN interoperability requires this new adapter.

PIN bytes are disposable and cleared after use. A derived secret may remain in
memory while unlocked so historical wrappers can be opened; lock/cancel/teardown
clear its byte array. Managed strings, WebAssembly/runtime memory and browser
copies cannot be guaranteed physically erased. No raw PIN, derived secret or
plaintext is persisted or uploaded. Device signing identity stays in an independent
local custody vault, protected by the selected unlock method, never a shared DEK.

No numeric PIN policy can create high entropy: four digits have 10,000 combinations
and six digits have 1,000,000. Argon2 increases each guess's cost; it does not make
an offline attack impossible. UI attempt limits, hashing and server rate limits do
not protect an exported/stolen local wrapper. No such guarantee is claimed.

## Lifecycle and frontend

The synthetic example offers explicit PIN setup with confirmation and an English/
Spanish explanation of this limitation. PRF remains available without an automatic
fallback or conversion. PIN initialization never overwrites an existing key or
silently substitutes a new identity. Selecting PIN for an existing PRF resource
requires a future explicit migration/enrollment flow, not reinitialization.

Initial workspace creation and device enrollment require an authorized online
session. Later PIN unlock restores existing local keys/custody/pins without a
network call, inside an already signed-in browser session. It supports local reads
and encrypted pending writes offline. A fresh offline browser login/navigation/SSR
session is not implemented by this feature. Synchronization subsequently enforces
server authorization, revocation and generation/epoch checks; an offline client
cannot know about revocations it has not received. Pending changes survive errors.

Local key discovery selects the highest retained wrapper. A wrapper older than
the independent replica generation pin is rejected. AEAD and checkpoint checks
remain in force. Removing all client state still removes local trust anchors;
this method introduces no server-trusted reset or expired-history bootstrap.

The reusable vault panel accepts PIN contexts supplied by its consumer. Inputs
clear on submit, lock and target changes; late completions cannot publish into a
new target. PIN changes, account-password reset, recovery and remote device
administration are separate flows and are not supplied implicitly.

Argon2 requires WebAssembly. The Angular document CSP opts into
`'wasm-unsafe-eval'`, retaining nonces, blocked script attributes and the prohibition
on JavaScript `'unsafe-eval'`/`'unsafe-inline'`. Website/API policies remain opted
out. Browsers lacking required Web Crypto, IndexedDB, WebAssembly or this CSP
capability fail explicitly; no weaker KDF is selected automatically.

## Evidence and release gates

Tests cover real browser encryption/local custody, offline reopen without
WebAuthn, wrong PIN with data preservation, context substitution and cancellation;
a public synthetic vector compares the browser KDF with Node's independent Argon2
implementation. Service/component checks cover generation pins, connection cleanup and target
changes. Authenticated end-to-end coverage audits ciphertext-only IndexedDB and
transport and exercises the deployed CSP. Final commands/results are recorded in
the PR and VIS-79 after execution.

Independent review of the PIN profile and implementation remains a release gate,
as do existing global nonce accounting, Nive recovery, retention/backup erasure,
privacy and production-acceptance decisions. No merge, deployment, provider change
or live migration is authorized or performed by this implementation.

References: [Argon2 RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[CSP3 WebAssembly compilation](https://www.w3.org/TR/CSP3/#can-compile-wasm-bytes).
