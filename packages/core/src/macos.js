import path from 'node:path';

const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function launchAgentPlist({ executable, hostScript, dataHome, authFile, searchPath = process.env.PATH }) {
  const env = { ELECTRON_RUN_AS_NODE: '1', MINDS_HOME: dataHome, PATH: searchPath || '/usr/bin:/bin:/usr/sbin:/sbin', ...(authFile ? { MINDS_CODEX_AUTH: authFile } : {}) };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>dev.minds.host</string>
<key>ProgramArguments</key><array><string>${xml(executable)}</string><string>${xml(hostScript)}</string></array>
<key>WorkingDirectory</key><string>${xml(path.dirname(hostScript))}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
</dict></plist>
`;
}
