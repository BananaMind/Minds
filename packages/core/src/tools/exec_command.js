import { spawn } from 'node:child_process';
import { resolvePath, clip } from './util.js';
import { powerShellArgs } from '../windows.js';

export default {
  name: 'exec_command',
  description:
    'Run a shell command on the host PC and return its combined stdout/stderr and exit code. Runs in the bot workspace unless `cwd` is given. Commands are non-interactive (no stdin). Long-running servers should be started detached and redirected to a log file.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run.' },
      cwd: { type: 'string', description: 'Working directory (default: bot workspace).' },
      timeout_seconds: { type: 'number', description: 'Kill after this many seconds (default 120, max 900).' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  summarize: (a) => a.command,
  run(ctx, { command, cwd, timeout_seconds }) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('command is required');
    const timeoutMs = Math.min(Math.max(Number(timeout_seconds) || 120, 1), 900) * 1000;
    const win = process.platform === 'win32';
    const [sh, shArgs] = win ? ['powershell.exe', powerShellArgs(`[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$OutputEncoding = [Console]::OutputEncoding\n${command}`)] : ['/bin/bash', ['-lc', command]];
    return new Promise((resolve) => {
      const child = spawn(sh, shArgs, {
        cwd: cwd ? resolvePath(ctx, cwd) : ctx.workspace,
        env: { ...process.env, MINDS_BOT: ctx.bot.name, TERM: 'dumb', CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !win,
        windowsHide: true,
      });
      let out = '', killed = false, finished = false;
      const add = (d) => { out += d; if (out.length > 400000) out = out.slice(-300000); };
      child.stdout.on('data', add); child.stderr.on('data', add);
      const kill = () => {
        if (!child.pid) return;
        try {
          if (win) {
            const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.on('error', () => { try { child.kill(); } catch {} });
            killer.on('exit', (code) => { if (code !== 0) { try { child.kill(); } catch {} } });
          } else process.kill(-child.pid, 'SIGKILL');
        } catch { try { child.kill(); } catch {} }
      };
      const timer = setTimeout(() => { killed = 'timeout'; kill(); }, timeoutMs);
      const onAbort = () => { killed = 'aborted'; kill(); };
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
      const finish = (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer); ctx.signal?.removeEventListener('abort', onAbort);
        const note = killed === 'timeout' ? `\n[killed: exceeded ${timeoutMs / 1000}s timeout]` : killed === 'aborted' ? '\n[stopped by user]' : '';
        resolve(`${clip(out)}${note}\n[exit code: ${code ?? 'null'}]`);
      };
      child.on('error', (e) => finish(`spawn error: ${e.message}`));
      child.on('close', finish);
    });
  },
};
