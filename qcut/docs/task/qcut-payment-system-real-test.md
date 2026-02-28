# QCut Payment System Real Test Decision

Date: 2026-02-28

## Short Answer

Yes, we should do a real test before launch, but only as a small controlled canary after Stripe test-mode coverage is complete.

## Why Real Test Is Needed

Stripe test mode is necessary but not sufficient for launch confidence. A live canary validates risks that mocks and test-mode cannot fully prove:

- real card network behavior
- live webhook delivery/retries/signature verification
- real redirect/deep-link handoff (`success.html` -> `qcut://activate`)
- real credit and license state transitions in production infrastructure
- real refund and reconciliation workflow

## Required Safety Guardrails

1. Use internal tester accounts only (email allowlist).
2. Use lowest-charge scenario for live canary:
   - one monthly Pro subscription
   - one smallest top-up pack
3. Enable kill switches:
   - disable checkout creation endpoint quickly
   - pause webhook processing safely
4. Keep idempotency keys on all Stripe write operations.
5. Keep webhook handlers idempotent (`event.id` dedupe storage).
6. Pre-define rollback runbook (cancel subscription, issue refund, restore license/credits if needed).

## Test Strategy (Staged)

1. Automated + integration tests
   - validate license status transitions
   - validate credit deduction and balance math
   - validate webhook event handlers with fixture payloads
2. Stripe test mode end-to-end
   - checkout success/failure
   - renewal and cancellation events
   - top-up purchase and credit grant
   - customer portal flow
3. Live canary real test (small, manual, internal only)
   - run once all stage 1 and 2 checks pass

## Live Canary Test Cases

1. Subscription purchase (Free -> Pro monthly)
   - expected: license becomes `active`, plan `pro`, plan credits granted
2. Credit top-up purchase
   - expected: `topUpCredits` increases, transaction log records Stripe payment id
3. Deep link activation from `success.html`
   - expected: app receives token and refreshes license/credits
4. Customer portal cancel flow
   - expected: subscription cancellation reflected after webhook processing
5. Refund handling
   - expected: financial state reconciled and product state corrected per policy

## Pass Criteria

Pass if all are true:

1. No duplicate credit grants from webhook retries.
2. License state and credit balance match Stripe truth after each flow.
3. App and web surfaces show consistent plan/credit data.
4. Refund/cancel actions are reversible and auditable.
5. Logs and DB records are sufficient for incident investigation.

## No-Go Conditions

Do not open public billing if any are true:

- webhook idempotency is missing or unproven
- refund path is manual and undocumented
- deep-link activation fails intermittently
- license and credit data diverge under retry/replay

## Recommendation

Proceed with real testing, but only as a controlled canary with strict guardrails and rollback readiness. This is the minimum safe path to validate production billing behavior before public release.
