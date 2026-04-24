// src/routes/payment.js
// Razorpay payment handling with tiered pricing:
// Month 1:   FREE
// Month 2-4: ₹49/month  (intro offer, 3 months)
// Month 5+:  ₹499/month (full price)

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
// PRICING LOGIC
// Month 1  = free (trialActive)
// Month 2-4 = ₹49   (monthsSinceJoin <= 4)
// Month 5+  = ₹499
// ─────────────────────────────────────────────────────────────────────────────
function getPricingForUser(user) {
  // Use trialStart to determine trial expiry (30 days)
  const trialStart = user.trialStart ? new Date(user.trialStart) : new Date(user.createdAt || Date.now());
  const now        = new Date();
  const trialDays  = Math.floor((now - trialStart) / (1000 * 60 * 60 * 24));
  const joinedAt   = user.createdAt ? new Date(user.createdAt) : new Date();
  const monthsSinceJoin = Math.floor((now - joinedAt) / (1000 * 60 * 60 * 24 * 30));
  const paymentCount = user.paymentCount || 0;

  // Month 1 — free trial (30 days from trialStart)
  if (trialDays < 30) {
    return { plan: 'trial', amount: 0, label: 'Free', monthsSinceJoin, paymentCount, trialDaysLeft: 30 - trialDays };
  }

  // Months 2-4 — intro offer ₹49 (first 3 payments)
  if (paymentCount < 3) {
    return { plan: 'intro', amount: 49, amountPaise: 4900, label: '₹49/month', monthsSinceJoin, paymentCount };
  }

  // Month 5+ — full price ₹499
  return { plan: 'full', amount: 499, amountPaise: 49900, label: '₹499/month', monthsSinceJoin, paymentCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /payment/pricing
// Returns what the current user should pay
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pricing', requireAuth, async (req, res) => {
  try {
    const db       = getDb();
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    const user     = userSnap.data();
    const pricing  = getPricingForUser(user);

    const trialDays = Math.floor(
      (Date.now() - new Date(user.trialStart || user.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    res.json({
      ...pricing,
      isPremium:     user.isPremium || false,
      trialActive:   !user.isPremium && trialDays < 30,
      trialDaysLeft: Math.max(0, 30 - trialDays),
      nextBillingDate: user.nextBillingDate || null,
      cancelScheduled: user.cancelScheduled || false,
      // Show what comes next after current plan
      nextPlan: pricing.plan === 'intro' && pricing.paymentCount >= 2
        ? { label: '₹499/month', note: 'Full price starts next month' }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /payment/create-order
// Creates Razorpay order with correct amount for this user
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const db       = getDb();
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    const user     = userSnap.data();
    const pricing  = getPricingForUser(user);

    // If still in trial, charge intro price ₹49
    const amountPaise = pricing.amountPaise || 4900;
    const planLabel   = pricing.label === 'Free' ? '₹49/month' : pricing.label;
    const planName    = pricing.plan === 'trial' ? 'intro' : pricing.plan;

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount:   amountPaise,
      currency: 'INR',
      receipt:  `r_${Date.now().toString().slice(-10)}`,
      notes: {
        uid:          req.user.uid,
        email:        req.user.email,
        plan:         pricing.plan,
        amount:       pricing.amount,
        paymentCount: pricing.paymentCount,
      },
    });

    res.json({
      orderId:      order.id,
      amount:       order.amount,
      currency:     order.currency,
      keyId:        process.env.RAZORPAY_KEY_ID,
      plan:         planName,
      planLabel:    planLabel,
      paymentCount: pricing.paymentCount,
    });
  } catch (err) {
    console.error('Create order error:', err);
    console.error('Razorpay key:', process.env.RAZORPAY_KEY_ID ? 'SET' : 'MISSING');
    console.error('Razorpay secret:', process.env.RAZORPAY_KEY_SECRET ? 'SET' : 'MISSING');
    res.status(500).json({ error: err.message || JSON.stringify(err) || 'Unknown error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /payment/verify
// Verify Razorpay payment signature and activate premium
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount, plan } = req.body;

    // Verify signature
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const expectedSig = hmac.digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const db  = getDb();
    const now = new Date();
    const nextBilling = new Date(now);
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    // Get current payment count
    const userSnap     = await db.collection('users').doc(req.user.uid).get();
    const userData     = userSnap.data();
    const paymentCount = (userData.paymentCount || 0) + 1;

    // Determine next month's price
    const nextPricing = getPricingForUser({ ...userData, paymentCount });

    await db.collection('users').doc(req.user.uid).update({
      isPremium:         true,
      trialActive:       false,
      paymentCount,
      subscriptionStart: userData.subscriptionStart || now.toISOString(),
      nextBillingDate:   nextBilling.toISOString(),
      lastPaymentId:     razorpay_payment_id,
      lastOrderId:       razorpay_order_id,
      lastPaymentAmount: amount,
      lastPaymentPlan:   plan,
      cancelScheduled:   false,
      updatedAt:         now.toISOString(),
    });

    // Save payment record
    await db.collection('payments').add({
      uid:          req.user.uid,
      orderId:      razorpay_order_id,
      paymentId:    razorpay_payment_id,
      amount:       amount || 49,
      plan:         plan || 'intro',
      currency:     'INR',
      status:       'paid',
      paidAt:       now.toISOString(),
      paymentCount,
    });

    res.json({
      success:       true,
      message:       'Payment verified! Welcome to TubeCoach Pro.',
      paymentCount,
      nextAmount:    nextPricing.amount,
      nextPlanLabel: nextPricing.label,
    });
  } catch (err) {
    console.error('Verify payment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /payment/status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const db       = getDb();
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    const user     = userSnap.data();
    const pricing  = getPricingForUser(user);

    const trialDays = Math.floor(
      (Date.now() - new Date(user.trialStart || user.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    res.json({
      isPremium:         user.isPremium || false,
      trialActive:       !user.isPremium && trialDays < 30,
      trialDaysLeft:     Math.max(0, 30 - trialDays),
      nextBillingDate:   user.nextBillingDate || null,
      subscriptionStart: user.subscriptionStart || null,
      cancelScheduled:   user.cancelScheduled || false,
      currentPlan:       pricing.label,
      paymentCount:      user.paymentCount || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /payment/cancel
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.collection('users').doc(req.user.uid).update({
      cancelledAt:     new Date().toISOString(),
      cancelScheduled: true,
    });
    res.json({ success: true, message: 'Subscription will cancel at end of billing period.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
