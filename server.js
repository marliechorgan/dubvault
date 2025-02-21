require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const logger = require('./utils/logger');

// Import Routes
const authRoutes = require('./routes/auth');
const tracksRoutes = require('./routes/tracks');
const paymentsRoutes = require('./routes/payments');
const loyaltyRoutes = require('./routes/loyalty');

const app = express();

app.set('trust proxy', 1);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com"
        ],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
        fontSrc: ["'self'", "https://fonts.gstatic.com"]
      }
    }
  })
);
app.use(cors());
app.use(compression());

// Rate limiter for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', apiLimiter);

// Session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'some_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// Parsing middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/artworks', express.static(path.join(__dirname, 'artworks')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount routes
app.use('/api', authRoutes);
app.use('/api', tracksRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', loyaltyRoutes);

// Serve HTML pages for non-API routes


app.get('/submit.html', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res
      .status(401)
      .send('<h1>Unauthorized</h1><p>You must be logged in.</p>');
  }
  res.sendFile(path.join(__dirname, 'public', 'submit.html'));
});
app.get('/profile.html', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'profile.html'))
);
app.get('/faq.html', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'faq.html'))
);
app.get('/login.html', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
);
app.get('/register.html', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'register.html'))
);
app.get('/success.html', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'success.html'))
);
app.get('/cancel.html', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'cancel.html'))
);

// Admin login endpoint (Mock admin login – replace with secure auth later)
app.post('/api/admin-login', (req, res) => {
    if (req.body.password === 'admin123') {
      req.session.isAdmin = true;
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

// 404 handler
app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`DubVault running on port ${PORT}`));