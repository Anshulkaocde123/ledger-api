# ADR 2: Row-Level Locking vs. SERIALIZABLE Isolation for Concurrency

## Status
Accepted

## Context
When concurrent transfers target the same accounts, race conditions cause double-spending and overdrafts. PostgreSQL offers two solutions: running transactions at the `SERIALIZABLE` isolation level or using explicit pessimistic row locks (`SELECT ... FOR UPDATE`) in `READ COMMITTED` mode.

## Decision
I chose explicit row-level locking (`SELECT ... FOR UPDATE`) with deterministic ordering (`ORDER BY id ASC`), executed within standard `READ COMMITTED` transactions.

## Consequences
- **Zero Serialization Aborts**: Under high contention, `SERIALIZABLE` isolation repeatedly throws `40001 serialization_failure` errors when read/write dependencies overlap, forcing complex client retry storms that degrade throughput. With row locks, concurrent transactions simply wait their turn in Postgres's lock queue and execute cleanly without retries.
- **Deadlock Immunity**: Sorting account IDs before acquiring locks guarantees that two simultaneous transfers moving money in opposite directions (A $\rightarrow$ B and B $\rightarrow$ A) acquire locks in the exact same sequence, eliminating circular lock deadlocks.
- **Trade-off**: Lock queues hold connection resources while waiting. I kept critical sections sub-millisecond by executing only locks and inserts inside the transaction, moving audits and caching outside.
