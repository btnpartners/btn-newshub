// Claude API calls: batch labeling and on-demand summaries.

const API = 'https://api.anthropic.com/v1/messages';

async function callClaude(env, { system, user, maxTokens }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body?.error?.message || 'error'}`);
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, usage: body.usage || {} };
}

function parseJson(text) {
  const start = text.indexOf('[') >= 0 && (text.indexOf('{') < 0 || text.indexOf('[') < text.indexOf('{')) ? text.indexOf('[') : text.indexOf('{');
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  return JSON.parse(text.slice(start, end + 1));
}

export function taxonomyText(taxonomy, pt = {}) {
  const n = (x) => (pt[x] && pt[x] !== x ? `${x} (${pt[x]})` : x);
  return Object.entries(taxonomy)
    .map(([seg, subs]) => `- ${n(seg)}: ${subs.map(n).join('; ')}`)
    .join('\n');
}

// articles: [{ id, title, excerpt, candidates: [company names found by text match] }]
// returns Map(id -> { segments, subsegments, companies })
export async function labelArticles(env, articles, taxonomy, pt = {}) {
  const segments = new Set(Object.keys(taxonomy));
  const pairs = new Map(); // "segment > sub" (lowercase) -> { seg, sub }
  for (const [seg, subs] of Object.entries(taxonomy)) for (const s of subs) pairs.set(`${seg} > ${s}`.toLowerCase(), { seg, sub: s });

  const system = `You label Brazilian and global financial news (mostly in Portuguese) for a fintech M&A advisory firm.
Taxonomy, taken from the firm's fintech database. Format: "- Segment (Portuguese name): Sub-segment (Portuguese name); ..."
${taxonomyText(taxonomy, pt)}

For each article decide which labels apply. Rules:
- Only label an article if it is genuinely about a fintech, a financial-services business model, or a company/deal in one of these segments. General macro, politics, FX, commodities, sports, lifestyle, gadgets and non-financial companies get NO labels.
- "labels": up to 3 entries written exactly as "Segment > Sub-segment" using the ENGLISH names above (a sub-segment can exist under more than one segment; pick the segment that fits the article).
- "segments": English segment names that apply even when no sub-segment fits (optional).
- "companies": from the article's candidate list only, keep the names that really refer to that fintech/financial company in this article (drop coincidental word matches).
Reply with ONLY a JSON array, one object per article: [{"id": <id>, "labels": [...], "segments": [...], "companies": [...]}]`;

  const user = articles
    .map((a) => `id ${a.id}\nTitle: ${a.title}\nExcerpt: ${a.excerpt || '(none)'}\nCandidates: ${a.candidates.length ? a.candidates.join(', ') : '(none)'}`)
    .join('\n\n');

  const { text, usage } = await callClaude(env, { system, user, maxTokens: 140 * articles.length + 200 });
  const parsed = parseJson(text);
  const out = new Map();
  for (const r of Array.isArray(parsed) ? parsed : []) {
    const a = articles.find((x) => x.id === Number(r.id));
    if (!a) continue;
    const subs = new Set();
    const segs = new Set();
    for (const l of (r.labels || []).slice(0, 3)) {
      const hit = pairs.get(String(l).replace(/\s*>\s*/, ' > ').trim().toLowerCase());
      if (hit) { subs.add(hit.sub); segs.add(hit.seg); }
    }
    for (const s of r.segments || []) if (segments.has(s)) segs.add(s);
    const companies = (r.companies || []).filter((c) => a.candidates.includes(c));
    out.set(a.id, { segments: [...segs], subsegments: [...subs], companies });
  }
  return { results: out, usage };
}

// Translate taxonomy names that have no Portuguese name yet.
export async function translateLabels(env, names) {
  if (!names.length) return {};
  const { text } = await callClaude(env, {
    system: 'Translate these fintech market category names into short Brazilian Portuguese labels as used by the Brazilian fintech/financial market (keep established English terms like BNPL, ERP, BaaS when that is market usage). Reply with ONLY a JSON object mapping each English name to its Portuguese label.',
    user: JSON.stringify(names),
    maxTokens: 40 * names.length + 100,
  });
  const obj = parseJson(text);
  return Object.fromEntries(names.filter((n) => typeof obj[n] === 'string').map((n) => [n, obj[n]]));
}

// Pull readable paragraphs from an article page (works when not paywalled).
export async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const html = await res.text();
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((p) => p.length > 60);
    return paras.join('\n').slice(0, 12000);
  } catch {
    return '';
  }
}

export async function summarizeArticle(env, article) {
  const body = await fetchArticleText(article.url);
  const system = `Você resume notícias para o sócio de uma boutique de M&A focada em fintechs no Brasil. Escreva em português, de forma objetiva.
Formato:
- 3 a 5 bullets curtos com os fatos principais (números, empresas, valores, datas).
- Uma linha final começando com "Relevância:" explicando em uma frase por que importa para fintechs/M&A (ou "baixa" se não importar).
Use apenas as informações fornecidas; não invente dados. Se o texto estiver incompleto (paywall), resuma o que houver e diga que o resumo é parcial.`;
  const user = `Título: ${article.title}\nFonte: ${article.source}\nResumo do feed: ${article.excerpt || '(nenhum)'}\n\nTexto da matéria:\n${body || '(não disponível — provavelmente paywall)'}`;
  const { text } = await callClaude(env, { system, user, maxTokens: 600 });
  return { summary: text.trim(), partial: !body };
}
