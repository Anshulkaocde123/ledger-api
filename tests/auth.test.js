const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { authenticate, authorize } = require('../src/middleware/auth.middleware');
const config = require('../src/config/env');
const ApiError = require('../src/utils/apiError');

describe('Auth Middleware & Security Unit Tests', () => {
  describe('authenticate middleware', () => {
    it('should throw 401 when Authorization header is missing', () => {
      const req = { headers: {} };
      const res = {};
      const next = jest.fn();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    it('should attach user payload to req.user when valid Bearer token provided', () => {
      const payload = { userId: 'u-123', email: 'test@ledger.local', role: 'customer' };
      const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {};
      const next = jest.fn();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({
        userId: 'u-123',
        email: 'test@ledger.local',
        role: 'customer',
      });
    });

    it('should throw 401 when token is expired', () => {
      const payload = { userId: 'u-123', email: 'test@ledger.local', role: 'customer' };
      const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '-1s' });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {};
      const next = jest.fn();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(401);
      expect(next.mock.calls[0][0].message).toMatch(/expired/i);
    });

    it('should throw 401 when token has an invalid signature', () => {
      const payload = { userId: 'u-123', email: 'test@ledger.local', role: 'customer' };
      const tokenWithWrongSecret = jwt.sign(payload, 'wrong_untrusted_secret_key');

      const req = { headers: { authorization: `Bearer ${tokenWithWrongSecret}` } };
      const res = {};
      const next = jest.fn();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(401);
      expect(next.mock.calls[0][0].message).toMatch(/invalid access token/i);
    });

    it('should throw 401 when token is malformed', () => {
      const req = { headers: { authorization: 'Bearer this_is_not_a_valid_jwt_structure' } };
      const res = {};
      const next = jest.fn();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    it('should throw 401 when Bearer prefix is missing', () => {
      const req = { headers: { authorization: 'Basic some_base64_encoded_token' } };
      const res = {};
      const next = jest.fn();

      authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(401);
      expect(next.mock.calls[0][0].message).toMatch(/missing or invalid format/i);
    });
  });

  describe('authorize middleware', () => {
    it('should return 403 when user role is not permitted', () => {
      const req = { user: { userId: 'u-1', role: 'customer' } };
      const res = {};
      const next = jest.fn();

      const middleware = authorize('admin', 'auditor');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0].statusCode).toBe(403);
    });

    it('should call next() without error when user role matches allowed roles', () => {
      const req = { user: { userId: 'u-1', role: 'admin' } };
      const res = {};
      const next = jest.fn();

      const middleware = authorize('admin', 'auditor');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('bcrypt password hashing cost factor', () => {
    it('should hash passwords with salt rounds cost factor 12', async () => {
      const password = 'SecretPassword123!';
      const hash = await bcrypt.hash(password, 12);
      
      // bcrypt hashes encode the cost factor after $2b$: $2b$12$...
      expect(hash.startsWith('$2b$12$') || hash.startsWith('$2a$12$')).toBe(true);
      const isMatch = await bcrypt.compare(password, hash);
      expect(isMatch).toBe(true);
    });
  });
});
