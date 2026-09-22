const express = require('express');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler.middleware');
const ApiError = require('./utils/apiError');

const app = express();

// Global Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Base API Route
app.use('/api/v1', routes);

// Catch 404
app.use((req, res, next) => {
  next(ApiError.notFound(`Cannot find ${req.method} ${req.originalUrl} on this server`));
});

// Centralized Error Handling Middleware
app.use(errorHandler);

module.exports = app;
