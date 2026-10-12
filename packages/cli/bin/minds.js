#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MindsClient, hostAlive, readHostInfo, MINDS_HOME, installWindowsAutostart, uninstallWindowsAutostart, launchAgentPlist } from '@bananamind/minds-core';
import { runChat } from '../src/chat.js';
import { pick } from '../src/pick.js';
import { c, botLine, glyph, md, clipLine } from '../src/render.js';
import QRCode from 'qrcode';
import { installRequest } from '../src/apps.js';

const [cmd = 'chat', ...args] = process.argv.slice(2);
const die = (m, code = 1) => { console.error(c.red(m)); process.exit(code); };
const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a.trim()); }); });

const HELP = `${c.bold('minds')} — your bots, from the terminal

  ${c.cyan('minds')} [chat] [bot]          open a chat (picks a bot if several)
  ${c.cyan('minds say')} <bot> <message…>  send one message, wait for the reply, print it
  ${c.cyan('minds bots')}                  list bots
  ${c.cyan('minds new')} <name>            create a bot
  ${c.cyan('minds tools')} <bot>           every tool call the bot made
  ${c.cyan('minds schedules')}             all schedules
  ${c.cyan('minds login')}                 sign in with ChatGPT
  ${c.cyan('minds config')} [key] [value]  show / set: openrouter-key, name, model, effort, permission
  ${c.cyan('minds apps')} [connect|disconnect|enable|disable|search|install|refresh|remove|tools]   built-in and community apps
  ${c.cyan('minds phone')} [on|off|pair|log|revoke <name>]   phone access (P2P, encrypted)
  ${c.cyan('minds daemon')} start|stop|status|install|uninstall
`;


/** Prompt without echoing what is typed (for tokens and secrets). */
const askHidden = (q) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl.output;
  rl._writeToOutput = (str) => { if (str.includes(q)) out.write(str); else if (/[\r\n]/.test(str)) out.write(str); };
  rl.question(q, (a) => { rl.close(); out.write('\n'); resolve(a.trim()); });
});

/** --key value / --flag parser; repeated keys become arrays. */
function parseFlags(list) {
  const flags = {}, rest = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) {
      const key = a.slice(2); const next = list[i + 1];
      const val = next === undefined || next.startsWith('--') ? true : (i++, next);
      flags[key] = key in flags ? [].concat(flags[key], val) : val;
    } else rest.push(a);
  }
  return { flags, rest };
}

function findBot(state, q) {
  if (!q) return null;
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && state.bots[n - 1]) return state.bots[n - 1];
  const s = q.toLowerCase();
  return state.bots.find((b) => b.name.toLowerCase() === s) || state.bots.find((b) => b.name.toLowerCase().startsWith(s)) || state.bots.find((b) => b.id === q);
}

async function daemon() {
  const sub = args[0] || 'status';
  const bin = fileURLToPath(import.meta.resolve('@bananamind/minds-core/mindsd'));
  if (sub === 'start') {
    const { ensureHost } = await import('@bananamind/minds-core');
    const i = await ensureHost(); return console.log(c.green(`Minds host running`) + c.gray(` (pid ${i.pid}, port ${i.port})`));
  }
  if (sub === 'status') {
    const i = readHostInfo();
    return console.log((await hostAlive(i)) ? `${c.green('● running')} ${c.gray(`pid ${i.pid} · port ${i.port} · data ${MINDS_HOME}`)}` : `${c.red('○ stopped')} ${c.gray('(start with: minds daemon start)')}`);
  }
  if (sub === 'stop') {
    if (!(await hostAlive())) return console.log(c.gray('Host is not running.'));
    const cl = await MindsClient.connect({ autostart: false }); await cl.call('host.shutdown'); return console.log('Host stopped. Scheduled tasks pause until it runs again.');
  }
  if (sub === 'install' || sub === 'uninstall') {
    if (process.platform === 'win32') {
      if (sub === 'uninstall') { uninstallWindowsAutostart(); return console.log('Removed Windows sign-in startup.'); }
      installWindowsAutostart(bin);
      const { ensureHost } = await import('@bananamind/minds-core');
      await ensureHost();
      return console.log(c.green('Installed.') + ' The host now starts in the background when you sign in to Windows.');
    }
    if (process.platform === 'linux') {
      const dir = path.join(os.homedir(), '.config/systemd/user'), file = path.join(dir, 'minds.service');
      if (sub === 'uninstall') { try { execFileSync('systemctl', ['--user', 'disable', '--now', 'minds.service'], { stdio: 'inherit' }); } catch {} fs.rmSync(file, { force: true }); return console.log('Removed autostart.'); }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `[Unit]\nDescription=Minds host (your AI bots)\nAfter=network-online.target\n\n[Service]\nExecStart=${process.execPath} ${bin}\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`);
      try {
        if (await hostAlive()) { const cl = await MindsClient.connect({ autostart: false }); await cl.call('host.shutdown'); await new Promise((r) => setTimeout(r, 800)); }
        execFileSync('systemctl', ['--user', 'daemon-reload']); execFileSync('systemctl', ['--user', 'enable', '--now', 'minds.service'], { stdio: 'inherit' });
        console.log(c.green('Installed.') + ' The host now starts at login and restarts if it crashes.');
        console.log(c.gray('Tip: `loginctl enable-linger $USER` keeps it running even when you are logged out.'));
      } catch (e) { console.log(`Wrote ${file}, but systemctl failed: ${e.message}\nRun: systemctl --user enable --now minds.service`); }
      return;
    }
    if (process.platform === 'darwin') {
      const file = path.join(os.homedir(), 'Library/LaunchAgents/dev.minds.host.plist');
      const domain = `gui/${process.getuid()}`;
      try { execFileSync('launchctl', ['bootout', `${domain}/dev.minds.host`], { stdio: 'ignore' }); } catch {}
      if (sub === 'uninstall') { fs.rmSync(file, { force: true }); return console.log('Removed autostart.'); }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, launchAgentPlist({ executable: process.execPath, hostScript: bin, dataHome: MINDS_HOME, authFile: process.env.MINDS_CODEX_AUTH }), { mode: 0o600 });
      try {
        if (await hostAlive()) {
          const cl = await MindsClient.connect({ autostart: false });
          try { await cl.call('host.shutdown'); } finally { cl.close(); }
          await new Promise((r) => setTimeout(r, 800));
        }
        execFileSync('launchctl', ['bootstrap', domain, file]);
        console.log(c.green('Installed.') + ' The host now starts at login and restarts if it crashes.');
      } catch (e) { die(`Wrote ${file}, but launchctl failed: ${e.message}`); }
      return;
    }
    return die('Autostart install is supported on Windows, Linux (systemd), and macOS.');
  }
  die(`Unknown daemon command "${sub}". Use start|stop|status|install|uninstall.`);
}

async function main() {
  if (['help', '-h', '--help'].includes(cmd)) return console.log(HELP);
  if (cmd === 'daemon') return daemon();
  const client = await MindsClient.connect().catch((e) => die(e.message));
  const done = (code = 0) => { client.close(); process.exit(code); };
  const state = await client.call('state');

  switch (cmd) {
    case 'chat': case 'open': {
      if (!process.stdin.isTTY) die('`minds chat` needs an interactive terminal. Use `minds say <bot> <message>` for scripts.');
      let bot = findBot(state, args.join(' '));
      if (args.length && !bot) die(`No bot "${args.join(' ')}". Try: minds bots`);
      if (!bot) {
        if (!state.bots.length) {
          console.log(c.bold('Welcome to Minds.') + ' Let\'s make your first bot.');
          const name = await ask('Name your bot: ');
          if (!name) return done();
          bot = await client.call('bots.create', { name });
        } else if (state.bots.length === 1) bot = state.bots[0];
        else {
          const id = await pick('Which bot?', state.bots.map((b) => ({ value: b.id, label: `${botLine(b)}${b.unread ? c.blue('  ●') : ''}${b.status !== 'idle' ? c.yellow(`  ${b.status}`) : ''}`, plain: b.name })));
          if (!id) return done();
          bot = state.bots.find((b) => b.id === id);
        }
      }
      await runChat(client, bot);
      return done();
    }

    case 'bots': {
      if (!state.bots.length) return console.log(c.gray('No bots yet. Create one with: minds new <name>')), done();
      state.bots.forEach((b, i) => console.log(`${c.gray(String(i + 1).padStart(2))} ${botLine(b)}${b.status !== 'idle' ? c.yellow(`  ${b.status}`) : ''}${b.unread ? c.blue('  ●') : ''}  ${c.gray(clipLine(b.last?.text || '', 50))}`));
      return done();
    }

    case 'new': {
      const name = args.join(' ').trim() || await ask('Name your bot: ');
      if (!name) die('A bot needs a name.');
      const b = await client.call('bots.create', { name });
      console.log(`Created ${botLine(b)}`); return done();
    }

    case 'say': {
      const bot = findBot(state, args[0]); const text = args.slice(1).join(' ').trim();
      if (!bot || !text) die('Usage: minds say <bot> <message…>');
      let exit = 0, finished;
      const settled = new Promise((r) => { finished = r; });
      client.on((e, d) => {
        if (d?.botId !== bot.id && d?.bot?.id !== bot.id) return;
        if (e === 'message.added' && d.item.type === 'assistant' && !d.item.interim) console.log(md(d.item.text).join('\n'));
        if (e === 'message.added' && d.item.type === 'notice' && d.item.level === 'error') { console.error(c.red(d.item.text)); exit = 1; }
        if (e === 'message.added' && d.item.type === 'question' && d.item.status === 'pending') {
          console.error(c.yellow(`\n${bot.name} asks: ${d.item.question}`) + (d.item.options?.length ? '\n' + d.item.options.map((o, i) => `  ${'ABCDEFGH'[i]}. ${o}`).join('\n') : ''));
          console.error(c.gray('Answer in `minds chat` or the app.')); exit = 2; finished();
        }
        if (e === 'message.added' && d.item.type === 'approval' && d.item.status === 'pending') { console.error(c.yellow(`${bot.name} needs approval: ${d.item.tool} ${d.item.summary}`)); exit = 2; finished(); }
        if (e === 'bot.updated' && d.bot.status === 'idle' && sent) finished();
      });
      let sent = false;
      await client.call('chat.send', { botId: bot.id, text, source: 'cli' }).catch((e) => die(e.message));
      sent = true;
      setTimeout(() => client.call('state').then((s) => s.bots.find((b) => b.id === bot.id)?.status === 'idle' && finished()).catch(() => {}), 1500);
      await settled; return done(exit);
    }

    case 'tools': {
      const bot = findBot(state, args.join(' ')) || (state.bots.length === 1 ? state.bots[0] : null);
      if (!bot) die('Usage: minds tools <bot>');
      const { items } = await client.call('tools.log', { botId: bot.id, limit: 100 });
      for (const t of items.filter((i) => i.type === 'tool')) console.log(`${c.gray(new Date(t.ts).toLocaleString())} ${t.status === 'ok' ? c.green('✓') : t.status === 'denied' ? c.red('⛔') : c.red('✗')} ${c.bold(t.name)} ${c.gray(clipLine(t.summary, 80))}`);
      return done();
    }

    case 'schedules': {
      const { schedules } = await client.call('schedules.list', {});
      if (!schedules.length) console.log(c.gray('No schedules.'));
      for (const s of schedules) { const b = state.bots.find((x) => x.id === s.botId); console.log(`${s.enabled ? c.green('●') : c.gray('○')} ${b ? glyph(b.icon) + ' ' + b.name : '?'}  ${c.bold(s.name)}  ${c.gray(s.kind === 'cron' ? s.cron : s.kind === 'interval' ? `every ${s.everyMinutes}m` : s.at)}  ${c.gray(`next ${s.nextRun ? new Date(s.nextRun).toLocaleString() : '—'}`)}`); }
      return done();
    }

    case 'login': {
      if (state.auth.signedIn) console.log(c.gray(`Already signed in${state.auth.email ? ` as ${state.auth.email}` : ''}. Starting a fresh sign-in…`));
      console.log('Opening the ChatGPT sign-in in your browser…');
      await client.call('auth.login');
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const a = await client.call('auth.status');
        if (a.signedIn && (!state.auth.signedIn || a.email !== state.auth.email || i > 2)) return console.log(c.green(`Signed in${a.email ? ` as ${a.email}` : ''}.`)), done();
      }
      die('Timed out waiting for sign-in.');
    }

    case 'apps': {
      const sub = args[0] || 'list';
      const { flags, rest } = parseFlags(args.slice(1));
      const { plugins } = await client.call('plugins.list');
      const find = (q) => plugins.find((p) => p.id === q || p.name.toLowerCase() === String(q).toLowerCase()) || plugins.find((p) => p.name.toLowerCase().startsWith(String(q).toLowerCase()));
      const need = (q) => find(q) || die(`No app "${q}". Try: minds apps`);
      const wait = async (id, what) => {
        for (let i = 0; i < 150; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const p = (await client.call('plugins.list')).plugins.find((x) => x.id === id);
          if (p.connected && !p.signingIn) return p;
          if (p.error) die(p.error);
        }
        die(`Timed out waiting for ${what}.`);
      };

      if (sub === 'list') {
        for (const p of plugins) {
          const on = state.bots.filter((b) => (b.plugins || []).includes(p.id)).map((b) => b.name);
          console.log(`${p.connected ? c.green('●') : p.needsReauth ? c.yellow('●') : c.gray('○')} ${c.bold(p.name.padEnd(16))} ${c.gray(p.id.padEnd(14))} ${p.needsReauth ? c.yellow('reconnect needed') : p.connected ? (p.account || p.detail || 'connected') : c.gray('not connected')}${on.length ? c.gray(`  · bots: ${on.join(', ')}`) : ''}`);
        }
        console.log(c.gray('\nConnect: minds apps connect github   ·   Give a bot access: minds apps enable github "My Bot"'));
        return done();
      }

      if (sub === 'connect') {
        const p = need(rest[0]);
        if (p.kind === 'mcp') die('Community apps are connected when installed. Use: minds apps install');
        if (p.setup?.steps?.length) { console.log(c.bold(`\nSetting up ${p.name}`)); p.setup.steps.forEach((st, i) => console.log(`  ${i + 1}. ${st.text}${st.link ? c.gray(`\n     ${st.link}`) : ''}`)); console.log(); }
        if (p.setup?.oauth) {
          const fields = { clientId: flags['client-id'], clientSecret: flags['client-secret'], mode: flags.mode };
          if (!fields.clientId && !p.connected && !p.needsReauth) fields.clientId = await ask('OAuth client ID: ');
          if (!fields.clientSecret && !p.connected && !p.needsReauth) fields.clientSecret = await askHidden('OAuth client secret: ');
          if (!fields.mode && !p.needsReauth) fields.mode = /^f/i.test(await ask('Access: read-only or full (read, send, organize)? [readonly/full] ')) ? 'full' : 'readonly';
          const { url } = await client.call('plugins.oauthStart', { id: p.id, fields });
          console.log(`Opening your browser to sign in. If it didn't open, visit:\n${c.cyan(url)}\n`);
          const r = await wait(p.id, 'sign-in'); console.log(c.green(`Connected${r.account ? ` as ${r.account}` : ''}.`)); return done();
        }
        let fields = {};
        if (flags.import) { const r = await client.call('plugins.importLocal', { id: p.id }); console.log(c.green(`Imported your existing login${r.account ? ` (${r.account})` : ''}.`)); return done(); }
        for (const f of flags.public && p.setup?.publicOk ? [] : p.setup?.fields || []) {
          const v = flags[f.key] !== undefined ? flags[f.key] : (f.secret ? await askHidden(`${f.label}${f.required ? '' : ' (Enter to skip)'}: `) : await ask(`${f.label}${f.required ? '' : ' (Enter to skip)'}: `));
          if (v && v !== true) fields[f.key] = v;
        }
        const r = await client.call('plugins.connect', { id: p.id, fields });
        console.log(c.green(`Connected${r.account ? ` as ${r.account}` : r.detail ? ` — ${r.detail}` : ''}.`)); return done();
      }

      if (sub === 'disconnect') { const p = need(rest[0]); await client.call('plugins.disconnect', { id: p.id }); console.log(`Disconnected ${p.name}.`); return done(); }

      if (sub === 'enable' || sub === 'disable') {
        const p = need(rest[0]); const bot = findBot(state, rest.slice(1).join(' ')) || die('Usage: minds apps enable <app> <bot>');
        if (sub === 'enable' && !p.connected) die(`${p.name} is not connected yet. Run: minds apps connect ${p.id}`);
        await client.call('plugins.setBotAccess', { botId: bot.id, id: p.id, enabled: sub === 'enable' });
        console.log(`${bot.name} ${sub === 'enable' ? 'can now use' : 'can no longer use'} ${p.name}.`); return done();
      }

      if (sub === 'tools') {
        const p = need(rest[0]);
        for (const t of p.tools) console.log(`${t.enabled ? c.green('●') : c.gray('○')} ${c.bold(t.title.padEnd(34))} ${t.access === 'write' ? c.yellow('changes things') : c.gray('read only')}  ${c.gray(clipLine(t.description, 70))}`);
        return done();
      }

      if (sub === 'search') {
        const { results } = await client.call('plugins.registry', { q: rest.join(' ') });
        if (!results.length) console.log(c.gray('Nothing found.'));
        results.forEach((e, i) => console.log(`${c.gray(String(i + 1).padStart(2))} ${c.bold(e.title)}  ${c.gray(e.name)}\n   ${clipLine(e.description, 100)}\n   ${c.gray(e.options.map((o) => o.label).join('  |  '))}`));
        if (results.length) console.log(c.gray(`\nInstall: minds apps install ${results[0].name}`));
        return done();
      }

      if (sub === 'refresh') {
        const p = need(rest[0]);
        const fields = {};
        for (const f of p.setup?.fields || []) if (flags[f.key] !== undefined) fields[f.key] = flags[f.key];
        const r = await client.call('plugins.refresh', { id: p.id, fields });
        if (r.error) die(r.error);
        console.log(c.green(`Reconnected ${r.name} (${r.tools.length} tools).`)); return done();
      }

      if (sub === 'install') {
        const target = rest.join(' ').trim(); if (!target) die('Usage: minds apps install <registry-name | "command …" | https://url | folder | git-url> [--source registry|command|url|folder|git] [--env K=V] [--header "Name: value"] [--yes]');
        const req = installRequest(target, flags);
        if (req.source === 'registry') {
          const { results } = await client.call('plugins.registry', { q: target });
          const e = results.find((x) => x.name === target) || die(`"${target}" was not found in the registry. Try: minds apps search <word>`);
          const oi = flags.option ? Number(flags.option) - 1 : 0; const o = e.options[oi] || die('No such option.');
          console.log(`${c.bold(e.title)} — ${e.description}\nWill use: ${c.cyan(o.label)}`);
          for (const f of o.fields) { const v = flags[f.label] ?? flags[f.key] ?? (f.secret ? await askHidden(`${f.label}${f.default !== undefined ? ` [${f.default}]` : f.required ? '' : ' (Enter to skip)'}: `) : await ask(`${f.label}${f.default !== undefined ? ` [${f.default}]` : f.required ? '' : ' (Enter to skip)'}: `)); if (v && v !== true) req.values[f.key] = v; }
          req.option = oi;
        } else console.log(`Will install: ${c.cyan(req.command || req.url || req.path)}`);
        console.log(c.yellow('Community apps run code on your computer or connect to a third-party server, with the access you give them.'));
        if (!flags.yes && !/^y/i.test(await ask('Do you trust it? (y/N) '))) return console.log('Cancelled.'), done();
        console.log(c.gray('Installing… (first run can take a minute)'));
        const r = await client.call('plugins.install', { ...req, confirmed: true });
        console.log(c.green(`Installed ${r.name} (${r.tools.length} tools).`) + c.gray(`  Give a bot access: minds apps enable ${r.id} "<bot>"`)); return done();
      }

      if (sub === 'remove') { const p = need(rest[0]); await client.call('plugins.uninstall', { id: p.id }); console.log(`Removed ${p.name}.`); return done(); }
      die('Usage: minds apps [list|connect <app>|disconnect <app>|enable <app> <bot>|disable <app> <bot>|tools <app>|search <q>|install <what>|refresh <app>|remove <app>]');
    }

    case 'phone': {
      const sub = args[0] || 'status';
      const ago = (t) => (t ? new Date(t).toLocaleString() : 'never');
      const show = (m) => {
        console.log(`${m.enabled ? c.green('● phone access on') : c.gray('○ phone access off')}  ${c.gray(`host id ${m.hostId.slice(0, 8)}`)}`);
        if (!m.devices.length) console.log(c.gray('  no phones paired'));
        for (const d of m.devices) console.log(`  ${d.online ? c.green('●') : c.gray('○')} ${c.bold(d.name)}  ${c.gray(d.online ? 'connected' : `last seen ${ago(d.lastSeen)}`)}`);
      };
      if (sub === 'status') { show(await client.call('mobile.status')); return done(); }
      if (sub === 'log') { const { log } = await client.call('mobile.log'); console.log(log.length ? log.join('\n') : c.gray('No connection events yet.')); return done(); }
      if (sub === 'on' || sub === 'off') { show(await client.call('mobile.setEnabled', { enabled: sub === 'on' })); return done(); }
      if (sub === 'revoke') {
        const q = args.slice(1).join(' ').toLowerCase(); const m = await client.call('mobile.status');
        const d = m.devices.find((x) => x.name.toLowerCase() === q || x.id.startsWith(q)) || m.devices.find((x) => x.name.toLowerCase().includes(q));
        if (!q || !d) die('Usage: minds phone revoke <name>   (see: minds phone)');
        await client.call('mobile.revoke', { deviceId: d.id }); console.log(`Removed ${d.name}.`); return done();
      }
      if (sub === 'pair') {
        if (!(await client.call('mobile.status')).enabled) { await client.call('mobile.setEnabled', { enabled: true }); console.log(c.gray('Phone access turned on.')); }
        const { id, payload, expiresAt } = await client.call('mobile.pair.start');
        console.log('\nOn your phone: Minds → Scan QR code. Works once, expires in 5 minutes.\n');
        console.log(await QRCode.toString(payload, { type: 'terminal', small: true, errorCorrectionLevel: 'L' }));
        console.log(c.gray(`Or paste this code in the app:\n${payload}\n`));
        console.log(c.gray('Waiting for the phone…'));
        let finished, handling = false;
        const over = new Promise((r) => { finished = r; });
        client.on(async (e, d) => {
          if (e !== 'mobile.pairing' || d.id !== id) return;
          handling = true;
          const ok = /^y/i.test(await ask(c.yellow(`\nPair "${d.deviceName}"? It will be able to chat with your bots. (y/N) `)));
          await client.call('mobile.pair.respond', { id, allow: ok }).catch(() => {});
          console.log(ok ? c.green(`Paired ${d.deviceName}.`) : c.gray('Declined.')); finished();
        });
        // The code can also expire or be cancelled elsewhere.
        const poll = setInterval(async () => { if (handling) return; const m = await client.call('mobile.status').catch(() => null); if (m && !m.pairing) { console.log(c.gray('Pairing code is no longer active.')); finished(); } }, 4000);
        over.then(() => clearInterval(poll));
        await over; return done();
      }
      die('Usage: minds phone [status|on|off|pair|revoke <name>]');
    }

    case 'config': {
      const map = { 'openrouter-key': 'openrouterKey', name: 'userName', model: 'defaultModel', effort: 'defaultEffort', permission: 'defaultPermission' };
      const [k, ...v] = args;
      if (!k) {
        const s = state.settings;
        console.log(`name            ${s.userName}\nmodel (new)     ${s.defaultModel}\neffort (new)    ${s.defaultEffort}\npermission (new) ${s.defaultPermission}\nopenrouter-key  ${s.openrouterConnected ? c.green('connected') : c.gray('not set')}\nchatgpt         ${state.auth.signedIn ? c.green(`signed in${state.auth.email ? ' · ' + state.auth.email : ''}`) : c.gray('not signed in (minds login)')}`);
        return done();
      }
      if (!map[k]) die(`Unknown setting "${k}". Options: ${Object.keys(map).join(', ')}`);
      const val = v.join(' ').trim() || (k === 'openrouter-key' ? '' : die(`Usage: minds config ${k} <value>`));
      await client.call('settings.set', { patch: { [map[k]]: val } });
      console.log(c.green('Saved.') + (k === 'openrouter-key' && !val ? ' (key removed)' : '')); return done();
    }

    default: console.log(HELP); return done(1);
  }
}

main().catch((e) => die(e.message));
