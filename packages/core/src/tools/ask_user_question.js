export default {
  name: 'ask_user_question',
  description:
    'Ask the user a question and wait for the answer. Use when you need a decision or missing information; offer 2-5 short options when sensible (the user can always type their own answer). The user sees a card in chat. This works even while they are away; the turn resumes when they answer.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question, short and direct.' },
      detail: { type: 'string', description: 'Optional one-line helper text under the question.' },
      options: { type: 'array', items: { type: 'string' }, description: 'Suggested answers.' },
    },
    required: ['question'],
    additionalProperties: false,
  },
  summarize: (a) => a.question,
  async run(ctx, args) {
    const answer = await ctx.askUser({ question: args.question, detail: args.detail, options: (args.options || []).slice(0, 6) });
    return answer.dismissed ? 'The user dismissed the question without answering.' : `User answered: ${answer.text}`;
  },
};
