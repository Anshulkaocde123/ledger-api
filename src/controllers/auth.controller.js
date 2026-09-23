const authService = require('../services/auth.service');
const { sendSuccess } = require('../utils/response');

class AuthController {
  async signup(req, res, next) {
    try {
      const { email, password, fullName } = req.body;
      const user = await authService.signup({ email, password, fullName });
      return sendSuccess(res, user, 201, 'User account created successfully');
    } catch (err) {
      return next(err);
    }
  }

  // Alias for backward compatibility
  async register(req, res, next) {
    return this.signup(req, res, next);
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const authData = await authService.login({ email, password });
      return sendSuccess(res, authData, 200, 'Login successful');
    } catch (err) {
      return next(err);
    }
  }

  async refresh(req, res, next) {
    try {
      const refreshToken = req.body.refreshToken || req.headers['x-refresh-token'];
      const tokens = await authService.refreshToken(refreshToken);
      return sendSuccess(res, tokens, 200, 'Tokens refreshed successfully');
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new AuthController();
