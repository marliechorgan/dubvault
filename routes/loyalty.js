const express = require('express');
const router = express.Router();

router.use((req, res, next) => {
  req.db = req.app.locals.db; // Access the database from app.locals
  next();
});

// POST /api/loyalty/claim - claim loyalty points (requires login)
router.post('/loyalty/claim', async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    const usersCollection = req.db.collection('users');
    const user = await usersCollection.findOne({ _id: req.session.userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.isPaid) {
      return res.status(400).json({ error: 'Not a paid subscriber' });
    }
    user.dubpoints = (user.dubpoints || 0) + 10;
    await usersCollection.updateOne(
      { _id: req.session.userId },
      { $set: { dubpoints: user.dubpoints } }
    );
    res.json({ success: true, dubpoints: user.dubpoints });
  } catch (err) {
    next(err);
  }
});

module.exports = router;