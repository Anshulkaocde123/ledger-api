/**
 * Account Entity / Schema representation
 * Account Types: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
 */
class Account {
  constructor({ id, userId, accountNumber, type, currency = 'USD', balance = 0, status = 'ACTIVE', createdAt, updatedAt }) {
    this.id = id;
    this.userId = userId;
    this.accountNumber = accountNumber;
    this.type = type; // 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
    this.currency = currency;
    this.balance = balance;
    this.status = status; // 'ACTIVE' | 'FROZEN' | 'CLOSED'
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = Account;
