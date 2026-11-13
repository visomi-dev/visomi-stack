# Public email branding and BIMI

Email-body branding and the sender avatar are separate integrations. The shared
MJML layout uses a public PNG. Gmail sender branding additionally requires BIMI,
enforced DMARC and an issuer-provided VMC or CMC. Publishing a logo alone does
not activate the Gmail avatar.

## Sources and publication

`assets/brand` remains the source of truth for the approved artwork.
`assets/brand/public.json` selects the current email and BIMI derivatives and
explicitly lists every public file. Original artwork, editing files and unrelated
workspace files are not exposed.

The gateway build emits the allowlisted files into
`dist/apps/web/gateway/static/brand`. The existing Dockerfile includes that output
in the runtime image. `/static/brand/...` is available before authentication,
browser telemetry context and website rendering. It does not set session cookies.
Missing files, hidden files and directory requests return JSON 404s with
`Cache-Control: no-store`; they never become website documents.

Published assets use a one-year immutable cache policy. Only these public image
responses allow cross-origin embedding through `Cross-Origin-Resource-Policy`;
the application's existing document policy remains unchanged. The mount is
read-only and accepts GET/HEAD. No image URL contains recipient identifiers,
codes, signed access tokens or tracking parameters.

Email rendering receives the validated canonical origin from authentication
composition through `MAIL_ORIGIN`. It never uses an incoming Host header.
Standalone API deployments must publish the same assets at that configured
origin. Local source-based gateway serving uses `STATIC_ASSETS_PATH` to point to
the compiled static directory; the production executable resolves it relative to
its own compiled module by default.

## Updating artwork without breaking old mail

1. Add a new version directory, rather than changing an existing public file.
2. Append its path to `files` in `public.json`. Keep all previously published
   paths and bytes. Update `emailLogo` or `bimiLogo` when the new version is ready.
3. Regenerate the committed MJML output with
   `pnpm nx run backend-shared:emails-build`.
4. Review the rendered email and run the branding, mail and gateway checks.

The initial PNG is an opaque, white-backed export of the approved horizontal
mark, including padding. Its 412 × 104 pixels render at 206 × 52 pixels. The
image stays legible without relying on email-client CSS inversion. The sender
name, footer and plain-text alternative remain useful when remote images are
blocked. The initial export used ImageMagick 7.1.1-43:

```sh
magick -background white -density 144 assets/brand/logotype-stack.svg \
  -resize 388x80 -bordercolor white -border 12 -alpha remove -alpha off \
  -depth 8 -strip PNG24:assets/brand/email/v1/logotype-stack.png
```

This is an editing command, not a runtime or CI dependency. Future exports must
use a new version path. The initial BIMI derivative centers the approved isotype
on an opaque 512 × 512 square with a Tiny PS declaration and descriptive text.
It is a candidate for issuer validation, not a certified mark.

CI runs `web-gateway:brand-check` as a build prerequisite. It checks the allowlist,
PNG format/dimensions/size, basic SVG policy, public certificate formatting when
present, and regression tests. With CI's `NX_BASE`, it also compares previously
published files against Git and rejects changed bytes or removed paths. The
generated-email check detects a stale logo reference. Nx inputs include the
manifest and assets, and deployment-selection tests ensure an asset change
selects the production-container check. Railway already watches `assets/brand`.

`web-gateway:container-check` and `tools/deployment/smoke.mjs` verify public bytes,
MIME types, cache headers, HEAD requests, absent cookies and 404 boundaries in
the actual runtime image. After deployment, run the smoke check against its
public origin before treating the release as ready.

Old emails can outlive deployments. A rollback image must retain all published
versions, including assets introduced by the release being rolled back. Rebuild
the previous application code with the retained asset catalog, or publish new
assets in a preceding release. Redeploying an older image that predates an asset
can break mail already sent with that URL; the container filesystem does not
provide persistent asset retention by itself.

## BIMI activation

The repository prepares the public logo and checks. It does not buy certificates,
change a domain-wide mail policy, or publish an incomplete DNS record during an
application build.

1. Review all legitimate sending services and DMARC reports. Verify aligned
   SPF/DKIM and DMARC using delivered message headers. One passing message does
   not establish that every sending service is ready for enforcement.
2. Obtain a VMC or CMC from a supported certificate authority. A VMC requires
   eligible trademark rights; a CMC has its own issuer eligibility requirements.
   Have the issuer validate the Tiny PS artwork and its binding to the mark
   certificate. If the issuer changes the artwork, publish it at a new version
   path rather than overwriting the candidate.
3. Add only the issuer's **public certificate chain** to a versioned BIMI
   directory and the public allowlist. Never commit a private key. The asset
   check rejects non-certificate PEM content. The live readiness check examines
   the active certificate's validity dates; retained historical certificates may
   expire without preventing an application build. Local checks do not establish
   CA trust or logo eligibility.
4. Deploy and verify the SVG and PEM HTTPS URLs, without authentication,
   redirects, expiring signatures or browser challenges.
5. After reviewing delivery impact, change the existing DMARC policy to
   `p=quarantine` or `p=reject` with `pct=100`. Preserve the domain's other policy
   and reporting settings. Keep environment inventory and report destinations
   in private operational records.
6. Publish one TXT record at `default._bimi.<sender-domain>`. For example, after
   replacing both URLs with the deployed, issuer-validated artifacts:

   ```text
   v=BIMI1; l=https://app.example.test/static/brand/bimi/v1/visomi.svg; a=https://app.example.test/static/brand/bimi/v1/mark.pem;
   ```

7. Run the read-only readiness check:

   ```sh
   pnpm nx run web-gateway:bimi-check --args="example.test https://app.example.test"
   ```

The check examines the exact sender domain's DMARC record and default BIMI
selector, the configured public SVG, and the certificate's availability and
validity dates. It exits unsuccessfully while prerequisites are missing. Its
output contains bounded readiness fields rather than message headers, DNS
report destinations or raw network errors. It does not verify the CA chain,
certificate policy, logo binding, inherited organizational-domain policies or
mailbox reputation. Use the issuer's validation and delivered-message checks
before calling BIMI active. No external DNS/network check is required for an
ordinary application PR to pass CI.

Gmail may take up to 48 hours to display a valid BIMI logo, and display remains
subject to mailbox-provider policy. A VMC and a CMC do not have identical badge
behavior. See [Google's BIMI setup requirements](https://knowledge.workspace.google.com/admin/security/set-up-bimi)
and [SVG requirements](https://knowledge.workspace.google.com/admin/security/create-a-bimi-svg-file-detailed-steps).
