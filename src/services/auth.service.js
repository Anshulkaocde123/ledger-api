const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/user.repository');
const ApiError = require('../utils/apiError');
const config = require('../config/env');

class AuthService {
  async register({ email, password, fullName }) {
    const existing = await userRepository.findByEmail(email);
    if (existing) {
      throw ApiError.badRequest('User with this email already exists');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    return userRepository.create({
      email,
      passwordHash,
      fullName,
    });
  }

  async login({ email, password }) {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const payload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: '7d' });

    return {
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
      accessToken,
      refreshToken,
    };
  }
}

module.exports = new AuthService();
