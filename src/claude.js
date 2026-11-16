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

// Pull the article text from its page (works when the paywall is applied in the browser).
export async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) return { text: '', status: res.status };
    const html = await res.text();
    const clean = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    // 1) structured data, 2) the site's article-body paragraphs (Globo/Valor), 3) any long paragraphs
    for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const items = [].concat(JSON.parse(m[1]));
        for (const it of items) if (it && typeof it.articleBody === 'string' && it.articleBody.length > 400) return { text: clean(it.articleBody).slice(0, 15000), status: res.status };
      } catch {}
    }
    const body = [...html.matchAll(/<p[^>]*class="[^"]*content-text__container[^"]*"[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1]));
    const paras = body.length >= 3 ? body : [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).filter((p) => p.length > 60);
    return { text: paras.join('\n').slice(0, 15000), status: res.status };
  } catch (e) {
    return { text: '', status: `error ${e.message}` };
  }
}

export const SUMMARY_VERSION = '2026-11-16b';

export async function summarizeArticle(env, article) {
  const { text: body, status } = await fetchArticleText(article.url);
  const system = `Você resume notícias financeiras para leitura de um executivo. Escreva em português do Brasil, em prosa clara e fiel ao texto.
Formato (Markdown simples):
- Um parágrafo de abertura com o fato principal e os números mais importantes.
- Em seguida, parágrafos curtos que cobrem cada aspecto relevante da matéria, cada um começando com um título curto em negrito terminado em ponto (ex.: **Perfil de uso.**, **Quem ganhou espaço.**, **Riscos.**).
- Destaque em negrito, na primeira menção, nomes de empresas, instituições e pessoas.
- Inclua todos os dados relevantes (valores, percentuais, datas, comparações). O tamanho deve acompanhar a matéria: uma nota curta vira 1-2 parágrafos; uma reportagem longa pode ter vários.
- Se a matéria citar pessoas, termine com:
**Pessoas citadas:**
Nome — cargo e empresa/instituição (uma pessoa por linha, como descrito na matéria)
Se ninguém for citado, omita essa seção.
Use apenas as informações do texto; não invente nada nem acrescente opinião. Ignore avisos de assinatura/paywall.`;
  const partialNote = body.length < 800 ? '\n\n(O texto completo não estava disponível: resuma o que houver e termine com "(resumo parcial)".)' : '';
  const user = `Título: ${article.title}\nFonte: ${article.source}\nResumo do feed: ${article.excerpt || '(nenhum)'}\n\nTexto da matéria:\n${body || '(não disponível)'}${partialNote}`;
  const { text } = await callClaude(env, { system, user, maxTokens: 3000 });
  return { summary: text.trim(), partial: !body, textChars: body.length, fetchStatus: status };
}
