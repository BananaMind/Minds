// Terminal rendering for /usage and /reset.
import { c } from './render.js';

const PLAN = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };

export function untilLabel(ms, now = Date.now()) {
  const m = Math.max(0, Math.round((ms - now) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${min}m` : `${min}m`;
}

const whenLabel = (ms, now = Date.now()) => {
  const t = new Date(ms), sameDay = t.toDateString() === new Date(now).toDateString();
  const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${t.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
};

function bar(pct, width = 24) {
  const full = Math.round((pct / 100) * width);
  const color = pct >= 90 ? c.red : pct >= 70 ? c.yellow : c.green;
  return color('█'.repeat(full)) + c.gray('░'.repeat(width - full));
}

export function usageLines(u, now = Date.now()) {
  const lines = ['', c.bold(`ChatGPT ${PLAN[u.plan] || u.plan || ''} usage`.replace(/\s+/g, ' ').trim())];
  if (!u.windows.length) lines.push(c.gray('  No usage limits reported for this plan.'));
  const pad = Math.max(...u.windows.map((w) => w.label.length), 6);
  for (const w of u.windows) {
    lines.push(`  ${w.label.padEnd(pad)}  ${bar(w.usedPercent)}  ${String(w.usedPercent).padStart(3)}% used  ${c.gray(`resets in ${untilLabel(w.resetsAt, now)} (${whenLabel(w.resetsAt, now)})`)}`);
  }
  if (u.limitReached || !u.allowed) lines.push(c.red(`  Limit reached${u.reachedType ? ` (${u.reachedType})` : ''}. Bots on ChatGPT models wait until it resets.`));
  if (u.resetsAvailable) lines.push(c.cyan(`  ${u.resetsAvailable} free reset${u.resetsAvailable > 1 ? 's' : ''} available · /reset`));
  lines.push('');
  return lines;
}

export const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
