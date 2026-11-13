# StockLink security report

Scope: the code in this folder, tested by its own automated suite (`npm test`, 117 checks) and a browser test.
This is a self-test by the author of the code. It is NOT an independent penetration test.

## What is protected and how

| Threat | Control | Tested |
|---|---|---|
| Stolen or guessed passwords | scrypt (N=16384) with per-user salt, constant-time compare, equal timing for unknown users, login rate limits per IP and per phone | yes |
| Session theft | Random 256-bit token, HttpOnly + SameSite=Lax (+Secure in production), only SHA-256 of the token stored, 7-day expiry, logout deletes server-side | yes |
| CSRF | Custom header required on every state-changing call, Origin must match host, JSON content type only | yes |
| XSS | All dynamic text escaped, no inline scripts or styles, strict CSP (script/style self only), uploads served sandboxed with nosniff | yes (browser test with script payload) |
| SQL injection | Parameterised queries only | yes |
| Cross-tenant data access (IDOR) | Every request re-checks role, shop ownership and an approved connection. Photos and payment proofs return 404 to outsiders | yes |
| Role escalation / mass assignment | Signup accepts only retailer or wholesaler; new wholesalers start unverified; extra fields ignored | yes |
| Invite-code guessing | 8 chars from a CSPRNG (40 bits), keyed hash at rest, max uses, expiry, revoke, 5 failures per hour per user and 20 per IP, persisted in DB. A valid code only creates a pending request | yes |
| Overselling / race conditions | Single atomic UPDATE inside an immediate transaction plus DB CHECK constraints. 12 simultaneous buyers for 3 units gave exactly 3 orders | yes |
| Double submit | Idempotency key per order | yes |
| Price tampering | Server reads prices from the database, ignores client prices | yes |
| Reused payment reference | UTR unique per wholesaler | yes |
| Malicious uploads | Magic-byte check (JPEG/PNG/WebP only), size caps, SVG and HTML rejected | yes |
| Log tampering | Hash-chained audit log; modification of any entry is detected | yes |
| Access after revocation | Checked live on each request and on every live-update event | yes |
| Request flooding | Per-IP global limit, body size limits, request timeouts | partly |

## Known limits (read before going live)

1. No independent penetration test or code audit. Get one before handling large money flows.
2. TLS and DDoS protection come from your host or proxy, not from this code.
3. Rate limits live in memory and reset on restart; run one instance.
4. SQLite is not encrypted at rest (use disk encryption). On Supabase the database is encrypted at rest by Supabase. Protect the connection string like a password.
5. No SMS OTP or 2FA, no password reset flow, no account lockout notification.
6. Invite codes are 40 bits. That is sufficient with the attempt limits above plus manual approval, but do not treat a code as a secret that grants access by itself (it does not).
7. Payment confirmation is manual and depends on the wholesaler checking their bank. The platform does not hold money.
8. Demo mode intentionally publishes passwords. Never enable it with real data.
9. Personal data (names, phones, shop details) is stored. If you operate in India, the DPDP Act applies: add a privacy policy, a way to delete accounts on request, and breach handling before public launch.

## Notifications and push

- Push subscriptions are accepted only for real browser push services (Google FCM, Mozilla, Apple, Microsoft) over https on port 443. The server can never be made to send requests to an arbitrary URL (SSRF).
- Push keys are length- and charset-checked; at most 5 devices per user; subscribing is rate limited.
- Each notification goes only to the owner of the shop it concerns, or to retailers with an approved connection to a verified wholesaler.
- Logging out removes the phone's subscription, so the next person on that phone does not get the previous account's alerts.
- A failing notification never fails the order or stock action that triggered it.
- The service worker never caches `/api/*` responses, so private data is not stored on the phone.
- The VAPID private key is stored in the `settings` table unless set by environment variable; treat database backups as secret.
