# Minds CLI

Chat with your personal AI bots from the terminal. Minds bots live on your computer: they run commands, edit files, browse the web, see and use your screen, and act on schedules even when you're away.

```sh
npm install -g @bananamind/minds-cli
minds login          # sign in with ChatGPT (or set up an OpenAI-compatible API)
minds new Nova       # create a bot
minds chat Nova      # talk to it
```

Requires Node.js 20.6 or newer. The CLI starts the Minds host in the background when needed.

## Commands

| Command | What it does |
| --- | --- |
| `minds chat [bot]` | Interactive chat (shift+tab cycles the permission mode) |
| `minds say <bot> <message…>` | Send one message, wait for the reply, print it |
| `minds bots` / `minds new <name>` | List or create bots |
| `minds tools <bot>` | Every tool call a bot made |
| `minds schedules` | All scheduled tasks |
| `minds login` | Sign in with ChatGPT |
| `minds config [key] [value]` | Show or set `name`, `model`, `effort`, `permission`, `openrouter-key` |
| `minds apps …` | Connect built-in and community apps (GitHub, Gmail, MCP servers) |
| `minds phone [on\|off\|pair]` | Pair the Minds phone app (P2P, end-to-end encrypted) |
| `minds daemon start\|stop\|status\|install\|uninstall` | Manage the host; `install` starts it when you sign in |

Data lives in `~/.minds` (set `MINDS_HOME` to change it).

## Screen indicators

When a bot looks at or uses your screen, Minds shows a glowing frame or the bot's own cursor. These are drawn with Electron: install the [Minds desktop app](https://github.com/BananaMind/Minds) or `npm install -g electron` to see them.

The desktop app and phone app are available from [GitHub](https://github.com/BananaMind/Minds).
