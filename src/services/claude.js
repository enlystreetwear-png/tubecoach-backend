// src/services/claude.js
// All AI calls — using Groq (free, fast, llama-3.3-70b)

const axios = require('axios');

async function groqRequest(systemPrompt, userPrompt, maxTokens = 2000) {
  const apiKey = process.env.GROQ_API_KEY;
  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      max_tokens:  maxTokens,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );
  return res.data.choices[0].message.content.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch real trending headlines from Google News RSS
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
// Generate weekly action plan
// ─────────────────────────────────────────────────────────────────────────────
async function generateWeeklyPlan({ channel, profile, snapshots }) {
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

  const trendData = await fetchRealTrends(niche, lang);

  const headlinesBlock = trendData.headlines.length > 0
    ? `REAL GOOGLE NEWS HEADLINES (fetched right now — ${dateStr}):\n${trendData.headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
    : `No headlines fetched. Use your knowledge of ${niche} trends in India for ${month} ${year}.`;

  const system = `You are TubeCoach, an expert YouTube growth strategist for Indian creators. You always respond with valid JSON only — no markdown, no code blocks, no extra text.`;

  const user = `TODAY: ${dateStr}. YEAR: ${year}.

${headlinesBlock}

CREATOR:
- Channel: "${channel.title || 'New Channel'}"
- Niche: ${niche}, Language: ${lang}
- Subscribers: ${(channel.subscribers || 0).toLocaleString()}
- Goal: ${profile.goal || '10,000 subscribers'}
- Posts per week: ${profile.freq || '2 videos/week'}
- Growth last week: ${subDelta >= 0 ? '+' : ''}${subDelta}

RECENT VIDEOS:
${recentVideos.slice(0, 4).map(v => `- "${v.title}" — ${(v.views || 0).toLocaleString()} views`).join('\n') || '- New channel'}

Create a weekly action plan. Respond ONLY with this JSON:
{
  "weekSummary": "what is trending this week in their niche",
  "tasks": [
    { "id": 1, "type": "video", "priority": "high", "title": "Post: \\"specific video title in ${lang}\\"", "detail": "why relevant", "trendReason": "real trend driving this", "isIdea": true }
  ],
  "trends": [
    { "name": "trending topic", "score": 94 },
    { "name": "trending topic", "score": 87 },
    { "name": "trending topic", "score": 79 },
    { "name": "trending topic", "score": 72 },
    { "name": "trending topic", "score": 65 }
  ],
  "weeklyInsight": "one insight for this week"
}

Rules: 6-8 tasks total, types: video/short/engage/seo/community, 2-3 with isIdea:true`;

  const text = await groqRequest(system, user, 2000);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse plan');
  return JSON.parse(jsonMatch[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate channel analysis
// ─────────────────────────────────────────────────────────────────────────────
async function generateAnalysis({ channel, profile, snapshots }) {
  const thisWeek = snapshots[0]?.stats || channel;
  const lastWeek = snapshots[1]?.stats || {};
  const videos   = snapshots[0]?.videos || [];

  const system = `You are TubeCoach analyzing Indian YouTube channels. Respond with valid JSON only.`;
  const user   = `Channel: "${channel.title}" | Niche: ${profile.niche} | Language: ${profile.lang}
This week: ${(thisWeek.subscribers||0).toLocaleString()} subs, ${(thisWeek.totalViews||0).toLocaleString()} views
Last week: ${(lastWeek.subscribers||0).toLocaleString()} subs
Top videos: ${videos.slice(0,3).map(v=>`"${v.title}" (${(v.views||0).toLocaleString()} views)`).join(', ')||'No videos yet'}

Give 3 actionable insights. JSON only:
{
  "insights": [
    { "emoji": "📈", "text": "what worked this week" },
    { "emoji": "⚠️", "text": "what to improve" },
    { "emoji": "🚀", "text": "specific action for next week" }
  ],
  "bestDay": "Thursday",
  "bestDayReason": "why this day works",
  "topPerformer": "best video title"
}`;

  const text = await groqRequest(system, user, 600);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding — analyze existing channel
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeChannel({ channel, videos }) {
  const system = `You are TubeCoach. Respond with valid JSON only.`;
  const user   = `Analyze this YouTube channel.
Channel: "${channel.title}", Subscribers: ${channel.subscribers}
Description: "${channel.description}"
Recent videos: ${videos.slice(0,8).map(v=>`"${v.title}"`).join(', ')}

JSON only:
{
  "detectedNiche": "Tech Reviews",
  "detectedLang": "Tamil",
  "contentSummary": "one sentence about this channel",
  "strengths": ["strength 1", "strength 2"],
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

  const text = await groqRequest(system, user, 400);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Coach Chat
// ─────────────────────────────────────────────────────────────────────────────
async function chatWithCoach({ messages, user, channel, profile, taskContext, niche, lang }) {
  const now = new Date();

  const taskSection = taskContext
    ? `CURRENT TASK: "${taskContext.title}" (${taskContext.type})\nOnly answer questions about this task. Redirect off-topic questions back to the task.`
    : `Help with anything related to their YouTube growth.`;

  const system = `You are AITube Coach, an expert YouTube growth assistant for Indian creators.
Today: ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.
Creator: ${user.name}, Channel: "${channel?.title||'their channel'}", Niche: ${niche||profile?.niche}, Language: ${lang||profile?.lang}, Subscribers: ${(channel?.subscribers||0).toLocaleString()}, Goal: ${profile?.goal||'10,000 subscribers'}.
${taskSection}
Be practical, specific, encouraging. Use Indian context, prices in rupees. Keep responses to 3-5 sentences unless writing a script.`;

  const conversationText = messages.map(m =>
    `${m.role === 'ai' ? 'AITube Coach' : user.name}: ${m.text}`
  ).join('\n');

  const text = await groqRequest(system, conversationText, 800);
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal estimation
// ─────────────────────────────────────────────────────────────────────────────
async function estimateGoalTimeline({ channel, profile, snapshots }) {
  const current  = channel.subscribers || 0;
  const goalNum  = profile.goalNumber  || 10000;
  const niche    = profile.niche       || 'Content creation';
  const freq     = profile.freq        || '2 videos/week';
  const remaining = Math.max(0, goalNum - current);

  const recent = snapshots.slice(0, 4);
  let avgWeeklyGrowth = 50;
  if (recent.length > 1) {
    const deltas = recent.slice(0, -1).map((s, i) =>
      Math.max(0, (s.stats?.subscribers || 0) - (recent[i + 1]?.stats?.subscribers || 0))
    );
    const sum = deltas.reduce((a, b) => a + b, 0);
    avgWeeklyGrowth = Math.max(10, Math.round(sum / deltas.length));
  }

  const estimatedWeeks = avgWeeklyGrowth > 0 ? Math.ceil(remaining / avgWeeklyGrowth) : 999;
  const weeklyGrowthNeeded = estimatedWeeks > 0 ? Math.ceil(remaining / Math.min(estimatedWeeks, 52)) : remaining;

  const allMilestones = [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
  const milestones = allMilestones.filter(m => m <= goalNum * 2).slice(0, 5).map(m => ({
    label: m >= 100000 ? (m/100000)+' Lakh subs' : m >= 1000 ? (m/1000)+'K subs' : m+' subs',
    done: current >= m,
    pct:  Math.min(100, Math.round((current / m) * 100)),
  }));

  const roadmap = [
    { week: 'Week 1', focus: `Post 2 trending ${niche} videos with strong thumbnails`, impact: `+${Math.round(weeklyGrowthNeeded * 0.8)} subs est.` },
    { week: 'Week 2', focus: 'Engage daily in comments, reply to every comment within 1 hour', impact: `+${Math.round(weeklyGrowthNeeded)} subs est.` },
    { week: 'Week 3', focus: 'Post 1 YouTube Short every day to boost channel reach', impact: `+${Math.round(weeklyGrowthNeeded * 1.2)} subs est.` },
    { week: 'Week 4', focus: 'Optimize titles and thumbnails for best CTR, post at peak time', impact: `+${Math.round(weeklyGrowthNeeded * 1.5)} subs est.` },
  ];

  return { estimatedWeeks, weeklyGrowthNeeded, avgWeeklyGrowth, roadmap, milestones };
}

module.exports = {
  generateWeeklyPlan,
  generateAnalysis,
  analyzeChannel,
  chatWithCoach,
  estimateGoalTimeline,
};
