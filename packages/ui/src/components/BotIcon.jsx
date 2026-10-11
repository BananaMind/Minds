// Distinct bot avatars: 10 shapes x 12 colors x 6 faces, all drawn from the icon spec the host stores.
const COLORS = ['#22a45d', '#7d7d83', '#f4f4f5', '#1d6fe8', '#e8553d', '#f2b01e', '#a259e6', '#17b8c9', '#e8508f', '#8cc63f', '#ff8a3d', '#5b6cf0'];

const SHAPES = [
  'M20 2a18 18 0 1 1 0 36 18 18 0 0 1 0-36z',                                                    // circle
  'M9 2h22a7 7 0 0 1 7 7v22a7 7 0 0 1-7 7H9a7 7 0 0 1-7-7V9a7 7 0 0 1 7-7z',                       // squircle
  'M20 2c9 0 18 6 18 17s-7 19-18 19S2 30 2 20 11 2 20 2z',                                         // blob
  'M20 1l16 9v20l-16 9-16-9V10z',                                                                  // hexagon
  'M20 2c4 0 5 5 9 6s8 1 8 6-4 6-4 9 4 5 2 9-7 2-10 4-5 4-5 4-3-1-6-4-8-1-10-4-1-7 1-10-5-4-4-9 5-5 8-6 6-6 11-5z', // soft flower
  'M20 1l18 19-18 19L2 20z',                                                                       // diamond
  'M20 2c8 9 16 15 16 23a16 14 0 0 1-32 0C4 17 12 11 20 2z',                                       // drop
  'M20 3c3 0 5 2 7 5l9 15c2 4 0 9-5 9H9c-5 0-7-5-5-9l9-15c2-3 4-5 7-5z',                           // round triangle
  'M12 33a9 9 0 0 1-1-18 10 10 0 0 1 19-1 9 9 0 0 1 1 19z',                                        // cloud
  'M4 14a10 10 0 0 1 10-10h12a10 10 0 0 1 10 10v12a10 10 0 0 1-10 10H14A10 10 0 0 1 4 26z',        // rounded block
];

const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

function Eyes({ face, ink }) {
  const p = { class: 'bot-eyes', fill: ink };
  switch (face % 6) {
    case 0: return <g {...p}><ellipse class="bot-eye" cx="14.5" cy="19" rx="2" ry="3.2" /><ellipse class="bot-eye" cx="25.5" cy="19" rx="2" ry="3.2" /></g>;
    case 1: return <g {...p}><circle class="bot-eye" cx="14" cy="18" r="2.4" /><circle class="bot-eye" cx="26" cy="18" r="2.4" /></g>;
    case 2: return <g class="bot-eyes" stroke={ink} stroke-width="2.2" stroke-linecap="round" fill="none"><path class="bot-eye" d="M11.5 19h5" /><path class="bot-eye" d="M23.5 19h5" /></g>;
    case 3: return <g {...p}><circle class="bot-eye" cx="13" cy="17" r="2.2" /><circle class="bot-eye" cx="24" cy="17" r="2.2" /></g>;
    case 4: return <g {...p}><ellipse class="bot-eye" cx="15" cy="17" rx="1.8" ry="2.8" /><ellipse class="bot-eye" cx="22" cy="19" rx="1.8" ry="2.8" /></g>;
    default: return <g class="bot-eyes" stroke={ink} stroke-width="2.2" stroke-linecap="round" fill="none"><path class="bot-eye" d="M12 21q2.5-4 5 0" /><path class="bot-eye" d="M23 21q2.5-4 5 0" /></g>;
  }
}

function Face({ face, ink }) {
  return <g><Eyes face={face} ink={ink} />{face % 6 === 3 && <path d="M16 25q4 3 8 0" stroke={ink} stroke-width="1.8" stroke-linecap="round" fill="none" />}</g>;
}

export function BotIcon({ icon, size = 40, badge = null, working = false }) {
  const color = COLORS[icon.color % COLORS.length];
  const ink = lum(color) > 0.55 ? '#111' : '#fff';
  return (
    <span class={`boticon ${working ? 'is-working' : ''}`} style={{ width: size, height: size, '--eye-delay': `${-((icon.shape * 31 + icon.face * 7 + icon.color) % 40) / 10}s` }}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        <path d={SHAPES[icon.shape % SHAPES.length]} fill={color} />
        <Face face={icon.face} ink={ink === '#fff' ? 'rgba(255,255,255,.95)' : 'rgba(10,10,10,.85)'} />
      </svg>
      {badge && <i class={`badge ${badge}`} />}
    </span>
  );
}
