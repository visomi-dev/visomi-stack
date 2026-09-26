# Form and Authentication UX Review

Reviewed on 2026-09-15 against the current implementation and the legacy `nive-v4` form controls.

## Implemented and Verified

- Password registration is a full-width alternative visible before an email is entered. `?method=password` preserves the selected screen across reloads and browser navigation.
- Passkey signup creates the credential first and requires email verification before activating the account. The sequence is a product decision, not a universal FIDO requirement.
- Field errors remain collapsed while editing, with negative margin compensating the grid gap and an animated height on reveal after blur. Error icons and text are vertically centered.
- Radio options support icons, descriptions, responsive layout, individual disabled options, and field-level disabled/loading state.
- Radio cards use the native radio as their only keyboard target. Space does not clear a selected radio, and arrow navigation updates the Signal Forms value.
- New passwords accept a minimum of 12 characters. The password indicator distinguishes the length requirement from its strength estimate.

## External Comparison

| Decision                                               | Finding                                                                                                                                                                                                                                                                                  | Source                                                                                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Avoid email errors while the user is still typing      | Supported. Premature validation can report errors before a user has finished entering a value. Blur is a reasonable trigger for this form.                                                                                                                                               | [NN/G: Hostile Patterns in Error Messages](https://www.nngroup.com/articles/hostile-error-messages/)                                          |
| Display contextual errors and live password guidance   | Supported. Errors should be actionable and near the field. Password guidance can update during typing without treating each incomplete value as an error.                                                                                                                                | [NN/G: Reporting Errors in Forms](https://www.nngroup.com/articles/errors-forms-design-guidelines/)                                           |
| Native radio keyboard behavior                         | Supported. Tab enters/leaves the group; arrows move and select; Space selects without toggling the current selection off.                                                                                                                                                                | [W3C APG: Radio Group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)                                                                       |
| Radio labels, grouping, and descriptions               | Supported by fieldset/legend and per-option hint examples. Do not automatically select an answer in a new question unless there is a justified existing value.                                                                                                                           | [GOV.UK: Radios](https://design-system.service.gov.uk/components/radios/)                                                                     |
| Passkey-first account creation with a visible fallback | Supported. Explain passkeys before the OS prompt, and allow people who decline them to use another authentication method. FIDO does not prescribe this application's exact email-verification order.                                                                                     | [FIDO: New Account Creation with a Passkey](https://fidoalliance.org/design-guidelines/optional-patterns/new-account-creation-with-a-passkey) |
| URL parameter for the chosen method                    | An implementation choice that makes navigation reproducible. These sources do not require a particular parameter or route structure.                                                                                                                                                     | Application navigation tests                                                                                                                  |
| Twelve-character password minimum                      | Product requirement, not a general NIST compliance claim. NIST requires 15 characters for single-factor passwords, permits a minimum of eight when passwords are only used in MFA, and disallows email for out-of-band authentication. Email-address verification is a separate purpose. | [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)                                                                           |
| No mandatory character-mixture rules                   | Aligned with NIST's prohibition of additional composition rules. Allowing paste, autofill, and password managers should remain part of the form behavior.                                                                                                                                | [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)                                                                           |

## Follow-up Recommendations

1. **Submission feedback — implemented:** authentication submit buttons allow invalid submissions to reveal actionable errors. The shared form marks fields touched, focuses an error summary, and prevents invalid requests from reaching the backend. Busy states still disable actions. [NN/G: Disabled Buttons](https://www.nngroup.com/videos/why-disabled-buttons-hurt-ux-and-how-to-fix-them/)
2. **Strength estimate — implemented:** `zxcvbn-ts` replaces the character-category heuristic and recognizes dictionary words, common passwords, substitutions, sequences, and repetitions. Its code and dictionaries load on demand; estimation is local and separate from the 12-character requirement. This is not a breach-database lookup or a server-side blocklist.
3. **Correction feedback:** suppressing premature errors is supported, but hiding a previously shown error on focus is not universally recommended. Test whether keeping an existing message visible during correction improves comprehension without causing layout jumps.
4. **Passkey explanation:** describe device PIN, fingerprint, or face verification in plain language before the OS prompt. Do not imply that every supported passkey is stored only on the current device.
5. **Unavailable choices:** keep a short explanation near disabled radio options. Prefer vertical layout for long descriptions; responsive columns remain optional.
6. **Accessibility verification:** keyboard and layout checks passed in Chromium, but this is not a full WCAG conformance audit or a screen-reader/device compatibility certification.

## Verification for the Latest Changes

- `pnpm nx run app:vite:test --run`: 76 passed, 1 existing skipped test; heuristic-score tests were replaced with estimator behavior tests.
- `pnpm nx run-many -t lint --projects=app,app-e2e --fix`: passed.
- `pnpm nx run app-e2e:e2e --reporter=list`: 19 passed in Chromium; dependent production builds passed. Coverage includes invalid submissions without API mutations, focused summaries, password-strength guidance, registration, radio navigation, Back from password verification, and signup email cooldown across sessions.
- `pnpm nx run api:test --runInBand`: 71 passed, including email delivery quota and cooldown regressions.
- `pnpm nx run app:extract-i18n`: passed.
- Screenshots inspected: `tmp/auth-captures/registration-options-mobile.png` and `tmp/auth-captures/radio-controls-mobile.png`. Desktop captures are also saved alongside them.

## Review Follow-up

- Passkey signup now uses the session-bound destination for shared OTP delivery quotas and a destination cooldown. New sessions cannot reset these counters. The limiter retains the existing process-local storage model; this change does not introduce distributed enforcement.
- Validation feedback is separate from the general submitted flag and is cleared before emitting a valid submission. Programmatic model clearing no longer creates a new error summary.
- Removing the password query parameter abandons both credential entry and factor verification, clears local flow state, and ignores a late credential-submission response.
