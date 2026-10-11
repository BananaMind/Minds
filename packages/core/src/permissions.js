// Per-bot permission modes (cycled with shift+tab in the CLI).
//   default: the safety model (or local rules) screens each call; only flagged calls ask the user.
//   ask:     ask before every action that changes things (commands, writes, edits, schedules).
//   bypass:  no checks at all; every call just runs.
export const PERMISSION_MODES = [
  { id: 'default', label: 'default mode', hint: 'Safety-checked; asks only when something looks risky' },
  { id: 'ask', label: 'ask for permission', hint: 'Asks before every command, edit and schedule' },
  { id: 'bypass', label: 'bypass permissions', hint: 'No safety checks; runs everything' },
];
export const DEFAULT_PERMISSION = 'default';
export const isPermission = (m) => PERMISSION_MODES.some((x) => x.id === m);
export const nextPermission = (m) => PERMISSION_MODES[(PERMISSION_MODES.findIndex((x) => x.id === m) + 1) % PERMISSION_MODES.length].id;
