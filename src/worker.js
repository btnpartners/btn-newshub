import { FEEDS, fetchFeed, titleKey, repairExcerpt } from './feeds.js';
import { refreshCompaniesIfStale, loadCompanies, findCompanyMentions } from './companies.js';
import { labelArticles, summarizeArticle, SUMMARY_VERSION } from './claude.js';
import { LABEL_GROUPS, LABELS_VERSION } from './labels.js';
import { emailEnabled, sendArticleEmail } from './email.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT,
    source TEXT,
    published_at INTEGER,
    fetched_at INTEGER,
    candidates TEXT DEFAULT '[]',
    label_status TEXT DEFAULT 'pending',
    label_attempts INTEGER DEFAULT 0,
    labels TEXT DEFAULT '[]',
    companies TEXT DEFAULT '[]',
    labeled INTEGER DEFAULT 0,
    summary TEXT,
    summary_model TEXT,
    summarized_at INTEGER,
    gmail_saved_at INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles (published_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_articles_status ON articles (label_status)',
  'CREATE TABLE IF NOT EXISTS companies (name TEXT, segment TEXT, description TEXT, source TEXT)',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)',
];

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  try { await env.DB.prepare("ALTER TABLE articles ADD COLUMN labels TEXT DEFAULT '[]'").run(); } catch {}
  try { await env.DB.prepare('ALTER TABLE articles ADD COLUMN title_key TEXT').run(); } catch {}
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_articles_tkey ON articles (title_key)').run();
  await dedupeExisting(env);
  await applyVersions(env);
  await repairExcerpts(env);
  schemaReady = true;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// ---------- ingestion ----------

// When the label set or the summary format changes, relabel stored articles / drop old-format summaries.
async function applyVersions(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM meta WHERE key IN ('labels_version', 'summary_version')").all()).results;
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (v.labels_version !== LABELS_VERSION) {
    await env.DB.batch([
      env.DB.prepare("UPDATE articles SET label_status = 'pending', label_attempts = 0"),
      env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('labels_version', ?)").bind(LABELS_VERSION),
    ]);
  }
  if (v.summary_version !== SUMMARY_VERSION) {
    await env.DB.batch([
      env.DB.prepare('UPDATE articles SET summary = NULL, summary_model = NULL'),
      env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('summary_version', ?)").bind(SUMMARY_VERSION),
    ]);
  }
}

// One-off + safety net: fill title_key for older rows and drop repeated stories (keep the first).
async function dedupeExisting(env) {
  const { results } = await env.DB.prepare('SELECT id, title FROM articles WHERE title_key IS NULL LIMIT 2000').all();
  if (results.length) {
    const stmts = results.map((r) => env.DB.prepare('UPDATE articles SET title_key = ? WHERE id = ?').bind(titleKey(r.title), r.id));
    for (let k = 0; k < stmts.length; k += 90) await env.DB.batch(stmts.slice(k, k + 90));
  }
  await env.DB.prepare(
    'DELETE FROM articles WHERE title_key IS NOT NULL AND id NOT IN (SELECT MIN(id) FROM articles WHERE title_key IS NOT NULL GROUP BY title_key)'
  ).run();
}

// One-off: clean InfoMoney excerpts stored with leftover image markup, then relabel them.
async function repairExcerpts(env) {
  const done = await env.DB.prepare("SELECT value FROM meta WHERE key = 'excerpt_repair'").first();
  if (done?.value === '2026-11-23b') return;
  const { results } = await env.DB.prepare(
    `SELECT id, excerpt FROM articles WHERE excerpt LIKE '%data-%="%' OR excerpt LIKE '%appeared first on%'`
  ).all();
  const stmts = results.map((r) => env.DB.prepare(
    "UPDATE articles SET excerpt = ?, label_status = 'pending', label_attempts = 0 WHERE id = ?"
  ).bind(repairExcerpt(r.excerpt), r.id));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('excerpt_repair', '2026-11-23b')"));
  for (let k = 0; k < stmts.length; k += 90) await env.DB.batch(stmts.slice(k, k + 90));
}

async function ingest(env) {
  const report = { feeds: {}, inserted: 0 };
  const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
  const now = Date.now();
  const stmts = [];
  results.forEach((r, i) => {
    const name = FEEDS[i].source;
    if (r.status === 'rejected') { report.feeds[name] = `error: ${r.reason?.message || r.reason}`; return; }
    report.feeds[name] = r.value.length;
    for (const it of r.value) {
      const key = titleKey(it.title);
      // Same story under another URL within 7 days -> skip; an "UPDATE" version refreshes the existing row.
      stmts.push(env.DB.prepare(
        `INSERT INTO articles (url, title, excerpt, source, published_at, fetched_at, title_key)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM articles WHERE url = ? OR (title_key = ? AND published_at > ?))`
      ).bind(it.url, it.title, it.excerpt, it.source, Math.min(it.published_at, now), now, key, it.url, key, now - 7 * 864e5));
      if (/^\s*update\s*\d*\s*:/i.test(it.title)) {
        stmts.push(env.DB.prepare(
          'UPDATE articles SET url = ?, title = ?, excerpt = ?, summary = NULL WHERE title_key = ? AND url != ? AND title != ? AND NOT EXISTS (SELECT 1 FROM articles WHERE url = ?)'
        ).bind(it.url, it.title, it.excerpt, key, it.url, it.title, it.url));
      }
    }
  });
  for (let k = 0; k < stmts.length; k += 90) {
    const res = await env.DB.batch(stmts.slice(k, k + 90));
    report.inserted += res.reduce((n, r) => n + (r.meta?.changes || 0), 0);
  }
  return report;
}

async function labelPending(env, maxArticles = 150) {
  const { results: pending } = await env.DB.prepare(
    "SELECT id, title, excerpt FROM articles WHERE label_status = 'pending' AND label_attempts < 3 ORDER BY published_at DESC LIMIT ?"
  ).bind(maxArticles).all();
  if (!pending.length) return { labeled: 0 };
  const { index } = await loadCompanies(env);
  let labeled = 0;
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (let k = 0; k < pending.length; k += 15) {
    const batch = pending.slice(k, k + 15).map((a) => ({
      ...a,
      candidates: findCompanyMentions(`${a.title} ${a.excerpt || ''}`, index).slice(0, 12),
    }));
    try {
      const { results, usage: u } = await labelArticles(env, batch);
      usage.input_tokens += u.input_tokens || 0;
      usage.output_tokens += u.output_tokens || 0;
      const stmts = batch.map((a) => {
        const r = results.get(a.id) || { labels: [], companies: [] };
        const has = r.labels.length + r.companies.length > 0 ? 1 : 0;
        return env.DB.prepare(
          "UPDATE articles SET candidates = ?, labels = ?, companies = ?, labeled = ?, label_status = 'done', label_attempts = label_attempts + 1 WHERE id = ?"
        ).bind(JSON.stringify(a.candidates), JSON.stringify(r.labels), JSON.stringify(r.companies), has, a.id);
      });
      await env.DB.batch(stmts);
      labeled += batch.length;
    } catch (e) {
      console.error('labeling failed', e.message);
      await env.DB.batch(batch.map((a) => env.DB.prepare(
        "UPDATE articles SET label_attempts = label_attempts + 1, label_status = CASE WHEN label_attempts + 1 >= 3 THEN 'error' ELSE 'pending' END WHERE id = ?"
      ).bind(a.id)));
      if (/ANTHROPIC_API_KEY|401|403/.test(e.message)) break;
    }
  }
  return { labeled, usage };
}

async function prune(env) {
  // keep labeled news 180 days, unlabeled 21 days
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles WHERE labeled = 0 AND published_at < ? AND summary IS NULL').bind(now - 21 * 864e5),
    env.DB.prepare('DELETE FROM articles WHERE published_at < ? AND summary IS NULL AND gmail_saved_at IS NULL').bind(now - 180 * 864e5),
  ]);
}

async function runCycle(env) {
  await ensureSchema(env);
  const out = {};
  try { out.companiesRefreshed = await refreshCompaniesIfStale(env); } catch (e) { out.companiesError = e.message; }
  out.ingest = await ingest(env);
  out.label = await labelPending(env);
  await prune(env);
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_cycle', ?)").bind(JSON.stringify({ at: Date.now(), ...out })).run();
  return out;
}

// ---------- auth (Google access token from the browser) ----------

const tokenCache = new Map();
async function authorize(request, env) {
  if (env.REQUIRE_LOGIN !== 'true') return 'public';
  if (env.DEV_BYPASS_EMAIL) return env.DEV_BYPASS_EMAIL; // local development only (.dev.vars)
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.email;
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  const info = await res.json();
  const allowed = env.ALLOWED_EMAILS.split(',').map((s) => s.trim().toLowerCase());
  if (info.aud !== env.GOOGLE_CLIENT_ID && info.azp !== env.GOOGLE_CLIENT_ID) return null;
  if (!info.email || info.email_verified === 'false' || !allowed.includes(info.email.toLowerCase())) return null;
  tokenCache.set(token, { email: info.email, exp: Date.now() + Math.min(Number(info.expires_in || 300), 3000) * 1000 });
  return info.email;
}

// ---------- API ----------

function rowOut(r) {
  return {
    id: r.id, url: r.url, title: r.title, excerpt: r.excerpt, source: r.source, published_at: r.published_at,
    labels: JSON.parse(r.labels || '[]'), companies: JSON.parse(r.companies || '[]'),
    candidates: JSON.parse(r.candidates || '[]'), label_status: r.label_status, labeled: !!r.labeled,
    summary: r.summary, summary_model: r.summary_model, gmail_saved_at: r.gmail_saved_at,
  };
}

async function listArticles(env, params) {
  const where = [];
  const binds = [];
  const mode = params.get('mode') || 'labeled'; // labeled | unlabeled | all | saved
  if (mode === 'labeled') where.push('a.labeled = 1');
  if (mode === 'unlabeled') where.push("a.labeled = 0 AND a.label_status = 'done'");
  if (mode === 'saved') where.push('(a.summary IS NOT NULL OR a.gmail_saved_at IS NOT NULL)');
  for (const [param, col] of [['label', 'labels'], ['company', 'companies']]) {
    for (const v of params.getAll(param)) {
      where.push(`EXISTS (SELECT 1 FROM json_each(a.${col}) WHERE json_each.value = ?)`);
      binds.push(v);
    }
  }
  const q = (params.get('q') || '').trim();
  if (q) { where.push('(a.title LIKE ? OR a.excerpt LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }
  const source = params.get('source');
  if (source) { where.push('a.source = ?'); binds.push(source); }
  const before = Number(params.get('before'));
  if (before) { where.push('a.published_at < ?'); binds.push(before); }
  const limit = Math.min(Number(params.get('limit')) || 40, 100);
  const sql = `SELECT * FROM articles a ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.published_at DESC LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(...binds, limit).all();
  return results.map(rowOut);
}

async function labelCounts(env, days = 30) {
  const since = Date.now() - days * 864e5;
  const counts = {};
  for (const col of ['labels', 'companies']) {
    const { results } = await env.DB.prepare(
      `SELECT j.value AS label, COUNT(*) AS n FROM articles a, json_each(a.${col}) j WHERE a.published_at > ? GROUP BY j.value ORDER BY n DESC LIMIT 200`
    ).bind(since).all();
    counts[col] = results;
  }
  const stats = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(labeled) AS labeled, SUM(CASE WHEN label_status='pending' AND labels = '[]' AND companies = '[]' THEN 1 ELSE 0 END) AS pending FROM articles WHERE published_at > ?"
  ).bind(since).first();
  const last = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_cycle'").first();
  return { groups: LABEL_GROUPS, counts, stats, lastCycle: last ? JSON.parse(last.value) : null };
}

async function handleApi(request, env, ctx, url) {
  const path = url.pathname;
  if (path === '/api/config') return json({ requireLogin: env.REQUIRE_LOGIN === 'true', googleClientId: env.GOOGLE_CLIENT_ID, shareEmail: env.SHARE_EMAIL, serverEmail: emailEnabled(env), shareLabel: env.SHARE_LABEL });

  await ensureSchema(env);
  const email = await authorize(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);

  if (path === '/api/me') return json({ email });
  if (path === '/api/articles' && request.method === 'GET') return json({ articles: await listArticles(env, url.searchParams) });
  if (path === '/api/labels') return json(await labelCounts(env));
  if (path === '/api/refresh' && request.method === 'POST') {
    const last = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_cycle'").first();
    const prev = last ? JSON.parse(last.value) : null;
    if (prev && Date.now() - prev.at < 120000) return json({ ...prev, throttled: true });
    return json(await runCycle(env));
  }

  let m = path.match(/^\/api\/articles\/(\d+)\/summary$/);
  if (m && request.method === 'POST') {
    const row = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(Number(m[1])).first();
    if (!row) return json({ error: 'not found' }, 404);
    const force = url.searchParams.get('force') === '1';
    if (row.summary && !force) return json(rowOut(row));
    const cap = Number(env.DAILY_SUMMARY_LIMIT || 150);
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE summarized_at > ?').bind(Date.now() - 864e5).first();
    if (used.n >= cap) return json({ error: `Limite diário de ${cap} resumos atingido` }, 429);
    try {
      const { summary, textChars, fetchStatus } = await summarizeArticle(env, row);
      await env.DB.prepare('UPDATE articles SET summary = ?, summary_model = ?, summarized_at = ? WHERE id = ?')
        .bind(summary, env.CLAUDE_MODEL, Date.now(), row.id).run();
      return json({ ...rowOut({ ...row, summary, summary_model: env.CLAUDE_MODEL }), text_chars: textChars, fetch_status: fetchStatus });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  m = path.match(/^\/api\/articles\/(\d+)\/(?:gmail|shared)$/);
  if (m && request.method === 'POST') {
    await env.DB.prepare('UPDATE articles SET gmail_saved_at = ? WHERE id = ?').bind(Date.now(), Number(m[1])).run();
    return json({ ok: true });
  }
  m = path.match(/^\/api\/articles\/(\d+)\/email$/);
  if (m && request.method === 'POST') {
    if (!emailEnabled(env)) return json({ error: 'Envio de e-mail não configurado' }, 503);
    const cap = Number(env.DAILY_EMAIL_LIMIT || 60);
    const sent = await env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE gmail_saved_at > ?').bind(Date.now() - 864e5).first();
    if (sent.n >= cap) return json({ error: `Limite diário de ${cap} e-mails atingido` }, 429);
    let row = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(Number(m[1])).first();
    if (!row) return json({ error: 'not found' }, 404);
    if (!row.summary) {
      try {
        const { summary } = await summarizeArticle(env, row);
        await env.DB.prepare('UPDATE articles SET summary = ?, summary_model = ?, summarized_at = ? WHERE id = ?').bind(summary, env.CLAUDE_MODEL, Date.now(), row.id).run();
        row = { ...row, summary, summary_model: env.CLAUDE_MODEL };
      } catch (e) { console.error('summary before email failed', e.message); }
    }
    try {
      await sendArticleEmail(env, rowOut(row));
    } catch (e) {
      return json({ error: e.message }, 502);
    }
    await env.DB.prepare('UPDATE articles SET gmail_saved_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
    return json({ ...rowOut(row), gmail_saved_at: Date.now() });
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, ctx, url); }
      catch (e) { console.error(e); return json({ error: e.message }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCycle(env).then((r) => console.log('cycle', JSON.stringify(r))));
  },
};
