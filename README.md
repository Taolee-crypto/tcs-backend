# TCS backend — rights-management pilot

TCS is neutral rights-management infrastructure, not a music distributor. TimeLink and other independent platforms use the same scoped API. This first implementation persists rights submissions, human reviews, externally signed agreement references and platform usage reports in SQLite.

## Local execution

Node.js 24 or later. No runtime dependencies.

1. Set `TCS_CREDENTIALS` to a JSON array of `{token,id,tenant,role,platformId?}`. Generate a separate random token of at least 32 characters for each principal. Roles: `creator`, `reviewer`, `platform`; only platform principals require `platformId`. The tenant is the administering organisation, not a claim of association membership or partnership. Do not commit tokens.
2. Optionally set `TCS_DB` (default `tcs-pilot.sqlite`) and `PORT` (default 8788).
3. `npm start` binds to **127.0.0.1 only**. Start the frontend development server with its `/tcs-api` proxy.
4. `npm test` exercises SQLite, authorisation, rights workflow, usage idempotency and HTTP handling.

This is a local proposal/pilot system, not a publicly deployable production authentication service. No default accounts, public registration, CORS wildcard or production credentials are included. Keep the local development server private. Use synthetic/redacted evidence only.

## API (Bearer authentication required)

| Method / route | Role | Behaviour |
|---|---|---|
| GET /v1/session | all | Server-assigned identity and scope |
| GET /v1/works | all | Creator's own works; reviewer tenant; platform's currently authorised work identifiers |
| POST /v1/works | creator | Title and original MP3 SHA-256; no audio upload |
| POST /v1/works/:id/submit | owner | Evidence references for composition, recording and performance; existing contract declaration |
| POST /v1/works/:id/review | reviewer | Approve/reject with reason; no self-approval |
| GET /v1/grants | all | Role-scoped grants |
| POST /v1/grants | reviewer | Register reviewed, externally signed agreement reference and hash |
| POST /v1/grants/:id/revoke | reviewer | Timestamped withdrawal; retain history |
| POST /v1/usage | platform | Idempotent usage receipt bound to authenticated platform |
| GET /v1/usage | all | Role-scoped reported usage |
| GET /v1/audit | reviewer | Tenant-scoped audit summaries |

All times use canonical UTC ISO strings with milliseconds. Initial permissions are `server_storage`, `tl3_packaging`, `platform_delivery`; all three must be expressly covered in this pilot's agreement. Scopes are `store_broadcast`, `central_radio`, `personal_listening`; each grant has one scope, one country and a future/non-retroactive effective period. Creating a grant records an agreement, it does not electronically sign one.

Usage accepts `eventId,grantId,deviceId,startedAt,endedAt,seconds,territory,scope`. Platform identity comes from credentials. Reports are positive whole seconds, max 86400, bounded by elapsed time and the grant. Same platform/event payload retries return the previous receipt; conflicting retries and overlapping reports for one device are rejected. Historical usage ending before withdrawal can still be received. This is reported usage, **not independent playback proof**; spoofed device identities are not prevented by the pilot. New events are appended, not edited. No correction workflow yet.

`baseTl = seconds`, but `appliedTl` and `fee` are null. No KRW conversion, 70:30 split, royalty debt, invoice, tax, token minting or payout is generated. Approval policies and economics require separate verified specifications.

## Boundaries and next stage

- Hashes identify supplied files/documents; they do not prove ownership. Evidence document storage, signatures, joint-owner shares, mandate checks and trust/collection-society integration remain to implement.
- Actual MP3 delivery and TL3 packaging belong to authorised independent platforms; this repository never serves audio. A grant does not auto-connect TimeLink or override its policy.
- Production identity/SSO, principal provisioning/revocation, key rotation, rate limits, TLS, schema migrations, backups, independent usage proof, pagination, correction/dispute workflows and tamper-evident audit storage remain required. The local SQLite audit is transactional, not tamper-proof.
- No real association or supplier has approved these records. Use this to demonstrate the workflow and collect requirements before connecting production systems.
