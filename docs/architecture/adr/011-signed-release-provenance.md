# ADR 011: Signed Release Provenance and Update Verification

## Status

Proposed; production distribution is explicitly blocked pending the controls and
finding dispositions below.

## Decision

Every distributed `themis-agent` artifact and any separately distributed runtime
bundle is accompanied by a versioned `themis.release-manifest`. The manifest
contains the artifact name, byte length, SHA-256 digest, format/version, and a
key ID, plus a detached Ed25519 signature over its canonical JSON fields. The signing private
key is CI/release-owner material and is never stored in the repository, build
output, logs, telemetry, or an artifact.

The checked-in verifier in `scripts/release-verification.ts` is the
minimal verification contract for this phase. The configured `release:gate`
command is the CI/release gate: it scans the generated manifest, artifact,
signed key catalogue, generated metadata, logs, and telemetry before any
candidate verification succeeds. Verification must happen before
installing or replacing an agent. A missing manifest, unknown key, invalid
signature, digest/size mismatch, malformed manifest, or unsupported version is
a hard failure: retain the current installation, do not execute or unpack the
candidate, emit only a redacted failure class, and require a trusted operator
to obtain a corrected release. This records a recovery policy without adding
an automatic update mechanism.

The configured `.github/workflows/ci.yml` runs the gate after the Nx server
build has produced a tarred runtime artifact. CI creates an ephemeral,
controlled key catalogue and manifest for that generated artifact, supplies the
catalogue key and generated metadata/log/telemetry inputs, then runs the gate a
second time after inserting protected plaintext. The latter invocation must
fail; CI does not publish or roll out the artifact.

## Release and build boundaries

- Nx builds are the source build checks. The repository currently has no Nx
  release target; release signing is an explicit post-build, CI-owned step.
- The Angular authenticated app, API, server, realtime, and worker are
  authenticated product/runtime distributions and must use the same manifest
  policy if distributed independently.
- The public Astro site is a separately deployable public artifact. Its
  deployment identity and content do not grant trust to the authenticated app
  or local agent.
- Generated catalogs, migrations, copied workspace modules, lockfiles, and
  other generated output are reviewed as release inputs. A generated artifact
  is not trusted merely because it was produced by a local build; it must be
  covered by the release manifest or excluded from distribution.

## Trusted key distribution and rotation

The release channel publishes a signed, versioned public-key catalogue containing
key IDs, validity windows, and the next key before rotation. The catalogue is
distributed independently of the candidate artifact through the release control
plane and pinned by the installer; an unknown key ID, expired key, revoked key,
or catalogue signature failure is a hard failure. Rotation requires overlap of
the old and new trusted IDs. Security can emergency-revoke an ID in the
catalogue; installers reject it immediately and retain the current install.
The catalogue signature is authenticated with a separately pinned catalogue
signing public key; a failed catalogue signature is a hard failure, not an
empty or partially trusted catalogue.

## Supply-chain review and ownership

| Review surface                     | Current control                                                                                           | Owner          | Remediation / decision                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| Direct and transitive dependencies | `pnpm-lock.yaml` plus `pnpm audit` in release review                                                      | Release owner  | Triage high/critical findings before production distribution; document accepted dev-only exceptions |
| Nx plugins and build tools         | Pinned Nx/plugin versions and resolved project targets                                                    | Build owner    | Review plugin upgrades and generated output before each release                                     |
| Generated artifacts                | Nx output and generated docs/migrations are diff-reviewed                                                 | Build owner    | Add a CI provenance attestation when a production registry is selected                              |
| Signing key custody                | External CI secret or offline release key; no repository key                                              | Security owner | Choose rotation, escrow, and compromise-revocation procedure before production                      |
| Telemetry/logging                  | Verification reports status classes only; never paths containing secrets, manifest contents, or key bytes | Runtime owner  | Confirm retention and alert routing in the operational telemetry decision                           |

The current audit is a review input, not a claim that the dependency tree is
clear. The 2026-08-19 remediation run fixed the critical advisory and all nine
high findings. `pnpm audit --json` now reports 0 critical, 0 high, 2 moderate,
and 2 low findings across 2,232 resolved packages. The remaining Astro 6 and
`@astrojs/node` 10 findings are retained for compatibility and remain a
production release blocker until the Astro runtime can be upgraded safely.
Historical triage deadlines for the previously open critical/high set were:

| Findings   | Owner                                          | Deadline   | Exception policy                                                                                   |
| ---------- | ---------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| 2 critical | Security owner                                 | 2026-08-25 | No exception; release blocked until fixed or vendor-confirmed false positive                       |
| 46 high    | Release owner, with build owner for Nx/tooling | 2026-09-01 | Only a documented, compensating, 30-day exception approved by Security; no release while untriaged |

The exact advisory IDs and dispositions must be attached to the release review;
the counts alone are not a clearance. The fixed critical advisory was
`GHSA-xv26-6w52-cph6`; the nine high advisories fixed in this run were
`GHSA-gcq2-9pq2-cxqm`, `GHSA-vmh5-mc38-953g`, `GHSA-vxpw-j846-p89q`,
`GHSA-hm92-r4w5-c3mj`, `GHSA-fx2h-pf6j-xcff`, `GHSA-f88m-g3jw-g9cj`,
`GHSA-4cwx-7wf7-3272`, and `GHSA-vp3h-ghgh-jr7g` (the audit collapsed one
duplicate advisory path). The remaining advisories are `GHSA-f48w-9m4c-m7f5`,
`GHSA-4g3v-8h47-v7g6`, `GHSA-r557-wffq-wvrc`, and `GHSA-7pw4-f3q4-r2p2`.

The 2026-08-18 `pnpm audit --json` result identifies these critical advisories:
`GHSA-23hp-3jrh-7fpw`, `GHSA-xv26-6w52-cph6`; both are **untriaged and
release-blocking**. The high advisories are:
`GHSA-28wg-ghj8-5hjv`, `GHSA-2m8v-j782-fhvr`, `GHSA-2p49-hgcm-8545`,
`GHSA-2v37-7h3g-55p8`, `GHSA-395f-4hp3-45gv`, `GHSA-3jxr-9vmj-r5cp`,
`GHSA-4c8g-83qw-93j6`, `GHSA-4cwx-7wf7-3272`, `GHSA-52cp-r559-cp3m`,
`GHSA-5p2g-fcmc-qvqq`, `GHSA-5p4m-2wfm-xmqj`, `GHSA-7c78-jf6q-g5cm`,
`GHSA-7p8r-x3mc-p8w7`, `GHSA-88fw-hqm2-52qc`, `GHSA-8x88-c5mf-7j5w`,
`GHSA-96hv-2xvq-fx4p`, `GHSA-f88m-g3jw-g9cj`, `GHSA-fx2h-pf6j-xcff`,
`GHSA-gcfj-64vw-6mp9`, `GHSA-gcq2-9pq2-cxqm`, `GHSA-hm92-r4w5-c3mj`,
`GHSA-hmw2-7cc7-3qxx`, `GHSA-mh99-v99m-4gvg`, `GHSA-mwp4-54f8-5fhr`,
`GHSA-r28c-9q8g-f849`, `GHSA-rgw5-rvv9-x895`, `GHSA-v2hh-gcrm-f6hx`,
`GHSA-v56q-mh7h-f735`, `GHSA-vmh5-mc38-953g`, `GHSA-vp3h-ghgh-jr7g`,
`GHSA-vpx6-8pjr-4g3v`, `GHSA-vxpw-j846-p89q`, `GHSA-w3rx-r6r6-pgpr`,
`GHSA-x9g3-xrwr-cwfg`, and `GHSA-xvcm-6775-5m9r`; all are **untriaged and
release-blocking** pending owner disposition. Duplicate package-path findings
are collapsed by advisory ID, while the audit count remains the release gate.

## Open decisions and blockers

1. Security owner: select the production signing-key custody, rotation, and
   emergency revocation mechanism.
2. Release owner: define the trusted public-key distribution channel and key
   identifier rotation format.
3. Build owner: add CI provenance attestations after the hosting/registry is
   selected; until then, the absence of an attestation is an explicit release
   block, not an implicit approval.
4. Runtime owner: approve telemetry retention and alert routing for redacted
   verification failure classes.
5. Security and release owners: disposition all high/critical audit findings
   or record an explicit, time-bounded exception before production.

## Redaction and negative verification gate

The verifier reports only stable failure classes (`malformed-manifest`,
`unknown-key`, `invalid-signature`, or `artifact-mismatch`). It never reports
candidate paths, manifest contents, key bytes, protected plaintext, or
untrusted stderr. The controlled invalid-update fixture proves verification
precedes unpack and execute and that the current installation remains in place.
Release CI must scan manifests, archives, generated release metadata, logs, and
telemetry fixtures for private-key material, credential-shaped values, and
protected plaintext; a match fails the gate. The public Astro deployment is
reviewed as a public artifact only, while authenticated Angular/runtime bundles
and themis-agent use the signed distribution policy.
