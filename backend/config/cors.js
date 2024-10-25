const rateLimit = require('express-rate-limit');

// CORS Configuration
const allowedOrigins = [
    'http://localhost:3000',
    'https://andrewy7.github.io',
    'https://andrewy7.github.io/integratingagents/',
  ];
  
  const corsOptions = {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  };
  
  // Rate Limiting
  const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 50,
    handler: (req, res) => {
      console.error('Rate limit exceeded for IP:', req.ip);
      res.status(429).json({
        error: 'Too many requests. Please wait before trying again.',
        retryAfter: Math.ceil(60 - Date.now() / 1000 % 60)
      });
    }
  });
  
  module.exports = {
    corsOptions,
    limiter,
    allowedOrigins
  };