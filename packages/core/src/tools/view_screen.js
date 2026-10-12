import path from 'node:path';
import { captureScreen } from '../screen.js';
import { botColor } from '../icons.js';

export default {
  name: 'view_screen',
  description: "Take a screenshot of the user's screen on the host PC and look at it. Use whenever seeing what is on screen would help: the user refers to something visible (\"this error\", \"this window\", \"what am I looking at\"), you need to check a GUI app or the result of an action, or text alone is ambiguous.",
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  image: true, // needs a model that accepts image input
  summarize: () => 'screenshot',
  async run(ctx) {
    const shot = await captureScreen(path.join(ctx.host.bots.dir(ctx.bot.id), 'screens'), ctx.signal);
    // Shown right after the grab so the indicator never covers what the bot sees.
    ctx.host.emit('screen.looking', { botId: ctx.bot.id, name: ctx.bot.name, color: botColor(ctx.bot), area: shot.area });
    return { text: `Screenshot captured (${shot.size.width}x${shot.size.height}); it is attached below.`, image: shot.image };
  },
};
