require('dotenv').config();
const express = require('express');
const session = require('express-session');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const app = express();

// Middleware setup
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(multer({ dest: 'public/uploads/' }).single('track'));

// File paths for JSON storage (replace with database in production)
const tracksFile = path.join(__dirname, 'tracks.json');
const ratingsFile = path.join(__dirname, 'ratings.json');
const commentsFile = path.join(__dirname, 'comments.json');
const usersFile = path.join(__dirname, 'users.json');

// Helper functions for file operations
const getTracks = () => {
  try {
    return JSON.parse(fs.readFileSync(tracksFile, 'utf8') || '[]');
  } catch (err) {
    return [];
  }
};
const saveTracks = (tracks) => fs.writeFileSync(tracksFile, JSON.stringify(tracks, null, 2));
const getRatings = () => {
  try {
    return JSON.parse(fs.readFileSync(ratingsFile, 'utf8') || '[]');
  } catch (err) {
    return [];
  }
};
const saveRatings = (ratings) => fs.writeFileSync(ratingsFile, JSON.stringify(ratings, null, 2));
const getComments = () => {
  try {
    return JSON.parse(fs.readFileSync(commentsFile, 'utf8') || '[]');
  } catch (err) {
    return [];
  }
};
const saveComments = (comments) => fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2));
const getUsers = () => {
  try {
    return JSON.parse(fs.readFileSync(usersFile, 'utf8') || '[]');
  } catch (err) {
    return [];
  }
};
const saveUsers = (users) => fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

// Email setup with Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Public tracks (approved only)
app.get('/api/tracks', (req, res) => {
  const allTracks = getTracks().filter(t => t.status === 'approved');
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

// Admin: Get pending tracks
app.get('/api/pending-tracks', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
  res.json(getTracks().filter(t => t.status === 'pending'));
});

// Admin: Approve/Reject track
app.post('/api/review-track', async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const { trackId, action } = req.body; // action: 'approve' or 'reject'
  const tracks = getTracks();
  const trackIndex = tracks.findIndex(t => t.id === trackId);
  if (trackIndex !== -1) {
    tracks[trackIndex].status = action === 'approve' ? 'approved' : 'rejected';
    saveTracks(tracks);

    // Notify artist via email
    const users = getUsers();
    const artist = users.find(u => u.id === tracks[trackIndex].artist);
    if (artist && artist.email) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: artist.email,
        subject: `Your Track "${tracks[trackIndex].title}" Has Been ${action === 'approve' ? 'Approved' : 'Rejected'}`,
        text: `Hey ${artist.username},\n\nYour track "${tracks[trackIndex].title}" has been ${action === 'approve' ? 'approved' : 'rejected'}.\n\n- DubVault Team`
      };
      await transporter.sendMail(mailOptions);
    }
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Track not found' });
  }
});

// Admin: Bulk approve/reject tracks
app.post('/api/bulk-review-tracks', async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const { trackIds, action } = req.body;
  const tracks = getTracks();
  const users = getUsers();

  for (const trackId of trackIds) {
    const trackIndex = tracks.findIndex(t => t.id === trackId);
    if (trackIndex !== -1) {
      tracks[trackIndex].status = action === 'approve' ? 'approved' : 'rejected';
      const artist = users.find(u => u.id === tracks[trackIndex].artist);
      if (artist && artist.email) {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: artist.email,
          subject: `Your Track "${tracks[trackIndex].title}" Has Been ${action === 'approve' ? 'Approved' : 'Rejected'}`,
          text: `Hey ${artist.username},\n\nYour track "${tracks[trackIndex].title}" has been ${action === 'approve' ? 'approved' : 'rejected'}.\n\n- DubVault Team`
        };
        await transporter.sendMail(mailOptions);
      }
    }
  }
  saveTracks(tracks);
  res.json({ success: true });
});

  

// User-specific endpoints
app.get('/api/user-tracks', (req, res) => {
  console.log('GET /api/user-tracks - Session:', req.session);
  if (!req.session.userId) {
    console.log('No userId in session for /api/user-tracks');
    return res.status(401).json({ error: 'Not logged in' });
  }
  console.log('Fetching tracks for userId:', req.session.userId);
  const tracks = getTracks().filter(t => t.artist === req.session.userId);
  res.json(tracks);
});

app.get('/api/user-tracks', (req, res) => {
  console.log('GET /api/user-tracks - Session:', req.session);
  if (!req.session.userId) {
    console.log('No userId in session for /api/user-tracks');
    return res.status(401).json({ error: 'Not logged in' });
  }
  console.log('Fetching tracks for userId:', req.session.userId);
  const tracks = getTracks().filter(t => t.artist === req.session.userId);
  res.json(tracks || []);
});

// Comment posting
app.post('/api/comments', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { trackId, comment } = req.body;
  let comments = getComments();
  comments.push({ trackId, userId: req.session.userId, comment });
  saveComments(comments);
  res.json({ success: true });
});

// Analytics dashboard (placeholder)
app.get('/api/analytics', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const tracks = getTracks();
  const users = getUsers();
  const subscriberCount = users.filter(u => u.isPaid).length;
  const topTracks = tracks
    .filter(t => t.status === 'approved')
    .sort((a, b) => b.avgRating - a.avgRating)
    .slice(0, 5);
  const revenue = subscriberCount * 10; // Example: $10 per subscriber
  res.json({ subscriberCount, topTracks, revenue });
});

// Mock admin login (replace with real auth in production)
  

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DubVault running on port ${PORT}`));