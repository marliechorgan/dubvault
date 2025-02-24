const express = require('express');
const Stripe = require('stripe');
const paypal = require('@paypal/checkout-server-sdk');
const path = require('path');
const { getUsers, saveUsers } = require('../utils/dataStore');
const router = express.Router();

const stripeInstance = Stripe(process.env.STRIPE_SECRET_KEY);
const Environment =
  process.env.NODE_ENV === 'production'
    ? paypal.core.LiveEnvironment
    : paypal.core.SandboxEnvironment;
const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(
    process.env.PAYPAL_CLIENT_ID || 'PAYPAL_CLIENT_ID',
    process.env.PAYPAL_CLIENT_SECRET || 'PAYPAL_CLIENT_SECRET'
  )
);

// POST /create-checkout-session - create stripe checkout session (requires login)
router.post('/create-checkout-session', async (req, res, next) => {
  try {
    console.log('POST /create-checkout-session - Session:', req.session);
    if (!req.session.userId) {
      return res.status(401).send('You must be logged in first.');
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    console.log('Base URL for checkout session:', baseUrl);

    const successUrl = `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&tier=standard`;
    const cancelUrl = `${baseUrl}/cancel.html`;
    console.log('Success URL:', successUrl);
    console.log('Cancel URL:', cancelUrl);

    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: 'price_1QbUsqCBSWQorwTPmEttjsGr', // £20/month subscription price ID
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    console.log('Stripe session created:', session.id);
    res.redirect(303, session.url);
  } catch (err) {
    console.error('Error in /create-checkout-session:', err.message);
    console.error('Stack trace:', err.stack);
    res.status(500).json({
      error: 'Failed to create checkout session',
      details: err.message
    });
  }
});

// GET /payment-success - handle payment success (requires login)
router.get('/payment-success', async (req, res, next) => {
  try {
    const { session_id, tier } = req.query;
    if (!session_id || !req.session.userId) return res.redirect('/');
    const session = await stripeInstance.checkout.sessions.retrieve(session_id);
    if (session.payment_status === 'paid') {
      const users = await getUsers();
      const user = users.find(u => u.id === req.session.userId);
      if (user) {
        user.isPaid = true;
        user.tier = tier;
        await saveUsers(users);
      }
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'success.html'));
  } catch (err) {
    next(err);
  }
});

// POST /cancel-subscription - cancel user subscription (requires login)
router.post('/cancel-subscription', async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    const users = await getUsers();
    const userIndex = users.findIndex(u => u.id === req.session.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    users[userIndex].isPaid = false;
    users[userIndex].tier = null;
    await saveUsers(users);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;