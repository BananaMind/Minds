import fs from 'node:fs';
import { nextPermission, EFFORT_HINTS, MODEL_DESCRIPTIONS } from '@bananamind/minds-core';
import { c, glyph, md, stampLabel, botLine, clipLine, termWidth, wrap } from './render.js';
import { Prompt } from './prompt.js';
import { usageLines, dateLabel } from './usage.js';

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version; } catch { return '0.1.0'; } })();
const MODE_COLOR = { default: '#3ecfa5', ask: '#f5c04a', bypass: '#ff7a73' };

const LETTERS = 'ABCDEFGH';
const COMMANDS = [
  { name: 'model', desc: 'choose what model and reasoning effort to use' },
  { name: 'effort', desc: 'choose how much the bot reasons' },
  { name: 'fast', desc: 'toggle Fast mode: faster replies, uses more of your limits' },
  { name: 'ultrafast', desc: 'toggle Ultrafast: very fast writing, but often a long wait first' },
  { name: 'mode', desc: 'choose a permission mode (or press shift+tab)' },
  { name: 'bots', desc: 'switch to another bot' },
  { name: 'new', desc: 'create a new bot', needsArg: true },
  { name: 'rename', desc: 'rename this bot', needsArg: true },
  { name: 'tools', desc: 'see every tool call (/tools <n> for details)' },
  { name: 'verbose', desc: 'toggle live tool-call lines' },
  { name: 'schedules', desc: "list this bot's schedules" },
  { name: 'usage', desc: 'show your ChatGPT 5-hour and weekly usage' },
  { name: 'reset', desc: 'see and use your free rate-limit resets' },
  { name: 'stop', desc: 'stop the current task' },
  { name: 'skip', desc: 'dismiss the pending question' },
  { name: 'delete', desc: 'delete this bot and its history' },
  { name: 'help', desc: 'show all commands' },
  { name: 'exit', desc: 'leave (your bots keep running)' },
];
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const visible = (m) => (m.type === 'user' && !m.hidden) || (m.type === 'assistant' && !m.interim && m.text) || m.type === 'question' || m.type === 'approval' || m.type === 'notice';

/** Interactive chat session: the terminal counterpart of the desktop chat window. */
export async function runChat(client, initialBot) {
  let state = await client.call('state');
  let bot = initialBot, items = [], status = 'idle';
  let verbose = false, spinTimer = null, frame = 0, lastTs = 0, sigintAt = 0, localEcho = new Set();

  const pending = () => [...items].reverse().find((m) => (m.type === 'question' || m.type === 'approval') && m.status === 'pending');

  const modeInfo = () => state.permissions.find((m) => m.id === bot.permission) || state.permissions[0];
  const modelName = () => (state.models.find((m) => m.id === bot.model)?.name || bot.model).replace(/ /g, '-');
  const prompt = new Prompt({
    commands: () => COMMANDS,
    footer: () => {
      const p = pending(), mode = modeInfo();
      return {
        label: p ? '?' : '›',
        placeholder: p ? (p.type === 'approval' ? 'y to allow once, n to decline' : 'Type your answer') : `Message ${bot.name}`,
        working: status !== 'idle' && !p ? `${SPIN[frame % SPIN.length]} Working… (esc to stop)` : null,
        status: `${c.rgb('#b9e6a8', `${modelName()} ${bot.effort}`)}${bot.speed === 'fast' ? c.rgb('#f5c04a', ' ⚡fast') : bot.speed === 'ultrafast' ? c.rgb('#ff8a3d', ' ⚡⚡ultrafast') : ''}${c.gray(' · ')}${glyph(bot.icon)} ${c.gray(bot.name)}${c.gray(' · ')}${c.rgb(MODE_COLOR[mode.id], `● ${mode.label}`)} ${c.gray('(shift+tab to cycle)')}`,
        hint: p ? (p.type === 'question' ? '/skip to dismiss' : 'the bot is waiting for your decision') : '/ for commands · /tools for tool calls · /bots to switch',
      };
    },
  });
  const refreshPrompt = () => prompt.render();
  const out = (text = '') => prompt.print(text);
  const block = (lines) => out(lines.join('\n'));

  const setStatus = (s) => {
    status = s;
    if (s !== 'idle' && !spinTimer) spinTimer = setInterval(() => { frame++; refreshPrompt(); }, 110);
    if (s === 'idle' && spinTimer) { clearInterval(spinTimer); spinTimer = null; }
    refreshPrompt();
  };

  function render(m, { replay = false } = {}) {
    if (m.type === 'tool') {
      if (verbose && !replay) out(c.gray(`  ⚙ ${m.name}${m.summary ? ` ${clipLine(m.summary, 80)}` : ''}`));
      return;
    }
    if (!visible(m)) return;
    const lines = [];
    if (m.ts - lastTs > 3600_000) lines.push('', c.gray(`  ${stampLabel(m.ts)}`));
    lastTs = m.ts;
    if (m.type === 'user') {
      if (m.source === 'schedule') lines.push(c.gray(`  ⏰ Scheduled: ${m.scheduleName || 'task'}`));
      else lines.push(...wrap(m.text, termWidth() - 4).map((l, i) => (i ? '  ' : `${c.dim('›')} `) + c.dim(l)));
    } else if (m.type === 'assistant') {
      const body = md(m.text);
      lines.push('', ...body.map((l, i) => (i ? '  ' : `${glyph(bot.icon)} `) + l), '');
    } else if (m.type === 'question') lines.push(...questionCard(m));
    else if (m.type === 'approval') lines.push(...approvalCard(m));
    else if (m.type === 'notice') lines.push(m.level === 'error' ? c.red(`  ✗ ${m.text}`) : c.gray(`  ${m.text}`));
    block(lines);
  }

  function questionCard(q) {
    if (q.status !== 'pending') return [c.gray(`  ? ${clipLine(q.question)} → ${q.status === 'answered' ? q.answer : q.status}`)];
    const L = [`${c.yellow('?')} ${c.bold(q.question)}`];
    if (q.detail) L.push(`  ${c.gray(q.detail)}`);
    if (!q.options?.length) L.push(`  ${c.gray('type your answer · /skip to dismiss')}`);
    return L;
  }
  function approvalCard(a) {
    if (a.status !== 'pending') return [c.gray(`  ! ${clipLine(`${a.tool}: ${a.summary}`)} → ${a.status}`)];
    return [`${c.yellow('!')} ${c.bold(c.yellow('Needs your OK'))}  ${c.gray(a.reason || '')}`, `  ${c.cyan(clipLine(`${a.tool}${a.summary ? ': ' + a.summary : ''}`, termWidth() - 6))}`];
  }

  // Questions and approvals are answered with an interactive pick list; Esc falls back to typing.
  const asked = new Set();
  let asking = null;
  const stillPending = (p) => items.find((x) => x.id === p.id)?.status === 'pending';
  async function maybeAsk() {
    const p = pending();
    if (!p || asked.has(p.id) || prompt.selecting) return;
    if (p.type === 'question' && !p.options?.length) return;
    asked.add(p.id); asking = p.id;
    try {
      if (p.type === 'question') {
        const CUSTOM = '__custom__';
        const choice = await prompt.select({
          title: p.question, subtitle: p.detail || undefined,
          items: [...p.options.map((o) => ({ label: o, value: o })), { label: 'Type your own answer', value: CUSTOM }],
          hint: 'enter to confirm · esc to answer in your own words (or /skip)',
        });
        if (!stillPending(p)) return;
        if (choice === null || choice === CUSTOM) return refreshPrompt();
        localEcho.add(`answered:${p.id}`); out(c.dim(`› ${choice}`));
        await client.call('chat.answer', { botId: bot.id, itemId: p.id, text: choice, source: 'cli' });
      } else {
        const choice = await prompt.select({
          title: 'Needs your OK', subtitle: `${p.tool}${p.summary ? ': ' + clipLine(p.summary, 100) : ''}${p.reason ? `  (${clipLine(p.reason, 80)})` : ''}`,
          items: [{ label: 'Allow once', value: true }, { label: 'Decline', value: false }],
          initial: 1, hint: 'enter to confirm · 1 allow · 2 decline · esc to decide by typing y/n',
        });
        if (!stillPending(p)) return;
        if (choice === null) return refreshPrompt();
        localEcho.add(`answered:${p.id}`); out(c.dim(`› ${choice ? 'Allowed once' : 'Declined'}`));
        await client.call('chat.answer', { botId: bot.id, itemId: p.id, allow: choice, source: 'cli' });
      }
    } catch (e) { out(c.red(`  ✗ ${e.message}`)); }
    finally { asking = null; maybeAsk(); }
  }

  async function load() {
    const r = await client.call('chat.history', { botId: bot.id, limit: 800 });
    items = r.items; status = r.status;
    lastTs = 0;
    out(`${c.rgb('#4aa3ff', c.bold('>_ Minds'))} ${c.gray(`(v${VERSION})`)}\n   ${glyph(bot.icon)} ${c.bold(bot.name)}\n`);
    for (const m of items.filter(visible).slice(-12)) render(m, { replay: true });
    setStatus(status === 'working' ? 'working' : 'idle');
    client.call('chat.markRead', { botId: bot.id }).catch(() => {});
    maybeAsk();
  }

  client.on((e, d) => {
    if (e === 'bot.updated' && d.bot.id === bot.id) { bot = { ...bot, ...d.bot }; setStatus(d.bot.status); }
    else if (e === 'message.added' && d.botId === bot.id) {
      const m = d.item; items.push(m);
      if (m.type === 'user' && localEcho.delete(m.text)) return;
      render(m);
      if (visible(m)) client.call('chat.markRead', { botId: bot.id }).catch(() => {});
      maybeAsk();
    } else if (e === 'message.updated' && d.botId === bot.id) {
      const m = items.find((x) => x.id === d.id); if (!m) return;
      const was = m.status; Object.assign(m, d.patch);
      if (m.type === 'tool' && verbose && d.patch.status && d.patch.status !== 'running') out(c.gray(`    ${d.patch.status === 'ok' ? '✓' : '✗'} ${clipLine(d.patch.result, 100)}`));
      if ((m.type === 'question' || m.type === 'approval') && was === 'pending' && d.patch.status && d.patch.status !== 'pending') {
        if (asking === m.id) prompt.cancelSelect();
        if (!localEcho.has(`answered:${m.id}`)) out(c.gray(`  ✓ answered elsewhere: ${m.answer ?? d.patch.status}`));
        refreshPrompt();
      }
    } else if (e === 'bot.deleted' && d.id === bot.id) { out(c.red('This bot was deleted.')); close(); }
  });

  // ---- commands ----
  const help = () => block(['', c.bold('Commands'), ...COMMANDS.map((x) => `  ${c.cyan(('/' + x.name).padEnd(12))} ${c.gray(x.desc)}`), '', c.gray('  Type / to see commands as you type. shift+tab cycles permission modes.'), ''].filter((l) => l !== undefined));

  async function switchTo(arg) {
    state = await client.call('state');
    const n = Number(arg);
    const target = Number.isInteger(n) && n >= 1 ? state.bots[n - 1] : state.bots.find((b) => b.name.toLowerCase() === String(arg).toLowerCase()) || state.bots.find((b) => b.name.toLowerCase().startsWith(String(arg).toLowerCase()));
    if (!target) return out(c.red(`No bot "${arg}". Try /bots.`));
    bot = target; await load();
  }

  const idxOf = (list, pred) => Math.max(0, list.findIndex(pred));
  const hyphen = (name) => name.replace(/ /g, '-');

  async function pickModel() {
    let step = 'model', modelId = bot.model;
    for (;;) {
      if (step === 'model') {
        const m = await prompt.select({
          title: 'Select model', hint: 'enter to continue · esc to cancel',
          items: state.models.map((x) => ({ label: hyphen(x.name), desc: MODEL_DESCRIPTIONS[x.id] || x.hint, value: x.id, current: x.id === bot.model })),
          initial: idxOf(state.models, (x) => x.id === bot.model),
        });
        if (m === null) return;
        modelId = m; step = 'effort';
      } else {
        const name = hyphen(state.models.find((x) => x.id === modelId)?.name || modelId);
        const e = await prompt.select({
          title: `Select reasoning effort for ${name}`,
          items: state.efforts.map((x) => ({ label: x, desc: EFFORT_HINTS[x] || '', value: x, current: x === bot.effort && modelId === bot.model })),
          initial: idxOf(state.efforts, (x) => x === bot.effort),
        });
        if (e === null) { step = 'model'; continue; }
        try { bot = { ...bot, ...(await client.call('bots.update', { id: bot.id, model: modelId, effort: e })) }; out(c.gray(`  Model: ${name} · ${e}`)); }
        catch (err) { out(c.red(`  ✗ ${err.message}`)); }
        return;
      }
    }
  }

  async function pickEffort() {
    const e = await prompt.select({
      title: 'Select reasoning effort', items: state.efforts.map((x) => ({ label: x, desc: EFFORT_HINTS[x] || '', value: x, current: x === bot.effort })),
      initial: idxOf(state.efforts, (x) => x === bot.effort), hint: 'enter to confirm · esc to cancel',
    });
    if (e === null) return;
    bot = { ...bot, ...(await client.call('bots.update', { id: bot.id, effort: e })) }; out(c.gray(`  Effort: ${bot.effort}`));
  }

  async function pickMode() {
    const id = await prompt.select({
      title: 'Select permission mode', items: state.permissions.map((m) => ({ label: m.label, desc: m.hint, value: m.id, current: m.id === bot.permission })),
      initial: idxOf(state.permissions, (m) => m.id === bot.permission), hint: 'enter to confirm · esc to cancel',
    });
    if (id) await setMode(id);
  }

  async function pickBot() {
    state = await client.call('state');
    const id = await prompt.select({
      title: 'Switch bot',
      items: state.bots.map((b) => ({ label: `${b.name}${b.unread ? ' ●' : ''}`, desc: `${b.status !== 'idle' ? `${b.status} · ` : ''}${clipLine(b.last?.text || 'no messages yet', 60)}`, value: b.id, current: b.id === bot.id })),
      initial: idxOf(state.bots, (b) => b.id === bot.id), hint: 'enter to open · esc to cancel',
    });
    if (id && id !== bot.id) { bot = state.bots.find((b) => b.id === id); await load(); }
  }

  async function setMode(id) {
    const prev = bot.permission; bot.permission = id; refreshPrompt();
    try { bot = { ...bot, ...(await client.call('bots.update', { id: bot.id, permission: id })) }; }
    catch (e) { bot.permission = prev; out(c.red(`  ✗ ${e.message}`)); }
    refreshPrompt();
  }

  async function showUsage() {
    out(c.gray('  Checking usage…'));
    block(usageLines(await client.call('usage.get')));
  }

  /** Every reset credit is its own entry; only available ones can be picked, and each use is confirmed. */
  async function pickReset() {
    out(c.gray('  Checking resets…'));
    const { credits } = await client.call('usage.resets');
    const usable = credits.filter((x) => x.redeemable);
    const others = credits.filter((x) => !x.redeemable);
    if (others.length) block(['', c.bold('Other resets'), ...others.map((x) => `  ${c.gray('○')} ${x.title}  ${c.gray(`${x.redeemedAt ? `used ${dateLabel(x.redeemedAt)}` : x.supported ? x.status : 'not supported by your plan'}`)}`)]);
    if (!usable.length) return out(c.gray('  No resets available right now.'));
    const id = await prompt.select({
      title: `Use a rate-limit reset (${usable.length} available)`, hint: 'enter to choose · esc to cancel',
      items: usable.map((x) => ({ label: x.title, desc: `expires ${dateLabel(x.expiresAt)} · granted ${dateLabel(x.grantedAt)}${x.description ? ` · ${x.description}` : ''}`, value: x.id })),
    });
    if (!id) return;
    const credit = usable.find((x) => x.id === id);
    const u = await client.call('usage.get').catch(() => null);
    const now = u?.windows.map((w) => `${w.label.toLowerCase()} ${w.usedPercent}%`).join(', ');
    out(c.yellow(`  Use "${credit.title}" now?${now ? ` You're at ${now}.` : ''} This can't be undone. Type y to confirm.`));
    if (!/^y/i.test((await prompt.ask('?')).trim())) return out(c.gray('  Kept your reset.'));
    const { usage } = await client.call('usage.redeem', { creditId: id });
    out(c.green(`  ✓ Reset used.`));
    if (usage) block(usageLines(usage));
  }

  async function command(line) {
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case 'help': case '?': return help();
      case 'exit': case 'quit': case 'q': return close();
      case 'bots': return pickBot();
      case 'switch': case 'open': return arg ? switchTo(arg) : pickBot();
      case 'new': {
        if (!arg) return out(c.red('Usage: /new <name>'));
        bot = await client.call('bots.create', { name: arg }); await load(); return;
      }
      case 'rename': if (!arg) return out(c.red('Usage: /rename <name>')); bot = await client.call('bots.update', { id: bot.id, name: arg }); return out(c.gray(`  Renamed to ${bot.name}`));
      case 'model': {
        if (!arg) return pickModel();
        bot = await client.call('bots.update', { id: bot.id, model: arg }); return out(c.gray(`  Model: ${bot.model}`));
      }
      case 'effort': {
        if (!arg) return pickEffort();
        bot = await client.call('bots.update', { id: bot.id, effort: arg }); return out(c.gray(`  Effort: ${bot.effort}`));
      }
      case 'mode': case 'permissions': {
        if (!arg) return pickMode();
        const id = state.permissions.find((m) => m.id === arg || m.label === arg)?.id;
        if (!id) return out(c.red(`  Modes: ${state.permissions.map((m) => m.id).join(' | ')}`));
        return setMode(id);
      }
      case 'verbose': verbose = !verbose; return out(c.gray(`  Live tool calls ${verbose ? 'on' : 'off'}`));
      case 'tools': {
        const calls = items.filter((m) => m.type === 'tool');
        if (arg) {
          const t = calls[Number(arg) - 1]; if (!t) return out(c.red('No such tool call.'));
          return block(['', `${c.bold(t.name)} ${c.gray(`#${arg} · ${t.status} · ${new Date(t.ts).toLocaleTimeString()}`)}`, c.gray('arguments'), JSON.stringify(t.args, null, 2), c.gray('result'), t.result ?? '(running…)', t.safety && !t.safety.safe ? c.yellow(`⚠ ${t.safety.reason}`) : '', '']);
        }
        if (!calls.length) return out(c.gray('  No tool calls yet.'));
        return block(['', ...calls.slice(-40).map((t, i, a) => `  ${c.gray(String(calls.length - a.length + i + 1).padStart(3))} ${t.status === 'ok' ? c.green('✓') : t.status === 'running' ? c.yellow('…') : c.red(t.status === 'denied' ? '⛔' : '✗')} ${c.bold(t.name)} ${c.gray(clipLine(t.summary, 70))}`), c.gray('  /tools <n> for details'), '']);
      }
      case 'schedules': {
        const { schedules } = await client.call('schedules.list', { botId: bot.id });
        if (!schedules.length) return out(c.gray('  No schedules. Ask the bot to schedule something.'));
        return block(['', ...schedules.map((s) => `  ${s.enabled ? c.green('●') : c.gray('○')} ${c.bold(s.name)}  ${c.gray(s.kind === 'cron' ? s.cron : s.kind === 'interval' ? `every ${s.everyMinutes}m` : s.at)}  ${c.gray(`next ${s.nextRun ? new Date(s.nextRun).toLocaleString() : '—'}`)}  ${c.gray(s.id)}`), '']);
      }
      case 'fast': case 'ultrafast': {
        if ((bot.provider || 'codex') !== 'codex') return out(c.gray('  Speed modes are only for ChatGPT models.'));
        const on = arg ? /^(on|1|true|yes)$/i.test(arg) : bot.speed !== cmd;
        bot = { ...bot, ...(await client.call('bots.update', { id: bot.id, speed: on ? cmd : 'normal' })) }; refreshPrompt();
        if (!on) return out(c.gray(`  ${cmd === 'fast' ? 'Fast' : 'Ultrafast'} mode off · normal speed`));
        return out(cmd === 'fast'
          ? `  ${c.rgb('#f5c04a', '⚡ Fast mode on')} ${c.gray('· faster replies (about 1.5–2x), uses more of your 5-hour and weekly limits')}`
          : `  ${c.rgb('#ff8a3d', '⚡⚡ Ultrafast mode on')} ${c.gray('· text arrives several times faster, but replies can wait 10s+ to start; uses more of your limits')}`);
      }
      case 'usage': return showUsage();
      case 'reset': case 'resets': return pickReset();
      case 'stop': await client.call('chat.stop', { botId: bot.id }); return;
      case 'skip': {
        const p = pending(); if (!p || p.type !== 'question') return out(c.gray('  Nothing to skip.'));
        return client.call('chat.answer', { botId: bot.id, itemId: p.id, dismissed: true, source: 'cli' });
      }
      case 'delete': {
        out(c.red(`  Delete ${bot.name} and all its history? Type y to confirm.`));
        const ok = /^y/i.test((await prompt.ask('?')).trim());
        if (!ok) return;
        await client.call('bots.delete', { id: bot.id });
        return;
      }
      default: return out(c.red(`Unknown command /${cmd}. Try /help.`));
    }
  }

  async function answer(p, line) {
    if (p.type === 'approval') {
      if (!/^(y|yes|n|no)$/i.test(line)) return out(c.gray('  Answer y or n.'));
      localEcho.add(`answered:${p.id}`);
      return client.call('chat.answer', { botId: bot.id, itemId: p.id, allow: /^y/i.test(line), source: 'cli' });
    }
    const idx = line.length === 1 ? LETTERS.indexOf(line.toUpperCase()) : -1;
    const text = idx >= 0 && p.options?.[idx] ? p.options[idx] : line;
    localEcho.add(`answered:${p.id}`);
    return client.call('chat.answer', { botId: bot.id, itemId: p.id, text, source: 'cli' });
  }

  let closed;
  const done = new Promise((r) => { closed = r; });
  const close = () => { if (spinTimer) clearInterval(spinTimer); prompt.stop(); closed(); };

  prompt.on('line', async (raw) => {
    const line = raw.trim();
    try {
      if (!line) return;
      if (/^\/[a-z?]/i.test(line)) return await command(line);
      const p = pending();
      if (p) return await answer(p, line);
      localEcho.add(line);
      await client.call('chat.send', { botId: bot.id, text: line, source: 'cli' });
    } catch (e) { localEcho.delete(line); out(c.red(`  ✗ ${e.message}`)); }
  });
  prompt.on('cycle', () => setMode(nextPermission(bot.permission || state.permissions[0].id)));
  prompt.on('escape', () => { if (status !== 'idle') client.call('chat.stop', { botId: bot.id }).catch(() => {}); });
  prompt.on('eof', close);
  prompt.on('sigint', async () => {
    if (status !== 'idle') { await client.call('chat.stop', { botId: bot.id }).catch(() => {}); return; }
    if (Date.now() - sigintAt < 2000) return close();
    sigintAt = Date.now(); out(c.gray('  (press Ctrl+C again to exit; your bots keep running)'));
  });
  client.onclose = () => { out(c.red('\nLost connection to the Minds host.')); close(); };

  prompt.start();
  await load();
  await done;
}
