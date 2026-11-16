// Server-side "Compartilhar por e-mail": sends the article to a fixed inbox via Resend,
// from news@notify.btnpartners.com (matched by the Gmail filter -> "Leads/News Fintech").

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function emailEnabled(env) {
  return !!(env.RESEND_API_KEY && env.SHARE_FROM && env.SHARE_TO);
}

export async function sendArticleEmail(env, a) {
  const labels = [...a.labels, ...a.companies].join(' · ');
  const date = new Date(a.published_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const html = `<div style="font-family:Georgia,serif;max-width:640px">
  <p style="font:12px Arial,sans-serif;color:#6b7280;margin:0 0 6px">${esc(a.source)} · ${esc(date)}${labels ? ' · ' + esc(labels) : ''}</p>
  <h2 style="margin:0 0 10px;font-size:20px;line-height:1.3"><a href="${esc(a.url)}" style="color:#142033">${esc(a.title)}</a></h2>
  ${a.excerpt ? `<p style="font:14px/1.5 Arial,sans-serif;color:#374151">${esc(a.excerpt)}</p>` : ''}
  ${a.summary ? `<div style="font:14px/1.55 Arial,sans-serif;white-space:pre-wrap;border-left:3px solid #4f86bd;padding:8px 12px;background:#f7f9fc">${esc(a.summary).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>` : ''}
  <p style="font:12px Arial,sans-serif;margin-top:14px"><a href="${esc(a.url)}">Abrir matéria</a> · btn partners NewsHub</p>
</div>`;
  const text = [a.title, a.url, '', `${a.source} · ${date}`, labels && `Rótulos: ${labels}`, '', (a.summary || a.excerpt || '').replace(/\*\*/g, '')].filter((x) => x !== false).join('\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.SHARE_FROM,
      to: env.SHARE_TO.split(',').map((s) => s.trim()),
      subject: a.title,
      html,
      text,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`E-mail: ${body.message || body.name || res.status}`);
  return body.id;
}
