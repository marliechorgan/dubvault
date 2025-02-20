const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { getTracks, saveTracks, getRatings, saveRatings } = require('../utils/dataStore');
const router = express.Router();

// Configure multer storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = file.fieldname === 'artwork' ? 'artworks' : 'uploads';
    try {
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// GET /api/tracks - get all tracks with average ratings
router.get('/tracks', async (req, res, next) => {
  try {
    const allTracks = await getTracks();
    const ratings = await getRatings();
    const mergedTracks = allTracks.map(t => {
      const trackRatings = ratings.filter(r => String(r.trackId) === String(t.id));
      let avgRating =
        trackRatings.length > 0
          ? parseFloat(
              (trackRatings.reduce((acc, rr) => acc + rr.vote, 0) /
                trackRatings.length
              ).toFixed(1)
            )
          : null;
      return { ...t, avgRating };
    });
    res.json(mergedTracks);
  } catch (err) {
    next(err);
  }
});

// POST /submit - submit a new track (requires login)
router.post(
  '/submit',
  upload.fields([
    { name: 'trackFile', maxCount: 1 },
    { name: 'artwork', maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      if (!req.session.userId)
        return res
          .status(401)
          .send('<h1>Unauthorized</h1><p>Log in to submit.</p>');

      const { title, artist } = req.body;
      const trackFile = req.files['trackFile']
        ? req.files['trackFile'][0]
        : null;
      const artworkFile = req.files['artwork']
        ? req.files['artwork'][0]
        : null;
      if (!trackFile)
        return res
          .status(400)
          .send('<h1>No Track File</h1><p>Please upload an audio file.</p>');

      // Set expiration date 6 months from now
      const sixMonthsFromNow = new Date();
      sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

      const localTracks = await getTracks();
      const newTrack = {
        id: Date.now(),
        title: title || 'Untitled',
        artist: artist || 'Unknown Artist',
        filePath: trackFile.filename,
        artworkPath: artworkFile ? artworkFile.filename : null,
        expiresOn: sixMonthsFromNow.toISOString()
      };
      localTracks.push(newTrack);
      await saveTracks(localTracks);

      res.send(`
        <h1>Track Submitted Successfully!</h1>
        <p><strong>Title:</strong> ${newTrack.title}</p>
        <p><strong>Artist:</strong> ${newTrack.artist}</p>
        ${
          artworkFile
            ? `<p><strong>Artwork:</strong> ${artworkFile.originalname}</p>`
            : ''
        }
        <p><strong>Expires On:</strong> ${sixMonthsFromNow.toDateString()}</p>
        <p>You’ll receive £25 soon!</p>
        <p><a href="/tracks">View All Tracks</a></p>
      `);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/vote - vote on a track (requires login)
router.post('/vote', async (req, res, next) => {
  try {
    if (!req.session.userId)
      return res.status(401).json({ error: 'Not logged in' });
    const { trackId, vote } = req.body;
    const ratings = await getRatings();
    ratings.push({ trackId, userId: req.session.userId, vote });
    await saveRatings(ratings);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
