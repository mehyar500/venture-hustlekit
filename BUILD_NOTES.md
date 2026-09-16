# HustleKit PWA — build notes

## What was built (in `~/workspace/build/hustlekit-pwa/`)

Static site + Pages Functions for HustleKit — AI Side-Hustle Starter Kit ($27 one-time).
Dark premium theme, electric-lime (`#a3e635`) accent on near-black (`#0a0a0b`) —
distinct from Designful/CrayonKid/Roast. No AI images; typographic + CSS only.
Single shared stylesheet `public/styles.css`. No build step.

### Public pages
| File | Purpose |
|---|---|
| `public/index.html` | Landing: hero (free-sample + $27 CTAs, trust row), `#preview` free sample generator (track picker + niche → `POST /api/hustlekit/teaser`, renders watermarked SAMPLE page), `#tracks` (3 track cards), `#how` (3 steps), `#inside` (14-chapter list + honesty note), `#pricing` ($27 box), `#faq` (6 honest Q&As), footer. JSON-LD Product + FAQPage. |
| `public/buy.html` | Intake form: email + track + 5 fields → `POST https://mehyar.us/api/pay/checkout` → redirect to `checkout_url`. Client-side validation (email regex, field caps, params ≤2048 bytes). `noindex`. |
| `public/success.html` | Reads `?token=`, polls `GET /api/hustlekit/status?token=` every 4s (paid→generating→ready/failed). Ready → link to deliverable; failed → retry button (`POST /api/hustlekit/generate {order_token}`). `noindex`. |
| `public/deliverable.html` | Reads `?token=`, shows summary (email/track/pages from manifest) + download button → `GET /api/hustlekit/deliverable?token=`. 404 handled. `noindex`. |
| `public/privacy.html`, `public/terms.html` | Short brand policies; deletion path = email info@mehyar.us (no accounts). |
| `public/favicon.svg`, `robots.txt`, `sitemap.xml` | Text-free lime bolt mark; sitemap lists index/buy/privacy/terms. |

### Functions (`functions/`)
| File | Behavior |
|---|---|
| `_shared/hustlekit.js` | `TRACKS` catalog (name/icon/craft/offers/hunting/deliverable per track), `MODEL` (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), `aiJson()` (handles the **pre-parsed `result.response` object** quirk), `normalizeInputs()` (flat checkout params or `{inputs}` wrapper), `trackOf()`, `HONESTY_RULES` (banned phrases: autopilot/passive income/make-money-while-you-sleep; no income promises; no unproven superlatives), `json()`, `clientIp()`, `todayDay()`. |
| `api/hustlekit/teaser.js` | `POST {track, niche?}` → rate limit 5/day/IP in `hustlekit_teasers` → AI writes one sample page `{title, intro, niche_sketch, offer_sketch, outreach_lines[3]}` (~350 words). 400 invalid track, 429 rate-limited, 500 on AI failure. |
| `api/hustlekit/generate.js` | `POST {order_token, track?, inputs?}` → order must be `paid`/`failed` (`ready` → `{replay:true}`) → AI writes full playbook JSON (cover + 14 chapters + action plan + 4 scripts, personalized from intake) with **one retry** (shorter instruction) on parse failure → pdf-lib composes styled PDF (dark cover, TOC inserted as page 2 with real page numbers, headers/footers, page numbers, script callout boxes, honesty close) → `HUSTLEKIT_R2.put("playbooks/<token>.pdf")` → order `ready` + manifest in `output_json`. Any failure → order `failed` (buyer retries). |
| `api/hustlekit/status.js` | `GET ?token=` → `{ok, paid, order_status, email, product_id, manifest}`. 404 on unknown/short token. |
| `api/hustlekit/deliverable.js` | `GET ?token=` → verifies paid+ready → streams R2 PDF (`application/pdf`, inline, `hustlekit-playbook.pdf`). 404 on bogus token or not-ready. |
| `lib/pdf-lib.bundle.js` | Copied from `~/workspace/build/crayonkid-mvp/lib/pdf-lib.bundle.js` (446KB, smoke-tested in node: creates/saves PDF fine). |

### Config / ops
- `wrangler.toml` — name `hustlekit`, `pages_build_output_dir = "public"`, no `[vars]` (by design).
- `schema.sql` — `hustlekit_orders` (UNIQUE `payment_id`, UNIQUE `access_token`, status default `paid`) + `hustlekit_teasers` (PK `(ip,day)`). Run on the shared `mehyar-jobs` D1.
- `BINDINGS.md` — required bindings: `AI` (Workers AI), `LEADS_DB` (D1 → mehyar-jobs), `HUSTLEKIT_R2` (R2 bucket), `HUSTLEKIT_BASE_URL=https://hustlekit.mehyar.us`.
- `deploy.py` — adapted from crayonkid's direct-upload deploy (project `hustlekit`, stage `/tmp/hk-deploy`); parses OK.

## Checkout params contract (implemented in `buy.html`)
```json
POST https://mehyar.us/api/pay/checkout
{
  "product_id": "hustlekit-starter",
  "email": "<buyer email>",
  "params": {
    "track": "ai-writing" | "ai-video" | "ai-social",
    "skills": "<≤300 chars>",
    "hours_per_week": "<number as string>",
    "income_goal": "<≤60 chars>",
    "experience_level": "beginner" | "some" | "experienced",
    "niche": "<≤300 chars>"
  },
  "success_url": "https://hustlekit.mehyar.us/success.html",
  "cancel_url": "https://hustlekit.mehyar.us/#pricing"
}
```
`params` JSON is kept ≤2048 bytes (client-validated). `success.html` receives `?token={access_token}` appended by the checkout success_url_template. The fulfill module (parent's side) must store these params flat in `billing_payments.metadata_json` and write the order row in `hustlekit_orders` — `generate.js` reads `inputs_json` defensively (flat or `{inputs}`-wrapped).

## Checks run
- `node --check` on all 5 functions files: **all pass**.
- pdf-lib bundle smoke test in node: **creates + saves PDF OK**.
- `deploy.py`: Python `ast.parse` OK (not executed — no deploy per instructions).

## Open questions / notes for the parent
1. **R2 bucket**: I assumed a bucket bound as `HUSTLEKIT_R2`; bucket name is your choice at creation.
2. **Teaser without email**: rate limit is IP-based (5/day); no CAPTCHA. Fine for launch; add Turnstile later if abused.
3. **Generate cost/time**: one 70B call with up to 8000 max_tokens per playbook (~$0.002–0.004). First Workers AI call of the day can queue for minutes — the success page polls, so this is handled UX-wise.
4. **TOC page numbers**: computed as `sectionPages` recorded during layout +1 for the inserted TOC page — verified logic by reading the code, not by rendering. A live render QC of one PDF is recommended post-deploy.
5. **Copy**: no banned phrases anywhere (grep-verified mentally during writing — "autopilot"/"passive income"/"make money while you sleep" appear only in FAQ/notes as explicit denials). No fake testimonials included at all.
6. I did **not** create the `venture-hustlekit` GitHub repo or push anything — your call whether the house "one repo per product" rule wants it, since deploy is direct-upload (same as Designful).
