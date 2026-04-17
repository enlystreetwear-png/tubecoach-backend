// server.js — TubeCoach Backend
// Entry point: sets up Express, connects Firebase, registers all routes

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const { initFirebase } = require('./src/config/firebase');
const { startCron }   = require('./src/cron/weeklyJob');

// ── Route imports ─────────────────────────────────────────────────────────────
const authRoutes      = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const paymentRoutes   = require('./src/routes/payment');

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status:  'ok',
  service: 'TubeCoach API',
  time:    new Date().toISOString(),
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',      authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/payment',   paymentRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  initFirebase();
  startCron();

  app.listen(PORT, () => {
    console.log(`\n🚀 TubeCoach API running on http://localhost:${PORT}`);
    console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Frontend URL: ${process.env.FRONTEND_URL}`);
    console.log(`   Endpoints:`);
    console.log(`     GET  /health`);
    console.log(`     GET  /auth/google`);
    console.log(`     GET  /auth/google/callback`);
    console.log(`     POST /auth/verify`);
    console.log(`     GET  /dashboard/plan`);
    console.log(`     GET  /dashboard/analysis`);
    console.log(`     POST /dashboard/chat`);
    console.log(`     GET  /dashboard/goal`);
    console.log(`     POST /dashboard/onboard`);
    console.log(`     POST /payment/create-order`);
    console.log(`     POST /payment/verify`);
    console.log(`     GET  /payment/status\n`);
  });
}

start();
