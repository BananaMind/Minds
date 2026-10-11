// Every bot gets a distinct icon: shape x color x face. Clients render it from this spec.
export const ICON_SHAPES = 10;
export const ICON_COLORS = [
  '#22a45d', '#7d7d83', '#f4f4f5', '#1d6fe8', '#e8553d', '#f2b01e',
  '#a259e6', '#17b8c9', '#e8508f', '#8cc63f', '#ff8a3d', '#5b6cf0',
];
export const ICON_FACES = 6;

export function pickIcon(used = []) {
  const key = (i) => `${i.shape}-${i.color}`;
  const taken = new Set(used.map(key));
  const all = [];
  for (let color = 0; color < ICON_COLORS.length; color++)
    for (let shape = 0; shape < ICON_SHAPES; shape++) all.push({ shape, color });
  const free = all.filter((i) => !taken.has(key(i)));
  const pool = free.length ? free : all;
  const base = pool[Math.floor(Math.random() * pool.length)];
  return { ...base, face: Math.floor(Math.random() * ICON_FACES) };
}
