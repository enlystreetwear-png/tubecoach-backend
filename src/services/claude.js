```javascript
// src/services/claude.js
// Google Gemini AI Service (optimized + fixed)

const axios = require('axios');

// BEST FREE MODEL FOR LOWER 429 ERRORS
const GEMINI_MODEL = 'gemini-2.0-flash-lite';

// ─────────────────────────────────────────────────────────────
// Delay helper
// ─────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// Gemini Text Call
// ─────────────────────────────────────────────────────────────
async function callGemini(prompt, maxTokens = 800) {

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY in .env');
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  try {

    // small delay to reduce rate-limit
    await sleep(1200);

    const res = await axios.post(
      url,
      {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7
        }
      },
      {
        timeout: 30000
      }
    );

    const text =
      res?.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('No response from Gemini');
    }

    return text.trim();

  } catch (err) {

    console.error(
      '[Gemini Error]',
      err.response?.status,
      JSON.stringify(err.response?.data || err.message, null, 2)
    );

    // Retry once for 429 errors
    if (err.response?.status === 429) {

      console.log('429 Rate Limit. Waiting 5 seconds...');

      await sleep(5000);

      return callGemini(prompt, maxTokens);
    }

    throw new Error('Gemini request failed');
  }
}

// ─────────────────────────────────────────────────────────────
// Gemini Chat
// ─────────────────────────────────────────────────────────────
async function callGeminiChat(systemPrompt, messages, maxTokens = 400) {

  const apiKey = process.env.GEMINI_API_KEY;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  try {

    await sleep(1200);

    const contents = [
      {
        role: 'user',
        parts: [{ text: systemPrompt }]
      }
    ];

    messages.forEach(m => {
      contents.push({
        role: m.role === 'ai' ? 'model' : 'user',
        parts: [{ text: m.text }]
      });
    });

    const res = await axios.post(
      url,
      {
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7
        }
      },
      {
        timeout: 30000
      }
    );

    const text =
      res?.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('No chat response from Gemini');
    }

    return text.trim();

  } catch (err) {

    console.error(
      '[Gemini Chat Error]',
      err.response?.status,
      JSON.stringify(err.response?.data || err.message, null, 2)
    );

    if (err.response?.status === 429) {

      console.log('429 Rate Limit. Waiting 5 seconds...');

      await sleep(5000);

      return callGeminiChat(systemPrompt, messages, maxTokens);
    }

    throw new Error('Gemini chat failed');
  }
}

// ─────────────────────────────────────────────────────────────
// Fetch Google News Trends
// ─────────────────────────────────────────────────────────────
async function fetchRealTrends(niche) {

  const now = new Date();

  const year = now.getFullYear();

  const month =
    now.toLocaleString('en-IN', { month: 'long' });

  const searchTerm =
    `${niche} India ${month} ${year}`;

  try {

    const rssUrl =
      `https://news.google.com/rss/search?q=${encodeURIComponent(searchTerm)}&hl=en-IN&gl=IN&ceid=IN:en`;

    const response = await axios.get(rssUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const headlines = [];

    const regex = /<title>(.*?)<\/title>/g;

    let match;

    while ((match = regex.exec(response.data)) !== null) {

      const title = match[1]
        .replace(/<[^>]+>/g, '')
        .trim();

      if (
        title.length > 15 &&
        !title.includes('Google News') &&
        !headlines.includes(title)
      ) {
        headlines.push(title);
      }

      if (headlines.length >= 5) break;
    }

    return {
      headlines,
      month,
      year
    };

  } catch (err) {

    console.error(
      '[Trend Fetch Error]',
      err.message
    );

    return {
      headlines: [],
      month,
      year
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Weekly Plan
// ─────────────────────────────────────────────────────────────
async function generateWeeklyPlan({
  channel,
  profile,
  snapshots
}) {

  const niche =
    profile?.niche || 'Tech';

  const lang =
    profile?.lang || 'Tamil';

  const trends =
    await fetchRealTrends(niche);

  const prompt = `
You are TubeCoach.

Create a short weekly YouTube growth plan.

Niche: ${niche}
Language: ${lang}
Subscribers: ${channel?.subscribers || 0}

Trending Headlines:
${trends.headlines.join('\n')}

Return JSON only:

{
  "weekSummary": "summary",
  "tasks": [
    {
      "id": 1,
      "type": "video",
      "priority": "high",
      "title": "video idea",
      "detail": "reason"
    }
  ],
  "weeklyInsight": "insight"
}
`;

  const text = await callGemini(prompt, 600);

  const jsonMatch =
    text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('Weekly plan parse failed');
  }

  return JSON.parse(jsonMatch[0]);
}

// ─────────────────────────────────────────────────────────────
// Channel Analysis
// ─────────────────────────────────────────────────────────────
async function generateAnalysis({
  channel,
  profile,
  snapshots
}) {

  const videos =
    snapshots?.[0]?.videos || [];

  const prompt = `
Analyze this YouTube creator.

Channel: ${channel?.title}
Niche: ${profile?.niche}
Language: ${profile?.lang}

Top Videos:
${videos.slice(0, 3).map(v => v.title).join('\n')}

JSON only:
{
  "insights": [
    { "emoji": "📈", "text": "growth insight" },
    { "emoji": "⚠️", "text": "improvement" },
    { "emoji": "🚀", "text": "next step" }
  ]
}
`;

  const text = await callGemini(prompt, 300);

  const jsonMatch =
    text.match(/\{[\s\S]*\}/);

  return JSON.parse(jsonMatch[0]);
}

// ─────────────────────────────────────────────────────────────
// Analyze Channel
// ─────────────────────────────────────────────────────────────
async function analyzeChannel({
  channel,
  videos
}) {

  const prompt = `
Analyze this channel.

Channel:
${channel.title}

Videos:
${videos.slice(0, 5).map(v => v.title).join('\n')}

JSON only:
{
  "detectedNiche": "Tech",
  "detectedLang": "Tamil",
  "contentSummary": "summary"
}
`;

  const text = await callGemini(prompt, 250);

  const jsonMatch =
    text.match(/\{[\s\S]*\}/);

  return JSON.parse(jsonMatch[0]);
}

// ─────────────────────────────────────────────────────────────
// AI Coach Chat
// ─────────────────────────────────────────────────────────────
async function chatWithCoach({
  messages,
  user,
  channel,
  profile
}) {

  const systemPrompt = `
You are AITube Coach.

Help Indian YouTube creators grow.

Creator:
${user?.name}

Channel:
${channel?.title}

Niche:
${profile?.niche}

Keep answers practical and short.
`;

  return await callGeminiChat(
    systemPrompt,
    messages,
    400
  );
}

// ─────────────────────────────────────────────────────────────
// Goal Timeline
// ─────────────────────────────────────────────────────────────
async function estimateGoalTimeline({
  channel,
  profile
}) {

  const current =
    channel?.subscribers || 0;

  const goal =
    profile?.goalNumber || 10000;

  const remaining =
    Math.max(0, goal - current);

  const prompt = `
Current Subscribers:
${current}

Goal:
${goal}

Give simple 4-week roadmap.

JSON only:
{
  "roadmap": [
    {
      "week": "Week 1",
      "focus": "action"
    }
  ]
}
`;

  let roadmap = [];

  try {

    const text =
      await callGemini(prompt, 250);

    const jsonMatch =
      text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {

      roadmap =
        JSON.parse(jsonMatch[0]).roadmap || [];
    }

  } catch (err) {

    console.error(
      '[Roadmap Error]',
      err.message
    );
  }

  return {
    remaining,
    roadmap
  };
}

// ─────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────
module.exports = {
  generateWeeklyPlan,
  generateAnalysis,
  analyzeChannel,
  chatWithCoach,
  estimateGoalTimeline,
};
```
