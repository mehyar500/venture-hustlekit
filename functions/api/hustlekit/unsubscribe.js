// GET /api/hustlekit/unsubscribe?token= — one-click unsubscribe (tokenized).
// Also supports POST with { token } body.
// The token is the per-subscriber unsub_token issued at subscribe time —
// never a raw email address in the URL (prevents third-party unsubscribes
// and address enumeration).
// Updates both hustlekit_subscribers (brand) and subscribers_global (global).
// Returns: HTML confirmation page (email HTML-escaped).

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token") || "";
  return handleUnsubscribe(token, env);
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const token = String(body.token || "");
  return handleUnsubscribe(token, env);
}

async function handleUnsubscribe(token, env) {
  try {
    if (!env.LEADS_DB) {
      return new Response("Service unavailable", { status: 503 });
    }
    if (!token || token.length < 16) {
      return new Response("Invalid unsubscribe link.", { status: 400 });
    }

    const db = env.LEADS_DB;
    const sub = await db.prepare(
      "SELECT email FROM hustlekit_subscribers WHERE unsub_token = ?"
    ).bind(token).first().catch(() => null);
    if (!sub) {
      return new Response("This unsubscribe link is invalid.", { status: 404 });
    }
    const email = sub.email;
    const now = new Date().toISOString();

    // Update brand table
    await db.prepare(
      "UPDATE hustlekit_subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE email = ?"
    ).bind(now, email).run().catch(() => null);

    // Update global table
    await db.prepare(
      "UPDATE subscribers_global SET status = 'unsubscribed', unsubscribed = 1, updated_at = ? WHERE email = ? AND brand = 'hustlekit'"
    ).bind(now, email).run().catch(() => null);

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed — HustleKit</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:20px;text-align:center}
h1{color:#1a1a1a}.btn{display:inline-block;background:#e5e5e5;color:#1a1a1a;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;margin-top:20px}</style>
</head>
<body>
<h1>You've been unsubscribed</h1>
<p>You won't receive any more emails from HustleKit at <strong>${esc(email)}</strong>.</p>
<p>Changed your mind? <a href="https://hustlekit.mehyar.us/#preview">Resubscribe here</a>.</p>
<p><a class="btn" href="https://hustlekit.mehyar.us/">Back to HustleKit</a></p>
</body></html>`;

    return new Response(html, {
      headers: { "content-type": "text/html;charset=utf-8" }
    });
  } catch (e) {
    console.error("hustlekit/unsubscribe failed", e && e.message);
    return new Response("Unsubscribe failed. Please try again.", { status: 500 });
  }
}
