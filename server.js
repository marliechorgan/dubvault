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
app.get('/api/tracks', (req, res) => {
let allTracks = getTracks();
if (req.session && req.session.userId) {
  const userId = req.session.userId;
  const userTracks = allTracks.filter(t => t.artist == userId);
  const publicTracks = allTracks.filter(t => t.artist != userId && t.status === 'approved');
  allTracks = [...publicTracks, ...userTracks];
} else {
  allTracks = allTracks.filter(t => t.status === 'approved');
}
const ratings = getRatings();
const comments = getComments();
const mergedTracks = allTracks.map(t => {
  const trackRatings = ratings.filter(r => r.trackId === String(t.id));
  let avgRating = trackRatings.length > 0 ? Math.round(trackRatings.reduce((acc, rr) => acc + parseInt(rr.vote), 0) / trackRatings.length) : 0;
  const trackComments = comments.filter(c => c.trackId === String(t.id));
  return { ...t, avgRating, comments: trackComments };
});
res.json(mergedTracks);
});

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