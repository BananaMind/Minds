// What each kind of client may call. Local clients (desktop app, CLI on this PC) can do everything;
// a paired phone gets a deliberately smaller surface: it can chat, answer questions and approvals,
// read tool logs and manage schedules, but cannot touch settings, keys, sign-in, host lifecycle,
// bot deletion, or pairing — and cannot escalate a bot to bypass mode (checked in Host.call).
const MOBILE_ALLOWED = new Set([
  'state', 'bots.create', 'bots.update', 'models.speeds',
  'chat.history', 'chat.send', 'chat.stop', 'chat.answer', 'chat.markRead',
  'tools.log', 'search',
  'schedules.list', 'schedules.setEnabled', 'schedules.delete',
  'voice.transcribe',
]);

export function authorize(role, method) {
  if (role === 'local') return true;
  if (role === 'mobile') return MOBILE_ALLOWED.has(method);
  return false;
}

/** Events a role may receive. Pairing/device events stay on the computer. */
export function mayReceive(role, event) {
  return role === 'local' || !event.startsWith('mobile.');
}
