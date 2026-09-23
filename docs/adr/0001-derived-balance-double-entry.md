# ADR 1: Derived Balance via Double-Entry Ledger vs. Stored Column

## Status
Accepted

## Context
In banking systems, storing a mutable `balance` column on an `accounts` table is a major liability. A simple update bug, partial failure, or concurrent overwrite causes balance drift that is impossible to reconcile because there is no proof of where funds originated or disappeared.

## Decision
I rejected storing balances directly. Instead, I implemented an append-only double-entry ledger where an account's balance is strictly derived on demand as:
`SUM(credits) - SUM(debits)` from immutable `ledger_entries`.
Corrections cannot mutate rows; they require compensating reversal transactions.

## Consequences
- **Integrity**: Complete auditability. Funds cannot be minted or destroyed without balanced counter-entries (`sum(credits) - sum(debits) = 0`), making balance drift mathematically impossible.
- **Trade-off & Mitigation**: Deriving balance on every read requires summing rows. I mitigated this with a composite index on `(account_id, created_at)` and a Redis cache-aside layer (30s TTL) that is explicitly invalidated immediately whenever a transfer completes. At massive scale, periodic balance snapshots would be introduced.
