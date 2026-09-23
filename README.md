# ledger-api

[![CI Pipeline](https://github.com/<OWNER>/<REPOSITORY>/actions/workflows/ci.yml/badge.svg)](https://github.com/<OWNER>/<REPOSITORY>/actions/workflows/ci.yml)

A resilient, audit-compliant banking-style ledger and payments backend built with Node.js, Express, and PostgreSQL.

---

## Overview

`ledger-api` provides core accounting, transaction processing, and ledger capabilities modeled after financial-grade double-entry bookkeeping systems. It guarantees data consistency, immutability of audit trails, and strict separation of concerns across layered application boundaries.

Key capabilities planned:
- Double-entry ledger architecture (debits and credits balance to zero)
- Atomic transaction execution with isolation against race conditions
- Account management with multi-currency support
- Idempotent payment processing via Redis caching / lock management
- Secure JWT-based authentication and role-based authorization

---

## Architecture

This service follows a strict **Layered Architecture (Separation of Concerns)**:

```
[ HTTP Client / External Services ]
                 │
                 ▼
        [ Routes / Middlewares ]
  (Authentication, Rate Limiting, Request Validation)
                 │
                 ▼
          [ Controllers ]
  (HTTP parsing, status codes, payload formatting)
                 │
                 ▼
           [ Services ]
  (Business logic, ledger integrity, domain rules, transaction boundaries)
                 │
                 ▼
         [ Repositories ]
  (Database access, SQL queries, transactional pooling)
                 │
                 ▼
      [ PostgreSQL / Redis ]
```

### Folder Breakdown

- `src/controllers/`: Handle HTTP request parsing, input sanitization, and response code mapping.
- `src/services/`: Contain core business logic, orchestrate transactional boundaries, and enforce domain constraints.
- `src/repositories/`: Abstract raw SQL queries, data mapping, and PostgreSQL interaction.
- `src/middleware/`: Express middlewares for JWT auth, global error catching, and validation.
- `src/models/`: Domain schemas, DTOs, and entity definitions.
- `src/utils/`: Common utilities such as standard error classes, mathematical helpers, and loggers.
- `src/config/`: Database pools, Redis connections, and environment variable loaders.

---

## Setup

### Prerequisites
- **Node.js**: v18+ or v20+
- **PostgreSQL**: v14+
- **Redis**: v6+

### Installation

1. Clone the repository and navigate to the project directory:
   ```bash
   git clone <repo-url>
   cd ledger-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your local PostgreSQL and Redis credentials
   ```

4. Start the application:
   - **Development (with hot reload)**:
     ```bash
     npm run dev
     ```
   - **Production**:
     ```bash
     npm start
     ```
   - **Run tests**:
     ```bash
     npm test
     ```

---

## API Endpoints

> *Note: Endpoints will be implemented and populated incrementally.*

### Authentication & Users
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Register a new user | No |
| `POST` | `/api/v1/auth/login` | Authenticate and retrieve JWT tokens | No |
| `POST` | `/api/v1/auth/refresh` | Refresh access token | No |

### Accounts
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/accounts` | Create an account (asset, liability, equity, etc.) | Yes |
| `GET` | `/api/v1/accounts/:id` | Get account details & balance snapshot | Yes |
| `GET` | `/api/v1/accounts/:id/entries` | Get ledger entries for an account | Yes |

### Transactions & Payments
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/transactions` | Post balanced multi-entry transaction | Yes |
| `POST` | `/api/v1/payments/transfer` | Execute funds transfer between accounts | Yes |
| `GET` | `/api/v1/transactions/:id` | Retrieve transaction details & audit trail | Yes |

---

## Design Decisions

1. **Layered Architecture over Route Handlers**: Decouples transport protocol (HTTP/REST) from domain business logic (accounting rules) and storage mechanisms (PostgreSQL), allowing comprehensive unit testing without mocking HTTP requests.
2. **Double-Entry Bookkeeping**: Money is never created or destroyed without counter-entries. Every transaction contains balanced debit and credit entries (`sum(debits) - sum(credits) = 0`).
3. **Immutability of Ledger Entries**: Financial records are append-only. Modifying or deleting ledger entries is strictly prohibited; corrections are issued via compensating entries (reversals).
4. **Strict Concurrency & Isolation**: Financial transactions execute inside PostgreSQL database transactions (`BEGIN ... COMMIT`) utilizing row-level locking (`SELECT ... FOR UPDATE`) to prevent double-spending and balance drift.
5. **Idempotency with Redis**: High-concurrency payment APIs utilize idempotency keys stored in Redis to eliminate duplicate charges in the event of client retries or network drops.
