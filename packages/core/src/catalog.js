// Which speed modes each ChatGPT model supports: the `speeds` list in MODELS, minus any ChatGPT refused at runtime.
import { MODELS } from './models.js';

const rejected = new Map(); // model -> Set of speeds ChatGPT refused

export function markUnsupported(model, speed) {
  if (!model || !speed || speed === 'normal') return;
  if (!rejected.has(model)) rejected.set(model, new Set());
  rejected.get(model).add(speed);
}

/** { modelId: [speeds ChatGPT refused] } */
export function unsupportedSpeeds() {
  return Object.fromEntries([...rejected].map(([model, set]) => [model, [...set]]));
}

export function speedSupported(model, speed) {
  if (speed === 'normal') return true;
  const known = MODELS.find((m) => m.id === model)?.speeds;
  return (!known || known.includes(speed)) && !rejected.get(model)?.has(speed);
}
