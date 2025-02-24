const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { getTracks, saveTracks, getRatings, saveRatings } = require('../utils/dataStore');
const router = express.Router();

const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary with credentials from .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Use CloudinaryStorage with Multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'dubvault-tracks',
    resource_type: 'auto'
  }
});
const upload = multer({ storage });

// GET /api/tracks - return all tracks with average ratings
// BUT in your index.js, you only show "approved" tracks to the public. If you want all statuses, remove the filter in index.js or handle here.
router.get('/tracks', async (req, res, next) => {
  try {
    const allTracks = await getTracks();
    const ratings = await getRatings();

    // Merge average rating
    const mergedTracks = allTracks.map(t => {
      const trackRatings = ratings.filter(r => String(r.trackId) === String(t.id));
      let avgRating = trackRatings.length
        ? parseFloat(
            (
              trackRatings.reduce((acc, rr) => acc + rr.vote, 0) /
              trackRatings.length
            ).toFixed(1)
          )
        : null;
      return { ...t, avgRating };
    });

    return res.json(mergedTracks);
  } catch (err) {
    next(err);
  }
});

// POST /api/submit - let logged-in user submit new track
router.post('/submit', upload.fields([{ name: 'trackFile' }, { name: 'artwork' }]), async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res
        .status(401)
        .send('<h1>Unauthorized</h1><p>Log in to submit.</p>');
    }

    const { title, artist, genre } = req.body;
    const trackFile = req.files['trackFile'] ? req.files['trackFile'][0] : null;
    const artworkFile = req.files['artwork'] ? req.files['artwork'][0] : null;

    if (!trackFile) {
      return res
        .status(400)
        .send('<h1>No Track File</h1><p>Please upload an audio file (MP3).</p>');
    }

    // 6-month expiry from now
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

    const localTracks = await getTracks();
    const newTrack = {
      id: Date.now(),
      title: title || 'Untitled',
      artist: artist || 'Unknown Artist',
      genre: genre || 'Unknown',
      filePath: trackFile.path, // This is Cloudinary path if using Cloudinary
      artworkPath: artworkFile ? artworkFile.path : null,
      expiresOn: sixMonthsFromNow.toISOString(),
      status: 'pending' // Mark new submissions as pending
    };

    localTracks.push(newTrack);
    await saveTracks(localTracks);

    res.send(`
      <h1>Track Submitted Successfully!</h1>
      <p><strong>Title:</strong> ${newTrack.title}</p>
      <p><strong>Artist:</strong> ${newTrack.artist}</p>
      <p><strong>Genre:</strong> ${newTrack.genre}</p>
      ${
        artworkFile
          ? `<p><strong>Artwork:</strong> ${artworkFile.originalname}</p>`
          : ''
      }
      <p><strong>Expires On:</strong> ${sixMonthsFromNow.toDateString()}</p>
      <p><strong>Status:</strong> ${newTrack.status}</p>
      <p>You’ll receive £25 soon (pending admin approval)!</p>
      <p><a href="/tracks">View All Tracks</a></p>
    `);
  } catch (err) {
    next(err);
  }
});

// POST /api/vote - vote on a track (requires login)
router.post('/vote', async (req, res, next) => {
  try {
    if (!req.session.userId)
      return res.status(401).json({ error: 'Not logged in' });

    const { trackId, vote } = req.body;
    const ratings = await getRatings();

    // If a user has already voted, you might want to overwrite or block.
    // For now, we just push a new rating entry.
    ratings.push({ trackId, userId: req.session.userId, vote });
    await saveRatings(ratings);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;