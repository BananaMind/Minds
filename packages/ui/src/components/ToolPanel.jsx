import { useState } from 'preact/hooks';

const ICON = { exec_command: '>_', read_file: '📄', write_file: '✎', edit_file: '✎', schedule: '⏰', ask_user_question: '?' };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function ToolPanel({ bot, items, onClose }) {
  const rows = items.filter((i) => i.type === 'tool' || (i.type === 'assistant' && i.interim));
  const [open, setOpen] = useState(null);
  const ordered = [...rows].reverse();
  return (
    <aside class="toolpanel">
      <header>
        <div><b>Tool calls</b><small>{rows.filter((r) => r.type === 'tool').length} by {bot.name}</small></div>
        <button class="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </header>
      <div class="tool-scroll">
        {!ordered.length && <p class="muted pad">Nothing yet. When {bot.name} runs commands or edits files, every call shows up here.</p>}
        {ordered.map((r) => r.type === 'assistant' ? (
          <div class="tc note" key={r.id}><small>{fmtTime(r.ts)} · thinking aloud</small><p>{r.text}</p></div>
        ) : (
          <div class={`tc ${r.status}`} key={r.id}>
            <button class="tc-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span class="tc-ico">{ICON[r.name] || '•'}</span>
              <span class="tc-main"><b>{r.name}{r.plugin && <i class="tag">{r.plugin}</i>}</b><code>{r.summary}</code></span>
              <span class={`st ${r.status}`}>{r.status === 'running' ? '…' : r.status === 'ok' ? '✓' : r.status === 'denied' ? '⛔' : '!'}</span>
            </button>
            <small class="tc-meta">{fmtTime(r.ts)}{r.durationMs != null ? ` · ${r.durationMs < 1000 ? r.durationMs + ' ms' : (r.durationMs / 1000).toFixed(1) + ' s'}` : ''}
              {r.safety && r.safety.source !== 'skipped' ? (r.safety.source === 'permission-mode' ? (r.safety.approvedByUser ? ' · you allowed it' : ' · asked first') : ` · safety: ${r.safety.safe ? 'ok' : 'flagged'} (${r.safety.source})`) : ''}</small>
            {open === r.id && (
              <div class="tc-body">
                {r.safety && r.safety.source !== 'permission-mode' && !r.safety.safe && <p class="warn-line">⚠ {r.safety.reason}{r.safety.approvedByUser ? ' — you allowed it' : ''}</p>}
                <label>Arguments</label><pre>{JSON.stringify(r.args, null, 2)}</pre>
                <label>Result</label><pre>{r.result ?? '(running…)'}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
