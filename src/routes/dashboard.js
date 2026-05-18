// src/routes/dashboard.js
// All protected dashboard endpoints

const express = require('express');
const { requireAuth, requirePremium } = require('../middleware/auth');
const { getChannelStats, getRecentVideos, saveWeeklySnapshot, getSnapshots } = require('../services/youtube');
const { generateWeeklyPlan, generateAnalysis, analyzeChannel, chatWithCoach, estimateGoalTimeline, generateTaskGuide } = require('../services/ollama');
const { getDb } = require('../config/firebase');

const router = express.Router();

// All dashboard routes require login
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Safe JSON parser — handles AI responses with special chars in strings
// ─────────────────────────────────────────────────────────────────────────────
function safeParseJSON(text) {
  if (!text) return null;

  // Remove markdown code fences if present
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Extract the outermost JSON object
  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  clean = clean.slice(start, end + 1);

  // Try direct parse first
  try { return JSON.parse(clean); } catch(e) {}

  // If that fails, sanitize string values that may contain unescaped quotes/newlines
  try {
    // Replace literal newlines inside JSON string values with \n
    let sanitized = clean
      .replace(/\r\n/g, '\\n')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    return JSON.parse(sanitized);
  } catch(e) {}

  // Last resort: use a more aggressive clean
  try {
    // Remove all control characters
    let aggressive = clean.replace(/[\x00-\x1F\x7F]/g, ' ');
    return JSON.parse(aggressive);
  } catch(e) {
    console.error('[safeParseJSON] All parse attempts failed. Error:', e.message);
    console.error('[safeParseJSON] Text snippet:', text.substring(0, 200));
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /dashboard/onboard
// Save user's niche/goal/language preferences
// ─────────────────────────────────────────────────────────────────────────────
router.post('/onboard', async (req, res) => {
  try {
    const { niche, lang, goal, freq, goalNumber } = req.body;
    const db = getDb();

    await db.collection('users').doc(req.user.uid).update({
      onboarded: true,
      profile: { niche, lang, goal, freq, goalNumber: goalNumber || 10000 },
      updatedAt: new Date().toISOString(),
    });

    // If user has a channel, fetch and save first snapshot
    if (req.user.hasChannel && req.user.accessToken) {
      try {
        const stats  = await getChannelStats(req.user.accessToken);
        const videos = await getRecentVideos(req.user.accessToken, stats.id);
        await saveWeeklySnapshot(req.user.uid, stats, videos);

        // Auto-analyze channel content
        const analysis = await analyzeChannel({ channel: stats, videos });
        await db.collection('users').doc(req.user.uid).update({
          channelAnalysis: analysis,
        });
      } catch (e) {
        console.error('Snapshot on onboard error:', e.message);
      }
    }

    res.json({ success: true, message: 'Profile saved!' });
  } catch (err) {
    console.error('Onboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/plan
// Returns this week's action plan (cached in Firestore, regenerated Mondays)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/plan', requirePremium, async (req, res) => {
  try {
    const db = getDb();
    const uid = req.user.uid;

    // Check if plan exists for this week
    const weekKey = getWeekKey();
    const planRef = db.collection('users').doc(uid).collection('plans').doc(weekKey);
    const planSnap = await planRef.get();

    // Allow force refresh with ?refresh=true
    const forceRefresh = req.query.refresh === 'true';

    if (planSnap.exists && !forceRefresh) {
      return res.json(planSnap.data());
    }

    // No plan yet — generate one
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();

    if (!userData.profile) {
      return res.status(400).json({ error: 'Please complete onboarding first' });
    }

    // Fetch fresh channel data
    let channel = userData.channel;
    let snapshots = await getSnapshots(uid, 2);

    if (req.user.accessToken) {
      try {
        channel = await getChannelStats(req.user.accessToken);
        const videos = await getRecentVideos(req.user.accessToken, channel.id);
        await saveWeeklySnapshot(uid, channel, videos);
        snapshots = await getSnapshots(uid, 2);
      } catch (e) {
        console.error('YouTube fetch error:', e.message);
      }
    }

    // Generate plan with Ollama
    const plan = await generateWeeklyPlan({
      channel:   channel || { title: 'Your Channel', subscribers: 0, totalViews: 0 },
      profile:   userData.profile,
      snapshots,
    });

    // Save plan
    const planData = {
      ...plan,
      weekKey,
      generatedAt: new Date().toISOString(),
      taskStates:  {}, // track which tasks user has checked off
    };
    await planRef.set(planData);

    res.json(planData);
  } catch (err) {
    console.error('Plan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /dashboard/plan/task
// Update task completion state
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/plan/task', requirePremium, async (req, res) => {
  try {
    const { taskId, done } = req.body;
    const weekKey = getWeekKey();
    const db = getDb();
    await db
      .collection('users').doc(req.user.uid)
      .collection('plans').doc(weekKey)
      .update({ [`taskStates.${taskId}`]: done });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/analysis
// Weekly performance analysis with AI insights
// ─────────────────────────────────────────────────────────────────────────────
router.get('/analysis', requirePremium, async (req, res) => {
  try {
    const db      = getDb();
    const uid     = req.user.uid;
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();

    let channel   = userData.channel;
    let snapshots = await getSnapshots(uid, 2);

    // Fetch fresh data if token available
    if (req.user.accessToken) {
      try {
        channel = await getChannelStats(req.user.accessToken);
        const videos = await getRecentVideos(req.user.accessToken, channel.id);
        await saveWeeklySnapshot(uid, channel, videos);
        snapshots = await getSnapshots(uid, 2);
      } catch (e) {
        console.error('YouTube fetch error:', e.message);
      }
    }

    const thisWeek = snapshots[0] || { stats: channel, videos: [] };
    const lastWeek = snapshots[1] || { stats: {} };

    // Build stat deltas
    const stats = {
      subscribers:  { current: thisWeek.stats.subscribers || 0, delta: (thisWeek.stats.subscribers || 0) - (lastWeek.stats.subscribers || 0) },
      totalViews:   { current: thisWeek.stats.totalViews || 0,  delta: (thisWeek.stats.totalViews || 0)  - (lastWeek.stats.totalViews || 0) },
      videoCount:   { current: thisWeek.stats.videoCount || 0,  delta: (thisWeek.stats.videoCount || 0)  - (lastWeek.stats.videoCount || 0) },
    };

    // AI insights
    const aiAnalysis = await generateAnalysis({
      channel:  channel || userData.channel,
      profile:  userData.profile || {},
      snapshots,
    });

    // Recent videos
    const videos = thisWeek.videos?.slice(0, 7).map(v => ({
      title:       v.title,
      views:       v.views,
      likes:       v.likes,
      publishedAt: v.publishedAt,
    })) || [];

    res.json({ stats, aiAnalysis, videos, weekKey: getWeekKey() });
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /dashboard/chat
// AI Coach chat — sends message history, returns Ollama reply
// ─────────────────────────────────────────────────────────────────────────────
router.post('/chat', requirePremium, async (req, res) => {
  try {
    const { messages, taskContext, niche, lang } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'No messages' });

    const db      = getDb();
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    const userData = userSnap.data();

    // Check points
    const weekKey = getWeekKey();
    const lastReset = userData.pointsWeekKey || '';
    let points = (lastReset !== weekKey) ? 50 : (userData.chatPoints ?? 50);
    if (points < 5) return res.status(403).json({ error: 'Not enough points. Please recharge.' });

    // Deduct points
    const newPoints = Math.max(0, points - 5);
    await db.collection('users').doc(req.user.uid).update({
      chatPoints: newPoints,
      pointsWeekKey: weekKey,
    });

    const reply = await chatWithCoach({
      messages,
      user:        req.user,
      channel:     userData.channel,
      profile:     userData.profile,
      taskContext, // restrict to task topic
      niche:       niche || userData.profile?.niche,
      lang:        lang || userData.profile?.lang,
    });

    res.json({ reply, pointsLeft: newPoints });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/goal
// Goal tracker data with AI-generated roadmap
// ─────────────────────────────────────────────────────────────────────────────
router.get('/goal', requirePremium, async (req, res) => {
  try {
    const db       = getDb();
    const uid      = req.user.uid;
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();

    let channel     = userData.channel;
    const weekKey   = getWeekKey();
    const goalNum   = userData.profile?.goalNumber || 10000;

    // Fetch fresh subscriber count if possible
    if (req.user.accessToken) {
      try { channel = await getChannelStats(req.user.accessToken); } catch (e) {}
    }

    const currentSubs = channel?.subscribers || 0;

    // Check Firestore cache — roadmap is cached per week per goal
    // Add ?refresh=true to force regeneration
    const forceRefresh = req.query.refresh === 'true';
    const cacheKey  = `goal_${weekKey}_${goalNum}`;
    const cacheRef  = db.collection('users').doc(uid).collection('goalCache').doc(cacheKey);
    const cacheSnap = await cacheRef.get();

    let timeline;
    if (cacheSnap.exists && !forceRefresh) {
      // Return cached roadmap instantly
      timeline = cacheSnap.data();
      console.log(`[Goal] Returning cached roadmap for week ${weekKey}`);
    } else {
      // Generate new roadmap with Ollama
      console.log(`[Goal] Generating new roadmap for week ${weekKey}`);
      const snapshots = await getSnapshots(uid, 4);
      timeline = await estimateGoalTimeline({
        channel:  channel || { subscribers: 0 },
        profile:  userData.profile || {},
        snapshots,
      });
      // Save to cache
      try {
        await cacheRef.set({ ...timeline, cachedAt: new Date().toISOString() });
      } catch (e) {
        console.error('[Goal] Cache save failed:', e.message);
      }
    }

    // Auto-detect if goal has been reached
    const goalReached = currentSubs >= goalNum;

    // Suggest next goal if current reached
    function suggestNextGoal(current) {
      const milestones = [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
      for (const m of milestones) {
        if (m > current) return m;
      }
      return current * 2;
    }

    res.json({
      current:      currentSubs,
      goal:         goalNum,
      goalReached,
      suggestedNextGoal: goalReached ? suggestNextGoal(currentSubs) : null,
      profile:      userData.profile,
      achievements: userData.achievements || [],
      goalJustSet:  userData.profile?.goalJustSet || false,
      ...timeline,
    });
  } catch (err) {
    console.error('Goal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/me — current user profile
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const db      = getDb();
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    const userData = userSnap.data();
    const { accessToken, refreshToken, ...safe } = userData;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────
function getWeekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /dashboard/task-guide
// Generates a detailed step-by-step guide for a specific task
// ─────────────────────────────────────────────────────────────────────────────
router.post('/task-guide', requirePremium, async (req, res) => {
  try {
    const { task } = req.body;
    if (!task) return res.status(400).json({ error: 'No task provided' });

    const db  = getDb();
    const uid = req.user.uid;

    // Check Firestore cache first — return immediately if already generated
    const cacheKey  = `task_${task.id}_${getWeekKey()}`;
    const cacheRef  = db.collection('users').doc(uid).collection('taskGuides').doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      console.log(`[TaskGuide] Returning cached guide for task ${task.id}`);
      return res.json(cacheSnap.data());
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();
    const profile  = userData.profile || {};
    const niche    = profile.nicheDesc || profile.niche || 'content creation';
    const lang     = profile.lang || 'Tamil';
    const channel  = userData.channel || {};

    const aiGuide = await generateTaskGuide({
      task: {
        ...task,
        niche,
        lang,
        prompt: `Create a TubeCoach task guide for ${task.title || task.name || 'this task'} in the ${niche} niche.`
      },
      channel,
      profile,
    });

    const aiGuideText = aiGuide.task_guide || aiGuide.guide || aiGuide.answer || aiGuide.reply || '';
    const aiResult = aiGuide.steps ? aiGuide : {
      totalTime: aiGuide.totalTime || '3-4 hours',
      steps: [
        {
          stepNum: 1,
          title: task.title || task.name || 'Complete the task',
          timestamp: task.type === 'video' || task.type === 'short' ? '0:00 - 0:30' : 'Start',
          duration: '30 min',
          what: aiGuideText || `Complete this task for your ${niche} channel.`,
          script: aiGuideText || `Explain the idea clearly in ${lang}.`,
          onScreen: 'Show the main action or example clearly.',
          tip: 'Keep it simple, specific, and useful for the viewer.'
        }
      ],
      seoContent: aiGuide.seoContent || null,
    };

    try {
      await cacheRef.set({ ...aiResult, cachedAt: new Date().toISOString() });
    } catch(e) { console.error('[TaskGuide] Cache save failed:', e.message); }

    return res.json(aiResult);

  } catch (err) {
    console.error('Task guide error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /dashboard/update-goal
// Called when user reaches goal and sets a new one
// ─────────────────────────────────────────────────────────────────────────────
router.post('/update-goal', requireAuth, async (req, res) => {
  try {
    const { goalNumber, goal } = req.body;
    const db = getDb();
    const uid = req.user.uid;

    // Save old goal as achievement
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();
    const oldGoal  = userData.profile?.goalNumber || 10000;
    const now      = new Date();

    const achievementIcons = {
      1000: '🎯', 10000: '🏆', 100000: '🥈', 1000000: '🥇', 10000000: '💎'
    };

    const newAchievement = {
      icon:  achievementIcons[oldGoal] || '🏆',
      label: oldGoal.toLocaleString('en-IN') + ' subscribers',
      date:  now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      achievedAt: now.toISOString(),
    };

    const existing = userData.achievements || [];

    // Update profile with new goal + save achievement
    await db.collection('users').doc(uid).update({
      'profile.goalNumber': goalNumber,
      'profile.goal':       goal,
      'profile.goalJustSet': true,
      achievements: [...existing, newAchievement],
      updatedAt: now.toISOString(),
    });

    // Delete cached plan + goal roadmap so they regenerate with new goal
    const weekKey   = getWeekKey();
    const planRef   = db.collection('users').doc(uid).collection('plans').doc(weekKey);
    const planSnap  = await planRef.get();
    if (planSnap.exists) await planRef.delete();

    // Clear all goal caches so roadmap regenerates for new goal
    const goalCaches = await db.collection('users').doc(uid).collection('goalCache').get();
    for (const doc of goalCaches.docs) { await doc.ref.delete(); }

    res.json({ success: true, achievement: newAchievement });
  } catch (err) {
    console.error('Update goal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/chat-points — get user's current points
// POST /dashboard/chat-points — update points after message
// ─────────────────────────────────────────────────────────────────────────────
router.get('/chat-points', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const uid = req.user.uid;
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();

    const WEEKLY_POINTS = 50;
    const weekKey = getWeekKey();
    const lastReset = userData.pointsWeekKey || '';
    let points = userData.chatPoints;

    // Reset points every week
    if (lastReset !== weekKey || points === undefined || points === null) {
      points = WEEKLY_POINTS;
      await db.collection('users').doc(uid).update({
        chatPoints: WEEKLY_POINTS,
        pointsWeekKey: weekKey,
      });
    }

    res.json({ points, weekKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat-points', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const uid = req.user.uid;
    const { points } = req.body;
    await db.collection('users').doc(uid).update({ chatPoints: points });
    res.json({ points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
