# Apps and plugins

Minds includes GitHub, Hugging Face, and Gmail. Open **Connect apps → Apps** on
your computer, choose an app, and follow its setup steps. Then switch it on under
**Available to bots**, or in a bot's menu under **Apps**. Connecting an account
does not give every bot access automatically.

In the default permission mode, read tools run directly. Tools that send, post,
create, delete, or run paid inference ask first. An app's **Allow changes without
asking** setting skips that prompt in default mode. A bot in **ask** mode still
asks for app changes; **bypass** mode skips all approval checks.

## Built-in setup

### GitHub

Public repositories work with **Use without signing in**. For private repositories
and writes, create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
Select the repositories Minds may use. Give **Contents: Read-only**; add
**Issues: Read and write** and **Pull requests: Read and write** for those actions.
Paste the token into the GitHub dialog and connect. You can also import a login
from `gh auth login` if the GitHub CLI is already installed.

Notifications require a classic token with `notifications`; classic tokens need
`repo` for private repository access. Fine-grained tokens do not support the
notifications endpoint. See [GitHub's notification authentication requirements](https://docs.github.com/en/rest/activity/notifications).

### Hugging Face

Public model, dataset, Space, and paper searches work with **Use without signing in**.
For private or gated content, create a token in [Hugging Face settings](https://huggingface.co/settings/tokens)
with access to the resources you need, and paste it into the dialog. Gated models
may also require accepting their terms on the model page.

Hosted chat needs a token allowed to call Inference Providers and a model supported
by that service. The prompt is sent to the selected provider and usage may be
billed to your account; Minds asks before these calls by default. A token saved by
`hf auth login` can be imported when available. See [Inference Providers authentication](https://huggingface.co/docs/inference-providers/en/index).

### Gmail

You need a Google Cloud project with a **Desktop app OAuth client** once. You do
not need to host a website or install a separate Gmail app.

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/projectcreate).
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Open **Google Auth Platform**, set the app name and contact email, and choose
   **External** for a personal Gmail account. Under **Audience → Test users**, add
   the Gmail address you will connect.
4. Under **Clients**, create an OAuth client with application type **Desktop app**.
   Copy its client ID and client secret.
5. Open **Connect apps → Apps → Gmail**, paste both values, and choose **Read only**
   or **Read, send and organize**. Press **Sign in with Google** and finish in your
   browser on the same computer. Review the access Google asks you to grant.
6. Enable Gmail for the bots that should use it. Read-only connections expose no
   send, draft, organize, or trash tools.

Sign-in uses PKCE and a temporary loopback callback; you do not configure a public
redirect URL. See [Google's desktop OAuth flow](https://developers.google.com/identity/protocols/oauth2/native-app).
External apps in Testing expire Gmail refresh tokens after seven days. Press
**Reconnect**; Minds reuses the saved client. Moving to production removes that
testing limit, but broader use can require Google verification. Tokens can also
be revoked independently. See [Google's token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

## Community apps

Open **Connect apps → Apps → Add a community app**. An app needs an MCP server or
a Minds plugin implementing its API; arbitrary apps without an integration do
not become connected automatically.

- **Browse:** search the [official MCP Registry](https://registry.modelcontextprotocol.io),
  pick a local or hosted install option, and fill in its setup fields. Minds uses
  the latest published entry and its pinned package version.
- **Command or URL:** enter the plugin author's command or hosted MCP URL. Supply
  environment variables for local commands or headers such as
  `Authorization: Bearer …` for hosted servers. HTTPS and localhost HTTP are
  supported, using Streamable HTTP or older SSE.
- **Folder or git:** install a Minds plugin folder, or clone an HTTPS git repository
  whose root contains the plugin files described below. Install that plugin's
  dependencies before installing the folder.

Local npm plugins need **Node.js 20+ and npm/npx**. Python plugins need
**[uv](https://docs.astral.sh/uv/getting-started/installation/)** and `uvx` on the
host's PATH. Container plugins need **Docker** installed and running. Git installs
need **git**. Hosted servers need no local plugin runtime. The plugin itself may
require an account, API key, developer app, or subscription; follow its author's
instructions and the setup fields shown by Minds.

Minds supports static API tokens and headers for hosted MCP connections. Servers
that require interactive MCP OAuth need an authenticated local MCP bridge from
their author, installed as a command; Minds does not yet run a generic hosted
MCP OAuth sign-in flow.

Review the source and trust prompt before installing. Local plugins run code with
your computer account's access; bot approval prompts control tool calls, not the
plugin process itself. Native plugins run inside the host. MCP processes inherit
a small default environment plus the variables you supply.

After installing, enable the app for a bot. Tool names are prefixed for MCP apps,
and tools without a read-only hint ask before running by default. You can disable
individual tools. Use **Disconnect** to pause an MCP app, **Reconnect & refresh
tools** to restart it, and **Remove app** to uninstall it. Saved environment and
header credentials can be replaced in the app dialog before reconnecting.

## CLI

If `minds` is not on your PATH, replace it with `node packages/cli/bin/minds.js`
from the repository root.

```sh
minds apps
minds apps connect github --public
minds apps connect huggingface --public
minds apps connect gmail                   # prompts for the desktop client
minds apps enable github "My Bot"
minds apps tools github
minds apps search notes
minds apps install io.example/notes        # use the exact name returned by search
minds apps install "npx -y @modelcontextprotocol/server-memory" --name Memory
minds apps install https://example.com/mcp --name Notes
minds apps install ~/my-minds-plugin
minds apps install https://github.com/example/minds-plugin.git
minds apps refresh mcp-memory
minds apps disable github "My Bot"
minds apps disconnect github
minds apps remove mcp-memory
```

For local credentials use repeated `--env KEY=value`; for hosted connections use
`--header "Name: value"`. Registry installs prompt for required inputs and accept
`--option 2` to select the second install option. Use `--source registry|command|url|folder|git`
to resolve an ambiguous target, and `--yes` only when you have already reviewed
and trust the plugin. Interactive secret prompts avoid placing tokens in shell
history. The install result prints the actual app ID to use with `enable`,
`refresh`, and `remove`.

## Write a Minds plugin

A folder needs `plugin.json` and an ES module (`index.js` by default). If it has
dependencies, include a `package.json` with `"type": "module"` and install those
dependencies in the source folder. The folder is copied into Minds' plugin data
directory at install time.

```json
{
  "id": "example-notes",
  "name": "Example Notes",
  "version": "1.0.0",
  "description": "Read notes from an example API",
  "main": "index.js",
  "setup": {
    "summary": "Create an API token in your notes account.",
    "fields": [{ "key": "token", "label": "API token", "secret": true, "required": true }]
  }
}
```

```js
export default {
  async connect(fields) {
    const token = String(fields.token || '').trim();
    if (!token) throw new Error('Enter an API token.');
    return { secrets: { token }, detail: 'Connected' };
  },
  tools: () => [{
    name: 'example_notes_list',
    title: 'List notes',
    description: 'List the account’s notes.',
    access: 'read',                         // use 'write' for changes or paid actions
    parameters: { type: 'object', properties: {} },
    async run(ctx) {
      const res = await fetch('https://api.example.com/notes', {
        headers: { Authorization: `Bearer ${ctx.secrets.get('token')}` },
        signal: ctx.signal,
      });
      if (!res.ok) throw new Error(`Notes API returned HTTP ${res.status}`);
      return JSON.stringify(await res.json());
    },
  }],
};
```

IDs use lowercase letters, digits, and dashes (2–41 characters). Tool names must
be unique across Minds, use letters, digits, underscores or dashes, and fit in
64 characters. Prefix native tool names with your plugin ID. A default-exported
`tools(ctx)` function also works. The context includes `secrets.get/set/all`,
`config`, `state`, and `account`; tool execution also receives `bot`, `workspace`,
`host`, and the abort `signal`. Return a string or a JSON-serializable result.

## Data and phone access

Connections, tokens, and per-app configuration live in `~/.minds/plugins.json`
(owner-only permissions). Native code lives under `~/.minds/plugins/`; per-bot
access lives in each bot's `bot.json`. `MINDS_HOME` overrides the data directory.
Built-in disconnects forget the stored credentials. MCP disconnects keep setup
credentials for reconnecting; uninstall removes them.

Manage apps on the computer. Paired phones can chat with bots using apps already
enabled for those bots, within their existing permissions, but cannot list app
credentials, install plugins, or change app access. See [MOBILE.md](MOBILE.md).
