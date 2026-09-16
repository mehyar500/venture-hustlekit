// functions/_shared/hustlekit.js
// Shared helpers for the HustleKit Pages Functions: track catalog, Workers AI
// JSON helper (handles the pre-parsed result.response quirk), input shaping.

export const TRACKS = {
  "ai-writing": {
    name: "AI freelance writing",
    icon: "✍️",
    craft: "newsletters, blog posts, email sequences, and website copy",
    offers: "newsletter ghostwriting, SEO blog packages, email welcome sequences",
    hunting: "Substack/newsletter communities, indie SaaS founders on X, local business Facebook groups, Upwork/Cold email",
    deliverable: "Google Docs drafts with tracked changes",
  },
  "ai-video": {
    name: "AI video editing",
    icon: "🎬",
    craft: "short-form cuts, captions, hooks, and content repurposing",
    offers: "short-form editing retainers, podcast-to-clips packages, ad creative cuts",
    hunting: "creator communities, podcast hosts, coaches on Instagram/TikTok, YouTube channels that post inconsistently",
    deliverable: "captioned vertical videos + a revision round",
  },
  "ai-social": {
    name: "AI social-media management",
    icon: "📣",
    craft: "content calendars, post drafting, and comment strategy",
    offers: "monthly content retainers, launch content sprints, profile revamps",
    hunting: "local businesses with dead Instagram accounts, founders who hate posting, realtor/coach Facebook groups",
    deliverable: "a monthly content calendar + drafted posts in the client's voice",
  },
};

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Workers AI with response_format json_object returns result.response
// PRE-PARSED as an object, not a string. Handle both shapes.
export function parseAiJson(result) {
  const r = result && result.response;
  if (!r) throw new Error("empty AI response");
  if (typeof r === "string") return JSON.parse(r);
  if (typeof r === "object") return r;
  throw new Error("unexpected AI response shape");
}

export async function aiJson(env, systemPrompt, userPrompt, maxTokens = 6000) {
  if (!env.AI) throw new Error("AI binding missing");
  const result = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    temperature: 0.7,
  });
  return parseAiJson(result);
}

// Normalize intake: accept the flat checkout params shape or {inputs:{...}}.
export function normalizeInputs(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const src = o.inputs && typeof o.inputs === "object" ? o.inputs : o;
  const s = (v, n = 300) => String(v == null ? "" : v).slice(0, n).trim();
  return {
    track: ["ai-writing", "ai-video", "ai-social"].includes(src.track) ? src.track : "ai-writing",
    skills: s(src.skills),
    hours_per_week: s(src.hours_per_week, 10),
    income_goal: s(src.income_goal, 60),
    experience_level: ["beginner", "some", "experienced"].includes(src.experience_level)
      ? src.experience_level : "beginner",
    niche: s(src.niche),
  };
}

export function trackOf(inputs) {
  return TRACKS[inputs.track] || TRACKS["ai-writing"];
}

export const HONESTY_RULES = [
  "NEVER imply hands-free earnings, income without effort, or revenue that arrives on its own.",
  "NEVER promise income, earnings, or specific financial results.",
  "NEVER use superlatives like 'only', 'best', or '#1' without proof.",
  "Frame everything as skill + AI leverage and real work: outreach, delivery, follow-up.",
  "Be concrete and actionable: names of places to look, exact scripts, day-by-day plans.",
].join("\n");

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export function todayDay() {
  return new Date().toISOString().slice(0, 10);
}
