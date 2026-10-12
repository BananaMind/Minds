// Build an isolated production app so Electron's installer includes the workspace dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = path.join(root, 'release', 'desktop-stage');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.join(root, 'packages/core/package.json'), 'utf8'));

const target = process.argv.includes('--linux') ? 'linux' : process.argv.includes('--mac') ? 'mac' : 'win';
const platforms = { linux: 'linux', mac: 'darwin', win: 'win32' };
const output = { linux: 'linux', mac: 'macos', win: 'windows' };
if (process.platform !== platforms[target]) throw new Error(`Build on ${platforms[target]}: npm run desktop:${target}.`);
if (!['x64', 'arm64'].includes(process.arch) || (target === 'win' && process.arch !== 'x64')) throw new Error('Use a supported x64 or arm64 build machine (Windows installers require x64).');
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const copy = (source, destination) => fs.cpSync(path.join(root, source), path.join(stage, destination || source), { recursive: true, filter: (p) => !p.split(path.sep).some((part) => ['node_modules', 'test', '.git'].includes(part)) });
copy('apps/desktop/main.mjs');
copy('apps/desktop/app.mjs');
copy('apps/desktop/preload.cjs');
copy('apps/desktop/assets');
copy('packages/core/src');
copy('packages/core/bin');
copy('packages/core/overlay');
copy('packages/p2p/src');
copy('packages/ui/dist');
fs.copyFileSync(path.join(root, 'packages/p2p/package.json'), path.join(stage, 'packages/p2p/package.json'));
fs.writeFileSync(path.join(stage, 'packages/core/package.json'), JSON.stringify({ ...core, dependencies: { ...core.dependencies, '@bananamind/minds-p2p': 'file:../p2p' } }, null, 2));
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'minds-desktop', version: pkg.version, description: pkg.description, author: 'Minds', private: true,
  type: 'module', main: 'apps/desktop/main.mjs',
  dependencies: { '@bananamind/minds-core': 'file:packages/core', '@bananamind/minds-p2p': 'file:packages/p2p' },
}, null, 2));

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const env = { ...process.env };
  // npm run forwards this setting as an env flag, which newer npm rejects for project installs.
  if (args.includes('--ignore-scripts')) for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
});

// Runtime dependencies ship ready-to-use files, including platform-specific WebRTC binaries.
await run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
await run(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--config', path.join(root, 'electron-builder.yml'), `--${target}`, `--${process.arch}`, `-c.directories.output=release/${output[target]}`, `-c.electronVersion=${electronVersion}`, `-c.electronDist=${path.join(root, 'node_modules/electron/dist')}`, '--publish', 'never'], root);
