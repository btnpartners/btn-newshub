// Claude API calls: batch labeling and on-demand summaries.

const API = 'https://api.anthropic.com/v1/messages';

async function callClaude(env, { system, user, maxTokens }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const send = (body) => fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const base = { model: env.CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
  // Labeling and summaries are simple tasks: no extended thinking (it would use up the token budget).
  let res = await send({ ...base, thinking: { type: 'disabled' } });
  let body = await res.json().catch(() => ({}));
  if (res.status === 400 && /thinking/i.test(body?.error?.message || '')) {
    res = await send({ ...base, max_tokens: maxTokens + 4000 });
    body = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body?.error?.message || 'error'}`);
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) throw new Error(`Claude returned no text (stop: ${body.stop_reason})`);
  return { text, usage: body.usage || {} };
}

function parseJson(text) {
  const start = text.indexOf('[') >= 0 && (text.indexOf('{') < 0 || text.indexOf('[') < text.indexOf('{')) ? text.indexOf('[') : text.indexOf('{');
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  return JSON.parse(text.slice(start, end + 1));
}

import { LABEL_GROUPS, ALL_LABELS, HINTS } from './labels.js';

function labelList() {
  return Object.entries(LABEL_GROUPS)
    .map(([g, ls]) => `${g}: ${ls.map((l) => (HINTS[l] ? `${l} (${HINTS[l]})` : l)).join('; ')}`)
    .join('\n');
}

// articles: [{ id, title, excerpt, candidates: [company names found by text match] }]
// returns Map(id -> { labels, companies })
export async function labelArticles(env, articles) {
  const valid = new Map(ALL_LABELS.map((l) => [l.toLowerCase(), l]));
  const system = `Você classifica notícias financeiras brasileiras para uma boutique de M&A focada em fintechs.
Rótulos disponíveis (use exatamente estes nomes; o texto entre parênteses é só explicação):
${labelList()}

Regras:
- Atribua TODOS os rótulos que se aplicam claramente à notícia (normalmente 1 a 5). Associações, reguladores e licenças só quando forem citados ou forem o assunto.
- Se nenhum rótulo se aplicar (esportes, celebridades, gadgets, política sem impacto econômico etc.), deixe a lista vazia.
- "companies": da lista de candidatas de cada notícia, mantenha só os nomes que de fato se referem a uma empresa do setor financeiro/fintech citada na notícia. Descarte coincidências: pessoas (ex.: Lula, Warren Buffett), lugares, órgãos públicos, personagens e palavras comuns.
Responda SOMENTE com um array JSON, um objeto por notícia: [{"id": <id>, "labels": [...], "companies": [...]}]`;

  const user = articles
    .map((a) => `id ${a.id}\nTítulo: ${a.title}\nResumo: ${a.excerpt || '(nenhum)'}\nCandidatas: ${a.candidates.length ? a.candidates.join(', ') : '(nenhuma)'}`)
    .join('\n\n');

  const { text, usage } = await callClaude(env, { system, user, maxTokens: 150 * articles.length + 500 });
  const parsed = parseJson(text);
  const out = new Map();
  for (const r of Array.isArray(parsed) ? parsed : []) {
    const a = articles.find((x) => x.id === Number(r.id));
    if (!a) continue;
    const labels = [...new Set((r.labels || []).map((l) => valid.get(String(l).trim().toLowerCase())).filter(Boolean))];
    const companies = (r.companies || []).filter((c) => a.candidates.includes(c));
    out.set(a.id, { labels, companies });
  }
  return { results: out, usage };
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
  const { text } = await callClaude(env, { system, user, maxTokens: 1000 });
  return { summary: text.trim(), partial: !body };
}
