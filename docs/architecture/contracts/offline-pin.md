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

The authenticated application shell discovers existing local wrapping metadata after
browser rendering and offers unlock for closed vaults, including when entering Home
rather than the persistence example. It does not initialize or convert vaults. A
resource screen owns its contextual prompt, avoiding duplicate forms in the shell.
The global lock action remains available in the authenticated shell.

The synthetic example offers PIN setup with confirmation and an English/Spanish
explanation only when no local binding exists and PRF is unavailable. WebAuthn client
capabilities are advisory: `extension:prf` permits trying PRF, not assuming the chosen
authenticator supports it. Older clients with no capability API try PRF first; an
explicit unsupported-PRF result enables PIN setup. User cancellation does not.
An existing PIN binding still uses PIN if the browser later gains PRF support; an
existing PRF binding never offers PIN reinitialization when PRF is unavailable.
PIN initialization never overwrites a key or silently substitutes another identity.
Conversion requires a future explicit migration/enrollment flow.

Application key and independent signing custody are owned by the account-bound
`VaultSession`, not the routed example component. Ordinary navigation synchronously
aborts old work, clears plaintext/drafts and closes replica connections, retaining
only already authenticated in-memory custody. Reentering the same scope restores
its local replica and requested object without another PIN/PRF ceremony, after
checking the latest local binding and independent generation pin. Other scopes
remain independently locked. Failed local unlock cleans up its own binding rather
than locking unrelated opened scopes. Late local opens close their own connection without
locking retained custody now used by a newer view. An incomplete device-custody
unlock does not count as a fully opened application vault. Account/version changes,
logout, explicit lock and full document reload require unlock again; a canceled or
query-only navigation does not by itself discard an already opened vault.

The standalone reusable panel intentionally keeps its own scoped custody/display
for independent mounted consumers. It is not the application's entry prompt and
does not share its editor state or infer enrollment policy.

Initial workspace creation and device enrollment require an authorized online
session. Later PIN unlock restores existing local keys/custody/pins without a
network call, inside an already signed-in browser session. It supports local reads
and encrypted pending writes offline. The shell's PIN unlock also performs no API
call. Existing PRF vaults obtain the configured RP ID from the authorized policy
endpoint. A fresh offline browser login/PWA boot/SSR session is not implemented
by this feature. Synchronization subsequently enforces
server authorization, revocation and generation/epoch checks; an offline client
cannot know about revocations it has not received. Pending changes survive errors.

Local key discovery selects the highest retained wrapper. A wrapper older than
the independent replica generation pin is rejected. AEAD and checkpoint checks
remain in force. An authorized online roster epoch is persisted monotonically in
the existing replica pin before starting synchronization; interrupted navigation
cannot forget that floor. This advances no cursor/checkpoint/generation and does
not modify encrypted units or outboxes. Removing all client state still removes local trust anchors;
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
implementation. Service/component checks cover client capability selection,
generation pins, startup discovery races, retained custody, connection cleanup,
account isolation and target changes. Browser coverage enters Home with closed
custody, unlocks offline, navigates away/back with an opened vault, and explicitly
locks/reopens it. Authenticated end-to-end coverage audits ciphertext-only IndexedDB and
transport and exercises the deployed CSP. Final commands/results are recorded in
the PR and VIS-79 after execution.

Independent review of the PIN profile and implementation remains a release gate,
as do existing global nonce accounting, Nive recovery, retention/backup erasure,
privacy and production-acceptance decisions. No merge, deployment, provider change
or live migration is authorized or performed by this implementation.

References: [Argon2 RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[CSP3 WebAssembly compilation](https://www.w3.org/TR/CSP3/#can-compile-wasm-bytes),
[WebAuthn client capabilities](https://www.w3.org/TR/webauthn-3/#sctn-getClientCapabilities).
