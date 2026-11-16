# btn partners • NewsHub

Cloudflare Worker that collects Brazilian financial news (Valor, Pipeline Valor, Exame, Brazil Journal, Finsiders),
labels each article with Claude using the NewsHub label set (`src/labels.js`, 98 labels in 5 groups) plus company names
from the FintechHub database, and shows only labeled news by default.

- `src/worker.js` – API, cron (every 15 min), Google-token auth
- `src/feeds.js` – RSS sources and parser
- `src/companies.js` – reads companies/taxonomy live from btn-fintechhub.pages.dev (refreshed daily)
- `src/labels.js` – the label list (edit here to add/remove labels)
- `src/claude.js` – labeling (batches of 15) and on-demand summaries
- `public/index.html` – the app (Google sign-in, filters, Claude summary, share by email to the News Fintech address)

Config: `wrangler.jsonc` vars (`CLAUDE_MODEL`, `ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`) and the secret `ANTHROPIC_API_KEY`
(Cloudflare dashboard → Workers → btn-newshub → Settings → Variables and Secrets).

## Address

The app lives at **https://btn-newshub.pages.dev** — a Cloudflare Pages project (output folder `pages/`, no build
command) whose `_worker.js` forwards every request to the Worker at btn-newshub.hamilton-512.workers.dev.
