import os from 'node:os';
import path from 'node:path';

export const MINDS_HOME = process.env.MINDS_HOME || path.join(os.homedir(), '.minds');
export const botsDir = () => path.join(MINDS_HOME, 'bots');
export const botDir = (id) => path.join(botsDir(), id);
export const settingsFile = () => path.join(MINDS_HOME, 'settings.json');
export const hostFile = () => path.join(MINDS_HOME, 'host.json');
export const schedulesFile = () => path.join(MINDS_HOME, 'schedules.json');
export const codexAuthFile = () =>
  process.env.MINDS_CODEX_AUTH || path.join(os.homedir(), '.codex', 'auth.json');
export const identityFile = () => path.join(MINDS_HOME, 'identity.json');
export const devicesFile = () => path.join(MINDS_HOME, 'devices.json');
export const pluginsFile = () => path.join(MINDS_HOME, 'plugins.json');
export const pluginsDir = () => path.join(MINDS_HOME, 'plugins');
