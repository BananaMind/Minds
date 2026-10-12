// Model catalog. Efforts apply to every model; set per bot. `speeds`: the speed modes the model offers.
export const MODELS = [
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', hint: 'Most capable', speeds: ['normal', 'fast', 'ultrafast'] },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', hint: 'Latest balanced', speeds: ['normal', 'fast', 'ultrafast'] },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', hint: 'Balanced default', speeds: ['normal', 'fast'] },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', hint: 'Fast and light', speeds: ['normal', 'fast'] },
];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const EFFORT_HINTS = {
  low: 'Fast responses with lighter reasoning',
  medium: 'Balances speed and reasoning depth for everyday tasks',
  high: 'Greater reasoning depth for complex problems',
  xhigh: 'Extra high reasoning depth for complex problems',
  max: 'Maximum reasoning depth for the hardest problems',
};
export const MODEL_DESCRIPTIONS = {
  'gpt-6-astra': 'Frontier intelligence for the most demanding work.',
  'gpt-6.1-sol': 'Latest workhorse model for coding and everyday work.',
  'gpt-6-sol': 'Previous generation workhorse model.',
  'gpt-6-luna': 'Fast and affordable model for easier tasks.',
};
export const DEFAULT_MODEL = 'gpt-6.1-sol';
export const DEFAULT_EFFORT = 'low';

export const OPENROUTER_TRANSCRIBE_MODEL = 'meta/muse-voice-transcribe-1.0';
export const OPENROUTER_SAFETY_MODEL = 'typesafe/jev-1.13';

export const isModel = (id) => MODELS.some((m) => m.id === id);
export const isEffort = (e) => EFFORTS.includes(e);
