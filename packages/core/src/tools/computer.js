import path from 'node:path';
import { captureScreen, lastCapture } from '../screen.js';
import { inputBackend } from '../computer/index.js';
import { parseKeys } from '../computer/keys.js';
import { botColor } from '../icons.js';

const ACTIONS = ['screenshot', 'move', 'click', 'double_click', 'right_click', 'middle_click', 'drag', 'scroll', 'type', 'key', 'wait'];
const POINTER = new Set(['move', 'click', 'double_click', 'right_click', 'middle_click', 'drag', 'scroll']);
const GLIDE_MS = 260; // let the visible bot cursor arrive before the real input happens
const SETTLE_MS = 450;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});

// One bot at a time drives the mouse and keyboard.
let lock = Promise.resolve();
const exclusive = (fn) => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };

/** Screenshot pixel -> fraction of the captured screen area. */
export function toFraction(shot, x, y) {
  if (![x, y].every(Number.isFinite)) throw new Error('x and y are required for this action.');
  const { width, height } = shot.size;
  if (x < 0 || y < 0 || x >= width || y >= height) throw new Error(`(${x}, ${y}) is outside the ${width}x${height} screenshot.`);
  return { fx: width > 1 ? x / (width - 1) : 0, fy: height > 1 ? y / (height - 1) : 0 };
}

/** Run a pointer action, then put the user's own pointer back where it was. */
async function keepUserPointer(input, fn) {
  const home = await input.pointer?.().catch(() => null);
  try { return await fn(); } finally { if (home) await input.move(home.fx, home.fy).catch(() => {}); }
}

export default {
  name: 'computer',
  description: "Control the user's computer like a person: move the mouse, click, drag, scroll, type and press keys. Your own visible cursor shows the user where you act. Coordinates are pixels in the most recent screenshot (from this tool or view_screen). Every action returns a fresh screenshot so you can check the result; look before you click, and never guess coordinates.",
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS },
      x: { type: 'number', description: 'Target x in screenshot pixels (pointer actions; start point for drag).' },
      y: { type: 'number', description: 'Target y in screenshot pixels.' },
      to_x: { type: 'number', description: 'drag: end x.' },
      to_y: { type: 'number', description: 'drag: end y.' },
      text: { type: 'string', description: 'type: text to type.' },
      keys: { type: 'string', description: 'key: a combo like "ctrl+s", "alt+tab", "Return", "cmd+space"; several separated by spaces are pressed in order.' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'scroll direction.' },
      amount: { type: 'number', description: 'scroll: wheel steps (default 3).' },
      seconds: { type: 'number', description: 'wait: seconds to wait before the screenshot (max 30).' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  image: true, // needs a model that accepts image input
  summarize: (a) => [a.action, a.x != null ? `(${a.x}, ${a.y})` : '', a.keys || '', a.text ? JSON.stringify(a.text.slice(0, 60)) : ''].filter(Boolean).join(' '),

  run(ctx, args) { return exclusive(() => act(ctx, args)); },
};

async function act(ctx, args) {
  const { action } = args;
  const { bot, host, signal } = ctx;
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action "${action}".`);
  const dir = path.join(host.bots.dir(bot.id), 'screens');
  const look = async (text) => {
    await sleep(SETTLE_MS, signal);
    const shot = await captureScreen(dir, signal);
    host.emit('screen.looking', { botId: bot.id, name: bot.name, color: botColor(bot), area: shot.area });
    return { text: `${text} Screenshot attached (${shot.size.width}x${shot.size.height}).`, image: shot.image };
  };

  if (action === 'screenshot') return look('Here is the screen.');
  if (action === 'wait') { await sleep(Math.min(Math.max(Number(args.seconds) || 1, 0), 30) * 1000, signal); return look('Waited.'); }

  const shot = lastCapture;
  if (POINTER.has(action) && !shot) return look('No screenshot yet, so nothing was done. Pick coordinates from this screenshot and try again.');
  const input = inputBackend();
  await input.open(signal);

  const cursor = (fx, fy, kind) => host.emit('computer.cursor', { botId: bot.id, name: bot.name, color: botColor(bot), fx, fy, action: kind, area: shot?.area || 'all' });
  const pointAt = async (x, y, kind) => {
    const { fx, fy } = toFraction(shot, x, y);
    cursor(fx, fy, kind);
    await sleep(GLIDE_MS, signal);
    await input.move(fx, fy);
    return { fx, fy };
  };
  const click = async (btn, count = 1) => {
    for (let i = 1; i <= count; i++) { await input.button(btn, true, i); await input.button(btn, false, i); if (i < count) await sleep(60, signal); }
  };

  if (POINTER.has(action)) return look(await keepUserPointer(input, () => pointerAction(args, { pointAt, click, cursor, input, shot, signal })));
  return keyboardAction(args, { cursor, input, shot, signal, look });
}

async function pointerAction(args, { pointAt, click, cursor, input, shot, signal }) {
  const { action } = args;
  switch (action) {
    case 'move': await pointAt(args.x, args.y, 'move'); return `Moved to (${args.x}, ${args.y}).`;
    case 'click': await pointAt(args.x, args.y, 'click'); await click('left'); return `Clicked (${args.x}, ${args.y}).`;
    case 'double_click': await pointAt(args.x, args.y, 'click'); await click('left', 2); return `Double-clicked (${args.x}, ${args.y}).`;
    case 'right_click': await pointAt(args.x, args.y, 'click'); await click('right'); return `Right-clicked (${args.x}, ${args.y}).`;
    case 'middle_click': await pointAt(args.x, args.y, 'click'); await click('middle'); return `Middle-clicked (${args.x}, ${args.y}).`;
    case 'drag': {
      const from = await pointAt(args.x, args.y, 'press');
      const to = toFraction(shot, args.to_x, args.to_y);
      await input.button('left', true);
      try {
        for (let i = 1; i <= 12; i++) {
          const fx = from.fx + (to.fx - from.fx) * i / 12, fy = from.fy + (to.fy - from.fy) * i / 12;
          cursor(fx, fy, 'drag'); await input.move(fx, fy); await sleep(25, signal);
        }
      } finally { await input.button('left', false); }
      return `Dragged from (${args.x}, ${args.y}) to (${args.to_x}, ${args.to_y}).`;
    }
    case 'scroll': {
      await pointAt(args.x, args.y, 'scroll');
      const n = Math.min(Math.max(Math.round(Number(args.amount) || 3), 1), 50);
      const dir = args.direction || 'down';
      await input.scroll(dir === 'left' ? -n : dir === 'right' ? n : 0, dir === 'up' ? -n : dir === 'down' ? n : 0);
      return `Scrolled ${dir} ${n}.`;
    }
  }
}

async function keyboardAction(args, { cursor, input, shot, signal, look }) {
  switch (args.action) {
    case 'type': {
      if (typeof args.text !== 'string' || !args.text) throw new Error('text is required for type.');
      if (shot) cursor(null, null, 'type');
      await input.type(args.text, signal);
      return look(`Typed ${args.text.length} characters.`);
    }
    case 'key': {
      const combos = parseKeys(args.keys);
      if (shot) cursor(null, null, 'key');
      for (const combo of combos) {
        const down = [];
        try { for (const k of combo) { await input.key(k, true); down.push(k); } } finally { for (const k of down.reverse()) await input.key(k, false); }
        await sleep(40, signal);
      }
      return look(`Pressed ${args.keys}.`);
    }
  }
}
