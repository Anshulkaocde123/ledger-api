# ADR 3: BullMQ (Redis-Backed) vs. Apache Kafka for Async Processing

## Status
Accepted

## Context
Transaction audit logging must be asynchronous. Writing audit logs synchronously inside the transfer database transaction inflates client latency and couples core payment availability to non-critical telemetry. I needed a message queue with retry backoff and dead-letter queue (DLQ) support.

## Decision
I chose BullMQ on Redis instead of Apache Kafka.

## Consequences
- **Operational Simplicity**: Kafka requires a multi-broker JVM cluster, ZooKeeper or KRaft metadata management, and specialized partition sizing. For a portfolio-to-midscale backend, this adds massive infrastructure overhead. BullMQ reuses our existing Redis instance (already used for rate limiting and cache-aside), keeping deployment lean and costs near zero.
- **Built-in Resilience**: BullMQ provides exponential retry backoff, job idempotency, and automated dead-letter routing (`audit-logs-dlq`) out of the box with zero external dependencies.
- **Trade-off**: Redis stores queued jobs in-memory (with RDB/AOF persistence). It lacks Kafka's multi-terabyte log retention, consumer group rebalancing, and high-throughput event sourcing. If audit ingestion reaches tens of thousands of events per second across multiple distributed microservices, I would migrate the audit pipeline to Kafka.
