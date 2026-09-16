# HustleKit — Pages project bindings

Project: `hustlekit` → https://hustlekit.mehyar.us (+ hustlekit.pages.dev)

Wire these via the Cloudflare dashboard or API after project creation.
Never commit secrets or binding values — `wrangler.toml` carries none.

| Binding / var        | Type        | Value / target                                  |
|----------------------|-------------|-------------------------------------------------|
| `AI`                 | Workers AI  | Workers AI binding                              |
| `LEADS_DB`           | D1          | `mehyar_leads_prod` (uuid e4f22065-e3e8-4772-87a8-51d4976be042; holds `hustlekit_orders`, `hustlekit_teasers`, `billing_*`) |
| `HUSTLEKIT_R2`       | R2 bucket   | R2 bucket for playbook PDFs (any name; key layout `playbooks/<token>.pdf`) |
| `HUSTLEKIT_BASE_URL` | plain text  | `https://hustlekit.mehyar.us`                   |

mehyar-web side (set by the parent agent, if needed — the fulfill module
defaults to `https://hustlekit.mehyar.us` when unset):
- `HUSTLEKIT_BASE_URL` on the mehyar-web Pages project.

Notes:
- D1 tables are created from `schema.sql` (parent agent runs it via the D1 REST API).
- The SKU row `hustlekit-starter` lives in `billing_products` on the same D1.
- R2 bucket name is free choice; only the binding name `HUSTLEKIT_R2` matters.
