// Tool-call screening: OpenRouter safety model when connected, local heuristics always.
import os from 'node:os';
import path from 'node:path';
import { checkSafety } from './openrouter.js';
import { resolvePath } from './tools/util.js';
import { settingsFile, hostFile, identityFile, devicesFile, pluginsFile, codexAuthFile } from './paths.js';

const home = os.homedir();
const SECRET_PATHS = [
  /(^|\/)\.ssh(\/|$)/, /(^|\/)\.gnupg(\/|$)/, /(^|\/)\.aws\/credentials/, /(^|\/)\.codex\/auth\.json/,
  /(^|\/)\.minds\/settings\.json/, /(^|\/)\.minds\/host\.json/, /(^|\/)\.minds\/(identity|devices|plugins)\.json/, /(^|\/)\.netrc\b/, /login data|cookies\b|logins\.json|key[34]\.db/,
  /(^|\/)\.config\/(gh|rclone)\//, /(^|\/)\.git-credentials\b/,
  /(^|\/)\.azure\//, /(^|\/)\.kube\/config/, /(^|\/)\.cache\/huggingface\/(token|stored_tokens)\b/,
  /appdata\/(local|roaming)\/microsoft\/(credentials|vault|protect)\//,
  /appdata\/roaming\/(github cli|gh)\//,
];
const SYSTEM_WRITE = [/^\/(etc|usr|boot|bin|sbin|lib|lib64|opt|var\/lib|sys|proc)(\/|$)/, /(^|\/)\.(bashrc|zshrc|profile|bash_profile|zprofile)$/, /(^|\/)\.config\/autostart\//, /(^|\/)\.config\/systemd\//, /\/etc\/cron/];
const DANGEROUS_CMD = [
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~|\$HOME|\*|\.\s|\.$)/, 'recursive delete of a broad path'],
  [/\bmkfs(\.\w+)?\b|\bdd\b[^|;]*\bof=\/dev\//, 'writes to a disk device'],
  [/:\(\)\s*\{.*\};\s*:/, 'fork bomb'],
  [/\b(curl|wget)\b[^|;]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, 'pipes a remote script into a shell'],
  [/\bsudo\b|\bsu\s+-|\bdoas\b/, 'privilege escalation'],
  [/\b(shutdown|reboot|poweroff|halt)\b|systemctl\s+(poweroff|reboot|halt)/, 'shuts down the machine'],
  [/\bchmod\s+-R\s+[0-7]*7[0-7]*\s+\//, 'recursive permission change on /'],
  [/\b(crontab|systemctl\s+(--user\s+)?(enable|edit)|launchctl\s+load)\b/, 'installs persistence'],
  [/>\s*\/dev\/(sd|nvme|disk)/, 'writes to a disk device'],
  [/\b(format(?:\.com)?\s+[a-z]:|format-volume|format-disk|clear-disk|diskpart(?:\.exe)?)\b/i, 'formats or modifies a disk'],
  [/\b(?:remove-item|ri|rm|rmdir|rd|del|erase)\b[^;\r\n]*(?:[a-z]:[\\/](?=[\s"'*]|$)|\$(?:env:)?(?:userprofile|home)\b|%(?:userprofile|systemroot)%|["']?~["']?(?:\s|$)|[\\/]windows[\\/]|[\\/]users[\\/]|(?:^|\s)["']?\*["']?(?:\s|$))/i, 'deletes a broad Windows path'],
  [/\b(?:invoke-webrequest|invoke-restmethod|iwr|irm|curl|wget)\b[^;\r\n]*\|\s*(?:invoke-expression|iex)\b/i, 'executes a remote PowerShell script'],
  [/\bstart-process\b[^;\r\n]*-verb\s+["']?runas\b|\brunas(?:\.exe)?\b/i, 'requests Windows administrator privileges'],
  [/\b(?:reg(?:\.exe)?\s+(?:add|delete|import)|schtasks(?:\.exe)?\s+\/create|register-scheduledtask|new-service|set-executionpolicy)\b/i, 'changes Windows system configuration or startup'],
];

const normalizePath = (s) => String(s).replaceAll('\\', '/').toLowerCase();
const touchesSecret = (s) => {
  const normalized = normalizePath(s);
  return SECRET_PATHS.some((re) => re.test(normalized)) || [settingsFile(), hostFile(), identityFile(), devicesFile(), pluginsFile(), codexAuthFile()].some((file) => normalized.includes(normalizePath(file)));
};
const windowsSystemFile = (s) => /(?:^|\/)(?:[a-z]:|[a-z]\$)\/(windows|program files(?: \(x86\))?|programdata)(\/|$)/.test(normalizePath(s)) || /\/microsoft\/windows\/start menu\/programs\/startup(\/|$)|\/(windowspowershell|powershell)\/[^/]*profile\.ps1$/.test(normalizePath(s));

function inside(dir, file) {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Local rules. Returns {hard, reason} or null. `hard` = ask even if the model says safe. */
export function heuristic(ctx, tool, args) {
  try {
    if (tool === 'exec_command') {
      let cmd = String(args.command || '').replaceAll('~', home);
      // Screen the content too when PowerShell's encoded form is used.
      const encoded = cmd.match(/-(?:encodedcommand|enc)\s+["']?([A-Za-z0-9+/=]+)/i);
      if (encoded) cmd += `\n${Buffer.from(encoded[1], 'base64').toString('utf16le')}`;
      if (touchesSecret(cmd)) return { hard: true, reason: 'Command touches credential or key files.' };
      for (const [re, why] of DANGEROUS_CMD) if (re.test(cmd)) return { hard: false, reason: `Command ${why}.` };
    } else if (tool === 'read_file') {
      const f = resolvePath(ctx, args.path);
      if (touchesSecret(f)) return { hard: true, reason: 'Reads a credential or key file.' };
    } else if (tool === 'write_file' || tool === 'edit_file') {
      const f = resolvePath(ctx, args.path);
      if (touchesSecret(f)) return { hard: true, reason: 'Modifies a credential or key file.' };
      if (SYSTEM_WRITE.some((re) => re.test(f)) || windowsSystemFile(f)) return { hard: false, reason: 'Modifies a system or shell startup file.' };
    }
  } catch { /* path resolution errors surface in the tool itself */ }
  return null;
}

const insideWorkspace = (ctx, p) => { try { return inside(ctx.workspace, resolvePath(ctx, p)); } catch { return false; } };

/** Does this call change things (or reach outside the workspace)? Those are what "ask" mode asks about. */
function actsOnWorld(ctx, tool, args) {
  if (tool === 'ask_user_question') return false;
  if (tool === 'schedule') return args.action === 'create' || args.action === 'delete';
  if (tool === 'read_file') return !insideWorkspace(ctx, args.path);
  return true;
}

function needsReview(ctx, tool, args) {
  if (tool === 'ask_user_question') return false;
  if (tool === 'schedule') return args.action === 'create';
  if (tool === 'read_file') return !insideWorkspace(ctx, args.path);
  return true;
}

/**
 * -> {action: 'allow'|'ask', safety: {source, safe, risk, reason}}
 * mode: 'default' (screen, ask if flagged) | 'ask' (ask for every action) | 'bypass' (no checks)
 */
export async function review(ctx, tool, args, { mode, openrouterKey, userIntent }) {
  const skip = { action: 'allow', safety: { source: 'skipped', safe: true } };
  if (mode === 'bypass') return skip;
  const app = ctx.host?.plugins?.meta?.(tool);
  if (app) {
    // App tools: reads run freely; anything that changes things asks, unless the user trusted this app's changes.
    if (app.access !== 'write') return skip;
    if (mode === 'ask') return { action: 'ask', safety: { source: 'permission-mode', safe: true, risk: 'unknown', reason: `${app.pluginName}: this bot asks before every action.` } };
    if (!app.autoApprove) return { action: 'ask', safety: { source: 'plugin', safe: true, risk: 'unknown', reason: `${app.pluginName} wants to make a change. Turn on “Allow changes without asking” for this app in Connect apps to skip this.` } };
    if (openrouterKey) {
      try {
        const v = await checkSafety(openrouterKey, { tool, args, workspace: ctx.workspace, userIntent });
        if (!v.safe) return { action: 'ask', safety: { source: 'jev', safe: false, risk: v.risk, reason: v.reason } };
        return { action: 'allow', safety: { ...v, source: 'jev' } };
      } catch { /* fall through: trusted app, screening unavailable */ }
    }
    return skip;
  }
  if (mode === 'ask') {
    if (!actsOnWorld(ctx, tool, args)) return skip;
    const h = heuristic(ctx, tool, args);
    return { action: 'ask', safety: { source: 'permission-mode', safe: !h, risk: h ? 'high' : 'unknown', reason: h?.reason || 'This bot asks before every action.' } };
  }
  if (!needsReview(ctx, tool, args)) return skip;
  const h = heuristic(ctx, tool, args);
  let verdict = null;
  if (openrouterKey) {
    try { verdict = { ...(await checkSafety(openrouterKey, { tool, args, workspace: ctx.workspace, userIntent })), source: 'jev' }; } catch (e) { verdict = { source: 'jev-unavailable', error: e.message }; }
  }
  const flagged = h?.hard || (verdict?.source === 'jev' ? !verdict.safe : Boolean(h));
  if (!flagged) return { action: 'allow', safety: verdict?.source === 'jev' ? verdict : { source: 'heuristic', safe: true, risk: 'low' } };
  const reason = [verdict?.source === 'jev' && !verdict.safe ? verdict.reason : null, h?.reason].filter(Boolean).join(' ') || 'Flagged as risky.';
  return { action: 'ask', safety: { source: verdict?.source === 'jev' ? 'jev' : 'heuristic', safe: false, risk: verdict?.risk || 'high', reason } };
}
