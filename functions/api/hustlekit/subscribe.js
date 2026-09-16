// POST /api/hustlekit/subscribe — email capture for free tier.
// Body: { email: string, source?: string }
// Stores in hustlekit_subscribers (brand) AND subscribers_global (global, brand='hustlekit').
// Double opt-in: the confirmation email is sent via the mehyar.us relay
// (POST /api/hustlekit/send-confirm, bearer HUSTLEKIT_RELAY_SECRET).
// Rate-limited: max 5 subscribes per IP per hour.

import { json, clientIp } from "../../_shared/hustlekit.js";

const RATE_LIMIT_PER_HOUR = 5;

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Rate-limit key: IPv4 exact; IPv6 truncated to /64 (privacy extensions
// rotate the low 64 bits per connection, so exact-match would never trigger).
function rateLimitKey(ip) {
  if (!ip || typeof ip !== "string") return "unknown";
  if (ip.indexOf(":") === -1) return "v4:" + ip;
  const parts = ip.split(":").filter((p) => p.length > 0).slice(0, 4);
  return "v6:" + parts.join(":");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const db = env.LEADS_DB;

    let body = {};
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

    const email = String(body.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      return json({ ok: false, error: "invalid_email" }, 400);
    }
    const source = String(body.source || "site").slice(0, 50);
    const ip = clientIp(request);
    const ipk = rateLimitKey(ip);

    // ── IP rate limit (free-tier abuse backstop) ──
    try {
      const cnt = await db.prepare(
        "SELECT COUNT(*) AS n FROM hustlekit_subscribers " +
        "WHERE ip_key = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')"
      ).bind(ipk).first();
      if (cnt && cnt.n >= RATE_LIMIT_PER_HOUR) {
        return json({ ok: false, error: "rate_limited" }, 429);
      }
    } catch {}

    const confirmToken = randomToken(32);
    const unsubToken = randomToken(32);

    // If already confirmed, don't send another confirmation.
    const existing = await db.prepare(
      "SELECT id, status FROM hustlekit_subscribers WHERE email = ?"
    ).bind(email).first().catch(() => null);
    if (existing && existing.status === "confirmed") {
      return json({ ok: true, message: "Already subscribed." });
    }

    if (existing) {
      // Pending re-subscribe: refresh tokens + ip.
      await db.prepare(
        "UPDATE hustlekit_subscribers SET confirm_token = ?, unsub_token = COALESCE(unsub_token, ?), ip = ?, source = ? WHERE email = ?"
      ).bind(confirmToken, unsubToken, ip, source, email).run().catch(() => null);
    } else {
      await db.prepare(
        `INSERT INTO hustlekit_subscribers (email, status, confirm_token, unsub_token, source, ip, ip_key)
         VALUES (?, 'pending', ?, ?, ?, ?, ?)`
      ).bind(email, confirmToken, unsubToken, source, ip, ipk).run().catch(() => null);
    }
    // Fetch the effective unsub token (existing row may have kept its own).
    let finalUnsub = unsubToken;
    try {
      const r = await db.prepare("SELECT unsub_token FROM hustlekit_subscribers WHERE email = ?").bind(email).first();
      if (r && r.unsub_token) finalUnsub = r.unsub_token;
    } catch {}

    // Global table (brand='hustlekit').
    await db.prepare(
      `INSERT OR IGNORE INTO subscribers_global (email, brand, status)
       VALUES (?, 'hustlekit', 'pending')`
    ).bind(email).run().catch(() => null);

    // ── Double opt-in email via the mehyar.us relay ──
    const relaySecret = env.HUSTLEKIT_RELAY_SECRET || "";
    if (relaySecret) {
      try {
        const rr = await fetch("https://mehyar.us/api/hustlekit/send-confirm", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": "Bearer " + relaySecret,
          },
          body: JSON.stringify({ email, token: confirmToken, unsub_token: finalUnsub }),
        });
        if (!rr.ok) console.error("subscribe: confirm relay failed", rr.status);
      } catch (e) {
        console.error("subscribe: confirm relay threw", e && e.message);
      }
    } else {
      console.error("subscribe: HUSTLEKIT_RELAY_SECRET not configured");
    }

    return json({
      ok: true,
      message: "Check your email to confirm your subscription.",
    });
  } catch (e) {
    console.error("hustlekit/subscribe failed", e && e.message);
    return json({ ok: false, error: "subscribe_failed" }, 500);
  }
}
