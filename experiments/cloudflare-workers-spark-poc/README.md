# Minimart POS — Cloudflare Workers Free + Firestore REST POC

Isolated proof-of-concept for committing Cashier sales without Firebase Blaze, Cloud Functions, or any paid service.
Production code, Rules, Cloud Functions, and production data are **not** modified and nothing here is deployed.

## Scope

- `POST /api/sales/commit` — Cashier sale commit through one Cloudflare Worker.
- `POST /api/offline-allowances` — Cashier obtains a server-issued 24-hour offline stock allowance plus a 72-hour authorization lease.
- `POST /api/offline-allowances/reconcile` — Owner-only release of an expired reservation.
- `POST /api/sales/void` — Cashier Void of a synced Sale, restoring Product, Batch and saleable Unit Registry records atomically.
- `POST /api/sales/return` — Cashier Return with restock/damaged dispositions, over-return protection, Credit due adjustment and an honest KPay refund status.
- Firebase ID token verified in the Worker (RS256, JWKS, aud/iss/sub/exp/iat), with optional revocation check.
- Authorization (role, branch, business, membership, branch status) read from trusted Firestore, never from the request body.
- Firestore REST transaction: `beginTransaction` → reads → `commit` (single atomic write set).
- Server-recalculated prices, costs, discounts, totals; batch/unit/stock checks; fingerprint idempotency.
- Trusted timestamps only: the Worker clock issues `issuedAt` / `expiresAt`, writes them to Firestore, and validates them on every offline commit. Client `issuedAt` / `expiresAt` fields are rejected by the request allowlist.
- A branch-level reservation ledger prevents two devices from overdrawing the same stock; expiry transitions never release stock automatically.
- Scheduled expiry (`crons = ["15 * * * *"]`) marks stale allowances `expired-hold` and leases `expired`; Owner reconciliation is required to release the reservation.

Out of scope (intentionally): client integration, deployment, offline queue changes, Rules changes, production data.

## Files

| File | Purpose |
| --- | --- |
| `src/index.js` | Worker entry; builds runtime from env, maps config errors to 503, scheduled expiry |
| `src/app.js` | HTTP layer: routes, Bearer auth, 1 MiB body cap, retry/backoff for ABORTED, response envelopes |
| `src/domain/sale.js` | Sale shape validation, allowlists, fingerprint (byte-identical to client), request parsing |
| `src/domain/allowance.js` | Server-issued allowance/lease, device binding, reservation ledger, availability math |
| `src/domain/commitSale.js` | The transactional commit: base reads, validation, trusted totals, allowance/ledger writes |
| `src/domain/expire.js` | Scheduled/lazy `expired-hold` transition; never touches the reservation ledger |
| `src/domain/reconcile.js` | Owner-only release of an expired/consumed allowance reservation |
| `src/domain/adjustment.js` | Cashier Void/Return transactions: authorization, stock/batch/unit restoration, refund status, idempotent replay |
| `src/auth/verifyIdToken.js` | JWKS cache, signature/claim checks, optional revocation (`validSince`) |
| `src/firestore/rest.js` | `beginTransaction`, `batchGet`, `runQuery`, `commit`, `rollback` + metrics |
| `src/firestore/values.js` | Firestore typed value encode/decode |
| `src/firestore/credentials.js` | Emulator credential or service-account JWT-bearer (secret only) |
| `src/errors.js` | `SaleError` and HTTP mapping; 500 message never leaks internals |
| `test/scenarios.test.mjs` | 58 emulator-backed allowance/lease/commit tests (7 suites) |
| `test/adjustment-scenarios.test.mjs` | 6 emulator-backed Void/Return tests |
| `test/helpers.mjs` | Fixtures, signing keys, counting fetch, controllable clock, allowance/reconcile harness |
| `test/emulator.mjs` | Starts/stops the Firestore emulator on port 8101, clears data |
| `test/emulator.rules` | Test-only allow-all Rules (never used in production) |
| `test/cpu-bench.mjs` | Pure-JS CPU micro-benchmark for the 20-line path |

## Run the tests

Requires Java and the Firestore emulator jar at
`~/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar`.

```bash
cd experiments/cloudflare-workers-spark-poc
npm test                 # 70 tests, writes test/results.json
npm run test:adjustments # 6 Void/Return tests only
npm run bench:cpu        # writes test/cpu-results.json
```

The tests start their own emulator (`demo-minimart-spark-poc`, port 8101) and never touch `minimart-production`.

## Environment for a real Worker

| Name | Kind | Value |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | var | `minimart-production` (Staging: `minimart-staging`) |
| `BUSINESS_ID` | var | `store-mini-main` (Staging: `store-staging-main`) |
| `ENVIRONMENT` | var | `staging` for the staging Worker; triggers Production-ID rejection |
| `CHECK_TOKEN_REVOCATION` | var | `true` / `false` |
| `FIRESTORE_SERVICE_ACCOUNT` | **secret** | Service-account JSON (never in Git/APK/logs) |
| `FIRESTORE_EMULATOR_HOST` | local only | `127.0.0.1:8101` |

Set the secret only in Cloudflare:

```bash
npx wrangler secret put FIRESTORE_SERVICE_ACCOUNT
```

Do **not** put the JSON in `wrangler.toml`, `.dev.vars`, the APK, or chat.

## API contract

```http
POST /api/sales/commit
Authorization: Bearer <Firebase ID token>
Content-Type: application/json

{ "branchId": "...", "sale": { ...existing Sale shape... } }
```

Online commits must have `sale.date` within 10 minutes of the server clock. An offline commit must add all four trusted references:

```json
{
  "branchId": "...",
  "sale": { "...": "..." },
  "allowanceId": "allowance-...",
  "allowanceToken": "<one-time capability token>",
  "leaseId": "lease-...",
  "deviceId": "..."
}
```

```http
POST /api/offline-allowances
Authorization: Bearer <Firebase ID token>

{ "branchId": "...", "deviceId": "...", "items": [{ "productId": "...", "quantity": 1, "batchAllocations": [{ "batchId": "...", "quantity": 1 }] }], "leaseId": "optional-existing-lease" }
```

`leaseId` reuses an unexpired lease for the same Cashier/Business/Branch/Device; otherwise the Worker issues a fresh 72-hour lease. Issuance reserves stock in `branches/{branchId}/meta/offlineStockReservations` and returns the plaintext `allowanceToken` exactly once. Only its SHA-256 hash is stored.

```http
POST /api/sales/void
POST /api/sales/return
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

Both endpoints must carry `branchId`, `saleId`, `requestId`, a 3–300 character `reason`, and `deviceId`.
Return additionally carries `items[]` with `productId`, `quantity`, `disposition`
(`restock` or `damaged`), and for tracked Products `units[]` (`registryId`, `unitId`,
per-unit disposition). The trusted Worker transaction verifies that every Unit
belongs to the original Sale and is still `sold`, prevents over-return and duplicate
Units, and rejects voiding a Sale that already has a Return. Repeating the same
`requestId` returns `already-committed` without any second stock movement.

Boundary evidence (`npm test`) includes 23h accepted, exactly 24h `expired-hold`,
25h rejected, backwards clock rejected, fabricated old sale date rejected,
duplicate retry `already-committed`, and expired reservations held until Owner
reconciliation. Lease evidence includes 71h accepted, exactly 72h rejected, 73h
rejected, disabled Cashier and wrong branch denied.

- `200 {ok:true, result:"created"|"already-committed"|"issued"|"released"|"already-reconciled", readCount, writeCount, attempts}`
- `400 invalid-argument` — malformed body/shape/allowlist violation, or an old online sale without an allowance
- `401 unauthenticated` / `authorization-expired` — bad/revoked/expired token, or 72-hour lease exceeded
- `403 permission-denied` — wrong role/branch/business/membership/device, or a tampered allowance token
- `409 failed-precondition` — stock, batch, expiry, unit, price, totals, KPay reuse, fingerprint mismatch, ledger mismatch
- `409 expired-hold` — 24-hour allowance exhausted/expired or reused; stock stays reserved
- `503 unavailable` — transaction contention after retries, or Worker config missing

The Worker returns `readCount`/`writeCount` plus `x-poc-*` headers for measurement only.

## Security model

- UID, role, business, and branch always come from Firestore membership documents; a `uid` field in the body is rejected.
- The service account bypasses Rules, so every Rules invariant that matters for sales is re-implemented in `commitSale.js`.
- Only `payload.stock`, `payload.quantity`, registry `payload.units`, allowance/lease status, the reservation ledger, and audit/sale documents are written; unrelated product fields are masked out of the update.
- The Worker clock is the only source of allowance/lease issuance, expiry, and expiry checks. A device clock change cannot extend or shorten a server-issued window.
- The allowance token is a one-time capability: SHA-256 hash, constant-time compare, bound to Business/Branch/Cashier/Device/Lease.
- Only one sale consumes a given allowance (it becomes `consumed`); retries are acknowledged by sale fingerprint before any policy check.
- No credential is logged or returned; config failures surface as a generic 503.

## Known limits

- Full automated suite runs against the Firestore emulator. The sale/adjustment
  data paths were additionally run once against the real `minimart-staging`
  Firestore (33/33) with a locally signed ID token and an injected JWKS; that
  run did not verify a real Google-issued token.
- `minimart-staging` exists (Spark, `asia-southeast1`) with `store-staging-main`
  seeded, and the Staging Rules candidate is deployed there. The Staging Worker
  is **not deployed**: Cloudflare authentication and the service-account key are
  still missing. `wrangler.staging.toml` is local and Git-ignored.
- CPU measured in Node, not in `workerd`.
- Revocation (`accounts:lookup`) is implemented but not exercised against live Identity Toolkit; the emulator suite injects a test revocation checker. The real-Staging run used an injected JWKS, so live JWKS/revocation verification remains unproven.
- The Worker enforces its server clock, but a fully offline browser cannot learn that its allowance expired until it reconnects. The browser may keep showing a locally queued sale; the commit is held (`409 expired-hold`) and the stock remains reserved until Owner reconciliation. This is a deliberate fail-closed limitation, not clock-independent offline enforcement in the browser itself.
- The scheduled expiry job processes one allowance/lease per transaction. With a very large number of active records it can exceed the 50-subrequest Free limit; batch/segment it before production scale.
- Client queue/offline behavior is unchanged. `src/lib/workerSaleClient.ts` is prepared but deliberately not imported by the checkout queue until Staging passes.
