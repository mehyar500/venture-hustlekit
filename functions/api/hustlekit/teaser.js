// POST /api/hustlekit/teaser — free sample playbook page for a track.
// Body: { track: "ai-writing"|"ai-video"|"ai-social", niche?: string }
// Rate-limited: 5/day per IP via LEADS_DB.hustlekit_teasers.
// Returns: { ok:true, sample:{ title, intro, niche_sketch, offer_sketch, outreach_lines[3] } }

import {
  TRACKS, aiJson, json, clientIp, todayDay, HONESTY_RULES,
} from "../../_shared/hustlekit.js";

const TEASER_LIMIT = 5;

export async function onRequestPost({ request, env }) {
  try {
    if (!env.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;

    let body = {};
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
    const trackKey = String(body.track || "");
    const track = TRACKS[trackKey];
    if (!track) return json({ ok: false, error: "invalid_track" }, 400);
    const niche = String(body.niche || "").slice(0, 120).trim();

    // ── rate limit ──
    const ip = clientIp(request);
    const day = todayDay();
    const row = await db.prepare(
      "SELECT count FROM hustlekit_teasers WHERE ip = ? AND day = ?"
    ).bind(ip, day).first().catch(() => null);
    const used = row ? Number(row.count) || 0 : 0;
    if (used >= TEASER_LIMIT) {
      return json({ ok: false, error: "rate_limited", detail: "Come back tomorrow for more samples — or unlock the full playbook." }, 429);
    }
    if (row) {
      await db.prepare("UPDATE hustlekit_teasers SET count = count + 1 WHERE ip = ? AND day = ?").bind(ip, day).run().catch(()=>{});
    } else {
      await db.prepare("INSERT INTO hustlekit_teasers (ip, day, count) VALUES (?, ?, 1)").bind(ip, day).run().catch(()=>{});
    }

    const system =
      "You write sample pages for HustleKit, an AI side-hustle starter kit. " +
      "Your sample must make the reader feel the full playbook is worth $27: " +
      "specific, concrete, and immediately usable. " + HONESTY_RULES + " " +
      "Return ONLY a JSON object with exactly these keys: " +
      '{"title": string, "intro": string (2 sentences), ' +
      '"niche_sketch": string (~120 words: the reader\'s niche narrowed to a buyable segment, who exactly to target, why they pay), ' +
      '"offer_sketch": string (~120 words: the concrete offer, what\'s included, starter pricing logic), ' +
      '"outreach_lines": [string, string, string] (3 distinct openers: one cold DM, one cold email subject+first line, one warm follow-up — written as the reader would send them)}';

    const user =
      `Track: ${track.name} — ${track.craft}. ` +
      (niche ? `Reader's niche interest: "${niche}". Narrow it to a specific buyable segment.` : `No niche given — pick the most beginner-friendly buyable segment for this track and name it explicitly.`) + " " +
      `Typical offers in this track: ${track.offers}. ` +
      "Write the sample page for a beginner with ~8 hours/week. About 350 words total. No income promises, no hype.";

    const sample = await aiJson(env, system, user, 2500);

    if (!sample.title || !Array.isArray(sample.outreach_lines)) {
      throw new Error("teaser: malformed AI output");
    }
    sample.outreach_lines = sample.outreach_lines.slice(0, 3).map(String);

    return json({ ok: true, sample, track: trackKey, track_name: track.name });
  } catch (e) {
    console.error("hustlekit/teaser failed", e && e.message);
    return json({ ok: false, error: "teaser_failed" }, 500);
  }
}
