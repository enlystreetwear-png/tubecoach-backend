// src/services/claude.js
// BaiuGPT provider adapter. The filename is kept for compatibility with existing routes.
const axios = require("axios");

const BAIUGPT_URL = (process.env.BAIUGPT_URL || process.env.BAIUGPT_API_URL || "").replace(/\/$/, "");
const BAIUGPT_API_KEY = process.env.BAIUGPT_API_KEY;

async function callBaiuGPT(path, body, timeout = 120000) {
  if (!BAIUGPT_URL) {
    throw new Error("BAIUGPT_URL or BAIUGPT_API_URL is missing");
  }

  if (!BAIUGPT_API_KEY) {
    throw new Error("BAIUGPT_API_KEY is missing");
  }

  const res = await axios.post(
    `${BAIUGPT_URL}${path}`,
    body,
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAIUGPT_API_KEY
      },
      timeout
    }
  );

  return res.data;
}

function extractText(result) {
  return result.reply || result.answer || result.task_guide || result.guide || "";
}

async function generateWeeklyPlan({ channel, profile, snapshots }) {
  return callBaiuGPT("/ai/weekly-plan", {
    channel,
    profile,
    snapshots
  });
}

async function generateAnalysis({ channel, profile, snapshots }) {
  return callBaiuGPT("/ai/analysis", {
    channel,
    profile,
    snapshots
  });
}

async function analyzeChannel({ channel, videos }) {
  return callBaiuGPT("/ai/analyze-channel", {
    channel,
    videos
  });
}

async function chatWithCoach({ messages, user, channel, profile, taskContext, niche, lang }) {
  const result = await callBaiuGPT("/ai/coach", {
    messages,
    user,
    channel,
    profile,
    taskContext,
    niche,
    lang
  });

  return extractText(result);
}

async function estimateGoalTimeline({ channel, profile, snapshots }) {
  return callBaiuGPT("/ai/goal-roadmap", {
    channel,
    profile,
    snapshots
  });
}

async function generateTaskGuide({ task, channel, profile }) {
  return callBaiuGPT("/ai/task-guide", {
    task,
    channel,
    profile
  });
}

module.exports = {
  generateWeeklyPlan,
  generateAnalysis,
  analyzeChannel,
  chatWithCoach,
  estimateGoalTimeline,
  generateTaskGuide
};
