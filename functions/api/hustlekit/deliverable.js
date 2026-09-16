// GET /api/hustlekit/deliverable?token= — stream the buyer's playbook PDF.
// Verifies a paid+ready order, then streams R2 playbooks/<token>.pdf.
// 404 on bogus token or not-ready order.

export async function onRequestGet({ request, env }) {
  const notFound = () => new Response(JSON.stringify({ ok: false, error: "not_found" }), {
    status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
  try {
    if (!env.LEADS_DB || !env.HUSTLEKIT_R2) {
      return new Response(JSON.stringify({ ok: false, error: "service_unavailable" }), { status: 503 });
    }
    const token = new URL(request.url).searchParams.get("token") || "";
    if (token.length < 16) return notFound();
    const row = await env.LEADS_DB.prepare(
      "SELECT status FROM hustlekit_orders WHERE access_token = ?"
    ).bind(token).first();
    if (!row || row.status !== "ready") return notFound();

    const obj = await env.HUSTLEKIT_R2.get("playbooks/" + token + ".pdf");
    if (!obj) return notFound();

    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="hustlekit-playbook.pdf"',
        "content-length": String(obj.size),
        "cache-control": "private, max-age=31536000",
      },
    });
  } catch (e) {
    console.error("hustlekit/deliverable failed", e && e.message);
    return notFound();
  }
}
