// Simple tiles for apps (stylized glyphs, not brand logos).
const TILES = {
  github: { bg: '#24292f', fg: '#ffffff', d: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-10 7" /></> },
  huggingface: { bg: '#ffd21e', fg: '#2b2400', d: <><circle cx="12" cy="12" r="8" /><circle cx="9" cy="10.5" r="1" fill="currentColor" /><circle cx="15" cy="10.5" r="1" fill="currentColor" /><path d="M8.5 14.2c1 2.2 6 2.2 7 0" /></> },
  gmail: { bg: '#ea4335', fg: '#ffffff', d: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 7.5l8.5 6 8.5-6" /></> },
  plugin: { bg: '#3a3a42', fg: '#e8e8ee', d: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" /> },
};

export function AppIcon({ icon, size = 40 }) {
  const t = TILES[icon] || TILES.plugin;
  return (
    <span class="apptile" style={{ width: size, height: size, background: t.bg, color: t.fg }}>
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58}>{t.d}</svg>
    </span>
  );
}
