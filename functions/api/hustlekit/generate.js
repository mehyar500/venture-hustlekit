// POST /api/hustlekit/generate — generate the buyer's personalized playbook PDF.
// Body: { order_token, track?, inputs? } (track/inputs optional — read from the order row)
// 1. Verifies order by access_token (must be paid or failed; ready → replay).
// 2. Workers AI (llama-3.3-70b, json_object) writes the personalized playbook JSON.
// 3. pdf-lib composes a styled multi-page PDF; stored in R2 at playbooks/<token>.pdf.
// 4. Order marked ready (or failed on any error — buyer retries from success.html).

import { PDFDocument, StandardFonts, rgb } from "../../../lib/pdf-lib.bundle.js";
import {
  TRACKS, aiJson, json, normalizeInputs, trackOf, HONESTY_RULES,
} from "../../_shared/hustlekit.js";

const PAGE_W = 612, PAGE_H = 792, MARGIN = 56;
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.42, 0.46);
const LIME = rgb(0.639, 0.902, 0.208);
const LIME_DARK = rgb(0.32, 0.51, 0.08);
const PAPER = rgb(1, 1, 1);
const DARK_BG = rgb(0.039, 0.039, 0.043);

const CHAPTER_TITLES = [
  "Your lane, defined",
  "The offer",
  "Pricing that holds",
  "Your unfair edge",
  "Where clients actually are",
  "Portfolio in a weekend",
  "Outreach scripts, word for word",
  "The numbers game",
  "Discovery calls that close",
  "Delivery system",
  "Getting testimonials",
  "From first client to retainer",
  "Your AI workflow stack",
  "Objection handling",
  "Raising your rates",
  "Scaling to your income goal",
  "Your 30-day action plan",
  "What to avoid",
];

function wrapText(text, font, size, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) line = t;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function buildPlaybookPrompt(inputs, chapterTitles, includeCover, includeExtras) {
  const t = trackOf(inputs);
  const expLine = {
    beginner: "a complete beginner — include a practice/portfolio-first ramp before any paid outreach",
    some: "someone with some experience — skip basics, focus on packaging and client acquisition",
    experienced: "an experienced practitioner — focus on positioning, pricing power, and retainers",
  }[inputs.experience_level];
  const keys = [
    '"chapters": [{"title": string, "body": string}] — one per chapter title below, in order.',
    "CRITICAL LENGTH REQUIREMENT: every chapter body MUST be 350-450 words of substantive, specific, " +
    "immediately usable content with concrete examples, numbers, and exact wording where relevant. " +
    "A short or generic chapter is a FAILED chapter. Write in depth — this is a premium paid playbook.",
  ];
  if (includeCover) {
    keys.unshift('"cover": {"title": string, "subtitle": string (one line naming their niche+track), "buyer_line": string (one line: their hours/week, goal, experience)}');
  }
  if (includeExtras) {
    keys.push('"action_plan": [{"day_range": string like "Days 1-3", "tasks": [string x3-4]}]');
    keys.push('"scripts": [{"situation": string, "script": string (the exact words to send/say)}] — 4 scripts: cold DM, cold email, follow-up, discovery-call opener');
  }
  return {
    system:
      "You are HustleKit's playbook engine. You write personalized, practical " +
      "side-hustle playbooks — concrete, specific, and immediately actionable. " +
      HONESTY_RULES + " " +
      "Return ONLY a JSON object with exactly these keys: " + keys.join(" "),
    user:
      `Track: ${t.name} — the craft is ${t.craft}. Typical offers: ${t.offers}. ` +
      `Where this track's clients hide: ${t.hunting}. Delivery looks like: ${t.deliverable}. ` +
      `Buyer: current skills "${inputs.skills || "not specified"}"; ` +
      `hours/week "${inputs.hours_per_week || "not specified"}"; ` +
      `income goal "${inputs.income_goal || "not specified"}"; ` +
      `experience: ${inputs.experience_level} (${expLine}); ` +
      `niche interest "${inputs.niche || "not specified"}". ` +
      `Chapter titles in order: ${chapterTitles.map((c, i) => `${i + 1}. ${c}`).join(" | ")}. ` +
      (includeExtras
        ? "The 30-day action plan must fit their stated hours/week realistically. " +
          "Scripts must be written in first person, ready to copy-paste, referencing their niche."
        : "") +
      "Personalize every chapter with the buyer's specifics. No filler, no repetition.",
  };
}

async function composePdf(data, inputs) {
  const t = trackOf(inputs);
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvO = await doc.embedFont(StandardFonts.HelveticaOblique);
  const contentW = PAGE_W - MARGIN * 2;
  const sectionPages = []; // {title, page}
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let pageNum = 1;
  let y = 0;

  function footer() {
    page.drawText("HustleKit · hustlekit.mehyar.us", { x: MARGIN, y: 34, size: 8, font: helv, color: MUTED });
    const n = String(pageNum);
    page.drawText(n, { x: PAGE_W - MARGIN - helv.widthOfTextAtSize(n, 9), y: 34, size: 9, font: helv, color: MUTED });
    page.drawText(t.name, { x: MARGIN, y: PAGE_H - 36, size: 8, font: helvB, color: MUTED });
  }
  function newPage() {
    footer();
    page = doc.addPage([PAGE_W, PAGE_H]);
    pageNum++;
    y = PAGE_H - 70;
  }
  function need(h) { if (y - h < 50) newPage(); }
  function drawPara(text, { size = 10.5, font = helv, color = INK, gap = 6, indent = 0 } = {}) {
    const lines = wrapText(text, font, size, contentW - indent);
    const lh = size * 1.5;
    for (const ln of lines) {
      need(lh + 2);
      page.drawText(ln, { x: MARGIN + indent, y, size, font, color });
      y -= lh;
    }
    y -= gap;
  }
  function heading(text, record = true) {
    need(64);
    if (record) sectionPages.push({ title: text, page: pageNum });
    y -= 6;
    page.drawText(text, { x: MARGIN, y, size: 17, font: helvB, color: INK });
    y -= 26;
    page.drawRectangle({ x: MARGIN, y: y + 8, width: 44, height: 4, color: LIME });
    y -= 10;
  }

  // ── cover (page 1, dark) ──
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: DARK_BG });
  page.drawRectangle({ x: 0, y: PAGE_H - 14, width: PAGE_W, height: 14, color: LIME });
  let cy = PAGE_H - 150;
  page.drawText("HUSTLEKIT", { x: MARGIN, y: cy, size: 15, font: helvB, color: LIME });
  cy -= 14;
  page.drawText("AI SIDE-HUSTLE STARTER KIT", { x: MARGIN, y: cy, size: 10, font: helv, color: MUTED });
  cy -= 70;
  for (const ln of wrapText(t.name, helvB, 44, contentW)) {
    page.drawText(ln, { x: MARGIN, y: cy, size: 44, font: helvB, color: PAPER });
    cy -= 54;
  }
  cy -= 20;
  page.drawText("Your personalized playbook", { x: MARGIN, y: cy, size: 20, font: helv, color: PAPER });
  cy -= 60;
  const cover = data.cover || {};
  for (const ln of wrapText(cover.subtitle || "", helv, 13, contentW)) {
    page.drawText(ln, { x: MARGIN, y: cy, size: 13, font: helv, color: rgb(0.85, 0.85, 0.86) });
    cy -= 20;
  }
  cy -= 20;
  for (const ln of wrapText(cover.buyer_line || "", helvO, 11, contentW)) {
    page.drawText(ln, { x: MARGIN, y: cy, size: 11, font: helvO, color: MUTED });
    cy -= 17;
  }
  cy -= 30;
  const dateStr = new Date().toISOString().slice(0, 10);
  page.drawText("Prepared " + dateStr + " · hustlekit.mehyar.us", { x: MARGIN, y: cy, size: 10, font: helv, color: MUTED });
  page.drawText("1", { x: PAGE_W - MARGIN - 10, y: 34, size: 9, font: helv, color: MUTED });
  footer();

  // ── chapters ──
  newPage();
  const chapters = Array.isArray(data.chapters) ? data.chapters : [];
  chapters.forEach((ch, i) => {
    heading(ch.title || CHAPTER_TITLES[i] || ("Chapter " + (i + 1)));
    drawPara(ch.body || "");
  });

  // ── action plan ──
  heading("Your 30-day action plan", true);
  const plan = Array.isArray(data.action_plan) ? data.action_plan : [];
  for (const block of plan) {
    need(50);
    page.drawText(block.day_range || "", { x: MARGIN, y, size: 12.5, font: helvB, color: LIME_DARK });
    y -= 22;
    for (const task of (block.tasks || [])) {
      const lines = wrapText(task, helv, 10.5, contentW - 18);
      need(lines.length * 16 + 8);
      page.drawText("•", { x: MARGIN, y, size: 10.5, font: helvB, color: LIME_DARK });
      for (const ln of lines) {
        page.drawText(ln, { x: MARGIN + 18, y, size: 10.5, font: helv, color: INK });
        y -= 16;
      }
      y -= 4;
    }
    y -= 8;
  }

  // ── scripts ──
  heading("Word-for-word scripts", true);
  const scripts = Array.isArray(data.scripts) ? data.scripts : [];
  for (const s of scripts) {
    need(60);
    page.drawText(s.situation || "Script", { x: MARGIN, y, size: 12.5, font: helvB, color: INK });
    y -= 20;
    const boxTop = y + 12;
    const lines = wrapText('"' + (s.script || "") + '"', helvO, 10.5, contentW - 32);
    const boxH = lines.length * 16 + 24;
    need(boxH);
    page.drawRectangle({ x: MARGIN, y: y - boxH + 28, width: contentW, height: boxH, color: rgb(0.96, 0.98, 0.92), borderColor: LIME, borderWidth: 1 });
    let sy = y;
    for (const ln of lines) {
      page.drawText(ln, { x: MARGIN + 16, y: sy, size: 10.5, font: helvO, color: INK });
      sy -= 16;
    }
    y -= boxH - 12;
    y -= 14;
  }

  // ── worksheets (deterministic — print and fill in) ──
  function checkboxRow(label, sub) {
    need(34);
    page.drawRectangle({ x: MARGIN, y: y - 4, width: 13, height: 13, borderColor: MUTED, borderWidth: 1.2 });
    page.drawText(label, { x: MARGIN + 22, y, size: 10.5, font: helvB, color: INK });
    if (sub) {
      const sl = wrapText(sub, helv, 9.5, contentW - 30);
      let sy = y - 15;
      for (const ln of sl) { page.drawText(ln, { x: MARGIN + 22, y: sy, size: 9.5, font: helv, color: MUTED }); sy -= 13; }
      y = sy - 8;
    } else { y -= 24; }
  }
  function fillLine(label) {
    need(30);
    page.drawText(label, { x: MARGIN, y, size: 10.5, font: helv, color: INK });
    const lw = helv.widthOfTextAtSize(label + " ", 10.5);
    page.drawLine({ start: { x: MARGIN + lw, y: y - 4 }, end: { x: MARGIN + contentW, y: y - 4 }, thickness: 1, color: MUTED });
    y -= 28;
  }

  heading("Your 30-day tracker", true);
  drawPara("Print this page. Check off each day you hit the target. The rule from Chapter 8: outreach is a numbers game — the tracker is how you prove to yourself you're playing it.", { size: 10.5 });
  const trackerThemes = [
    "Portfolio piece — build one sample in your niche",
    "Outreach block — 10 new prospects contacted",
    "Follow-ups — every unanswered message from 3+ days ago",
    "Outreach block — 10 new prospects contacted",
    "Skill reps — 1 hour deliberate practice + study one competitor",
    "Outreach block — 10 new prospects contacted",
    "Rest + review — tally replies, refine your opener",
  ];
  for (let d = 1; d <= 30; d++) {
    need(26);
    page.drawRectangle({ x: MARGIN, y: y - 3, width: 12, height: 12, borderColor: MUTED, borderWidth: 1.2 });
    page.drawText("Day " + d, { x: MARGIN + 20, y, size: 10, font: helvB, color: INK });
    const theme = trackerThemes[(d - 1) % 7];
    page.drawText("— " + theme, { x: MARGIN + 72, y, size: 9.5, font: helv, color: MUTED });
    y -= 22;
    if (d % 10 === 0) { y -= 6; }
  }

  heading("Pricing worksheet", true);
  drawPara("Fill this in with real numbers before you quote your first client. Your floor price must cover costs + time + tax buffer — never quote below it.", { size: 10.5 });
  fillLine("Monthly costs (tools, subscriptions): $");
  fillLine("Hours available per week: ");
  fillLine("Minimum acceptable hourly rate: $");
  fillLine("Tax buffer (set aside 25-30%): $");
  fillLine("Floor price for a starter project: $");
  fillLine("Target price for a starter project: $");
  fillLine("Monthly retainer target (from Chapter 12): $");

  heading("Outreach tracker", true);
  drawPara("Log every prospect. If a row has no follow-up date, you left money on the table — follow up at day 3 and day 7, every time.", { size: 10.5 });
  const cols = [["Prospect", 0.30], ["Channel", 0.18], ["Sent", 0.16], ["Follow-up", 0.18], ["Reply?", 0.18]];
  function trackerHeader() {
    need(30);
    let x = MARGIN;
    page.drawText("", { x, y, size: 1, font: helv, color: INK });
    for (const [label, frac] of cols) {
      page.drawText(label, { x: x + 4, y, size: 9, font: helvB, color: MUTED });
      x += contentW * frac;
    }
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + contentW, y }, thickness: 1.2, color: INK });
    y -= 18;
  }
  trackerHeader();
  for (let r = 0; r < 24; r++) {
    need(26);
    let x = MARGIN;
    for (const [, frac] of cols) {
      page.drawLine({ start: { x: x + 4, y: y - 2 }, end: { x: x + contentW * frac - 6, y: y - 2 }, thickness: 0.7, color: MUTED });
      x += contentW * frac;
    }
    y -= 24;
    if ((r + 1) % 8 === 0 && r < 23) { trackerHeader(); }
  }

  heading("Niche validation checklist", true);
  drawPara("Check all 6 before you commit to a niche. If you can't check at least 5, narrow or pick a different niche.", { size: 10.5 });
  checkboxRow("They already pay for help", "Your niche spends money on marketing, content, or operations today — not 'someday'.");
  checkboxRow("You can name 50 prospects", "Fifty real businesses/people you could contact this week. If not, the niche is too small or too vague.");
  checkboxRow("You speak their language", "You understand their day-to-day well enough to write an opener that doesn't sound generic.");
  checkboxRow("Results are visible", "You can point to before/after: more leads, better content, saved hours. Clients buy visible outcomes.");
  checkboxRow("You can reach them directly", "Email, DMs, or in person — no gatekeepers you can't get past.");
  checkboxRow("You'd enjoy 100 of them", "You'll live in this niche for months. Pick one you don't dread.");

  // ── honesty close ──
  need(120);
  page.drawRectangle({ x: MARGIN, y: y - 96, width: contentW, height: 110, color: rgb(0.97, 0.97, 0.98), borderColor: MUTED, borderWidth: 1 });
  page.drawText("Straight talk", { x: MARGIN + 16, y: y - 6, size: 12, font: helvB, color: INK });
  y -= 12;
  drawPara("This playbook is a skill + AI leverage kit — not a promise of income. The plan works if you work it: the outreach numbers, the portfolio pieces, the follow-ups. If you stall, re-read the chapter on what to avoid, cut your niche narrower, and double your outreach for one week. Then email info@mehyar.us — a human reads every message.", { size: 10, indent: 16, gap: 0 });
  footer();

  // ── TOC inserted as page 2 (page numbers now known) ──
  const toc = doc.insertPage(1);
  pageNum++; // account (not strictly needed after)
  let ty = PAGE_H - 70;
  toc.drawText(t.name, { x: MARGIN, y: PAGE_H - 36, size: 8, font: helvB, color: MUTED });
  toc.drawText("HustleKit · hustlekit.mehyar.us", { x: MARGIN, y: 34, size: 8, font: helv, color: MUTED });
  toc.drawText("2", { x: PAGE_W - MARGIN - 10, y: 34, size: 9, font: helv, color: MUTED });
  toc.drawText("What's inside", { x: MARGIN, y: ty, size: 22, font: helvB, color: INK });
  ty -= 40;
  for (const s of sectionPages) {
    const dots = ".".repeat(Math.max(2, 52 - s.title.length));
    toc.drawText(s.title, { x: MARGIN, y: ty, size: 11, font: helv, color: INK });
    const pn = String(s.page + 1); // +1 for the inserted TOC page
    toc.drawText(dots + " " + pn, { x: MARGIN + helv.widthOfTextAtSize(s.title + " ", 11), y: ty, size: 11, font: helv, color: MUTED });
    ty -= 24;
  }

  return { bytes: await doc.save(), pages: doc.getPageCount() };
}

export async function onRequestPost({ request, env }) {
  let seenToken = "";
  try {
    if (!env.LEADS_DB || !env.AI || !env.HUSTLEKIT_R2) {
      return json({ ok: false, error: "service_unavailable" }, 503);
    }
    const db = env.LEADS_DB;
    let body = {};
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
    const token = String(body.order_token || "");
    seenToken = token;
    if (token.length < 16) return json({ ok: false, error: "bad_token" }, 400);

    const order = await db.prepare(
      "SELECT id, product_id, email, inputs_json, status, output_json FROM hustlekit_orders WHERE access_token = ?"
    ).bind(token).first();
    if (!order) return json({ ok: false, error: "not_found" }, 404);
    if (order.status === "ready") {
      let pages = null;
      try { pages = JSON.parse(order.output_json || "{}").pages || null; } catch {}
      return json({ ok: true, replay: true, pages });
    }
    if (order.status !== "paid" && order.status !== "failed") {
      return json({ ok: false, error: "not_paid" }, 402);
    }

    // Inputs: body override wins, else the order row (flat checkout params or {inputs}).
    let rawInputs = {};
    try { rawInputs = order.inputs_json ? JSON.parse(order.inputs_json) : {}; } catch {}
    if (body.inputs && typeof body.inputs === "object") rawInputs = body.inputs;
    const inputs = normalizeInputs(rawInputs);
    if (body.track && TRACKS[body.track]) inputs.track = body.track;
    const t = trackOf(inputs);

    // Mark generating (best effort; also re-arms failed rows for retry)
    await db.prepare("UPDATE hustlekit_orders SET status='generating' WHERE access_token=? AND status!='ready'").bind(token).run().catch(()=>{});

    // ── AI: write the playbook JSON in THREE parts (one call caps out around
    // 2.5-3k words; three calls get us to a real ~15-page playbook) ──
    async function genPart(chapterTitles, includeCover, includeExtras, maxTokens) {
      const { system, user } = buildPlaybookPrompt(inputs, chapterTitles, includeCover, includeExtras);
      const part = await aiJson(env, system, user, maxTokens);
      if (!part || !Array.isArray(part.chapters) || part.chapters.length < chapterTitles.length - 1) {
        throw new Error("playbook: too few chapters in part");
      }
      return part;
    }
    let data = null, lastErr = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try {
        const maxT = attempt === 0 ? 16000 : 12000;
        const third = Math.ceil(CHAPTER_TITLES.length / 3);
        const p1 = await genPart(CHAPTER_TITLES.slice(0, third), true, false, maxT);
        const p2 = await genPart(CHAPTER_TITLES.slice(third, third * 2), false, false, maxT);
        const p3 = await genPart(CHAPTER_TITLES.slice(third * 2), false, true, maxT);
        data = {
          cover: p1.cover || {},
          chapters: [...(p1.chapters || []), ...(p2.chapters || []), ...(p3.chapters || [])],
          action_plan: p3.action_plan || [],
          scripts: p3.scripts || [],
        };
      } catch (e) { lastErr = e; data = null; }
    }
    if (!data) throw new Error("playbook AI failed: " + (lastErr && lastErr.message));

    // ── PDF ──
    const { bytes, pages } = await composePdf(data, inputs);
    await env.HUSTLEKIT_R2.put("playbooks/" + token + ".pdf", bytes, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const manifest = {
      track: inputs.track,
      track_name: t.name,
      pages,
      generated_at: new Date().toISOString(),
      chapters: (data.chapters || []).map((c) => c.title).filter(Boolean),
    };
    await db.prepare(
      "UPDATE hustlekit_orders SET status='ready', output_json=?, ready_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE access_token=? AND status!='ready'"
    ).bind(JSON.stringify(manifest), token).run();

    return json({ ok: true, pages, track: inputs.track });
  } catch (e) {
    console.error("hustlekit/generate failed", e && e.message);
    if (seenToken && env && env.LEADS_DB) {
      try {
        await env.LEADS_DB.prepare("UPDATE hustlekit_orders SET status='failed' WHERE access_token=? AND status!='ready'").bind(seenToken).run();
      } catch {}
    }
    return json({ ok: false, error: "generate_failed" }, 500);
  }
}
