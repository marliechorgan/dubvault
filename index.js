/*******************************************************
 * index.js
 * 
 * Updated:
 *  - Adds /api/me route for user info
 *  - Adds rating system: /api/rate, /api/ratings
 *  - Watermark function stub to apply a signature
 *******************************************************/
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs'); // Using bcryptjs for no native binding issues
const multer = require('multer');
const Stripe = require('stripe');
const paypal = require('@paypal/checkout-server-sdk'); // optional

// For fetching & parsing the published Google Sheet CSV
const fetch = require('node-fetch'); // node-fetch@2
const Papa = require('papaparse');

const app = express();

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
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: (process.env.NODE_ENV === 'production'), // secure only in production
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

// ========== LOAD TRACKS FROM CSV ==========
const CSV_URL = process.env.G_SHEET_CSV_URL || 'YOUR_CSV_LINK_HERE';

async function fetchTracksFromPublishedCSV() {
  const response = await fetch(CSV_URL);
  const rawCsv = await response.text();
  const parsed = Papa.parse(rawCsv, {
    header: true,
    skipEmptyLines: true
  });
  // Columns: ID, Title, Artist, FileName, ArtworkName, ExpiresOn, SnippetFile
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

// ========== RATING LOGIC ==========
// We'll store ratings in a local `ratings.json` with structure:
// [
//   { trackId: "1001", userId: 12345, rating: 8 },
//   ...
// ]
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

// ========== WATERMARK STUB ==========
// In reality, you'd use an audio library (e.g. fluent-ffmpeg) to embed a signature.
function applyWatermarkToAudio(filePath, signature) {
  // Placeholder: we won't actually modify the file
  // In a real solution, you'd do something like:
  // ffmpeg input -> apply filter or overlay a beep at low volume -> output
  // For now, we just log that a watermark was "applied".
  console.log(`Applying watermark "${signature}" to ${filePath} (stub)`);
}

// ========== ROUTES ==========

// HOME
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ABOUT
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

// TRACKS
app.get('/tracks', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tracks.html'));
});

// SUBMIT (protected)
app.get('/submit.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','You must be logged in to submit a track.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'submit.html'));
});

// PROFILE (protected)
app.get('/profile.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','You must be logged in to view your profile.'));
  }
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// FAQ
app.get('/faq.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'faq.html'));
});

// CONTACT
app.get('/contact.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

// LOGIN
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// REGISTER
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// SUCCESS & CANCEL
app.get('/success.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});
app.get('/cancel.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cancel.html'));
});

// ========== /api/tracks (Loads from CSV) ==========
app.get('/api/tracks', async (req, res) => {
  try {
    const tracks = await fetchTracksFromPublishedCSV();
    // We'll also gather average ratings for each track, if any
    const ratings = getRatings();
    
    // For each track, compute average rating
    const ratedTracks = tracks.map(t => {
      const trackRatings = ratings.filter(r => r.trackId === t.id.toString());
      if (trackRatings.length > 0) {
        const avg = trackRatings.reduce((acc, rr) => acc + rr.rating, 0) / trackRatings.length;
        t.avgRating = parseFloat(avg.toFixed(1)); // 1 decimal
      } else {
        t.avgRating = null; // no ratings yet
      }
      return t;
    });

    res.json(ratedTracks);
  } catch (err) {
    console.error('Error fetching tracks from CSV:', err);
    res.status(500).json({ error: 'Failed to load tracks' });
  }
});

// ========== DOWNLOAD (membership gated) ==========
app.get('/download/:fileName', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','You must be logged in to download tracks.'));
  }
  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user || !user.isPaid) {
    return res.status(403).send(generateErrorPage('Forbidden','You need a paid membership to download tracks.'));
  }
  const filePath = path.join(__dirname, 'uploads', req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(generateErrorPage('Not Found','File does not exist.'));
  }
  res.download(filePath);
});

// ========== SUBMIT (UPLOAD) with Watermark ==========
// STILL writes to tracks.json if you want user submissions stored locally.
app.post('/submit', upload.fields([
  { name: 'trackFile', maxCount: 1 },
  { name: 'artwork', maxCount: 1 }
]), (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage('Unauthorized','You must be logged in to submit a track.'));
  }

  const { title, artist } = req.body;
  const trackFile = req.files['trackFile'] ? req.files['trackFile'][0] : null;
  const artworkFile = req.files['artwork'] ? req.files['artwork'][0] : null;
  if (!trackFile) {
    return res.status(400).send(generateErrorPage('No Track File','You must upload a track file.'));
  }

  const twoMonthsFromNow = new Date();
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);

  // ========== Watermark the audio ==========  
  // We'll apply a unique signature. For example, user ID + timestamp
  const watermarkSignature = `UserID-${req.session.userId}-${Date.now()}`;
  applyWatermarkToAudio(path.join(__dirname, 'uploads', trackFile.filename), watermarkSignature);

  // Save to local "tracks.json" (not the CSV).
  let localTracks = [];
  try {
    localTracks = JSON.parse(fs.readFileSync('tracks.json', 'utf8'));
  } catch (err) {
    console.warn("Couldn't read tracks.json, starting fresh...");
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
      ${artworkFile ? `<p><strong>Artwork Uploaded:</strong> ${artworkFile.originalname}</p>` : ''}
      <p><strong>Expires On:</strong> ${twoMonthsFromNow.toDateString()}</p>
      <p>Watermark signature: ${watermarkSignature}</p>
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

// ========== AUTH ROUTES ==========

// REGISTER
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

// LOGIN
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

// LOGOUT
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, redirect: '/' });
});

// ========== /api/me (User Info) ==========
app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    username: user.username,
    isPaid: user.isPaid
  });
});

// ========== RATING API ==========
// POST /api/rate => { trackId, rating }  (1-10)
app.post('/api/rate', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'You must be logged in to rate' });
  }
  const { trackId, rating } = req.body;
  const numRating = parseInt(rating, 10);
  if (!trackId || isNaN(numRating) || numRating < 1 || numRating > 10) {
    return res.status(400).json({ error: 'Invalid rating or trackId' });
  }

  // Save rating
  let ratings = getRatings();
  // Check if user already rated this track
  const existing = ratings.find(r => r.trackId === trackId && r.userId === req.session.userId);
  if (existing) {
    existing.rating = numRating; // update
  } else {
    ratings.push({ trackId, userId: req.session.userId, rating: numRating });
  }
  saveRatings(ratings);

  res.json({ success: true });
});

// GET /api/ratings => returns all ratings (or you can filter by track)
app.get('/api/ratings', (req, res) => {
  // optional route if you want the front-end to fetch all raw ratings
  const ratings = getRatings();
  res.json(ratings);
});

// ========== STRIPE CHECKOUT EXAMPLE ==========
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
            // e.g. £20
            unit_amount: 2000,
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

// Stripe portal
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

// Payment success
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

// OPTIONAL PAYPAL
app.post('/api/checkout/paypal', async (req, res) => {
  return res.json({ error: 'PayPal not used. Stripe is primary now.' });
});

// ========== 404 NOT FOUND PAGE ==========
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DubVault running on port ${PORT}`));
