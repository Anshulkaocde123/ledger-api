const authService = require('../services/auth.service');
const { sendSuccess } = require('../utils/response');

class AuthController {
  async register(req, res, next) {
    try {
      const { email, password, fullName } = req.body;
      const user = await authService.register({ email, password, fullName });
      return sendSuccess(res, user, 201, 'User registered successfully');
    } catch (err) {
      return next(err);
    }
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
}

module.exports = new AuthController();
