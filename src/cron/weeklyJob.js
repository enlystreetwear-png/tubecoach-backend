// src/cron/weeklyJob.js
// Runs every Monday at 6:00 AM IST
// Fetches YouTube data + generates weekly plan for all premium users

const cron = require('node-cron');
const { getDb } = require('../config/firebase');
const { getChannelStats, getRecentVideos, saveWeeklySnapshot, getSnapshots } = require('../services/youtube');
const { generateWeeklyPlan } = require('../services/claude');

function getWeekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function runWeeklyJob() {
  console.log(`\n🔄 Weekly job started at ${new Date().toISOString()}`);
  const db = getDb();

  // Get all premium + trial users who have completed onboarding
  const usersSnap = await db.collection('users')
    .where('onboarded', '==', true)
    .get();

  const users = usersSnap.docs.map(d => d.data());
  console.log(`📊 Processing ${users.length} users`);

  let success = 0, failed = 0;

  for (const user of users) {
    // Skip users without access
    const trialDays = Math.floor(
      (Date.now() - new Date(user.trialStart || Date.now()).getTime()) / (1000 * 60 * 60 * 24)
    );
    const hasAccess = user.isPremium || trialDays < 7;
    if (!hasAccess) continue;

    // Skip if plan already generated this week
    const weekKey = getWeekKey();
    const planSnap = await db
      .collection('users').doc(user.uid)
      .collection('plans').doc(weekKey)
      .get();
    if (planSnap.exists) { console.log(`  ⏭ ${user.name}: plan already exists`); continue; }

    try {
      // 1. Fetch fresh YouTube data
      let channel   = user.channel;
      let snapshots = await getSnapshots(user.uid, 2);

      if (user.accessToken && user.hasChannel) {
        try {
          channel = await getChannelStats(user.accessToken);
          const videos = await getRecentVideos(user.accessToken, channel.id);
          await saveWeeklySnapshot(user.uid, channel, videos);
          snapshots = await getSnapshots(user.uid, 2);
          console.log(`  ✅ ${user.name}: YouTube data fetched`);
        } catch (ytErr) {
          console.error(`  ⚠️ ${user.name}: YouTube fetch failed — ${ytErr.message}`);
        }
      }

      // 2. Generate weekly plan with Claude
      const plan = await generateWeeklyPlan({
        channel:   channel || { title: 'Your Channel', subscribers: 0, totalViews: 0 },
        profile:   user.profile || {},
        snapshots,
      });

      // 3. Save plan to Firestore
      await db
        .collection('users').doc(user.uid)
        .collection('plans').doc(weekKey)
        .set({
          ...plan,
          weekKey,
          generatedAt: new Date().toISOString(),
          taskStates:  {},
        });

      console.log(`  ✅ ${user.name}: plan generated`);
      success++;

      // Throttle: wait 1 second between users to respect API rate limits
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.error(`  ❌ ${user.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Weekly job done — ${success} success, ${failed} failed\n`);
}

function startCron() {
  // Every Monday at 6:00 AM IST (UTC+5:30 = 00:30 UTC)
  cron.schedule('30 0 * * 1', runWeeklyJob, { timezone: 'Asia/Kolkata' });
  console.log('⏰ Weekly cron scheduled — Mondays 6:00 AM IST');
}

module.exports = { startCron, runWeeklyJob };
