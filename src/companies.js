// Company database + label taxonomy, read live from FintechHub.

const DAY = 24 * 60 * 60 * 1000;

// Extract the `const ORIG = [...]` JSON array from the FintechHub page.
export function extractCompanies(html) {
  const marker = 'const ORIG = ';
  const i = html.indexOf(marker);
  if (i < 0) throw new Error('FintechHub data not found');
  const start = i + marker.length;
  let depth = 0;
  let j = start;
  for (; j < html.length; j++) {
    const c = html[j];
    if (c === '"') {
      j++;
      while (j < html.length && html[j] !== '"') { if (html[j] === '\\') j++; j++; }
    } else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  const rows = JSON.parse(html.slice(start, j + 1));
  return rows
    .filter((r) => r && r.company && r.segment)
    .map((r) => ({
      name: String(r.company).trim(),
      segment: String(r.segment).trim(),
      description: String(r.description || '').trim(),
      source: String(r.source || '').trim(),
    }));
}

export async function refreshCompaniesIfStale(env, force = false) {
  const meta = await env.DB.prepare("SELECT value FROM meta WHERE key = 'companies_updated'").first();
  if (!force && meta && Date.now() - Number(meta.value) < DAY) return false;
  const res = await fetch(env.FINTECHHUB_URL, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`FintechHub HTTP ${res.status}`);
  const companies = extractCompanies(await res.text());
  if (companies.length < 100) throw new Error(`FintechHub returned only ${companies.length} companies`);
  const stmts = [env.DB.prepare('DELETE FROM companies')];
  for (const c of companies) {
    stmts.push(env.DB.prepare('INSERT INTO companies (name, segment, description, source) VALUES (?, ?, ?, ?)').bind(c.name, c.segment, c.description, c.source));
  }
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('companies_updated', ?)").bind(String(Date.now())));
  for (let k = 0; k < stmts.length; k += 90) await env.DB.batch(stmts.slice(k, k + 90));
  cache = null;
  return true;
}

let cache = null; // { companies, taxonomy, index, loadedAt }

export async function loadCompanies(env) {
  if (cache && Date.now() - cache.loadedAt < 10 * 60 * 1000) return cache;
  const { results } = await env.DB.prepare('SELECT name, segment, description, source FROM companies').all();
  const taxonomy = buildTaxonomy(results);
  cache = { companies: results, taxonomy, index: buildIndex(results), loadedAt: Date.now() };
  return cache;
}

// segment -> sorted list of sub-segments (FintechHub "description" values)
export function buildTaxonomy(companies) {
  const seg = new Map();
  for (const c of companies) {
    if (!seg.has(c.segment)) seg.set(c.segment, new Map());
    if (c.description) {
      const m = seg.get(c.segment);
      m.set(c.description, (m.get(c.description) || 0) + 1);
    }
  }
  const out = {};
  for (const [s, subs] of [...seg.entries()].sort()) {
    out[s] = [...subs.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  }
  return out;
}

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const tokenize = (s) => strip(s).split(/[^A-Za-z0-9&+]+/).filter(Boolean);

// Words that are too generic to count as a company mention on their own.
// Single-word company names that collide with people/places in Brazilian news.
const COLLISIONS = new Set(['lula', 'rio', 'brasilia', 'bond', 'center', 'warren', 'trump', 'haddad', 'galipolo', 'tarcisio', 'moraes', 'bolsonaro']);
const PLACES = new Set(['rio', 'sao paulo', 'sp', 'rj', 'brasil', 'brazil', 'mexico', 'colombia', 'chile', 'argentina', 'peru', 'uk', 'usa', 'us', 'europe', 'latam', 'india', 'singapore', 'london', 'new york']);

const GENERIC = new Set(['bank', 'banco', 'pay', 'capital', 'credit', 'credito', 'seguros', 'invest', 'digital', 'finance', 'financial', 'group', 'grupo', 'brasil', 'brazil', 'the', 'one', 'app', 'data', 'cash', 'money', 'fintech', 'global']);

function nameVariants(name) {
  const variants = new Set();
  const base = name.replace(/\(([^)]*)\)/g, ' ').replace(/\s+/g, ' ').trim();
  variants.add(base);
  // "PagSeguro (PagBank)" -> also "PagBank"; but not places like "Arbor Capital (Rio)"
  for (const m of name.matchAll(/\(([^)]*)\)/g)) {
    const alt = m[1].trim();
    if (alt.length >= 5 && !PLACES.has(alt.toLowerCase())) variants.add(alt);
  }
  // "Foo Inc", "Foo S.A." -> "Foo"
  variants.add(base.replace(/\b(inc|ltd|llc|s\.?a\.?|ltda|plc|corp|gmbh)\.?$/i, '').trim());
  return [...variants].filter(Boolean);
}

const squash = (tokens) => tokens.join('').toLowerCase();

// Index by the name with spaces removed and lowercased, so "Pagbank" = "PagBank" and "C6Bank" = "C6 Bank".
export function buildIndex(companies) {
  const index = new Map(); // squashed name -> company
  for (const c of companies) {
    for (const v of nameVariants(c.name)) {
      const tokens = tokenize(v);
      if (!tokens.length) continue;
      if (tokens.length === 1) {
        const t = tokens[0].toLowerCase();
        if (GENERIC.has(t) || COLLISIONS.has(t)) continue;
        if (t.length < 3) {
          // very short names ("XP") only match when written exactly the same, in capitals
          if (/^[A-Z0-9]{2}$/.test(tokens[0])) index.set('=' + tokens[0], c.name);
          continue;
        }
      }
      const key = squash(tokens);
      if (key.length < 3 || !index.has(key)) index.set(key, c.name);
    }
  }
  return index;
}

// A mention must start with a capitalised word (or a digit), so common lowercase words don't match.
export function findCompanyMentions(text, index) {
  const tokens = tokenize(text);
  const found = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (!/^[A-Z0-9]/.test(tokens[i])) continue;
    const exact = index.get('=' + tokens[i]);
    if (exact) found.add(exact);
    let joined = '';
    for (let k = 0; k < 4 && i + k < tokens.length; k++) {
      joined += tokens[i + k].toLowerCase();
      const hit = index.get(joined);
      if (hit) found.add(hit);
    }
  }
  return [...found];
}
