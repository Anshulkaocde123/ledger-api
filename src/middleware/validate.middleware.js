const ApiError = require('../utils/apiError');

/**
 * Generic request validator helper
 * Accepts a validation function or schema validator
 */
const validate = (validatorFn) => (req, res, next) => {
  try {
    const errors = validatorFn(req);
    if (errors && errors.length > 0) {
      return next(ApiError.badRequest(`Validation error: ${errors.join(', ')}`));
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  validate,
};
