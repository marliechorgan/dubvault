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
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
app.set('trust proxy', 1);

// Handle HTTPS redirection for production (Render uses x-forwarded-proto)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https' && req.url !== '/api/submit') {
    return res.redirect('https://' + req.headers.host + req.url);
  }
  next();
});

// MongoDB Connection
let client;
async function connectDB() {
  try {
    client = new MongoClient(process.env.MONGO_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      }
    });
    await client.connect();
    console.log('Connected to MongoDB Atlas');
    const db = client.db('dubvault');
    app.locals.db = db; // Store the database instance in app.locals for routes
    logger.info('MongoDB connection established successfully');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    logger.error('MongoDB connection failed: ' + err.message + '\nStack: ' + err.stack);
    app.locals.db = null; // Set to null if connection fails
  }
}

connectDB();

// Middleware to check if db is available
app.use((req, res, next) => {
  if (!app.locals.db) {
    logger.error('Database service unavailable during request to ' + req.url);
    return res.status(503).json({ error: 'Database service unavailable. Please try again later.' });
  }
  req.db = app.locals.db;
  next();
});

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.stripe.com"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com"
        ],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        connectSrc: ["'self'", "https://api.stripe.com", "https://res.cloudinary.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'", "https://checkout.stripe.com"]
      }
    }
  })
);

app.use(cors());
app.use(compression());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', apiLimiter);

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

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Mount routes (update these to use MongoDB)
const authRoutes = require('./routes/auth');
const tracksRoutes = require('./routes/tracks');
const paymentsRoutes = require('./routes/payments');
const loyaltyRoutes = require('./routes/loyalty');

app.use('/api', authRoutes);
app.use('/api', tracksRoutes);
app.use('/api', loyaltyRoutes);
app.use(paymentsRoutes);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/artworks', express.static(path.join(__dirname, 'artworks')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
app.get('/tracks', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'tracks.html'))
);

app.post('/api/admin-login', (req, res) => {
  if (req.body.password === 'admin123') {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.use((err, req, res, next) => {
  logger.error('Error handling request to ' + req.url + ': ' + err.stack);
  res.status(500).json({ error: 'Internal server error: ' + err.message });
});

const port = process.env.PORT || 10000; // Match Render's default port
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  logger.info(`Server started on port ${port}`);
});

// Ensure the client closes when the app shuts down
process.on('SIGTERM', () => client && client.close());
process.on('SIGINT', () => client && client.close());