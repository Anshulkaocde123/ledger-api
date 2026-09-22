/**
 * Transaction & Ledger Entry representations
 * Every transaction groups balanced double-entry records
 */
class LedgerEntry {
  constructor({ id, transactionId, accountId, type, amount, currency, createdAt }) {
    this.id = id;
    this.transactionId = transactionId;
    this.accountId = accountId;
    this.type = type; // 'DEBIT' | 'CREDIT'
    this.amount = amount; // BigInt or integer in minor units (e.g. cents)
    this.currency = currency;
    this.createdAt = createdAt;
  }
}

class Transaction {
  constructor({ id, reference, description, status = 'PENDING', entries = [], createdAt, updatedAt }) {
    this.id = id;
    this.reference = reference; // Idempotency key / external reference
    this.description = description;
    this.status = status; // 'PENDING' | 'POSTED' | 'REJECTED' | 'REVERSED'
    this.entries = entries; // Array of LedgerEntry
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = {
  Transaction,
  LedgerEntry,
};
