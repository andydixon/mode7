# Security Audit Report

## 1. Executive Summary

MODE 7 is a small, client-only static application with no backend, authentication, database, package manager, CI configuration, or deployment manifest in scope. Its attack surface is therefore limited primarily to browser resource loading, keyboard-event handling, story-data processing, canvas rendering, and the integrity of files served from the same origin.

Two low-severity findings were confirmed and fixed. Buffered keyboard events could grow without a defined bound, and the entry document did not establish browser resource or referrer policies. Regression tests now cover both controls. No Critical, High, or Medium findings were identified.

Residual risk is mainly operational: anti-framing controls, HSTS, MIME-sniffing protection, and other response headers must be verified on the eventual hosting platform because this repository contains no server configuration.

## 2. Scope Reviewed

- `index.html`, `css/style.css`, and the local OpenType font.
- `js/main.js`, `js/core/teletext.js`, and `js/story/story.js`.
- `js/story/story.json`, including all 62 scenes and 887 steps.
- `README.md`, git history, repository status, and newly added security tests.
- No dependency manifests, lockfiles, backend services, infrastructure-as-code, container files, CI/CD files, environment files, or deployment configuration were present.

## 3. Methodology

- Manual static review of browser event handling, asynchronous waiters, queues, rendering, input length controls, dynamic text substitution, network access, and error handling.
- Automated searches for dangerous DOM APIs, dynamic code execution, storage, cross-window messaging, external network use, and likely secret patterns.
- Structural validation of the story graph, step types, start scene, `goto` targets, and branch targets.
- Denial-of-service analysis of loops, timers, key queues, canvas dimensions, text wrapping, glitch rounds, and story pacing.
- Supply-chain review of repository manifests and binary assets.
- Focused Node regression tests for the applied fixes.

## 4. Risk Rating Method

Severity reflects practical exploitability and impact in the deployed client-only architecture. Confidence reflects the strength of direct code evidence. Issues requiring same-origin code execution or modification of trusted repository content were not overstated as remote vulnerabilities.

## 5. Findings Summary Table

| ID | Severity | Confidence | Title | Component | Status |
|---|---|---|---|---|---|
| SEC-001 | Low | High | Unbounded buffered keyboard-event queue | `TeletextTerminal._pushKey` | Fixed |
| SEC-002 | Low | High | Missing browser resource and referrer policies | `index.html` | Fixed |

## 6. Detailed Findings

### Finding ID: SEC-001

#### Title

Unbounded buffered keyboard-event queue

#### Severity

Low

#### Confidence

High

#### Affected Files / Components

- `js/core/teletext.js`, keyboard state initialization and `TeletextTerminal._pushKey`.
- Fixed at lines 81-83 and 808-829 in the audited revision.

#### Description

When no consumer was waiting, every accepted keyboard event was appended to `_keyQueue` with no maximum length. Browser key repeat, synthetic events from an embedding context or extension, or prolonged typing during output could retain unnecessary event objects for the lifetime of the page.

#### Evidence

The original `_pushKey` path ended with an unconditional `_keyQueue.push(evt)`. The fixed code validates event shape, sets `_maxKeyQueue` to 64, and discards the oldest event before adding a new one when the limit is reached.

#### Attack Scenario

A sustained stream of keydown events is delivered while the story is not consuming input. Before the fix, each event increased retained memory. The practical impact is constrained by the browser and local nature of the application, but the resource use had no application-level ceiling.

#### Impact

Gradual client-side memory growth and degraded responsiveness. This does not affect a server or other users.

#### Recommendation

Retain the fixed queue bound and event-shape validation. Keep the limit small enough to prevent stale input from affecting later prompts.

#### Safer Example

```js
if (this._keyQueue.length >= this._maxKeyQueue) this._keyQueue.shift();
this._keyQueue.push(evt);
```

#### Suggested Tests

- Push substantially more than 64 valid events and assert the queue remains at 64.
- Push null, unknown, and multi-character events and assert they are rejected.
- Verify a waiting consumer still receives the next valid event immediately.

#### References

- CWE-770: Allocation of Resources Without Limits or Throttling.
- OWASP denial-of-service resource-management guidance.

#### Assumptions / Limitations

The current page contains no third-party scripts. Synthetic same-origin script execution would already imply broader control of the application, so severity remains Low.

### Finding ID: SEC-002

#### Title

Missing browser resource and referrer policies

#### Severity

Low

#### Confidence

High

#### Affected Files / Components

- `index.html`, document `<head>`.
- Fixed at lines 4-9 in the audited revision.

#### Description

The entry document did not define a Content Security Policy or referrer policy. Although the current application does not use dangerous HTML injection APIs and loads only local resources, the browser had no explicit policy limiting future or injected resource execution and could send the page URL as a referrer during later changes.

#### Evidence

The fixed document now sets `Referrer-Policy` through a meta element and a CSP that limits scripts, styles, fonts, connections, and images to required sources while blocking objects, media, workers, forms, frames, and base-URL changes. The policy appears before the font preload and executable resource references.

#### Attack Scenario

A future content-injection defect or accidental third-party resource reference would have had no document-level execution boundary. With the policy, unauthorized external scripts and most unnecessary resource types are rejected by supporting browsers.

#### Impact

Reduced defense in depth against content injection and reduced control over outbound URL disclosure. No exploitable HTML injection sink was found in the current code.

#### Recommendation

Retain the meta policy for local/static use. In production, send CSP and Referrer-Policy as HTTP response headers. Add `frame-ancestors 'none'` or an explicit allowlist in the response-header CSP; this directive is not enforceable through a meta CSP.

#### Safer Example

```html
<meta name="referrer" content="no-referrer" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; object-src 'none'; base-uri 'none'; script-src 'self'; style-src 'self'" />
```

#### Suggested Tests

- Assert the entry document contains `script-src 'self'`, `object-src 'none'`, and `base-uri 'none'`.
- In deployed environments, inspect response headers and verify blocked-resource CSP tests in a browser.

#### References

- CWE-693: Protection Mechanism Failure.
- OWASP Top 10 A05:2021, Security Misconfiguration.

#### Assumptions / Limitations

Meta CSP cannot provide `frame-ancestors`, HSTS, `X-Content-Type-Options`, or all other server response protections. Hosting configuration was not available for review.

## 7. Denial-of-Service Review

The unbounded keyboard queue was fixed under SEC-001. Timed key waiters remove themselves on timeout, avoiding stale waiter accumulation. User text lengths are limited by story configuration, fixed-coordinate rendering stops at the canvas boundary, and the current story's largest glitch burst is 24 rounds. No catastrophic regular expressions, recursion, decompression, file upload, network retry, queue-worker, or backend resource risks exist in scope.

Story JSON remains trusted same-origin application data. If story authors become untrusted, add schema validation and hard limits for scene steps, pause durations, glitch rounds, coordinates, and input lengths.

## 8. Dependency and Supply-Chain Review

No third-party JavaScript or CSS dependencies, package manifests, lockfiles, registries, or build scripts are present. All runtime resources are same-origin. `fonts/font.otf` is a committed binary OpenType asset with SHA-256 `6877c7ece6d55b11a63f8be1250013bc487356b119f72a9395b6475972c98e5a`; its upstream provenance and update process cannot be established from repository metadata and should be documented.

## 9. Secrets and Sensitive Data Review

No credentials, private keys, tokens, environment files, or likely embedded secrets were found. Matches for “secrets” in `story.json` are narrative text. The application does not persist or transmit player input.

## 10. Authentication and Authorisation Review

Not applicable to the current client-only application. There are no accounts, sessions, roles, protected routes, APIs, administrative functions, or tenant boundaries.

## 11. Input Validation and Output Encoding Review

Keyboard input is restricted to single key events and text entry rejects non-printable ASCII and enforces configured maximum lengths. Player text is rendered to a canvas, not inserted into the DOM, so HTML/DOM XSS sinks were not found. Player strings can contain teletext markup tokens such as `[RED]`, but this only changes the user's local canvas presentation and does not execute code or cross a privilege boundary.

The story graph validation found no missing start, `goto`, or branch targets. No `eval`, `Function`, `innerHTML`, `document.write`, command execution, SQL, template engine, path access, unsafe deserialization, or cross-origin message handling was found.

## 12. Infrastructure and Deployment Review

No deployment files were available. Production hosting must be checked manually for HTTPS-only delivery, HSTS, `X-Content-Type-Options: nosniff`, an HTTP CSP including `frame-ancestors`, an appropriate `Permissions-Policy`, cache policy, correct MIME types, and compression/resource limits. The added meta CSP is useful defense in depth but is not a replacement for response headers.

## 13. Logging, Monitoring, and Error Handling Review

Fatal client errors are logged to the browser console and shown on the canvas. The displayed message is not inserted into HTML. There is no remote telemetry, so operational failures and CSP violations are not centrally visible. If telemetry is later introduced, avoid collecting player-entered story responses and define retention and consent controls.

## 14. Test Coverage and Security Regression Gaps

`tests/security.test.mjs` adds three passing tests for queue bounds, malformed event rejection, CSP, and referrer policy. There is no broader automated test suite or browser integration test. Useful future coverage includes timed-waiter cleanup, story-schema limits, canvas boundary behavior, and a deployed-header/browser CSP check.

## 15. Prioritised Remediation Plan

**Immediate:** Completed SEC-001 and SEC-002; retain the regression tests.

**Short-term:** Configure production response headers, especially CSP `frame-ancestors`, HSTS, and `X-Content-Type-Options`; verify them against the deployed URL.

**Medium-term:** Add a lightweight story schema validator if story content will be edited or supplied outside the trusted release process. Document font provenance and licensing.

**Long-term:** Add browser-level smoke tests and deployment-header checks if the project gains CI/CD or a formal hosting configuration.

## 16. False Positives / Needs Manual Verification

- The committed font is binary and was not reverse-engineered; provenance and build-chain integrity need manual verification.
- Anti-framing, TLS, HSTS, MIME-sniffing, caching, and hosting access controls cannot be determined from this repository.
- Teletext markup in player input is a local presentation behavior, not DOM XSS in the current architecture.

## 17. Final Notes

Commit `ce4d311` fixes both confirmed findings. Verification completed with `node --test tests/security.test.mjs` (3 tests passed), `git diff --check`, JSON parsing, story graph/reference validation, and targeted secret and dangerous-API searches. No known application-code security findings remain open. Residual risk is concentrated in deployment headers and trusted content provenance that are outside the available repository scope.
