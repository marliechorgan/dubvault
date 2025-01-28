// index.js

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Stripe = require('stripe');
const paypal = require('@paypal/checkout-server-sdk');
const ffmpeg = require('fluent-ffmpeg');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const app = express();

// ========== SECURITY MIDDLEWARE ==========
app.use(helmet());
app.use(cors());
app.use(compression());

// ========== RATE LIMITING ==========
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// ========== STRIPE SETUP ==========
const stripeInstance = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// ========== PAYPAL SETUP (Optional) ==========
const Environment = process.env.NODE_ENV === 'production'
  ? paypal.core.LiveEnvironment
  : paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(
    process.env.PAYPAL_CLIENT_ID || 'PAYPAL_CLIENT_ID',
    process.env.PAYPAL_CLIENT_SECRET || 'PAYPAL_CLIENT_SECRET'
  )
);

// ========== MULTER (FILE UPLOAD) ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'artwork') {
      cb(null, 'artworks/');
    } else {
      cb(null, 'uploads/');
    }
  },
  filename: (req, file, cb) => {
    // Unique filename to prevent collisions
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ========== SESSION ==========
app.use(session({
  secret: process.env.SESSION_SECRET || 'some_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: (process.env.NODE_ENV === 'production'),
    sameSite: 'lax'
  }
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// ========== STATIC ==========
app.use(express.static(path.join(__dirname, 'public')));
app.use('/artworks', express.static(path.join(__dirname, 'artworks')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========== HELPER FUNCTIONS ==========
function getUsers() {
  try {
    const data = fs.readFileSync('users.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading users.json:', err);
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Error writing to users.json:', err);
  }
}

function getTracks() {
  try {
    const data = fs.readFileSync('tracks.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading tracks.json:', err);
    return [];
  }
}

function saveTracks(tracks) {
  try {
    fs.writeFileSync('tracks.json', JSON.stringify(tracks, null, 2));
  } catch (err) {
    console.error('Error writing to tracks.json:', err);
  }
}

function getRatings() {
  try {
    const data = fs.readFileSync('ratings.json', 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading ratings.json:', err);
    return [];
  }
}

function saveRatings(ratings) {
  try {
    fs.writeFileSync('ratings.json', JSON.stringify(ratings, null, 2));
  } catch (err) {
    console.error('Error writing to ratings.json:', err);
  }
}

function generateErrorPage(title, message) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} - DubVault</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="header fade-in">
    <img src="/logo.jpg" alt="DubVault Logo" class="logo">
    <nav class="nav">
      <a href="/">Home</a>
      <a href="/about.html">About</a>
      <a href="/tracks">Tracks</a>
      <a href="/submit.html">Submit</a>
      <a href="/profile.html">My Profile</a>
      <a href="/faq.html">FAQ</a>
      <a href="/login.html">Login</a>
    </nav>
  </header>
  <main class="content-container fade-in">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="/" class="button">Return Home</a></p>
  </main>
  <footer>
    <p>&copy; 2025 DubVault. All rights reserved.</p>
  </footer>
</body>
</html>
  `;
}

// ========== ADVANCED WATERMARK ==========
async function applyUniqueWatermark(inputPath, outputPath, userId) {
  return new Promise((resolve, reject) => {
    const beepPath = path.join(__dirname, 'watermarks', 'beep.mp3');
    if (!fs.existsSync(beepPath)) {
      return reject(new Error('Watermark beep.mp3 not found.'));
    }

    const randomOffset = Math.floor(Math.random() * 20) + 5; // between 5 and 25 seconds

    console.log(`[Watermark] Embedding beep for user ${userId} at ${randomOffset}s`);

    ffmpeg(inputPath)
      .input(beepPath)
      .complexFilter([
        {
          filter: 'adelay',
          options: `${randomOffset * 1000}|${randomOffset * 1000}`,
          inputs: '1:a',
          outputs: 'delayedBeep'
        },
        {
          filter: 'volume',
          options: '0.2',
          inputs: 'delayedBeep',
          outputs: 'quietBeep'
        },
        {
          filter: 'amix',
          options: 'inputs=2:duration=longest:dropout_transition=3',
          inputs: ['0:a','quietBeep'],
          outputs: 'mixed'
        }
      ], 'mixed')
      .outputOptions(['-map 0:v?', '-map "[mixed]"'])
      .on('end', () => {
        console.log(`[Watermark] Watermarking completed for ${inputPath}`);
        resolve();
      })
      .on('error', err => {
        console.error('[Watermark] Error during watermarking:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

// ========== ROUTES ==========

// Home Page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// About Page
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

// Tracks Page
app.get('/tracks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tracks.html'));
});

// Submit Page (Protected)
app.get('/submit.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized', 'You must be logged in.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'submit.html'));
});

// Profile Page (Protected)
app.get('/profile.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized', 'Login first.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// FAQ Page
app.get('/faq.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'faq.html'));
});

// Login Page
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Register Page
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Success Page
app.get('/success.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Cancel Page
app.get('/cancel.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cancel.html'));
});

// ========== API ENDPOINTS ==========

// Get All Tracks
app.get('/api/tracks', (req, res) => {
  try {
    console.log("Fetching tracks from tracks.json...");
    const allTracks = getTracks();
    console.log("All Tracks:", allTracks);

    const ratings = getRatings();
    // Merge rating data
    const mergedTracks = allTracks.map(t => {
      const trackRatings = ratings.filter(r => r.trackId === String(t.id));
      let avgRating = null;
      if (trackRatings.length > 0) {
        const sum = trackRatings.reduce((acc, rr) => acc + rr.rating, 0);
        avgRating = parseFloat((sum / trackRatings.length).toFixed(1));
      }
      return { ...t, avgRating };
    });
    console.log("Merged track data:", mergedTracks);

    res.json(mergedTracks);
  } catch (err) {
    console.error("Error reading tracks.json:", err);
    res.status(500).json({ error: 'Failed to load tracks' });
  }
});

// Submit a Track (Protected)
app.post('/submit', upload.fields([
  { name: 'trackFile', maxCount: 1 },
  { name: 'artwork', maxCount: 1 }
]), async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized', 'Log in to submit.'));
  }

  const { title, artist } = req.body;
  const trackFile = req.files.trackFile ? req.files.trackFile[0] : null;
  const artworkFile = req.files.artwork ? req.files.artwork[0] : null;

  if (!trackFile) {
    return res.status(400).send(generateErrorPage('No Track File', 'Upload an audio file.'));
  }

  // Calculate expiration date (2 months from now)
  const twoMonthsFromNow = new Date();
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);

  const inputPath = path.join(__dirname, 'uploads', trackFile.filename);
  const watermarkedOutput = path.join(__dirname, 'uploads', `wm_${trackFile.filename}`);

  try {
    console.log(`[Submit] Watermarking track for user: ${req.session.userId}`);
    await applyUniqueWatermark(inputPath, watermarkedOutput, req.session.userId);
    fs.unlinkSync(inputPath);
    fs.renameSync(watermarkedOutput, inputPath);
  } catch (err) {
    console.error('[Watermark] Error:', err);
    // If watermarking fails, keep original
    // Optionally, inform the user
  }

  let localTracks = [];
  try {
    localTracks = getTracks();
  } catch (err) {
    console.warn('tracks.json not found or invalid; starting fresh...');
  }

  const newTrack = {
    id: Date.now(),
    title: title || 'Untitled',
    artist: artist || 'Unknown Artist',
    filePath: trackFile.filename, // e.g., "1684438742500-RUSHME.mp3"
    artworkPath: artworkFile ? artworkFile.filename : null,
    expiresOn: twoMonthsFromNow.toISOString()
  };

  localTracks.push(newTrack);
  saveTracks(localTracks);
  console.log('[Submit] New track saved to tracks.json:', newTrack);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Track Submitted - DubVault</title>
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      <header class="header fade-in">
        <img src="/logo.jpg" alt="DubVault Logo" class="logo">
        <nav class="nav">
          <a href="/">Home</a>
          <a href="/about.html">About</a>
          <a href="/tracks">Tracks</a>
          <a href="/submit.html">Submit</a>
          <a href="/profile.html">My Profile</a>
          <a href="/faq.html">FAQ</a>
          <a href="/login.html">Login</a>
        </nav>
      </header>
      <main class="content-container fade-in">
        <h1>Track Submitted Successfully!</h1>
        <p><strong>Title:</strong> ${newTrack.title}</p>
        <p><strong>Artist:</strong> ${newTrack.artist}</p>
        ${artworkFile ? `<p><strong>Artwork:</strong> ${artworkFile.originalname}</p>` : ''}
        <p><strong>Expires On:</strong> ${twoMonthsFromNow.toDateString()}</p>
        <a href="/tracks" class="button">View All Tracks</a>
      </main>
      <footer>
        <p>&copy; 2025 DubVault. All rights reserved.</p>
      </footer>
    </body>
    </html>
  `);
});

// ========== AUTHENTICATION ENDPOINTS ==========

// Register a New User
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const users = getUsers();

  if (users.some(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already taken' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: Date.now(), username, password: hashedPassword, isPaid: false };
    users.push(newUser);
    saveUsers(users);

    req.session.userId = newUser.id;
    res.json({ success: true, redirect: '/profile.html' });
  } catch (err) {
    console.error('Error during user registration:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Login User
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = getUsers();
  const user = users.find(u => u.username === username);

  if (!user) {
    return res.status(400).json({ error: 'Invalid username or password' });
  }

  try {
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    req.session.userId = user.id;
    res.json({ success: true, redirect: '/profile.html' });
  } catch (err) {
    console.error('Error during user login:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Logout User
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error during logout:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    res.json({ success: true, redirect: '/' });
  });
});

// Get Current User Info
app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ username: user.username, isPaid: user.isPaid });
});

// Ratings
app.post('/api/rate', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Must be logged in to rate' });
  }

  const { trackId, rating } = req.body;
  const numRating = parseInt(rating, 10);
  if (!trackId || isNaN(numRating) || numRating < 1 || numRating > 10) {
    return res.status(400).json({ error: 'Invalid rating or trackId' });
  }

  let ratings = getRatings();
  const existing = ratings.find(r => r.trackId === String(trackId) && r.userId === req.session.userId);
  if (existing) {
    existing.rating = numRating;
  } else {
    ratings.push({ trackId: String(trackId), userId: req.session.userId, rating: numRating });
  }
  saveRatings(ratings);
  res.json({ success: true });
});

app.get('/api/ratings', (req, res) => {
  res.json(getRatings());
});

// ========== STRIPE CHECKOUT ==========
app.post('/create-checkout-session', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send('You must be logged in first.');
  }
  try {
    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: { name: "DubVault Premium Subscription" },
            unit_amount: 2000, // £20
            recurring: { interval: 'month' }
          },
          quantity: 1,
        },
      ],
      success_url: `${req.headers.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/cancel.html`,
    });
    return res.redirect(303, session.url);
  } catch (err) {
    console.error('[Stripe] Error creating session:', err);
    return res.status(500).send('Could not create Stripe checkout session');
  }
});

// Create Stripe Portal Session
app.post('/create-portal-session', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).send('Missing session_id');
  try {
    const checkoutSession = await stripeInstance.checkout.sessions.retrieve(session_id);
    const portalSession = await stripeInstance.billingPortal.sessions.create({
      customer: checkoutSession.customer,
      return_url: req.headers.origin,
    });
    return res.redirect(303, portalSession.url);
  } catch (err) {
    console.error('[Stripe] Error creating portal session:', err);
    return res.status(500).send('Could not create portal session');
  }
});

// Payment Success Route
app.get('/payment-success', async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId || !req.session.userId) {
    return res.redirect('/');
  }
  try {
    const session = await stripeInstance.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid') {
      const users = getUsers();
      const user = users.find(u => u.id === req.session.userId);
      if (user) {
        user.isPaid = true;
        saveUsers(users);
      }
    }
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
  } catch (err) {
    console.error('[Stripe] payment-success error:', err);
    res.redirect('/');
  }
});

// Optional PayPal
app.post('/api/checkout/paypal', async (req, res) => {
  return res.json({ error: 'PayPal not used. Stripe is primary now.' });
});

// 404 Page
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DubVault running on port ${PORT}`));