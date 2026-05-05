// src/services/claude.js
// All Claude API calls — weekly plan, analysis, onboarding, chat

const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch real trending headlines from Google News RSS
// Runs BEFORE Claude so real data goes into the prompt
// ─────────────────────────────────────────────────────────────────────────────
async function fetchRealTrends(niche, lang) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.toLocaleString('en-IN', { month: 'long' });

  const nicheTerms = {
    'Gaming':       `gaming India ${month} ${year}`,
    'Tech Reviews': `smartphone launch India ${month} ${year}`,
    'Cooking':      `viral recipe India ${month} ${year}`,
    'Finance':      `stock market India news ${month} ${year}`,
    'Fitness':      `fitness trend India ${month} ${year}`,
    'Education':    `education news India ${month} ${year}`,
    'Comedy':       `viral comedy India ${month} ${year}`,
    'Vlogs':        `travel vlog India trending ${month} ${year}`,
    'Beauty':       `beauty skincare trend India ${month} ${year}`,
  };

  const searchTerm = nicheTerms[niche] || `${niche} trending India ${month} ${year}`;

  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchTerm)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const response = await axios.get(rssUrl, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const headlines = [];
    const patterns = [
      /<title><!\[CDATA\[(.*?)\]\]><\/title>/g,
      /<title>(.*?)<\/title>/g,
    ];

    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(response.data)) !== null && headlines.length < 10) {
        const t = match[1].replace(/<[^>]+>/g, '').trim();
        if (t.length > 15 && !t.toLowerCase().includes('google news') && !headlines.includes(t)) {
          headlines.push(t);
        }
      }
      if (headlines.length > 0) break;
    }

    console.log(`[Trends] Fetched ${headlines.length} headlines for "${searchTerm}"`);
    return { headlines: headlines.slice(0, 8), searchTerm, month, year };
  } catch (err) {
    console.error('[Trends] Fetch failed:', err.message);
    return { headlines: [], searchTerm, month, year };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate weekly action plan with REAL current trends
// ─────────────────────────────────────────────────────────────────────────────
async function generateWeeklyPlan({ channel, profile, snapshots }) {
  const client = getClient();

  const thisWeek     = snapshots[0]?.stats || {};
  const lastWeek     = snapshots[1]?.stats || {};
  const recentVideos = snapshots[0]?.videos || [];
  const subDelta     = (thisWeek.subscribers || 0) - (lastWeek.subscribers || 0);

  const niche   = profile.niche || 'Tech Reviews';
  const lang    = profile.lang  || 'Tamil';
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const year    = now.getFullYear();
  const month   = now.toLocaleString('en-IN', { month: 'long' });

  // Step 1: Fetch real trends from Google News
  const trendData = await fetchRealTrends(niche, lang);

  const headlinesBlock = trendData.headlines.length > 0
    ? `REAL GOOGLE NEWS HEADLINES (fetched right now — ${dateStr}):\n${trendData.headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nUse these headlines to identify what is ACTUALLY trending this week.`
    : `No headlines fetched for "${trendData.searchTerm}". Use your best knowledge of what is happening in ${niche} in India in ${month} ${year}. Do NOT use anything from 2024.`;

  const prompt = `You are TubeCoach, an expert YouTube growth strategist for Indian creators.

TODAY: ${dateStr}
YEAR: ${year} — NEVER mention or reference 2024.

${headlinesBlock}

CREATOR:
- Channel: "${channel.title || 'New Channel'}"
- Niche: ${niche}
- About their content: ${profile.nicheDesc || profile.niche || niche}
- Language: ${lang}
- Subscribers: ${(channel.subscribers || 0).toLocaleString()}
- Goal: ${profile.goal || '10,000 subscribers'}
- Posts per week: ${profile.freq || '2 videos/week'}
- Subscriber growth last week: ${subDelta >= 0 ? '+' : ''}${subDelta}

RECENT VIDEOS:
${recentVideos.slice(0, 4).map(v => `- "${v.title}" — ${(v.views || 0).toLocaleString()} views`).join('\n') || '- New channel, no videos yet'}

TASK: Create a weekly action plan using the REAL headlines above. Extract actual current topics from the headlines and turn them into specific video ideas for this creator.

Respond ONLY with this JSON (no markdown, no extra text, no code blocks):
{
  "weekSummary": "What is actually happening this week in their niche based on real news",
  "tasks": [
    {
      "id": 1,
      "type": "video",
      "priority": "high",
      "title": "Post: \\"[specific video title in ${lang} based on real current trend]\\"",
      "detail": "Why this is relevant this week — reference actual news/event",
      "trendReason": "Specific real event from ${month} ${year} driving this",
      "isIdea": true
    }
  ],
  "trends": [
    { "name": "Real trending topic from news", "score": 94 },
    { "name": "Real trending topic from news", "score": 87 },
    { "name": "Real trending topic from news", "score": 79 },
    { "name": "Real trending topic from news", "score": 72 },
    { "name": "Real trending topic from news", "score": 65 }
  ],
  "weeklyInsight": "One insight based on real events happening this week"
}

RULES:
- 6-8 tasks total. Types: video, short, engage, seo, community
- 2-3 tasks with isIdea: true (video ideas from real trends)
- Year must be ${year} everywhere — never 2024
- trends must come from the real headlines, not made-up topics
- trendReason must cite a specific real thing from ${month} ${year}`;

  const res = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = res.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[Plan] Could not find JSON in response:', text.substring(0, 300));
    throw new Error('Could not parse plan from Claude');
  }

  return JSON.parse(jsonMatch[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate channel analysis + AI insight
// ─────────────────────────────────────────────────────────────────────────────
async function generateAnalysis({ channel, profile, snapshots }) {
  const client = getClient();

  const thisWeek = snapshots[0]?.stats || channel;
  const lastWeek = snapshots[1]?.stats || {};
  const videos   = snapshots[0]?.videos || [];

  const prompt = `You are TubeCoach. Analyze this Indian YouTube creator's weekly performance.

CHANNEL: "${channel.title}" | Niche: ${profile.niche} | Language: ${profile.lang}

THIS WEEK: ${(thisWeek.subscribers || 0).toLocaleString()} subs, ${(thisWeek.totalViews || 0).toLocaleString()} views, ${videos.length} videos
LAST WEEK: ${(lastWeek.subscribers || 0).toLocaleString()} subs

TOP VIDEOS: ${videos.slice(0, 3).map(v => `"${v.title}" (${(v.views || 0).toLocaleString()} views)`).join(', ') || 'No videos yet'}

Give 3 actionable insights. JSON only:
{
  "insights": [
    { "emoji": "📈", "text": "what worked this week" },
    { "emoji": "⚠️", "text": "what to improve" },
    { "emoji": "🚀", "text": "specific action for next week" }
  ],
  "bestDay": "Thursday",
  "bestDayReason": "why this day works for their audience",
  "topPerformer": "best video title this week"
}`;

  const res = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = res.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding — analyze existing channel content
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeChannel({ channel, videos }) {
  const client = getClient();

  const prompt = `Analyze this YouTube channel.

CHANNEL: "${channel.title}"
DESCRIPTION: "${channel.description}"
SUBSCRIBERS: ${channel.subscribers}
RECENT VIDEOS:
${videos.slice(0, 8).map(v => `- "${v.title}"`).join('\n')}

JSON only:
{
  "detectedNiche": "Tech Reviews",
  "detectedLang": "Tamil",
  "contentSummary": "One sentence about this channel",
  "strengths": ["strength 1", "strength 2"],
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

  const res = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = res.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Coach Chat
// ─────────────────────────────────────────────────────────────────────────────
async function chatWithCoach({ messages, user, channel, profile, taskContext, niche, lang }) {
  const client = getClient();
  const now    = new Date();

  const taskSection = taskContext
    ? `CURRENT TASK THE USER NEEDS HELP WITH:
- Task: "${taskContext.title}"
- Details: ${taskContext.detail || 'No additional details'}
- Type: ${taskContext.type || 'general'}

STRICT RULE: You MUST only answer questions related to this specific task. 
If the user asks about something unrelated to this task, politely redirect them back to the task.
Say something like: "I'm here to help you with '${taskContext.title}'. Let's stay focused on that! 😊"
Do NOT answer questions about other topics, other tasks, or general YouTube advice outside this task context.`
    : `Help with anything related to their YouTube growth.`;

  const systemPrompt = `You are AITube Coach, an expert YouTube growth assistant for Indian creators.
Today is ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.

CREATOR:
- Name: ${user.name}
- Channel: "${channel?.title || 'their channel'}"
- Niche: ${profile?.nicheDesc || niche || profile?.niche || 'Content creation'}
- Language: ${lang || profile?.lang || 'Tamil'}
- Subscribers: ${(channel?.subscribers || 0).toLocaleString()}
- Goal: ${profile?.goal || '10,000 subscribers'}

${taskSection}

Be practical, specific, encouraging. Mention Indian context, prices in rupees.
Keep responses to 3-5 sentences unless writing a full script or list.
Never reference 2024 — use ${now.getFullYear()} context only.`;

  const res = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system:     systemPrompt,
    messages:   messages.map(m => ({
      role:    m.role === 'ai' ? 'assistant' : 'user',
      content: m.text,
    })),
  });

  return res.content[0].text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal estimation — math done in backend, Claude only writes roadmap actions
// ─────────────────────────────────────────────────────────────────────────────
async function estimateGoalTimeline({ channel, profile, snapshots }) {
  const client = getClient();

  const current  = channel.subscribers || 0;
  const goalNum  = profile.goalNumber  || 10000;
  const niche    = profile.niche       || 'Content creation';
  const freq     = profile.freq        || '2 videos/week';
  const remaining = Math.max(0, goalNum - current);

  // Calculate avg weekly growth from snapshots (real math, not Claude)
  const recent = snapshots.slice(0, 4);
  let avgWeeklyGrowth = 50; // sensible default for new channels
  if (recent.length > 1) {
    const deltas = recent.slice(0, -1).map((s, i) =>
      Math.max(0, (s.stats?.subscribers || 0) - (recent[i + 1]?.stats?.subscribers || 0))
    );
    const sum = deltas.reduce((a, b) => a + b, 0);
    avgWeeklyGrowth = Math.max(10, Math.round(sum / deltas.length));
  }

  // Calculate weeks to goal (real math)
  const estimatedWeeks = avgWeeklyGrowth > 0
    ? Math.ceil(remaining / avgWeeklyGrowth)
    : 999;

  const weeklyGrowthNeeded = estimatedWeeks > 0
    ? Math.ceil(remaining / Math.min(estimatedWeeks, 52))
    : remaining;

  // Build milestones with correct percentages (real math, not Claude)
  const allMilestones = [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
  const relevantMilestones = allMilestones
    .filter(m => m <= goalNum * 2)
    .slice(0, 5);

  const milestones = relevantMilestones.map(m => {
    const done = current >= m;
    const pct  = Math.min(100, Math.round((current / m) * 100));
    const label = m >= 100000
      ? (m / 100000) + ' Lakh subs'
      : m >= 1000
      ? (m / 1000) + 'K subs'
      : m + ' subs';
    return { label, done, pct };
  });

  // Only use Claude for the roadmap action text (not numbers)
  const prompt = `You are TubeCoach. Indian YouTube creator:
- Niche: ${niche}
- Posts per week: ${freq}
- Current: ${current} subscribers
- Goal: ${goalNum} subscribers
- Remaining: ${remaining} subscribers needed
- Weekly growth needed: ${weeklyGrowthNeeded} subs/week

Write a realistic 4-week action roadmap. Each week should have ONE specific actionable focus.
Respond in JSON only:
{
  "roadmap": [
    { "week": "Week 1", "focus": "specific action to take", "impact": "+${Math.round(weeklyGrowthNeeded * 0.8)} subs est." },
    { "week": "Week 2", "focus": "specific action to take", "impact": "+${Math.round(weeklyGrowthNeeded * 1.0)} subs est." },
    { "week": "Week 3", "focus": "specific action to take", "impact": "+${Math.round(weeklyGrowthNeeded * 1.2)} subs est." },
    { "week": "Week 4", "focus": "specific action to take", "impact": "+${Math.round(weeklyGrowthNeeded * 1.5)} subs est." }
  ]
}`;

  const res = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text      = res.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let roadmap     = [
    { week: 'Week 1', focus: 'Post 2 videos on trending topics in your niche', impact: `+${Math.round(weeklyGrowthNeeded * 0.8)} subs est.` },
    { week: 'Week 2', focus: 'Engage daily in comments, collaborate with similar creators', impact: `+${Math.round(weeklyGrowthNeeded)} subs est.` },
    { week: 'Week 3', focus: 'Post 1 YouTube Short every day to boost reach', impact: `+${Math.round(weeklyGrowthNeeded * 1.2)} subs est.` },
    { week: 'Week 4', focus: 'Optimize all video titles and thumbnails for better CTR', impact: `+${Math.round(weeklyGrowthNeeded * 1.5)} subs est.` },
  ];

  try {
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.roadmap && Array.isArray(parsed.roadmap)) {
        roadmap = parsed.roadmap;
      }
    }
  } catch(e) {
    console.error('[Goal] Roadmap parse failed, using fallback:', e.message);
  }

  return {
    estimatedWeeks,
    weeklyGrowthNeeded,
    avgWeeklyGrowth,
    roadmap,
    milestones,
  };
}

module.exports = {
  generateWeeklyPlan,
  generateAnalysis,
  analyzeChannel,
  chatWithCoach,
  estimateGoalTimeline,
};
