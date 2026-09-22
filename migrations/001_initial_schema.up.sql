-- =============================================================================
-- Migration: 001_initial_schema.up.sql
-- Description: Core schema for double-entry financial ledger and payment system
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom enum types
CREATE TYPE entry_type_enum AS ENUM ('debit', 'credit');
CREATE TYPE transaction_status_enum AS ENUM ('pending', 'posted', 'rejected', 'reversed');
CREATE TYPE account_type_enum AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- -----------------------------------------------------------------------------
-- 1. USERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. ACCOUNTS TABLE
-- Note: Balance is NEVER stored here. It is derived from ledger_entries.
-- -----------------------------------------------------------------------------
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    account_type account_type_enum NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_accounts_user
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 3. TRANSACTIONS TABLE
-- Represents business transactions grouping double-entry ledger entries.
-- -----------------------------------------------------------------------------
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) NOT NULL,
    status transaction_status_enum NOT NULL DEFAULT 'posted',
    initiated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_transactions_user
        FOREIGN KEY (initiated_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL
);

-- -----------------------------------------------------------------------------
-- 4. LEDGER_ENTRIES TABLE (Immutable double-entry rows)
-- Invariant: Sum(debits) - Sum(credits) = 0 for every transaction_id
-- -----------------------------------------------------------------------------
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL,
    account_id UUID NOT NULL,
    amount NUMERIC(18, 4) NOT NULL,
    entry_type entry_type_enum NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_positive_amount CHECK (amount > 0),
    CONSTRAINT fk_ledger_entries_transaction
        FOREIGN KEY (transaction_id) 
        REFERENCES transactions(id) 
        ON DELETE RESTRICT,
    CONSTRAINT fk_ledger_entries_account
        FOREIGN KEY (account_id) 
        REFERENCES accounts(id) 
        ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 5. AUDIT_LOGS TABLE
-- Append-only trail capturing critical lifecycle actions and security events.
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_audit_logs_actor
        FOREIGN KEY (actor_id) 
        REFERENCES users(id) 
        ON DELETE SET NULL
);

-- -----------------------------------------------------------------------------
-- 6. RATE_LIMIT_EVENTS TABLE
-- Security & throttling telemetry.
-- -----------------------------------------------------------------------------
CREATE TABLE rate_limit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    ip_address VARCHAR(45) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    request_method VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_rate_limit_user
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------

-- 1. Strict idempotency constraint on transactions
CREATE UNIQUE INDEX idx_transactions_idempotency_key 
    ON transactions (idempotency_key);

-- 2. High-performance composite index for balance derivations & account statements
CREATE INDEX idx_ledger_entries_account_created 
    ON ledger_entries (account_id, created_at);

-- 3. Foreign key join acceleration indexes
CREATE INDEX idx_ledger_entries_transaction_id 
    ON ledger_entries (transaction_id);

CREATE INDEX idx_accounts_user_id 
    ON accounts (user_id);

-- 4. Audit and security lookup indexes
CREATE INDEX idx_audit_logs_entity 
    ON audit_logs (entity_type, entity_id);

CREATE INDEX idx_audit_logs_actor_created 
    ON audit_logs (actor_id, created_at);

CREATE INDEX idx_rate_limit_ip_endpoint_created 
    ON rate_limit_events (ip_address, endpoint, created_at);

-- -----------------------------------------------------------------------------
-- VIEW: DERIVED ACCOUNT BALANCES
-- Balance is dynamically computed: SUM(credits) - SUM(debits)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW account_balances AS
SELECT 
    a.id AS account_id,
    a.user_id,
    a.account_type,
    a.currency,
    COALESCE(
        SUM(
            CASE 
                WHEN le.entry_type = 'credit' THEN le.amount
                WHEN le.entry_type = 'debit' THEN -le.amount
                ELSE 0
            END
        ), 0
    ) AS balance,
    COUNT(le.id) AS total_entries,
    MAX(le.created_at) AS last_activity_at
FROM accounts a
LEFT JOIN ledger_entries le ON a.id = le.account_id
GROUP BY a.id, a.user_id, a.account_type, a.currency;
