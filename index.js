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
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// ========== STRIPE SETUP ==========
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

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

// ========== HELPERS ==========
function getUsers() {
  try {
    return JSON.parse(fs.readFileSync('users.json', 'utf8'));
  } catch {
    return [];
  }
}
function saveUsers(users) {
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
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

// Ratings (local)
function getRatings() {
  try {
    return JSON.parse(fs.readFileSync('ratings.json', 'utf8'));
  } catch {
    return [];
  }
}
function saveRatings(ratings) {
  fs.writeFileSync('ratings.json', JSON.stringify(ratings, null, 2));
}

// Local tracks (no CSV)
function getTracks() {
  try {
    return JSON.parse(fs.readFileSync('tracks.json', 'utf8'));
  } catch {
    return [];
  }
}
function saveTracks(tracks) {
  fs.writeFileSync('tracks.json', JSON.stringify(tracks, null, 2));
}

// ADVANCED WATERMARK
async function applyUniqueWatermark(inputPath, outputPath, userId) {
  return new Promise((resolve, reject) => {
    const beepPath = path.join(__dirname, 'watermarks', 'beep.mp3');
    const randomOffset = Math.floor(Math.random() * 20) + 5;

    console.log(`[Watermark] Embedding beep for user ${userId} at ${randomOffset}s`);

    ffmpeg(inputPath)
      .input(beepPath)
      .complexFilter([
        {
          filter: 'adelay',
          options: `${randomOffset * 1000}|${randomOffset * 1000}`,
          inputs: '[1:a]',
          outputs: 'delayedBeep'
        },
        {
          filter: 'volume',
          options: '0.2', // quiet
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
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .save(outputPath);
  });
}

// ========== ROUTES ==========

// HOME
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});
app.get('/tracks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tracks.html'));
});

// SUBMIT PAGE (protected)
app.get('/submit.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','You must be logged in.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'submit.html'));
});

// PROFILE (protected)
app.get('/profile.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','Login first.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// FAQ
app.get('/faq.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'faq.html'));
});

// LOGIN / REGISTER
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// SUCCESS / CANCEL
app.get('/success.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});
app.get('/cancel.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cancel.html'));
});

// ========== /api/tracks (Local) ==========
app.get('/api/tracks', (req, res) => {
  try {
    const allTracks = getTracks(); 
    const ratings = getRatings();

    // Merge rating
    const tracks = allTracks.map(t => {
      const trackRatings = ratings.filter(r => r.trackId === String(t.id));
      let avgRating = null;
      if (trackRatings.length > 0) {
        const sum = trackRatings.reduce((acc, rr) => acc + rr.rating, 0);
        avgRating = parseFloat((sum / trackRatings.length).toFixed(1));
      }
      return {
        ...t,
        avgRating
      };
    });
    res.json(tracks);
  } catch (err) {
    console.error('Error reading local tracks:', err);
    res.status(500).json({ error: 'Failed to load tracks' });
  }
});

// DOWNLOAD (membership gating)
app.get('/download/:fileName', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','Log in first.'));
  }
  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user || !user.isPaid) {
    return res.status(403).send(generateErrorPage('Forbidden','Must be paid.'));
  }
  const filePath = path.join(__dirname, 'uploads', req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(generateErrorPage('Not Found','File not found.'));
  }
  res.download(filePath);
});

// SUBMIT (UPLOAD) w/ watermark
app.post('/submit', upload.fields([
  { name: 'trackFile', maxCount: 1 },
  { name: 'artwork', maxCount: 1 }
]), async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','Log in to submit.'));
  }

  const { title, artist } = req.body;
  const trackFile = req.files.trackFile ? req.files.trackFile[0] : null;
  const artworkFile = req.files.artwork ? req.files.artwork[0] : null;
  if (!trackFile) {
    return res.status(400).send(generateErrorPage('No Track File','Upload an audio file.'));
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
    // if watermark fails, keep original
  }

  let localTracks = [];
  try {
    localTracks = JSON.parse(fs.readFileSync('tracks.json', 'utf8'));
  } catch {
    console.warn('tracks.json not found; starting fresh...');
  }
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
      <h1>Track Submitted</h1>
      <p><strong>Title:</strong> ${newTrack.title}</p>
      <p><strong>Artist:</strong> ${newTrack.artist}</p>
      ${artworkFile ? `<p><strong>Artwork:</strong> ${artworkFile.originalname}</p>` : ''}
      <p><strong>Expires On:</strong> ${twoMonthsFromNow.toDateString()}</p>
      <p>Unique beep watermark for user ID: ${req.session.userId}</p>
      <a href="/" class="button">Home</a>
    </main>
    <footer>
      <p>&copy; 2025 DubVault. All rights reserved.</p>
    </footer>
  </body>
  </html>
  `);
});

// AUTH
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const users = getUsers();
  if (users.some(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  const hashed = await bcrypt.hash(password, 10);
  const newUser = { id: Date.now(), username, password: hashed, isPaid: false };
  users.push(newUser);
  saveUsers(users);
  req.session.userId = newUser.id;
  return res.json({ success: true, redirect: '/profile.html' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = getUsers();
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(400).json({ error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  return res.json({ success: true, redirect: '/profile.html' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, redirect: '/' });
});

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

// RATING
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
  const existing = ratings.find(r => r.trackId === trackId && r.userId === req.session.userId);
  if (existing) {
    existing.rating = numRating;
  } else {
    ratings.push({ trackId, userId: req.session.userId, rating: numRating });
  }
  saveRatings(ratings);
  res.json({ success: true });
});
app.get('/api/ratings', (req, res) => {
  res.json(getRatings());
});

// STRIPE checkout
app.post('/create-checkout-session', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send('You must be logged in first.');
  }
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: { name: "DubVault Premium Subscription" },
            unit_amount: 2000, // e.g. £20
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

app.post('/create-portal-session', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).send('Missing session_id');
  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: checkoutSession.customer,
      return_url: req.headers.origin,
    });
    return res.redirect(303, portalSession.url);
  } catch (err) {
    console.error('[Stripe] Error creating portal session:', err);
    return res.status(500).send('Could not create portal session');
  }
});

app.get('/payment-success', async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId || !req.session.userId) {
    return res.redirect('/');
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
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

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DubVault running on port ${PORT}`));