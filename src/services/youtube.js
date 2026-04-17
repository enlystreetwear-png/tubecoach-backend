// src/services/youtube.js
// All YouTube Data API v3 calls live here

const axios = require('axios');
const { getDb } = require('../config/firebase');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// ─────────────────────────────────────────────────────────────────────────────
// Get fresh channel stats
// ─────────────────────────────────────────────────────────────────────────────
async function getChannelStats(accessToken) {
  const res = await axios.get(`${YT_BASE}/channels`, {
    params: { part: 'snippet,statistics,contentDetails', mine: true },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const ch = res.data.items?.[0];
  if (!ch) throw new Error('No channel found');

  return {
    id:          ch.id,
    title:       ch.snippet.title,
    description: ch.snippet.description,
    country:     ch.snippet.country || 'IN',
    thumbnail:   ch.snippet.thumbnails?.medium?.url,
    subscribers: parseInt(ch.statistics.subscriberCount || 0),
    totalViews:  parseInt(ch.statistics.viewCount || 0),
    videoCount:  parseInt(ch.statistics.videoCount || 0),
    createdAt:   ch.snippet.publishedAt,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get recent videos (last 10)
// ─────────────────────────────────────────────────────────────────────────────
async function getRecentVideos(accessToken, channelId, maxResults = 10) {
  // Step 1: search for recent uploads
  const searchRes = await axios.get(`${YT_BASE}/search`, {
    params: {
      part:       'snippet',
      channelId,
      type:       'video',
      order:      'date',
      maxResults,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const videoIds = searchRes.data.items?.map(i => i.id.videoId).join(',');
  if (!videoIds) return [];

  // Step 2: get stats for those videos
  const statsRes = await axios.get(`${YT_BASE}/videos`, {
    params: { part: 'snippet,statistics,contentDetails', id: videoIds },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return statsRes.data.items.map(v => ({
    id:           v.id,
    title:        v.snippet.title,
    description:  v.snippet.description,
    thumbnail:    v.snippet.thumbnails?.medium?.url,
    publishedAt:  v.snippet.publishedAt,
    tags:         v.snippet.tags || [],
    views:        parseInt(v.statistics.viewCount || 0),
    likes:        parseInt(v.statistics.likeCount || 0),
    comments:     parseInt(v.statistics.commentCount || 0),
    duration:     v.contentDetails.duration, // ISO 8601
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detect niche from recent video titles + descriptions
// ─────────────────────────────────────────────────────────────────────────────
function detectNiche(videos) {
  const text = videos.map(v => v.title + ' ' + (v.tags?.join(' ') || '')).join(' ').toLowerCase();

  const niches = {
    'Tech Reviews':  ['review', 'smartphone', 'phone', 'laptop', 'tech', 'unboxing', 'gadget', 'mobile', '5g', 'iphone', 'samsung'],
    'Gaming':        ['gaming', 'game', 'gameplay', 'pubg', 'freefire', 'bgmi', 'minecraft', 'gta', 'esports'],
    'Cooking':       ['recipe', 'cooking', 'food', 'kitchen', 'biryani', 'curry', 'homemade', 'chef'],
    'Finance':       ['money', 'investment', 'stock', 'sip', 'mutual fund', 'finance', 'saving', 'ipo'],
    'Education':     ['learn', 'tutorial', 'course', 'study', 'exam', 'class', 'coding', 'python'],
    'Fitness':       ['fitness', 'workout', 'gym', 'yoga', 'exercise', 'diet', 'health', 'weight'],
    'Comedy/Vlogs':  ['vlog', 'daily', 'comedy', 'funny', 'prank', 'challenge', 'reaction'],
  };

  let best = 'General'; let bestScore = 0;
  for (const [niche, keywords] of Object.entries(niches)) {
    const score = keywords.filter(k => text.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = niche; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Save weekly snapshot to Firestore
// ─────────────────────────────────────────────────────────────────────────────
async function saveWeeklySnapshot(uid, stats, videos) {
  const db = getDb();
  const week = getWeekKey();
  await db
    .collection('users').doc(uid)
    .collection('snapshots').doc(week)
    .set({ stats, videos, savedAt: new Date().toISOString() });
}

// ─────────────────────────────────────────────────────────────────────────────
// Get last two weekly snapshots (for comparison)
// ─────────────────────────────────────────────────────────────────────────────
async function getSnapshots(uid, count = 2) {
  const db = getDb();
  const snap = await db
    .collection('users').doc(uid)
    .collection('snapshots')
    .orderBy('savedAt', 'desc')
    .limit(count)
    .get();
  return snap.docs.map(d => d.data());
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getWeekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

module.exports = {
  getChannelStats,
  getRecentVideos,
  detectNiche,
  saveWeeklySnapshot,
  getSnapshots,
};
