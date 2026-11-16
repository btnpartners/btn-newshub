# btn partners • NewsHub

Cloudflare Worker that collects Brazilian financial news (Valor, Pipeline Valor, Exame, Brazil Journal, Finsiders),
labels each article with Claude using the FintechHub taxonomy (6 segments, ~59 sub-segments) plus company names
from the FintechHub database, and shows only labeled news by default.

- `src/worker.js` – API, cron (every 15 min), Google-token auth
- `src/feeds.js` – RSS sources and parser
- `src/companies.js` – reads companies/taxonomy live from btn-fintechhub.pages.dev (refreshed daily)
- `src/claude.js` – labeling (batches of 15) and on-demand summaries
- `public/index.html` – the app (Google sign-in, filters, Claude summary, save to Gmail label "News Fintech")

Config: `wrangler.jsonc` vars (`CLAUDE_MODEL`, `ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`) and the secret `ANTHROPIC_API_KEY`
(Cloudflare dashboard → Workers → btn-newshub → Settings → Variables and Secrets).
