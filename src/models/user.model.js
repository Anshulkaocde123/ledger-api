/**
 * User Entity / Schema representation
 */
class User {
  constructor({ id, email, passwordHash, fullName, role = 'user', createdAt, updatedAt }) {
    this.id = id;
    this.email = email;
    this.passwordHash = passwordHash;
    this.fullName = fullName;
    this.role = role;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = User;
