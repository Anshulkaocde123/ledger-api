const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/user.repository');
const refreshTokenRepository = require('../repositories/refreshToken.repository');
const ApiError = require('../utils/apiError');
const config = require('../config/env');

const BCRYPT_SALT_ROUNDS = 12; // Required cost factor 12
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY_DAYS = 7; // 7 days

class AuthService {
  /**
   * Hashes a token using SHA-256 for secure, indexed database storage.
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates short-lived access token
   */
  generateAccessToken(user) {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      config.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  }

  /**
   * Generates long-lived refresh token
   */
  generateRefreshToken(user) {
    return jwt.sign(
      {
        userId: user.id,
        jti: crypto.randomBytes(16).toString('hex'), // Unique token identifier
      },
      config.jwtRefreshSecret,
      { expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` }
    );
  }

  /**
   * Signup new user with role='customer' and bcrypt cost factor 12
   */
  async signup({ email, password, fullName }) {
    if (!email || !password) {
      throw ApiError.badRequest('Email and password are required');
    }

    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      throw ApiError.badRequest('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const newUser = await userRepository.create({
      email,
      passwordHash,
      fullName: fullName || null,
      role: 'customer', // Enforced role
    });

    return {
      id: newUser.id,
      email: newUser.email,
      fullName: newUser.full_name,
      role: newUser.role,
      createdAt: newUser.created_at,
    };
  }

  // Alias for backward compatibility
  async register(data) {
    return this.signup(data);
  }

  /**
   * Authenticate user, issue access + refresh tokens, store hashed refresh token
   */
  async login({ email, password }) {
    if (!email || !password) {
      throw ApiError.badRequest('Email and password are required');
    }

    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const accessToken = this.generateAccessToken(user);
    const rawRefreshToken = this.generateRefreshToken(user);

    // Hash refresh token before persisting to database
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await refreshTokenRepository.create({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Validate refresh token, execute rotation, and issue fresh access + refresh tokens
   */
  async refreshToken(rawRefreshToken) {
    if (!rawRefreshToken) {
      throw ApiError.badRequest('Refresh token is required');
    }

    let decoded;
    try {
      decoded = jwt.verify(rawRefreshToken, config.jwtRefreshSecret);
    } catch (err) {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const tokenRecord = await refreshTokenRepository.findByTokenHash(tokenHash);

    if (!tokenRecord) {
      throw ApiError.unauthorized('Refresh token not recognized');
    }

    // Reuse detection: If token was already revoked, someone may have compromised it
    if (tokenRecord.revoked_at) {
      // Invalidate all tokens for this user as a security safeguard
      await refreshTokenRepository.revokeAllForUser(tokenRecord.user_id);
      throw ApiError.unauthorized('Refresh token reuse detected. Access revoked for security.');
    }

    // Check expiration against database record
    if (new Date() > new Date(tokenRecord.expires_at)) {
      throw ApiError.unauthorized('Refresh token has expired');
    }

    const user = await userRepository.findById(tokenRecord.user_id);
    if (!user) {
      throw ApiError.unauthorized('User associated with token no longer exists');
    }

    // Issue rotated tokens
    const newAccessToken = this.generateAccessToken(user);
    const newRefreshToken = this.generateRefreshToken(user);
    const newTokenHash = this.hashToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // Invalidate old token and record successor
    await refreshTokenRepository.revoke(tokenRecord.id, newTokenHash);

    // Save newly issued hashed token
    await refreshTokenRepository.create({
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt: newExpiresAt,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }
}

module.exports = new AuthService();
