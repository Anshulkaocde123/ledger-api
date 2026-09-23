const express = require('express');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler.middleware');
const ApiError = require('./utils/apiError');

const app = express();

// Global Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const path = require('path');

// Base API Route
app.use('/api/v1', routes);

// Serve Interactive Web Workbench & Inspector
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));
app.get(['/', '/console'], (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Catch 404
app.use((req, res, next) => {
  next(ApiError.notFound(`Cannot find ${req.method} ${req.originalUrl} on this server`));
});

// Centralized Error Handling Middleware
app.use(errorHandler);

module.exports = app;
