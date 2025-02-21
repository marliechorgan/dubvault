const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { getUsers, saveUsers } = require('../utils/dataStore');
const router = express.Router();

// POST /api/register
router.post(
  '/register',
  body('username').isLength({ min: 3 }).trim().escape(),
  body('password').isLength({ min: 6 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty())
        return res.status(400).json({ errors: errors.array() });

      const { username, password } = req.body;
      const users = await getUsers();
      if (users.some(u => u.username === username))
        return res.status(400).json({ error: 'Username already taken' });

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = {
        id: Date.now(),
        username,
        password: hashedPassword,
        isPaid: false,
        tier: null
      };
      users.push(newUser);
      await saveUsers(users);
      req.session.userId = newUser.id;
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
      if (!errors.isEmpty())
        return res.status(400).json({ errors: errors.array() });

      const { username, password } = req.body;
      const users = await getUsers();
    const user = users.find(u => u.username === username);
      if (!user)
        return res.status(400).json({ error: 'Invalid username or password' });

      const match = await bcrypt.compare(password, user.password);
      if (!match)
        return res.status(400).json({ error: 'Invalid username or password' });

      req.session.userId = user.id;
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
    if (!req.session.userId)
      return res.status(401).json({ error: 'Not logged in. Please log in to access this resource.' });
    const users = await getUsers();
    const user = users.find(u => u.id === req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ username: user.username, isPaid: user.isPaid, tier: user.tier, dubpoints: user.dubpoints !== undefined ? user.dubpoints : 0 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;