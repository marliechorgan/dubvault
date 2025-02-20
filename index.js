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

// Log the current environment for debugging
console.log("NODE_ENV:", process.env.NODE_ENV);

// Trust proxy (required by Render)
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// Stripe & PayPal Setup
const stripeInstance = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const Environment = process.env.NODE_ENV === 'production'
  ? paypal.core.LiveEnvironment
  : paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(
    process.env.PAYPAL_CLIENT_ID || 'PAYPAL_CLIENT_ID',
    process.env.PAYPAL_CLIENT_SECRET || 'PAYPAL_CLIENT_SECRET'
  )
);

// Multer (File Upload)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.fieldname === 'artwork' ? 'artworks' : 'uploads';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Session Setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'some_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    domain: process.env.NODE_ENV === 'production' ? '.dubvault.co.uk' : undefined,
  }
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Static Files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/artworks', express.static(path.join(__dirname, 'artworks')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Helper Functions
function getUsers() {
  try {
    if (!fs.existsSync('users.json')) {
      fs.writeFileSync('users.json', JSON.stringify([]));
    }
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
    if (!fs.existsSync('tracks.json')) {
      fs.writeFileSync('tracks.json', JSON.stringify([]));
    }
    const data = fs.readFileSync('tracks.json', 'utf8');
    const tracks = JSON.parse(data);
    if (!tracks || tracks.length === 0) {
      const sampleTracks = [
        {
          id: Date.now(),
          title: "Sample Dub 1",
          artist: "Underground Artist",
          filePath: "sample1.mp3",
          artworkPath: "sample_artwork1.jpg",
          expiresOn: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: Date.now() + 1,
          title: "Sample Dub 2",
          artist: "Local Producer",
          filePath: "sample2.mp3",
          artworkPath: "sample_artwork2.jpg",
          expiresOn: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
        }
      ];
      saveTracks(sampleTracks);
      console.log("Created sample tracks:", sampleTracks);
      return sampleTracks;
    }
    return tracks;
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
    if (!fs.existsSync('ratings.json')) {
      fs.writeFileSync('ratings.json', JSON.stringify([]));
    }
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
    <p>© 2025 DubVault. All rights reserved.</p>
  </footer>
</body>
</html>
  `;
}

// Advanced Watermark (Skipping as per your request)
async function applyUniqueWatermark(inputPath, outputPath, userId) {
  return new Promise((resolve, reject) => {
    const beepPath = path.join(__dirname, 'watermarks', 'beep.mp3');
    if (!fs.existsSync(beepPath)) {
      console.warn('Watermark beep.mp3 not found; skipping watermark');
      fs.copyFileSync(inputPath, outputPath);
      return resolve();
    }
    const randomOffset = Math.floor(Math.random() * 20) + 5;
    console.log(`[Watermark] Embedding beep for user ${userId} at ${randomOffset}s`);
    ffmpeg(inputPath)
      .input(beepPath)
      .complexFilter([
        { filter: 'adelay', options: `${randomOffset * 1000}|${randomOffset * 1000}`, inputs: '1:a', outputs: 'delayedBeep' },
        { filter: 'volume', options: '0.2', inputs: 'delayedBeep', outputs: 'quietBeep' },
        { filter: 'amix', options: 'inputs=2:duration=longest:dropout_transition=3', inputs: ['0:a', 'quietBeep'], outputs: 'mixed' }
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

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

app.get('/tracks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tracks.html'));
});

app.get('/submit.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized', 'You must be logged in.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'submit.html'));
});

app.get('/profile.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized', 'Login first.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/faq.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'faq.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/success.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

app.get('/cancel.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cancel.html'));
});

// Debug Endpoint: Return Entire Session
app.get('/api/debug', (req, res) => {
  console.log("[/api/debug] Session data:", req.session);
  res.json(req.session);
});

// Cancel Subscription Endpoint
app.post('/api/cancel-subscription', (req, res) => {
  console.log("[/api/cancel-subscription] Called. Session userId:", req.session.userId);
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  let users = getUsers();
  const userIndex = users.findIndex(u => u.id === req.session.userId);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }
  users[userIndex].isPaid = false;
  saveUsers(users);
  console.log("[/api/cancel-subscription] Subscription canceled for user:", req.session.userId);
  return res.json({ success: true });
});

// Get All Tracks (with ratings merged)
app.get('/api/tracks', (req, res) => {
  try {
    const allTracks = getTracks();
    const ratings = getRatings();
    const mergedTracks = allTracks.map(t => {
      const trackRatings = ratings.filter(r => r.trackId === String(t.id));
      let avgRating = null;
      if (trackRatings.length > 0) {
        const sum = trackRatings.reduce((acc, rr) => acc + rr.rating, 0);
        avgRating = parseFloat((sum / trackRatings.length).toFixed(1));
      }
      return { ...t, avgRating };
    });
    console.log("[/api/tracks] Returning tracks:", mergedTracks);
    res.json(mergedTracks);
  } catch (err) {
    console.error("Error reading tracks.json:", err);
    res.status(500).json({ error: 'Failed to load tracks' });
  }
});

// Submit Track Endpoint (protected)
app.post('/submit', upload.fields([
  { name: 'trackFile', maxCount: 1 },
  { name: 'artwork', maxCount: 1 }
]), async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized', 'Log in to submit.'));
  }
  const { title, artist } = req.body;
  const trackFile = req.files['trackFile'] ? req.files['trackFile'][0] : null;
  const artworkFile = req.files['artwork'] ? req.files['artwork'][0] : null;
  if (!trackFile) {
    return res.status(400).send(generateErrorPage('No Track File', 'Upload an audio file.'));
  }
  const twoMonthsFromNow = new Date();
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);
  const inputPath = path.join(__dirname, 'uploads', trackFile.filename);
  const watermarkedOutput = path.join(__dirname, 'uploads', `wm_${trackFile.filename}`);
  try {
    await applyUniqueWatermark(inputPath, watermarkedOutput, req.session.userId);
    fs.unlinkSync(inputPath);
    fs.renameSync(watermarkedOutput, inputPath);
  } catch (err) {
    console.error('[Watermark] Error:', err);
  }
  let localTracks = getTracks();
  const newTrack = {
    id: Date.now(),
    title: title || 'Untitled',
    artist: artist || 'Unknown Artist',
    filePath: trackFile.filename,
    artworkPath: artworkFile ? artworkFile.filename : null,
    expiresOn: twoMonthsFromNow.toISOString()
  };
  localTracks.push(newTrack);
  saveTracks(localTracks);
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Track Submitted - DubVault</title>
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      ${generateErrorPage("Track Submitted Successfully!", `
        <p><strong>Title:</strong> ${newTrack.title}</p>
        <p><strong>Artist:</strong> ${newTrack.artist}</p>
        ${artworkFile ? `<p><strong>Artwork:</strong> ${artworkFile.originalname}</p>` : ''}
        <p><strong>Expires On:</strong> ${twoMonthsFromNow.toDateString()}</p>
        <p><a href="/tracks" class="button">View All Tracks</a></p>
      `)}
    </body>
    </html>
  `);
});

// Register Endpoint
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  console.log("[/api/register] Attempting registration for:", username);
  let users = getUsers();
  if (users.some(u => u.username === username)) {
    console.log("[/api/register] Username already taken:", username);
    return res.status(400).json({ error: 'Username already taken' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: Date.now(), username, password: hashedPassword, isPaid: false };
    users.push(newUser);
    saveUsers(users);
    req.session.userId = newUser.id;
    req.session.save(err => {
      if (err) {
        console.error("[/api/register] Session save error:", err);
        return res.status(500).json({ error: 'Session save error' });
      }
      console.log("[/api/register] Registration successful for:", username);
      res.json({ success: true, redirect: '/profile.html' });
    });
  } catch (err) {
    console.error('Error during registration:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Login Endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  console.log("[/api/login] Login attempt for:", username);
  const users = getUsers();
  const user = users.find(u => u.username === username);
  if (!user) {
    console.log("[/api/login] User not found:", username);
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  try {
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log("[/api/login] Password mismatch for:", username);
      return res.status(400).json({ error: 'Invalid username or password' });
    }
    req.session.userId = user.id;
    req.session.save(err => {
      if (err) {
        console.error("[/api/login] Session save error:", err);
        return res.status(500).json({ error: 'Session save error' });
      }
      console.log("[/api/login] Login successful for:", username);
      res.json({ success: true, redirect: '/profile.html' });
    });
  } catch (err) {
    console.error('Error during user login:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Logout Endpoint
app.post('/api/logout', (req, res) => {
  console.log("[/api/logout] Logging out user:", req.session.userId);
  req.session.destroy(err => {
    if (err) {
      console.error('Error during logout:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    res.json({ success: true, redirect: '/' });
  });
});

// /api/me Endpoint
app.get('/api/me', (req, res) => {
  console.log("[/api/me] Called. Session userId:", req.session.userId);
  if (!req.session.userId) {
    console.log("[/api/me] No user is logged in.");
    return res.status(401).json({ error: 'Not logged in' });
  }
  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    console.log("[/api/me] User not found for session:", req.session.userId);
    return res.status(404).json({ error: 'User not found' });
  }
  console.log("[/api/me] Returning user:", user);
  res.json({ username: user.username, isPaid: user.isPaid });
});

// Stripe Checkout Endpoint
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
            unit_amount: 1500,
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

// Stripe Portal Session Endpoint
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

// Payment Success Endpoint
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

// Optional PayPal Endpoint
app.post('/api/checkout/paypal', async (req, res) => {
  return res.json({ error: 'PayPal not used. Stripe is primary now.' });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DubVault running on port ${PORT}`));