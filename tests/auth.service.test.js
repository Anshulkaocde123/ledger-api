const authService = require('../src/services/auth.service');
const userRepository = require('../src/repositories/user.repository');
const refreshTokenRepository = require('../src/repositories/refreshToken.repository');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');
const ApiError = require('../src/utils/apiError');

jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/refreshToken.repository');

describe('AuthService Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('should create a user with bcrypt cost factor 12 and customer role', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.create.mockImplementation(async ({ email, passwordHash, fullName, role }) => ({
        id: 'user-uuid-1',
        email,
        password_hash: passwordHash,
        full_name: fullName,
        role,
        created_at: new Date(),
      }));

      const result = await authService.signup({
        email: 'alice@example.com',
        password: 'Password123!',
        fullName: 'Alice Smith',
      });

      expect(result.id).toBe('user-uuid-1');
      expect(result.email).toBe('alice@example.com');
      expect(result.role).toBe('customer');

      // Verify that repository was called with role 'customer' and a cost-12 hash
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'alice@example.com',
          role: 'customer',
          passwordHash: expect.stringMatching(/^\$2[ab]\$12\$/),
        })
      );
    });

    it('should throw 400 if user email already exists', async () => {
      userRepository.findByEmail.mockResolvedValue({ id: 'existing-id' });

      await expect(
        authService.signup({ email: 'alice@example.com', password: 'Password123!' })
      ).rejects.toThrow(ApiError);
    });
  });

  describe('login', () => {
    it('should issue access token (15m), refresh token (7d), and store hashed refresh token', async () => {
      const password = 'CorrectPassword123!';
      const passwordHash = await bcrypt.hash(password, 12);

      userRepository.findByEmail.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'alice@example.com',
        password_hash: passwordHash,
        role: 'customer',
        full_name: 'Alice Smith',
      });

      refreshTokenRepository.create.mockResolvedValue({ id: 'rt-1' });

      const result = await authService.login({
        email: 'alice@example.com',
        password,
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();

      // Verify access token expiration & contents
      const decodedAccess = jwt.verify(result.accessToken, config.jwtSecret);
      expect(decodedAccess.userId).toBe('user-uuid-1');
      expect(decodedAccess.role).toBe('customer');
      expect(decodedAccess.exp - decodedAccess.iat).toBe(15 * 60); // 15 minutes

      // Verify refresh token expiration & contents
      const decodedRefresh = jwt.verify(result.refreshToken, config.jwtRefreshSecret);
      expect(decodedRefresh.userId).toBe('user-uuid-1');
      expect(decodedRefresh.exp - decodedRefresh.iat).toBe(7 * 24 * 60 * 60); // 7 days

      // Verify refresh token was hashed in DB
      expect(refreshTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-uuid-1',
          tokenHash: authService.hashToken(result.refreshToken),
          expiresAt: expect.any(Date),
        })
      );
    });

    it('should throw 401 on incorrect password', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword123!', 12);
      userRepository.findByEmail.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'alice@example.com',
        password_hash: passwordHash,
      });

      await expect(
        authService.login({ email: 'alice@example.com', password: 'WrongPassword' })
      ).rejects.toThrow(ApiError);
    });
  });

  describe('refreshToken (rotation & reuse detection)', () => {
    it('should successfully rotate tokens on valid refresh request', async () => {
      const user = { id: 'user-uuid-1', email: 'alice@example.com', role: 'customer' };
      const rawRefreshToken = authService.generateRefreshToken(user);
      const tokenHash = authService.hashToken(rawRefreshToken);

      refreshTokenRepository.findByTokenHash.mockResolvedValue({
        id: 'token-db-1',
        user_id: user.id,
        token_hash: tokenHash,
        revoked_at: null,
        expires_at: new Date(Date.now() + 1000 * 60 * 60), // Valid in future
      });

      userRepository.findById.mockResolvedValue(user);
      refreshTokenRepository.revoke.mockResolvedValue({});
      refreshTokenRepository.create.mockResolvedValue({});

      const response = await authService.refreshToken(rawRefreshToken);

      expect(response.accessToken).toBeDefined();
      expect(response.refreshToken).toBeDefined();
      expect(response.refreshToken).not.toBe(rawRefreshToken); // Must be rotated!

      // Old token should be revoked with link to new token hash
      expect(refreshTokenRepository.revoke).toHaveBeenCalledWith(
        'token-db-1',
        authService.hashToken(response.refreshToken)
      );

      // New token should be stored hashed
      expect(refreshTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: user.id,
          tokenHash: authService.hashToken(response.refreshToken),
        })
      );
    });

    it('should detect reuse of revoked token, revoke all tokens for user, and throw 401', async () => {
      const user = { id: 'user-uuid-1', email: 'alice@example.com', role: 'customer' };
      const rawRefreshToken = authService.generateRefreshToken(user);
      const tokenHash = authService.hashToken(rawRefreshToken);

      // Token already revoked!
      refreshTokenRepository.findByTokenHash.mockResolvedValue({
        id: 'token-db-1',
        user_id: user.id,
        token_hash: tokenHash,
        revoked_at: new Date(Date.now() - 10000), // Already revoked
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
      });

      refreshTokenRepository.revokeAllForUser.mockResolvedValue();

      await expect(authService.refreshToken(rawRefreshToken)).rejects.toThrow(
        /reuse detected/i
      );

      // Invalidate all tokens for compromised account
      expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(user.id);
    });
  });

  describe('logout', () => {
    it('should revoke refresh token in database on logout', async () => {
      const rawRefreshToken = 'sample_refresh_token_to_revoke';
      const tokenHash = authService.hashToken(rawRefreshToken);

      refreshTokenRepository.findByTokenHash.mockResolvedValue({
        id: 'token-db-1',
        token_hash: tokenHash,
        revoked_at: null,
      });
      refreshTokenRepository.revoke.mockResolvedValue({});

      await authService.logout(rawRefreshToken);

      expect(refreshTokenRepository.revoke).toHaveBeenCalledWith('token-db-1');
    });

    it('should handle missing or empty refresh token gracefully', async () => {
      await authService.logout(null);
      expect(refreshTokenRepository.revoke).not.toHaveBeenCalled();
    });
  });
});
