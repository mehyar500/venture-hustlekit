// GET /api/hustlekit/confirm?token= — confirm email subscription (double opt-in).
// Returns: HTML confirmation page. Email is HTML-escaped; the unsubscribe
// link is tokenized (never a raw email address).

import { clientIp } from "../../_shared/hustlekit.js";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.LEADS_DB) {
      return new Response("Service unavailable", { status: 503 });
    }
    const db = env.LEADS_DB;
    const token = new URL(request.url).searchParams.get("token") || "";

    if (token.length < 16) {
      return new Response("Invalid confirmation link.", { status: 400 });
    }

    // Find the subscriber by confirm token
    const sub = await db.prepare(
      "SELECT email, unsub_token FROM hustlekit_subscribers WHERE confirm_token = ? AND status = 'pending'"
    ).bind(token).first().catch(() => null);

    if (!sub) {
      return new Response("This confirmation link is invalid or has already been used.", { status: 404 });
    }

    const email = sub.email;
    const now = new Date().toISOString();

    // Update brand table to confirmed
    await db.prepare(
      "UPDATE hustlekit_subscribers SET status = 'confirmed', confirmed_at = ?, confirm_token = NULL WHERE email = ?"
    ).bind(now, email).run().catch(() => null);

    // Update global table to confirmed
    await db.prepare(
      "UPDATE subscribers_global SET status = 'confirmed', updated_at = ? WHERE email = ? AND brand = 'hustlekit'"
    ).bind(now, email).run().catch(() => null);

    const unsubUrl = sub.unsub_token
      ? `https://hustlekit.mehyar.us/api/hustlekit/unsubscribe?token=${encodeURIComponent(sub.unsub_token)}`
      : "https://hustlekit.mehyar.us/";

    // Return HTML confirmation
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subscribed — HustleKit</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:20px;text-align:center}
h1{color:#1a1a1a}.btn{display:inline-block;background:#a3e635;color:#1a1a1a;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;margin-top:20px}</style>
</head>
<body>
<h1>✅ You're subscribed!</h1>
<p>Welcome to HustleKit. You'll get free side-hustle tips and playbook updates at <strong>${esc(email)}</strong>.</p>
<p><a class="btn" href="https://hustlekit.mehyar.us/">Back to HustleKit</a></p>
<p style="margin-top:40px;font-size:12px;color:#666">
<a href="${esc(unsubUrl)}">Unsubscribe</a>
</p>
</body></html>`;

    return new Response(html, {
      headers: { "content-type": "text/html;charset=utf-8" }
    });
  } catch (e) {
    console.error("hustlekit/confirm failed", e && e.message);
    return new Response("Confirmation failed. Please try again.", { status: 500 });
  }
}
