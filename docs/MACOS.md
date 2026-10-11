# macOS

Minds supports the desktop app, CLI, background host, and app plugins on macOS.
The window uses native close/minimize/fullscreen buttons; clicking its Dock icon
reopens the window. Closing the window keeps bots running in the background.

## Run from source

Install Node.js 22.12 or newer, then run in the repository:

```sh
npm install
node node_modules/electron/install.js
npm run desktop
```

Connect GitHub, Hugging Face, Gmail, and community plugins using **Connect apps**.
Use the profile button for ChatGPT sign-in, OpenRouter, and other settings.
Install plugin runtimes such as Node/npm, uv, or Docker as required by the plugin.
See [PLUGINS.md](PLUGINS.md) for setup.

The installer includes the host's Node runtime. ChatGPT sign-in and npm plugins
also require Node/npm installed on the Mac. Finder launches include the usual
Homebrew and `/usr/local/bin` locations; shell-profile-only runtime managers may
need Minds launched from a terminal with their PATH loaded. The CLI launch agent
preserves the PATH used when installing it.

## Startup

For an installed app in Applications, enable **Profile & settings → Preferences
→ Mac startup → Open Minds when I sign in**.

For a background host from a source checkout:

```sh
node packages/cli/bin/minds.js daemon install
node packages/cli/bin/minds.js daemon uninstall
```

This manages `~/Library/LaunchAgents/dev.minds.host.plist`. It preserves custom
`MINDS_HOME` and `MINDS_CODEX_AUTH` paths and starts the host at login with crash
recovery. Reinstall after moving the source checkout or Node executable.

## Build

On a Mac, run:

```sh
npm run desktop:mac
```

The build creates DMG and ZIP files under `release/macos/`, including production
dependencies for the machine's architecture: arm64 on Apple Silicon, x64 on
Intel. Build each architecture on its matching Mac. The app includes a microphone
permission description for voice input.

These builds use ad-hoc signing. Public distribution needs an Apple Developer ID
and notarization; replace the ad-hoc signing configuration in
`electron-builder.yml` for a signed release.

The [macOS workflow](../.github/workflows/macos.yml) is configured to run tests,
build the app, and upload its installers on a Mac runner. Native installation,
startup, and microphone permissions still need verification on macOS; Linux
checks cannot validate those integrations.

Data defaults to `~/.minds`; Codex credentials default to `~/.codex/auth.json`.
Deleting the app does not delete your bots or credentials.
