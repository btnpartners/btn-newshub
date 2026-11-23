// News sources and a small dependency-free RSS parser.

export const FEEDS = [
  { source: 'Valor Econômico', url: 'https://pox.globo.com/rss/valor/' },
  { source: 'Pipeline Valor', url: 'https://pox.globo.com/rss/pipelinevalor/' },
  { source: 'Exame', url: 'https://exame.com/feed/' },
  { source: 'Brazil Journal', url: 'https://braziljournal.com/feed/' },
  { source: 'Finsiders Brasil', url: 'https://finsidersbrasil.com.br/feed/' },
  { source: 'NeoFeed', url: 'https://neofeed.com.br/feed/' },
  { source: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/' },
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

// Tag matcher that skips over quoted attribute values (InfoMoney's <img> tags carry HTML inside data-* attributes).
const TAG = /<\/?[a-z!][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi;
const stripTags = (t) => t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(TAG, ' ');

export function cleanText(s) {
  if (!s) return '';
  let t = stripTags(stripCdata(s));
  t = decodeEntities(t); // some feeds double-encode HTML
  t = stripTags(t);
  t = decodeEntities(t);
  // WordPress footer: "The post <title> appeared first on <site>."
  t = t.replace(/\s*The post [\s\S]*? appeared first on [^.]*\.?\s*$/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

// Repairs excerpts stored before the fix above (leftover image markup and WordPress footer).
export function repairExcerpt(e) {
  if (!e) return e;
  let t = e;
  if (/data-[a-z-]+="/.test(t)) t = t.includes('/>') ? t.slice(t.lastIndexOf('/>') + 2) : ''; // only caption text left: drop it
  t = t.replace(/\s*The post [\s\S]*? appeared first on [^.]*\.?\s*$/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

export function parseRss(xml, source) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = cleanText(tag(block, 'title'));
    let link = cleanText(tag(block, 'link'));
    if (!link) link = cleanText(tag(block, 'guid'));
    if (!title || !/^https?:\/\//.test(link)) continue;
    let excerpt = cleanText(tag(block, 'description'));
    if (excerpt.length > 600) excerpt = excerpt.slice(0, 597).replace(/\s+\S*$/, '') + '…';
    const pub = Date.parse(cleanText(tag(block, 'pubDate')) || cleanText(tag(block, 'dc:date')));
    items.push({
      url: link.split('#')[0],
      title,
      excerpt,
      source,
      published_at: Number.isFinite(pub) ? pub : Date.now(),
    });
  }
  return items;
}

export async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 btn-newshub',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    cf: { cacheTtl: 120 },
  });
  if (!res.ok) throw new Error(`${feed.source}: HTTP ${res.status}`);
  return parseRss(await res.text(), feed.source);
}

// Key used to spot the same story published twice (different URL, "UPDATE1:" prefix, "| Source" suffix).
export function titleKey(title) {
  return title
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*(update\s*\d*|atualiza\S*)\s*[:\-–]\s*/i, '')
    .replace(/\s+\|\s+[^|]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
