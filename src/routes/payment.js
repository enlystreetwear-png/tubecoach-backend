// src/routes/payment.js
// Razorpay subscription handling

const express  = require('express');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../config/firebase');

const router = express.Router();

function getRazorpay() {
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /payment/create-order
// Creates a Razorpay order for ₹499/month
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const razorpay = getRazorpay();

    const order = await razorpay.orders.create({
      amount:   49900,        // ₹499 in paise
      currency: 'INR',
      receipt:  `receipt_${req.user.uid}_${Date.now()}`,
      notes: {
        uid:   req.user.uid,
        email: req.user.email,
        plan:  'monthly_499',
      },
    });

    res.json({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      keyId:    process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Create order error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /payment/verify
// Razorpay calls this after successful payment
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Verify signature
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const expectedSignature = hmac.digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Mark user as premium in Firestore
    const db = getDb();
    const now = new Date();
    const nextBilling = new Date(now);
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    await db.collection('users').doc(req.user.uid).update({
      isPremium:         true,
      subscriptionStart: now.toISOString(),
      nextBillingDate:   nextBilling.toISOString(),
      lastPaymentId:     razorpay_payment_id,
      lastOrderId:       razorpay_order_id,
    });

    // Save payment record
    await db.collection('payments').add({
      uid:        req.user.uid,
      orderId:    razorpay_order_id,
      paymentId:  razorpay_payment_id,
      amount:     499,
      currency:   'INR',
      status:     'paid',
      paidAt:     now.toISOString(),
    });

    res.json({ success: true, message: 'Payment verified! Welcome to TubeCoach Pro.' });
  } catch (err) {
    console.error('Verify payment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /payment/status
// Check current subscription status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const db      = getDb();
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    const user    = userSnap.data();

    const trialDays = Math.floor(
      (Date.now() - new Date(user.trialStart).getTime()) / (1000 * 60 * 60 * 24)
    );

    res.json({
      isPremium:       user.isPremium || false,
      trialActive:     !user.isPremium && trialDays < 7,
      trialDaysLeft:   Math.max(0, 7 - trialDays),
      nextBillingDate: user.nextBillingDate || null,
      subscriptionStart: user.subscriptionStart || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /payment/cancel
// Cancel subscription (set isPremium to false after period ends)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.collection('users').doc(req.user.uid).update({
      cancelledAt:     new Date().toISOString(),
      cancelScheduled: true, // premium stays active till nextBillingDate
    });
    res.json({ success: true, message: 'Subscription will cancel at end of billing period.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
