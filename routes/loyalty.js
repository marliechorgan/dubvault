const express = require('express');
const { getUsers, saveUsers } = require('../utils/dataStore');
const router = express.Router();

router.post('/loyalty/claim', async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    const users = await getUsers();
    const userIndex = users.findIndex(u => u.id === Number(req.session.userId));
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Only allow claim if the user is a paid subscriber
    if (!users[userIndex].isPaid) {
      return res.status(400).json({ error: 'Not a paid subscriber' });
    }
    // Initialize dubpoints if not present
    if (typeof users[userIndex].dubpoints !== 'number') {
      users[userIndex].dubpoints = 0;
    }
    // Increment dubpoints by 10
    users[userIndex].dubpoints += 10;
    await saveUsers(users);
    res.json({ success: true, dubpoints: users[userIndex].dubpoints });
  } catch (err) {
    next(err);
  }
});

module.exports = router;