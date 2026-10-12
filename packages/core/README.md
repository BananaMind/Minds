# Minds core

The Minds host: personal AI bots that live on your computer. It runs the bots and their tools (shell, files, web, screen and computer use, schedules, apps/MCP), stores chats under `~/.minds`, and serves the local RPC that the [CLI](https://www.npmjs.com/package/@bananamind/minds-cli), desktop app and phone app use.

Most people want the CLI: `npm install -g @bananamind/minds-cli`.

```js
import { ensureHost, MindsClient } from '@bananamind/minds-core';

await ensureHost();                    // start the host in the background if needed
const client = await MindsClient.connect();
const { bots } = await client.call('state');
await client.call('chat.send', { botId: bots[0].id, text: 'What is on my calendar today?' });
client.on((event, data) => { if (event === 'message.added') console.log(data.item); });
```

`mindsd` (`@bananamind/minds-core/mindsd`) runs the host in the foreground. Requires Node.js 20.6 or newer.

Source and the desktop/phone apps: https://github.com/BananaMind/Minds
