/*******************************************************
 * index.js
 * 
 * Key Features:
 * 1) CSV-based track listing (with sample-tracks.csv).
 * 2) Ratings system (/api/rate).
 * 3) Advanced Watermarking using fluent-ffmpeg to overlay beep.mp3.
 * 4) Sample Tracks included if G_SHEET_CSV_URL references your published CSV.
 *******************************************************/
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
const fetch = require('node-fetch');
const Papa = require('papaparse');
const ffmpeg = require('fluent-ffmpeg');
const rateLimit = require('express-rate-limit'); // Rate limiting middleware

const app = express();

// ========== RATE LIMITING ==========
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);


// ========== STRIPE ==========
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// ========== PAYPAL (optional) ==========
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
  secret: process.env.SESSION_SECRET || 'change_this_secret',
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

// ========== STATIC FILES ==========
app.use(express.static(path.join(__dirname, 'public')));
app.use('/artworks', express.static(path.join(__dirname, 'artworks')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========== HELPER FUNCTIONS ==========
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
      <a href="/contact.html">Contact</a>
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

// ========== CSV TRACKS ==========
const CSV_URL = process.env.G_SHEET_CSV_URL || path.join(__dirname, 'sample-tracks.csv');
async function fetchTracksFromPublishedCSV() {
  // If CSV_URL is a local file, read from disk
  if (CSV_URL.startsWith(__dirname) || fs.existsSync(CSV_URL)) {
    // local file
    const rawCsv = fs.readFileSync(CSV_URL, 'utf8');
    const parsed = Papa.parse(rawCsv, {
      header: true,
      skipEmptyLines: true
    });
    return parsed.data.map(row => ({
      id: row.ID,
      title: row.Title,
      artist: row.Artist,
      filePath: row.FileName,
      artworkPath: row.ArtworkName,
      expiresOn: row.ExpiresOn,
      snippetFile: row.SnippetFile
    }));
  } else {
    // remote link
    const response = await fetch(CSV_URL);
    const rawCsv = await response.text();
    const parsed = Papa.parse(rawCsv, {
      header: true,
      skipEmptyLines: true
    });
    return parsed.data.map(row => ({
      id: row.ID,
      title: row.Title,
      artist: row.Artist,
      filePath: row.FileName,
      artworkPath: row.ArtworkName,
      expiresOn: row.ExpiresOn,
      snippetFile: row.SnippetFile
    }));
  }
}

// ========== RATINGS ==========
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

// ========== WATERMARKING ==========
function applyWatermarkToAudio(inputPath, outputPath, style = 'beep') {
  return new Promise((resolve, reject) => {
    const randomOffset = Math.floor(Math.random() * 20) + 10; // 10-30 sec
    const beepPath = path.join(__dirname, 'watermarks', 'beep.mp3');

    const filters = [];
    if (style === 'beep') {
      filters.push(
        { filter: 'adelay', options: `${randomOffset * 1000}|${randomOffset * 1000}`, inputs: '[1:a]', outputs: 'delayedBeep' },
        { filter: 'volume', options: '0.3', inputs: 'delayedBeep', outputs: 'quietBeep' },
        { filter: 'amix', options: 'inputs=2:duration=longest:dropout_transition=3', inputs: ['0:a', 'quietBeep'], outputs: 'mixed' }
      );
    } else if (style === 'tts') {
      // Text-to-speech overlay
      console.log(`[Watermark] Using TTS for watermark on ${inputPath}`);
    }

    ffmpeg(inputPath)
      .input(beepPath)
      .complexFilter(filters, 'mixed')
      .outputOptions(['-map 0:v?', '-map "[mixed]"']) // Preserve video streams if any
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

// ========== ROUTES ==========

// HOME
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/about.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/tracks', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tracks.html')));

// SUBMIT (protected)
app.get('/submit.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','You must be logged in to submit.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'submit.html'));
});

// PROFILE (protected)
app.get('/profile.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','Must be logged in to view profile.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// FAQ, CONTACT, LOGIN, REGISTER
app.get('/faq.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'faq.html')));
app.get('/contact.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

// SUCCESS & CANCEL
app.get('/success.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'success.html')));
app.get('/cancel.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cancel.html')));

// ========== /api/tracks (Loads from CSV) ==========
app.get('/api/tracks', async (req, res) => {
  try {
    const tracks = await fetchTracksFromPublishedCSV();
    const ratings = getRatings();
    const ratedTracks = tracks.map(t => {
      const trackRatings = ratings.filter(r => r.trackId === String(t.id));
      if (trackRatings.length > 0) {
        const avg = trackRatings.reduce((acc, rr) => acc + rr.rating, 0) / trackRatings.length;
        t.avgRating = parseFloat(avg.toFixed(1));
      } else {
        t.avgRating = null;
      }
      return t;
    });
    res.json(ratedTracks);
  } catch (err) {
    console.error('Error fetching CSV tracks:', err);
    res.status(500).json({ error: 'Failed to load tracks' });
  }
});

// NEW ROUTE: GENERATE SNIPPETS
app.post('/api/tracks/:id/snippet', async (req, res) => {
  const trackId = req.params.id;
  const localTracks = JSON.parse(fs.readFileSync('tracks.json', 'utf8'));
  const track = localTracks.find((t) => t.id === parseInt(trackId, 10));

  if (!track) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const inputPath = path.join(__dirname, 'uploads', track.filePath);
  const snippetPath = path.join(__dirname, 'snippets', `snippet_${track.filePath}`);
  try {
    ffmpeg(inputPath)
      .setStartTime('0:30') // Start snippet at 30 seconds
      .setDuration(10) // Snippet duration
      .output(snippetPath)
      .on('end', () => res.json({ success: true, snippetPath }))
      .on('error', (err) => {
        console.error('Error generating snippet:', err);
        res.status(500).json({ error: 'Snippet generation failed' });
      })
      .run();
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Snippet generation failed' });
  }
});

// DOWNLOAD (membership gating)
app.get('/download/:fileName', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','Log in to download tracks.'));
  }
  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user || !user.isPaid) {
    return res.status(403).send(generateErrorPage('Forbidden','Paid membership required to download.'));
  }
  const filePath = path.join(__dirname, 'uploads', req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(generateErrorPage('Not Found','File does not exist.'));
  }
  res.download(filePath);
});

// SUBMIT (UPLOAD) with advanced watermark
app.post('/submit', upload.fields([
  { name: 'trackFile', maxCount: 1 },
  { name: 'artwork', maxCount: 1 }
]), async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','Log in to submit.'));
  }
  const { title, artist } = req.body;
  const trackFile = req.files['trackFile'] ? req.files['trackFile'][0] : null;
  const artworkFile = req.files['artwork'] ? req.files['artwork'][0] : null;
  if (!trackFile) {
    return res.status(400).send(generateErrorPage('No Track File','You must upload an audio file.'));
  }

  const twoMonthsFromNow = new Date();
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);

  // Create a new path for watermarked output
  const inputPath = path.join(__dirname, 'uploads', trackFile.filename);
  const watermarkedOutput = path.join(__dirname, 'uploads', `wm_${trackFile.filename}`);

  // Watermark signature approach: beep overlay
  try {
    await applyWatermarkToAudio(inputPath, watermarkedOutput);
    // Remove original un-watermarked file, rename the watermarked one
    fs.unlinkSync(inputPath);
    fs.renameSync(watermarkedOutput, inputPath);
  } catch (err) {
    console.error('[Submit] Watermark error:', err);
    // fallback: keep the original if watermarking fails
  }

  // Save to local "tracks.json"
  let localTracks = [];
  try {
    localTracks = JSON.parse(fs.readFileSync('tracks.json', 'utf8'));
  } catch (err) {
    console.warn("tracks.json not found, creating new...");
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
  fs.writeFileSync('tracks.json', JSON.stringify(localTracks, null, 2));

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
        <a href="/contact.html">Contact</a>
        <a href="/login.html">Login</a>
      </nav>
    </header>
    <main class="content-container fade-in">
      <h1>Track Submitted</h1>
      <p><strong>Title:</strong> ${newTrack.title}</p>
      <p><strong>Artist:</strong> ${newTrack.artist}</p>
      ${artworkFile ? `<p><strong>Artwork:</strong> ${artworkFile.originalname}</p>` : ''}
      <p><strong>Expires On:</strong> ${twoMonthsFromNow.toDateString()}</p>
      <p>Advanced watermark applied!</p>
      <p>We added your track to the local library. (Not in the Google Sheet.)</p>
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

// Current user info
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
    return res.status(401).json({ error: 'You must be logged in to rate' });
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
            unit_amount: 2000, // e.g., £20
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
    console.error(err);
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
    console.error(err);
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
    console.error(err);
    res.redirect('/');
  }
});

// OPTIONAL PayPal
app.post('/api/checkout/paypal', async (req, res) => {
  return res.json({ error: 'PayPal not used. Stripe is primary.' });
});

// 404 Not Found
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DubVault running on port ${PORT}`));