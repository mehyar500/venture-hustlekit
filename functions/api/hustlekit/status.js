// GET /api/hustlekit/status?token= — order status for the success page.
// Returns { ok, paid, order_status, email, product_id, manifest? }. 404 on unknown token.

import { json } from "../../_shared/hustlekit.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!env.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const token = new URL(request.url).searchParams.get("token") || "";
    if (token.length < 16) return json({ ok: false, error: "not_found" }, 404);
    const row = await env.LEADS_DB.prepare(
      "SELECT product_id, email, status, output_json FROM hustlekit_orders WHERE access_token = ?"
    ).bind(token).first();
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    let manifest = null;
    try { manifest = row.output_json ? JSON.parse(row.output_json) : null; } catch {}
    return json({
      ok: true,
      paid: true,
      order_status: row.status,
      email: row.email,
      product_id: row.product_id,
      manifest,
    });
  } catch (e) {
    console.error("hustlekit/status failed", e && e.message);
    return json({ ok: false, error: "status_failed" }, 500);
  }
}
