const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { ObjectId } = require('mongodb');

router.use((req, res, next) => {
  req.db = req.app.locals.db; // Access the database from app.locals
  next();
});

// POST /api/register
router.post(
  '/register',
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, password } = req.body;
      const usersCollection = req.db.collection('users');
      const existingUser = await usersCollection.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = {
        username,
        password: hashedPassword,
        isPaid: false,
        tier: null,
        dubpoints: 0,
        createdAt: new Date(),
      };
      await usersCollection.insertOne(newUser);

      req.session.userId = newUser._id.toString(); // MongoDB generates an _id
      req.session.save(err => {
        if (err) return next(err);
        res.json({ success: true, redirect: '/profile.html' });
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/login
router.post(
  '/login',
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, password } = req.body;
      const usersCollection = req.db.collection('users');
        const user = await usersCollection.findOne({ _id: new ObjectId(req.session.userId) });
      if (!user) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(400).json({ error: 'Invalid username or password' });
      }

      req.session.userId = user._id.toString();
      req.session.save(err => {
        if (err) return next(err);
        res.json({ success: true, redirect: '/profile.html' });
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/logout
router.post('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.json({ success: true, redirect: '/' });
  });
});

// GET /api/me
router.get('/me', async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    // Convert string to ObjectId:
    const userIdObj = new ObjectId(req.session.userId);

    const usersCollection = req.db.collection('users');
    const user = await usersCollection.findOne({ _id: userIdObj });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      username: user.username,
      isPaid: user.isPaid,
      tier: user.tier,
      dubpoints: user.dubpoints,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;