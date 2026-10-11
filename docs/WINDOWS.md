# Windows

Minds has Windows support for the desktop UI, CLI, background host, PowerShell
tools, built-in apps, and community MCP plugins. Installer builds currently
target Windows x64. The Windows CI workflow is configured to check platform
behavior; a Linux test run cannot verify Windows integration.

## Run from source

Install Node.js 22.12 or newer with npm, then open PowerShell in the repository:

```powershell
npm install
node node_modules/electron/install.js
npm run desktop
```

The desktop host uses Electron's Node runtime. ChatGPT sign-in and npm-based
community plugins also need Node/npm/npx on PATH. For terminal commands, use
`node packages/cli/bin/minds.js` if `minds` is not on PATH:

```powershell
node packages/cli/bin/minds.js bots
node packages/cli/bin/minds.js login
node packages/cli/bin/minds.js apps
```

Bot commands run in Windows PowerShell with UTF-8 output. The bot is instructed
to use PowerShell syntax and Windows paths. Stopping a command or reaching its
timeout terminates its process tree. File tools accept absolute drive and UNC
paths; both `~/` and `~\` expand to your user directory.

## Sign-in and apps

Click the profile avatar for **Profile & settings → ChatGPT**. Sign-in launches
the official Codex login through npx, including npm's Windows command shim.
You can also run `npx -y @openai/codex login` in PowerShell.

Use **Connect apps** for GitHub, Hugging Face, Gmail, and community plugins. Gmail
still needs your Google Cloud Desktop OAuth client; its browser callback listens
only on localhost. See [PLUGINS.md](PLUGINS.md).

Install each community plugin's runtime on PATH: Node/npm for npx, uv for uvx,
Git for repository installs, and Docker Desktop for container-based plugins.
Quote executable paths containing spaces:

```text
"C:\Program Files\nodejs\node.exe" "C:\My Plugins\server.mjs"
```

## Start when you sign in

For the desktop app, enable **Profile & settings → Preferences → Windows startup
→ Open Minds when I sign in**. Closing the window leaves the host running.

For a background host without opening the desktop window:

```powershell
node packages/cli/bin/minds.js daemon install
node packages/cli/bin/minds.js daemon uninstall
```

This creates or removes a per-user **Minds host.lnk** in the Windows Startup
folder. It preserves `MINDS_HOME` and an explicit `MINDS_CODEX_AUTH` path and
launches the host without a console window. It needs no administrator password.
Keep the source checkout and Node installation at the same paths, or reinstall
the startup shortcut after moving them. The host runs while your Windows session
is signed in; this is not an always-on Windows service.

## Build an installer

On Windows, from the repository root:

```powershell
npm run desktop:win
```

This builds the UI, stages the production host and P2P packages with their
dependencies, and generates a per-user NSIS installer under `release/windows/`.
It includes the Windows native WebRTC binding. The installer is unsigned until
a signing certificate is configured. Building on Windows ensures the correct
native dependencies are installed; cross-building from Linux is not enabled.

The [Windows workflow](../.github/workflows/windows.yml) runs the tests on a
Windows runner, builds the installer, and uploads it as a workflow artifact.

## Data and permissions

Data defaults to `%USERPROFILE%\.minds`; your Codex login defaults to
`%USERPROFILE%\.codex\auth.json`. `MINDS_HOME` and `MINDS_CODEX_AUTH` override
those paths. Removing the installer does not erase your bots or credentials.
Windows file access follows the directory's Windows ACLs; Unix `0600` file modes
do not implement Windows ACL restrictions.

The safety rules recognize Windows credential paths, startup folders, PowerShell
profiles, system directories, registry/startup commands, destructive disk tools,
broad deletes, and remote scripts piped into PowerShell. Bypass mode still skips
these checks, as it does on the other platforms.
