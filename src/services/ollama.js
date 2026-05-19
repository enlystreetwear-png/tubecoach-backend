// src/services/ollama.js
// Ollama provider adapter. The filename is kept so existing route imports still work.

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3:latest";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

function clean(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function profileNiche(profile = {}, fallback = "content creation") {
  return clean(profile.nicheDesc || profile.niche, fallback);
}

function profileLang(profile = {}, fallback = "English") {
  return clean(profile.lang, fallback);
}

function latestUserMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] || {};
    const role = clean(msg.role || msg.sender).toLowerCase();
    const text = clean(msg.text || msg.content || msg.message);
    if (text && (!role || role === "user" || role === "human")) return text;
  }
  return "";
}

function recentMessages(messages = [], limit = 8) {
  return messages.slice(-limit).map((msg) => ({
    role: clean(msg.role || msg.sender).toLowerCase() === "ai" ? "assistant" : "user",
    content: clean(msg.text || msg.content || msg.message),
  })).filter((msg) => msg.content);
}

function taskTopic(taskContext, fallback) {
  if (!taskContext || typeof taskContext !== "object") return fallback;
  return clean(taskContext.title || taskContext.name || taskContext.detail || fallback)
    .replace(/^(Create|Short|Package):\s*/i, "");
}

function requestIntent(question) {
  const q = clean(question).toLowerCase();
  if (/(script|voiceover|voice over|dialogue|speak)/.test(q)) return "script";
  if (/(title|headline|name my video)/.test(q)) return "titles";
  if (/(thumbnail|thumb|cover)/.test(q)) return "thumbnail";
  if (/(seo|tags|description|keyword)/.test(q)) return "seo";
  if (/(hook|intro|opening|first 10)/.test(q)) return "hooks";
  if (/(plan|schedule|roadmap|grow|growth)/.test(q)) return "plan";
  return "coach";
}

function nicheTrends(niche) {
  const lower = niche.toLowerCase();
  if (lower.includes("tech") || lower.includes("review")) {
    return [
      "AI phone features worth using",
      "foldable phones durability and repair cost",
      "camera phone test: zoom, low light, and video",
    ];
  }
  if (lower.includes("gaming") || lower.includes("game")) {
    return [
      "best settings for stable aim",
      "one gameplay mistake beginners repeat",
      "challenge video with a visible result",
    ];
  }
  if (lower.includes("cook") || lower.includes("food")) {
    return [
      "quick recipe with final dish first",
      "budget home recipe with texture checkpoints",
      "one-pot meal for busy days",
    ];
  }
  return [
    `${niche} beginner mistakes`,
    `${niche} step-by-step guide`,
    `${niche} weekly challenge`,
  ];
}

function safeParseJSON(text) {
  if (!text) return null;
  const cleanText = String(text)
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleanText.indexOf("{");
  const end = cleanText.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleanText.slice(start, end + 1));
  } catch (_err) {
    return null;
  }
}

async function postOllama(payload, timeout = OLLAMA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        options: {
          temperature: 0.35,
          top_p: 0.85,
          repeat_penalty: 1.12,
          num_predict: 900,
        },
        ...payload,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 180)}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function askOllama({ system, messages, prompt, json = false, timeout }) {
  const chatMessages = [
    { role: "system", content: system },
    ...(messages || []),
  ];
  if (prompt) chatMessages.push({ role: "user", content: prompt });

  const result = await postOllama({
    messages: chatMessages,
    format: json ? "json" : undefined,
  }, timeout);

  return clean(result.message?.content || result.response || "");
}

function coachSystem({ niche, lang, channel, taskContext }) {
  return [
    "You are TubeCoach AI, a practical YouTube growth coach for small and growing creators.",
    "Your job is to produce the exact useful result the creator asked for, not a general article.",
    "Do not mention internal provider names.",
    "Give concrete scripts, titles, thumbnail ideas, SEO text, hooks, and step-by-step plans when useful.",
    "Keep responses focused on the creator's task and avoid generic motivational filler.",
    "Do not invent specific brands, phone models, prices, statistics, or claims unless the user provided them.",
    "When facts are unknown, give a test/checklist the creator can film instead of pretending you tested it.",
    "If the creator asks for a script, write exact words to say on camera with timestamps.",
    "If the creator asks for titles, give 5 strong title options and pick the best one.",
    "If the creator asks for a thumbnail, describe the layout, text, subject, and visual proof.",
    "If the creator asks for SEO, give title, description, tags, and pinned comment.",
    "If the creator asks how to grow, give a 7-day action plan tied to their niche.",
    "Use short sections and numbered steps. Do not write long essays.",
    "Never answer with vague advice like 'be consistent' unless you also give the exact action.",
    `Creator niche: ${niche}.`,
    `Language preference: ${lang}.`,
    `Channel context: ${JSON.stringify(channel || {})}.`,
    `Current task: ${JSON.stringify(taskContext || {})}.`,
  ].join("\n");
}

function coachPrompt({ messages, profile, taskContext, niche, lang, channel }) {
  const latest = latestUserMessage(messages);
  const intent = requestIntent(latest);
  const topic = taskTopic(taskContext, latest || profileNiche(profile));
  const trends = nicheTrends(niche);
  const formats = {
    script: [
      "Required output format for this script:",
      "1. Video angle: one sentence",
      "2. 0:00 Hook: exact words to say, result first, no greeting",
      "3. 0:10 Setup: exact words to say",
      "4. 0:30 Proof/Test 1: exact words plus what to show",
      "5. 1:15 Proof/Test 2: exact words plus what to show",
      "6. 2:00 Verdict: exact words to say",
      "7. Short clip: one 20-45 second clip idea",
      "8. Next action: one sentence",
    ],
    titles: [
      "Required output format for titles:",
      "1. 5 title options under 70 characters",
      "2. Best pick",
      "3. Why it should get clicks",
    ],
    thumbnail: [
      "Required output format for thumbnail:",
      "1. Main visual",
      "2. Text on thumbnail, max 4 words",
      "3. Layout",
      "4. What not to add",
    ],
    seo: [
      "Required output format for SEO:",
      "1. SEO title",
      "2. Description",
      "3. 15 tags",
      "4. Pinned comment",
    ],
    hooks: [
      "Required output format for hooks:",
      "1. 7 hook options",
      "2. Best hook",
      "3. First shot to show",
    ],
    plan: [
      "Required output format for growth plan:",
      "1. Today",
      "2. This week",
      "3. Next upload",
      "4. What metric to check",
    ],
    coach: [
      "Required output format:",
      "1. Direct answer",
      "2. Exact next steps",
      "3. Copy-paste text or checklist",
      "4. One next action",
    ],
  };

  return [
    `Latest creator request: ${latest || "Give me a useful YouTube growth answer."}`,
    `Detected request type: ${intent}`,
    `Selected task/topic: ${topic}`,
    `Creator niche: ${niche}`,
    `Language to use: ${lang}`,
    `Channel: ${JSON.stringify(channel || {})}`,
    `Profile: ${JSON.stringify(profile || {})}`,
    `Relevant topic angles: ${trends.join("; ")}`,
    "",
    "Answer requirements:",
    "- Start directly with the result. No greeting.",
    "- Make the answer specific to the selected task/topic.",
    "- Do not mention unrelated examples.",
    "- Do not use old or random device/product examples unless asked.",
    "- Include copy-paste ready text where possible.",
    "- Keep it practical for a YouTube creator.",
    "- End with one next action.",
    "",
    ...formats[intent],
  ].join("\n");
}

function localCoachReply({ messages, profile, taskContext, niche, lang }) {
  const finalNiche = clean(niche, profileNiche(profile));
  const finalLang = clean(lang, profileLang(profile));
  const question = latestUserMessage(messages) || "Give me YouTube creator growth advice";
  const topic = taskTopic(taskContext, question);
  const trends = nicheTrends(finalNiche);
  const primary = topic || trends[0];
  const secondary = trends.find(t => t.toLowerCase() !== primary.toLowerCase()) || trends[1];
  const opener = `Ollama is not running, so I am using the built-in offline coach for now.\n\nFor your ${finalNiche} channel, treat this as: ${primary}.`;

  if (/(script|voiceover|voice over|dialogue|speak)/i.test(question)) {
    return `${opener}\n\nUse this script:\n\n0:00 Hook:\nI tested ${primary} like a normal viewer, and this is the part most people miss.\n\n0:10 Setup:\nI will show the exact result, the hidden mistake, and what you should do next.\n\n0:35 Proof:\nHere is what changed, why it matters, and how you can copy it.\n\nEnd:\nTry this today and comment what topic I should test next.\n\nLanguage: ${finalLang}.`;
  }

  if (/(title|headline|name my video)/i.test(question)) {
    return `${opener}\n\nTitle options:\n1. ${primary} - Honest Verdict\n2. I Tested This So You Do Not Waste Time\n3. Before You Try This, Watch These 3 Things\n\nBest pick: ${primary} - Honest Verdict.`;
  }

  if (/(thumbnail|thumb|cover)/i.test(question)) {
    return `${opener}\n\nThumbnail: show one big proof visual from ${primary}, then use 2-4 words like TESTED, WORTH IT, or SKIP. Keep it readable on a phone.`;
  }

  return `${opener}\n\nBest next move:\n1. Open with the final result in the first 5-10 seconds.\n2. Give three proof points: what changed, why it matters, and what viewers should do.\n3. Turn the strongest moment into a 20-45 second Short.\n4. Pin a comment asking viewers to choose between ${primary} and ${secondary}.`;
}

function fallbackPlan(profile = {}) {
  const niche = profileNiche(profile);
  const trends = nicheTrends(niche);
  return {
    summary: `Weekly plan for ${niche}.`,
    focus: "Create one result-first video, one proof Short, and one packaging task.",
    tasks: [
      { id: "idea-1", type: "video", title: `Create: ${trends[0]}`, detail: "Make a decision-first video with proof in the first 10 seconds.", time: "2-3 hours", priority: "high" },
      { id: "short-1", type: "short", title: `Short: ${trends[1]}`, detail: "Cut one strong proof moment into a fast Short.", time: "60 min", priority: "high" },
      { id: "thumb-1", type: "seo", title: `Package: ${trends[2]}`, detail: "Write three title options, one thumbnail concept, tags, and pinned comment.", time: "45 min", priority: "medium" },
    ],
    trends: trends.map((topic, index) => ({ topic, score: 95 - index * 7 })),
  };
}

async function generateJSONWithOllama(prompt, fallback, timeout = OLLAMA_TIMEOUT_MS) {
  try {
    const text = await askOllama({
      json: true,
      timeout,
      system: "You are TubeCoach AI. Return valid JSON only. No markdown. No provider names.",
      prompt,
    });
    return safeParseJSON(text) || fallback;
  } catch (err) {
    console.warn("[Ollama] JSON generation failed:", err.message);
    return fallback;
  }
}

async function generateWeeklyPlan({ channel, profile, snapshots }) {
  const fallback = fallbackPlan(profile);
  return generateJSONWithOllama(`
Create a TubeCoach weekly YouTube action plan.

Channel: ${JSON.stringify(channel || {})}
Profile: ${JSON.stringify(profile || {})}
Snapshots: ${JSON.stringify((snapshots || []).slice(0, 2))}

Return this JSON shape:
{
  "summary": "short summary",
  "focus": "weekly focus",
  "tasks": [
    {"id":"idea-1","type":"video","title":"Create: ...","detail":"...","time":"2-3 hours","priority":"high"},
    {"id":"short-1","type":"short","title":"Short: ...","detail":"...","time":"60 min","priority":"high"},
    {"id":"thumb-1","type":"seo","title":"Package: ...","detail":"...","time":"45 min","priority":"medium"}
  ],
  "trends": [{"topic":"...","score":95}]
}
`, fallback);
}

async function generateAnalysis({ channel, profile, snapshots }) {
  const fallback = {
    summary: "Ollama analysis fallback ready.",
    insights: [{ text: "Open with the result first, then prove it with one clear example." }],
    bestDay: "Saturday",
  };
  return generateJSONWithOllama(`
Analyze this YouTube channel and return JSON.
Channel: ${JSON.stringify(channel || {})}
Profile: ${JSON.stringify(profile || {})}
Snapshots: ${JSON.stringify((snapshots || []).slice(0, 2))}

Shape:
{"summary":"...","insights":[{"text":"..."}],"bestDay":"Saturday"}
`, fallback);
}

async function analyzeChannel({ channel, videos }) {
  const fallback = {
    channel_analysis: "Channel analyzed with local fallback.",
    strengths: ["Clear niche direction"],
    opportunities: ["Turn the strongest topic into a repeatable weekly series."],
  };
  return generateJSONWithOllama(`
Analyze this YouTube channel and recent videos.
Channel: ${JSON.stringify(channel || {})}
Videos: ${JSON.stringify((videos || []).slice(0, 10))}

Shape:
{"channel_analysis":"...","strengths":["..."],"opportunities":["..."]}
`, fallback);
}

async function chatWithCoach({ messages, user, channel, profile, taskContext, niche, lang }) {
  const finalNiche = clean(niche, profileNiche(profile));
  const finalLang = clean(lang, profileLang(profile));
  const promptMessages = recentMessages(messages).slice(0, -1);

  try {
    return await askOllama({
      system: coachSystem({ niche: finalNiche, lang: finalLang, channel, taskContext, user }),
      messages: promptMessages,
      prompt: coachPrompt({
        messages,
        profile,
        taskContext,
        niche: finalNiche,
        lang: finalLang,
        channel,
      }),
    });
  } catch (err) {
    console.warn("[Ollama] Coach failed:", err.message);
    return localCoachReply({ messages, profile, taskContext, niche: finalNiche, lang: finalLang });
  }
}

async function estimateGoalTimeline({ channel, profile, snapshots }) {
  const fallback = {
    timeline: "Publish consistently for 90 days, then double down on topics with the strongest retention.",
    roadmap: [
      { label: "This week", action: "Publish one result-first video and three Shorts from the proof moments." },
      { label: "Next 30 days", action: "Build a repeatable weekly series and compare performance." },
      { label: "Next 90 days", action: "Double down on topics with the highest CTR and retention." },
    ],
  };
  return generateJSONWithOllama(`
Create a YouTube subscriber goal roadmap.
Channel: ${JSON.stringify(channel || {})}
Profile: ${JSON.stringify(profile || {})}
Snapshots: ${JSON.stringify((snapshots || []).slice(0, 4))}

Shape:
{"timeline":"...","roadmap":[{"label":"This week","action":"..."}]}
`, fallback);
}

async function generateTaskGuide({ task, channel, profile }) {
  const fallbackText = `Complete this task for your ${profileNiche(profile)} channel: ${clean(task?.title || task?.name, "TubeCoach task")}.`;
  const fallback = {
    totalTime: "3-4 hours",
    steps: [
      {
        stepNum: 1,
        title: task?.title || task?.name || "Complete the task",
        timestamp: task?.type === "video" || task?.type === "short" ? "0:00 - 0:30" : "Start",
        duration: "30 min",
        what: fallbackText,
        script: fallbackText,
        onScreen: "Show the main action or example clearly.",
        tip: "Keep it simple, specific, and useful for the viewer.",
      },
    ],
    seoContent: null,
  };

  return generateJSONWithOllama(`
Create a detailed TubeCoach task guide.
Task: ${JSON.stringify(task || {})}
Channel: ${JSON.stringify(channel || {})}
Profile: ${JSON.stringify(profile || {})}

Return valid JSON:
{
  "totalTime": "3-4 hours",
  "steps": [
    {
      "stepNum": 1,
      "title": "Step title",
      "timestamp": "0:00 - 0:30",
      "duration": "20 min",
      "what": "exactly what to do",
      "script": "exact words to say",
      "onScreen": "what to show",
      "tip": "one useful tip"
    }
  ],
  "seoContent": null
}
`, fallback);
}

module.exports = {
  generateWeeklyPlan,
  generateAnalysis,
  analyzeChannel,
  chatWithCoach,
  estimateGoalTimeline,
  generateTaskGuide,
};
