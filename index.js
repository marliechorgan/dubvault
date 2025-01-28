require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Stripe = require('stripe');
const paypal = require('@paypal/checkout-server-sdk'); // optional
const fetch = require('node-fetch'); // Make sure you're on node-fetch@2
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

// ========== SESSION SETUP ==========
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

// ========== STATIC FOLDERS ==========
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

// ========== LOAD TRACKS FROM CSV WITH SNIPPET SUPPORT ==========
const CSV_URL = process.env.G_SHEET_CSV_URL 
  || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQSeATgiiUTKcZ2iE8MT042dbOY3b0x4BnVlXCtD-XkiUA_dLqBkQDIfbdkJsnUglfR0nokeFBllfMy/pub?output=csv';

async function fetchTracksFromPublishedCSV() {
  const response = await fetch(CSV_URL);
  const rawCsv = await response.text();
  const parsed = Papa.parse(rawCsv, {
    header: true,
    skipEmptyLines: true
  });
  // If you added a "SnippetFile" column to the CSV, we can read that here
  // e.g. columns: ID, Title, Artist, FileName, ArtworkName, ExpiresOn, SnippetFile
  return parsed.data.map(row => ({
    id: row.ID,
    title: row.Title,
    artist: row.Artist,
    filePath: row.FileName,
    artworkPath: row.ArtworkName,
    expiresOn: row.ExpiresOn,
    snippetFile: row.SnippetFile // optional new column
  }));
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
    return res.status(401).send(generateErrorPage(
      'Unauthorized',
      'You must be logged in to submit a track.'
    ));
  }
  res.sendFile(path.join(__dirname, 'public', 'submit.html'));
});

// PROFILE (protected)
app.get('/profile.html', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage(
      'Unauthorized',
      'You must be logged in to view your profile.'
    ));
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

// ========== /api/tracks (CSV) ==========
app.get('/api/tracks', async (req, res) => {
  try {
    const tracks = await fetchTracksFromPublishedCSV();
    res.json(tracks);
  } catch (err) {
    console.error('Error fetching tracks from CSV:', err);
    res.status(500).json({ error: 'Failed to load tracks' });
  }
});

// ========== DOWNLOAD (membership gated) ==========
app.get('/download/:fileName', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage(
      'Unauthorized',
      'You must be logged in to download tracks.'
    ));
  }
  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user || !user.isPaid) {
    return res.status(403).send(generateErrorPage(
      'Forbidden',
      'You need a paid membership to download tracks.'
    ));
  }
  const filePath = path.join(__dirname, 'uploads', req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(generateErrorPage('Not Found', 'File does not exist.'));
  }
  res.download(filePath);
});

// ========== SUBMIT (UPLOAD) ==========
// STILL writes to tracks.json if you want user submissions stored locally.
app.post('/submit', upload.fields([
  { name: 'trackFile', maxCount: 1 },
  { name: 'artwork', maxCount: 1 }
]), (req, res) => {
  if (!req.session.userId) {
    return res.status(401).send(generateErrorPage(
      'Unauthorized',
      'You must be logged in to submit a track.'
    ));
  }

  const { title, artist } = req.body;
  const trackFile = req.files['trackFile'] ? req.files['trackFile'][0] : null;
  const artworkFile = req.files['artwork'] ? req.files['artwork'][0] : null;
  if (!trackFile) {
    return res.status(400).send(generateErrorPage(
      'No Track File',
      'You must upload a track file.'
    ));
  }

  const twoMonthsFromNow = new Date();
  twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);

  // Save to local "tracks.json" (not the CSV). 
  // If you want to add them to the sheet, you'd do that manually or create separate logic.
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
      <p>We added your track to the local library. (This won't show up in the Google Sheet CSV.)</p>
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

// LOGIN (We’ll show a toast in login.html after success)
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
  // On success, we send back JSON that triggers a toast in the front-end
  return res.json({ success: true, redirect: '/profile.html' });
});

// LOGOUT
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, redirect: '/' });
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
            unit_amount: 1000, // e.g. £10
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
  // For any route not matched above, serve a custom 404 page
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ========== START SERVER ==========

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DubVault running on port ${PORT}`));
