import os from 'node:os';
import { normalizeConfig, validModel } from './providers/openai.js';
import { settingsFile } from './paths.js';
import { readJson, writeJson } from './store.js';
import { DEFAULT_MODEL, DEFAULT_EFFORT, isModel, isEffort } from './models.js';
import { DEFAULT_PERMISSION, isPermission } from './permissions.js';
import { normalizeRelay, publicRelay } from './relay.js';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function defaultSettings() {
  let user = 'there';
  try { user = os.userInfo().username; } catch {}
  return {
    userName: cap(user),
    openrouterKey: '',
    defaultModel: DEFAULT_MODEL,
    defaultProvider: 'codex',
    openai: { baseUrl: 'http://localhost:11434/v1', apiKey: '', models: [], tools: true },
    defaultEffort: DEFAULT_EFFORT,
    defaultPermission: DEFAULT_PERMISSION, // permission mode for bots that haven't picked one
    autoSendTranscript: true,
    mobileEnabled: false,      // phone access (P2P) is off until you turn it on
    mobileCanApprove: true,    // may a paired phone approve risky actions?
    mobileRelay: { provider: 'none' },
  };
}

export class Settings {
  // Only explicit user choices are written to disk, so changing a default later reaches everyone who never touched it.
  constructor() {
    this.overrides = readJson(settingsFile(), {}) || {};
    this.data = { ...defaultSettings(), ...this.overrides };
  }
  get() { return this.data; }
  /** Settings safe to send to clients (never the raw key). */
  public() {
    const { openrouterKey, mobileRelay, openai, ...rest } = this.data;
    return { ...rest, openai: { ...openai, apiKey: undefined, keySaved: Boolean(openai?.apiKey) }, mobileRelay: publicRelay(mobileRelay), openrouterConnected: Boolean(openrouterKey) };
  }
  set(patch) {
    const next = { ...this.data };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in defaultSettings())) continue;
      if (k === 'defaultModel' && !((patch.defaultProvider || next.defaultProvider) === 'openai' ? validModel(v) : isModel(v))) continue;
      if (k === 'defaultProvider' && !['codex', 'openai'].includes(v)) throw new Error('Unknown model provider');
      if (k === 'defaultEffort' && !isEffort(v)) continue;
      if (k === 'defaultPermission' && !isPermission(v)) continue;
      if (k === 'openai') next[k] = normalizeConfig(v, this.data.openai);
      else if (k === 'mobileRelay') next[k] = normalizeRelay(v, this.data.mobileRelay);
      else if (k === 'openrouterKey') next[k] = String(v || '').trim();
      else if (k === 'userName') next[k] = String(v || '').trim().slice(0, 40) || this.data.userName;
      else next[k] = v;
    }
    const defaults = defaultSettings();
    for (const k of Object.keys(patch || {})) {
      if (!(k in defaults)) continue;
      if (next[k] === defaults[k] && k !== 'openrouterKey') delete this.overrides[k]; else this.overrides[k] = next[k];
    }
    this.data = next;
    writeJson(settingsFile(), this.overrides);
    return this.public();
  }
}
