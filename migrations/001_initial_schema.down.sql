-- =============================================================================
-- Migration: 001_initial_schema.down.sql
-- Description: Revert core schema for double-entry financial ledger
-- =============================================================================

-- Drop view
DROP VIEW IF EXISTS account_balances;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS rate_limit_events;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS users;

-- Drop custom enum types
DROP TYPE IF EXISTS account_type_enum;
DROP TYPE IF EXISTS transaction_status_enum;
DROP TYPE IF EXISTS entry_type_enum;
