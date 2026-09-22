const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const config = require('../config/env');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';
    error = new ApiError(statusCode, message, false, err.stack);
  }

  const { statusCode, message, isOperational } = error;

  if (!isOperational) {
    logger.error(`[Unhandled Error] ${req.method} ${req.originalUrl}:`, {
      message: error.message,
      stack: error.stack,
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(config.nodeEnv === 'development' && { stack: error.stack }),
  });
};

module.exports = errorHandler;
