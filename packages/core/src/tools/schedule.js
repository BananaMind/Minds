export default {
  name: 'schedule',
  description:
    'Manage this bot\'s scheduled tasks. A schedule wakes you up later with a prompt so you can act on your own while the host PC is on, then message the user with the result. Use action "create" with exactly one of: cron (5-field cron expression, host local time), every_minutes (repeat interval), or at (ISO 8601 date-time, one-off). Use "list" to see schedules and "delete" to remove one by id.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'delete'] },
      name: { type: 'string', description: 'Short label (create).' },
      prompt: { type: 'string', description: 'What you should do when it fires, written as an instruction to yourself (create).' },
      cron: { type: 'string' },
      every_minutes: { type: 'number' },
      at: { type: 'string' },
      id: { type: 'string', description: 'Schedule id (delete).' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  summarize: (a) => `${a.action}${a.name ? ` · ${a.name}` : ''}${a.cron ? ` · ${a.cron}` : a.every_minutes ? ` · every ${a.every_minutes}m` : a.at ? ` · ${a.at}` : ''}`,
  run(ctx, args) {
    const s = ctx.host.scheduler;
    if (args.action === 'list') {
      const list = s.list(ctx.bot.id);
      return list.length ? list.map((x) => `${x.id} · ${x.name} · ${s.describe(x)} · ${x.enabled ? 'on' : 'off'} · next ${x.nextRun || '—'}`).join('\n') : 'No schedules.';
    }
    if (args.action === 'delete') {
      if (!s.remove(args.id, ctx.bot.id)) throw new Error('No such schedule for this bot');
      return `Deleted schedule ${args.id}`;
    }
    if (args.action === 'create') {
      const x = s.create({ botId: ctx.bot.id, name: args.name, prompt: args.prompt, cron: args.cron, everyMinutes: args.every_minutes, at: args.at });
      return `Created schedule ${x.id} (${s.describe(x)}). Next run: ${x.nextRun}`;
    }
    throw new Error('Unknown action');
  },
};
