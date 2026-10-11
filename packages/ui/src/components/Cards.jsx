import { useState } from 'preact/hooks';

const LETTERS = 'ABCDEFGH';

export function QuestionCard({ q, bot, api }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const answer = async (value, dismissed = false) => {
    if (busy) return; setBusy(true);
    try { await api.call('chat.answer', { botId: bot.id, itemId: q.id, text: value, dismissed }); } finally { setBusy(false); }
  };
  if (q.status !== 'pending') {
    return (
      <div class="card done">
        <div class="q-title">{q.question}</div>
        <div class="q-result">
          {q.status === 'answered' ? <><span class="tick">✓</span> {q.answer}</> : q.status === 'dismissed' ? 'Dismissed' : 'No longer waiting'}
        </div>
      </div>
    );
  }
  return (
    <div class="card">
      <div class="card-head">
        <div>
          <div class="q-title">{q.question}</div>
          <div class="q-detail">{q.detail || 'Pick one or tell me in your own words. We can change it anytime.'}</div>
        </div>
        <button class="x" aria-label="Dismiss" onClick={() => answer('', true)}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </div>
      {q.options?.length > 0 && (
        <div class="options">
          {q.options.map((o, i) => (
            <button key={i} class="option" disabled={busy} onClick={() => answer(o)}>
              <kbd>{LETTERS[i]}</kbd><span>{o}</span>
            </button>
          ))}
        </div>
      )}
      <input class="own" placeholder="Type your own answer" value={text} disabled={busy}
        onInput={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && text.trim() && (e.preventDefault(), answer(text.trim()))} />
    </div>
  );
}

export function ApprovalCard({ a, bot, api }) {
  const [busy, setBusy] = useState(false);
  const decide = async (allow) => { setBusy(true); try { await api.call('chat.answer', { botId: bot.id, itemId: a.id, allow }); } finally { setBusy(false); } };
  if (a.status !== 'pending') {
    return (
      <div class="card done">
        <div class="q-title mono">{a.summary || a.tool}</div>
        <div class="q-result">{a.status === 'allowed' ? <><span class="tick">✓</span> Allowed</> : a.status === 'denied' ? 'Declined' : 'No longer waiting'}</div>
      </div>
    );
  }
  return (
    <div class="card warn">
      <div class="q-title">Needs your OK</div>
      <div class="q-detail">{a.reason || 'This action was flagged as risky.'}</div>
      <pre class="cmd">{a.tool}{a.summary ? `: ${a.summary}` : ''}</pre>
      <div class="row end">
        <button class="btn" disabled={busy} onClick={() => decide(false)}>Decline</button>
        <button class="btn primary" disabled={busy} onClick={() => decide(true)}>Allow once</button>
      </div>
    </div>
  );
}
