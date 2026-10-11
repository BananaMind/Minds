import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MINDS_HOME } from './paths.js';

export const encodePowerShell = (script) => Buffer.from(script, 'utf16le').toString('base64');
export const powerShellArgs = (script) => ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)];
const psString = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** A per-user Startup shortcut needs no administrator access or stored password. */
export function windowsStartupScript({ executable, hostScript, dataHome, authFile }) {
  const launch = [
    "$ErrorActionPreference = 'Stop'",
    "$env:ELECTRON_RUN_AS_NODE = '1'",
    `$env:MINDS_HOME = ${psString(dataHome)}`,
    ...(authFile ? [`$env:MINDS_CODEX_AUTH = ${psString(authFile)}`] : []),
    `Start-Process -FilePath ${psString(executable)} -ArgumentList ${psString(`"${hostScript}"`)} -WorkingDirectory ${psString(path.win32.dirname(hostScript))} -WindowStyle Hidden`,
  ].join('\n');
  return [
    "$ErrorActionPreference = 'Stop'",
    "$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Minds host.lnk'",
    "$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)",
    "$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    `$shortcut.Arguments = ${psString(`-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encodePowerShell(launch)}`)}`,
    `$shortcut.WorkingDirectory = ${psString(path.win32.dirname(hostScript))}`,
    "$shortcut.Description = 'Start the Minds bot host when you sign in'",
    '$shortcut.Save()',
    'Write-Output $link',
  ].join('\n');
}

export function installWindowsAutostart(hostScript) {
  const script = windowsStartupScript({ executable: process.execPath, hostScript, dataHome: MINDS_HOME, authFile: process.env.MINDS_CODEX_AUTH });
  return execFileSync('powershell.exe', powerShellArgs(script), { windowsHide: true, encoding: 'utf8', timeout: 15000 }).trim();
}

export function uninstallWindowsAutostart() {
  const script = "$ErrorActionPreference = 'Stop'\n$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Minds host.lnk'\nif (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force }";
  execFileSync('powershell.exe', powerShellArgs(script), { windowsHide: true, timeout: 15000 });
}
