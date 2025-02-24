const express = require('express');
const Stripe = require('stripe');
const path = require('path');
const router = express.Router();

const stripeInstance = Stripe(process.env.STRIPE_SECRET_KEY);

router.use((req, res, next) => {
  req.db = req.app.locals.db; // Access the database from app.locals
  next();
});

// POST /create-checkout-session - create Stripe checkout session (requires login)
router.post('/create-checkout-session', async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.status(401).send('You must be logged in first.');
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const successUrl = `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&tier=standard`;
    const cancelUrl = `${baseUrl}/cancel.html`;

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
    if (!session_id || !req.session.userId) {
      return res.redirect('/');
    }
    const session = await stripeInstance.checkout.sessions.retrieve(session_id);
    if (session.payment_status === 'paid') {
      const usersCollection = req.db.collection('users');
const { ObjectId } = require('mongodb');
await usersCollection.updateOne(
        { _id: new ObjectId(req.session.userId) },
        { $set: { isPaid: true, tier } }
      );
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
    const usersCollection = req.db.collection('users');
    await usersCollection.updateOne(
      { _id: new ObjectId(req.session.userId) },
      { $set: { isPaid: false, tier: null } }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;