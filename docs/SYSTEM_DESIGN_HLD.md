# Financial Ledger System Design & HLD Master Playbook

> **How to ace the System Design & Architecture interview for `ledger-api` using first-principles thinking.**

---

## 1. The 30-Second Interview Elevator Pitch

> *"Most junior implementations treat money like a mutable number in a database—running `UPDATE accounts SET balance = balance - 100`. In high-scale financial systems, that design fails catastrophically under race conditions, network timeouts, and auditing audits.*
> 
> *I designed and built **`ledger-api`**, a financial-grade double-entry ledger backend based on immutable accounting primitives. It eliminates race conditions via deterministic row-level locking, enforces payment idempotency, accelerates read throughput with cache-aside Redis, and guarantees non-blocking durability using asynchronous message queues with dead-letter retries."*

---

## 2. First Principles: What is Money in Software?

In classical software engineering, you create a table:
```sql
-- ❌ THE NAIVE ANTIPATTERN
CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    balance NUMERIC(15, 2) NOT NULL -- MUTABLE VALUE
);
```

### Why this fails in real life:
1. **Mutation Destroys History**: If an account balance changes from \$1,000 to \$700, who moved the \$300? Was it a card swipe, an ATM withdrawal, a service fee, or a software bug? You have destroyed the evidence.
2. **Silent Drift**: If two application servers execute `UPDATE accounts SET balance = balance - 100` concurrently without lock isolation, one write overwrites the other (lost update problem).
3. **No Reconciliation**: You cannot mathematically prove the system balances to zero.

### The Accounting First Principle (Luca Pacioli, 1494)
> **Money never appears or disappears from thin air. Every movement of value is a dual-sided transfer: a Debit in one account balanced by a Credit in another.**

$$\sum \text{Credits} - \sum \text{Debits} = 0$$

In this system:
- **Balance is derived, NEVER stored.**
- An account balance is calculated dynamically on-the-fly:
  $$\text{Balance} = \sum \text{Credits} - \sum \text{Debits}$$
- The database is **strictly append-only**. Financial records are immutable. If a mistake occurs, you do not update or delete a row; you issue an equal and opposite **compensating transaction (reversal)**.

---

## 3. Evolutionary Requirement Tree: Unlocking Architecture by Need

A great interview answer explains *why* each component exists by presenting the problem first:

```
[ Problem: Silent Balance Drift & Lost Audits ]
                   │
                   ▼
     ( Double-Entry Append-Only Ledger )
                   │
[ Problem: Network Timeouts & Client Retries ]
                   │
                   ▼
     ( Unique Idempotency Key Validation )
                   │
[ Problem: Double-Spending & Race Conditions ]
                   │
                   ▼
     ( Pessimistic Row-Level Locking: SELECT FOR UPDATE )
                   │
[ Problem: Opposing Transfers Cause Deadlocks (A->B vs B->A) ]
                   │
                   ▼
     ( Deterministic ID-Sorted Lock Acquisition )
                   │
[ Problem: Calculating SUM() on Every Balance Check is O(N) ]
                   │
                   ▼
     ( Redis Cache-Aside Layer with Instant Invalidation )
                   │
[ Problem: Audit Logging Slows Down Core Transfer API ]
                   │
                   ▼
     ( BullMQ Async Queue + Worker + Dead-Letter Queue )
                   │
[ Problem: Brute Force & API Abuse ]
                   │
                   ▼
     ( Redis Token Bucket Rate Limiter via Atomic Lua Script )
```

---

## 4. High-Level Architecture (HLD)

### Visual System Topology

```
                              ┌─────────────────────────────────────────┐
                              │           CLIENT APPLICATIONS           │
                              │    (Mobile, Web, Automated APIs)        │
                              └────────────────────┬────────────────────┘
                                                   │
                                                   │ HTTPS / REST
                                                   ▼
                              ┌─────────────────────────────────────────┐
                              │             LOAD BALANCER               │
                              │    (Reverse Proxy / SSL Termination)    │
                              └───────┬─────────────────────────┬───────┘
                                      │                         │
                                      ▼                         ▼
                         ┌────────────────────────┐┌────────────────────────┐
                         │   APP SERVER NODE 1    ││   APP SERVER NODE 2    │
                         │  (Stateless Express)   ││  (Stateless Express)   │
                         └───────────┬────────────┘└───────────┬────────────┘
                                     │                         │
                  ┌──────────────────┴────────────┬────────────┴──────────────────┐
                  │                               │                               │
                  ▼                               ▼                               ▼
       ┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
       │     REDIS STORE     │         │   BULLMQ BROKER     │         │     POSTGRESQL      │
       │                     │         │                     │         │                     │
       │ 1. Token Bucket Lua │         │ • 'audit-logs' Q    │         │ • Strict ACID Engine│
       │ 2. Balance Cache    │         │ • 'audit-logs-dlq'  │         │ • Row Locks (Mutex) │
       │    (30s Cache-Aside)│         │ • Exponential Retry │         │ • Append-only Ledger│
       └─────────────────────┘         └──────────┬──────────┘         └──────────▲──────────┘
                                                  │                               │
                                                  ▼                               │
                                       ┌─────────────────────┐                    │
                                       │ AUDIT WORKER NODE   │────────────────────┘
                                       │ (Background Worker) │ (Writes Audit Trail)
                                       └─────────────────────┘
```

### Request Flow Diagram (Mermaid)

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant GW as Express Gateway / Rate Limiter
    participant Auth as JWT Auth Middleware
    participant Service as Payment Service
    participant Redis as Redis Cache & Queue
    participant DB as PostgreSQL (ACID Engine)
    participant Worker as BullMQ Audit Worker

    Client->>GW: POST /api/v1/transfers (Header: Idempotency-Key)
    GW->>Redis: Check Token Bucket (Atomic Lua Script)
    alt Rate Limit Exceeded
        Redis-->>Client: 429 Too Many Requests (Retry-After: 12s)
    end
    GW->>Auth: Validate JWT Access Token (Stateless)
    Auth->>Service: Execute Transfer
    Service->>DB: Check if Idempotency Key exists
    alt Duplicate Transaction Key
        DB-->>Service: Return cached original transaction
        Service-->>Client: 200 OK (Idempotent-Replay: true)
    end
    Service->>DB: BEGIN Transaction
    Service->>DB: SELECT * FROM accounts WHERE id IN (A, B) ORDER BY id ASC FOR UPDATE
    Note over Service,DB: Row locks acquired deterministically; deadlocks impossible
    Service->>DB: Calculate sender derived balance from ledger_entries
    alt Balance < Transfer Amount
        Service->>DB: ROLLBACK
        Service-->>Client: 400 Bad Request (Insufficient Balance)
    end
    Service->>DB: INSERT INTO transactions (idempotency_key, status='posted')
    Service->>DB: INSERT INTO ledger_entries (debit sender, credit receiver)
    Service->>DB: COMMIT Transaction
    Service-)Redis: Invalidate balance cache: DEL cache:account:balance:A, B
    Service-)Redis: Enqueue audit job to 'audit-logs' queue
    Service-->>Client: 201 Created (Transfer Completed)

    Note over Redis,Worker: Asynchronous Background Processing
    Redis-)Worker: Dequeue audit job
    Worker->>DB: INSERT INTO audit_logs
    alt Worker Database Failure
        Worker->>Redis: Retry with exponential backoff (up to 3x)
        Worker->>Redis: Move to 'audit-logs-dlq' (Dead-Letter Queue)
    end
```

---

## 5. Deep-Dive: The 4 Core Engineering Decisions

### 1. Concurrency: Why Row-Level Locking instead of SERIALIZABLE?

- **The Problem**: Two users or threads try to spend the same \$500 balance at the same time.
- **Why NOT `SERIALIZABLE`?**
  - PostgreSQL implements `SERIALIZABLE` via SSI (Serializable Snapshot Isolation).
  - Under high concurrent write contention on the same account, SSI detects rw-antidependencies and aborts transactions with `40001 serialization_failure`.
  - This forces the application into aggressive retry loops, wasting CPU, generating network chatter, and multiplying database connection pool pressure.
- **The Solution**: **Pessimistic Row-Level Locking (`SELECT ... FOR UPDATE`) in `READ COMMITTED`**:
  - The first transaction locks the account row.
  - The second transaction queues behind it in the database engine's lock manager.
  - When the first transaction commits, the second transaction reads the newly committed ledger state and cleanly aborts with `400 Insufficient Balance`. Zero retry storms.

### 2. Deadlock Immunity: Deterministic Lock Sorting

- **The Problem**: 
  - Transaction 1 moves money from **Account A $\rightarrow$ Account B**.
  - Transaction 2 moves money from **Account B $\rightarrow$ Account A**.
  - If Tx 1 locks A and waits for B, while Tx 2 locks B and waits for A: **Deadlock** (`40P01 deadlock_detected`).
- **The Solution**:
  - In [`src/services/payment.service.js`](file:///home/anshul-jain/CITI/src/services/payment.service.js#L61-L65):
    ```javascript
    const lockOrder = [sourceAccountId, destinationAccountId].sort((a, b) => 
      a.localeCompare(b)
    );
    ```
  - Both transactions sort their lock requests alphabetically by account ID.
  - If $A < B$, both transactions *must* lock $A$ before requesting $B$.
  - Circular wait is mathematically eliminated ($O(1)$ overhead).

### 3. Read Scalability: Cache-Aside with Write-Time Eviction

- **The Problem**: Calculating $\sum \text{Credits} - \sum \text{Debits}$ on an account with 100,000 historical transactions takes tens of milliseconds.
- **The Solution**:
  - On read (`GET /accounts/:id/balance`):
    1. Check Redis key `cache:account:balance:{id}`.
    2. Cache Hit $\rightarrow$ return instantly ($<1\text{ms}$).
    3. Cache Miss $\rightarrow$ calculate derived balance from PostgreSQL, store in Redis with a 30-second TTL (`EX 30`).
  - On write (`POST /transfers`):
    - **Never wait for TTL expiration.** The transfer service immediately invalidates (deletes) both sender and receiver cache keys:
      ```javascript
      await redis.del(`cache:account:balance:${sourceId}`);
      await redis.del(`cache:account:balance:${destId}`);
      ```
  - **Graceful Degradation**: If Redis crashes, a `try/catch` falls back to the database, ensuring zero downtime for balance checks.

### 4. Availability: Why BullMQ instead of Kafka?

- **The Problem**: Audit logging requires network I/O. If the audit database is slow, running it synchronously inside the financial transfer transaction ties up database locks and inflates user response times.
- **Why NOT Kafka for this project?**
  - Kafka requires dedicated multi-broker JVM clusters, ZooKeeper/KRaft controllers, topic partition provisioning, and consumer group offset management.
  - For a single-repo, portfolio-to-production scale system, the operational complexity and cloud cost of Kafka are unjustified.
- **The Solution**: **BullMQ backed by Redis**:
  - Reuses the existing Redis cluster already deployed for caching and rate limiting.
  - Provides native exponential retry backoff and dead-letter queue routing (`audit-logs-dlq`) with zero extra infrastructure.

---

## 6. How to Answer in an Interview (The 5-Step Formula)

When the interviewer asks: **"Design a distributed payment ledger like Stripe or Venmo."**

### Step 1: Clarify Scope & Non-Negotiables (2 mins)
> *"Before discussing servers, let's establish the domain invariant: In a financial system, consistency and auditability trumps availability (PACELC: PC/EC). We cannot tolerate double-spending, balance drift, or dropped audit trails. Do we need multi-currency? (Yes/No). What is our target TPS? (e.g. 5,000 TPS)."*

### Step 2: The Data Model (The Core Differentiator) (3 mins)
> *"I reject the mutable balance column design. I model this as an append-only double-entry ledger with three core tables: `accounts`, `transactions`, and `ledger_entries`. An account balance is always derived as `SUM(credits) - SUM(debits)`. This makes balance drift mathematically impossible."*

### Step 3: The Write Path & Concurrency Control (5 mins)
> *"Let's trace a transfer from Account A to Account B.
> 1. Client supplies an `Idempotency-Key` in the header to handle network retries safely.
> 2. We open a transaction in `READ COMMITTED` mode.
> 3. We acquire pessimistic row locks (`SELECT ... FOR UPDATE`) on both accounts. To prevent deadlocks from simultaneous reverse transfers (A $\rightarrow$ B vs B $\rightarrow$ A), we deterministically sort the account IDs before acquiring locks.
> 4. We calculate A's balance. If sufficient, we insert the transaction and two balancing ledger entries.
> 5. We commit."*

### Step 4: Caching & Asynchronous Tasks (3 mins)
> *"To keep reads fast, we use a Cache-Aside pattern on balance reads with a 30-second TTL in Redis. When a transfer commits, we immediately invalidate the cache keys for both accounts.
> For audit logging, we enqueue an event to BullMQ so that the transfer API responds in <20ms without waiting for audit telemetry."*

### Step 5: What I'd Do Differently at Massive Scale (>100k TPS) (2 mins)
> *"If we scale to 100k TPS across hundreds of microservices:
> 1. **Balance Checkpointing**: Compute balance from the last hourly snapshot plus subsequent entries, keeping reads $O(1)$.
> 2. **Account Sharding**: Shard database instances by `account_id` hash. For cross-shard transfers, use a Two-Phase Commit (2PC) or Saga orchestration with a clearing account.
> 3. **Kafka Event Streaming**: Migrate BullMQ to Kafka for multi-subscriber streaming into audit data lakes and fraud detection engines."*

---

## 7. Key Files in This Repository

| Component | File Path | Key Mechanism |
| :--- | :--- | :--- |
| **Pessimistic Locking** | [`src/services/payment.service.js`](file:///home/anshul-jain/CITI/src/services/payment.service.js) | Sorted `[A, B]` locking, derived balance verification |
| **Row Lock Queries** | [`src/repositories/account.repository.js`](file:///home/anshul-jain/CITI/src/repositories/account.repository.js) | `SELECT ... FOR UPDATE` & dynamic SQL balance summation |
| **Database Schema** | [`migrations/001_initial_schema.up.sql`](file:///home/anshul-jain/CITI/migrations/001_initial_schema.up.sql) | Idempotency unique index, composite `(account_id, created_at)` index |
| **Redis Cache-Aside** | [`src/services/account.service.js`](file:///home/anshul-jain/CITI/src/services/account.service.js) | 30s TTL, write-time invalidation, DB fallback |
| **Token Bucket Limiter** | [`src/middleware/rateLimiter.middleware.js`](file:///home/anshul-jain/CITI/src/middleware/rateLimiter.middleware.js) | Atomic Redis Lua script, `Retry-After` calculation |
| **Async Audit Worker** | [`src/workers/audit.worker.js`](file:///home/anshul-jain/CITI/src/workers/audit.worker.js) | 3x exponential backoff, dead-letter routing (`audit-logs-dlq`) |
| **10-Transfer Concurrency Test** | [`tests/transfers.integration.test.js`](file:///home/anshul-jain/CITI/tests/transfers.integration.test.js) | 10 concurrent requests testing overdraft & lock integrity |
