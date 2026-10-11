import { useEffect, useRef, useState } from 'preact/hooks';

/** Dark custom dropdown (the native <select> popup can't be themed). options: [{value,label,hint?}] */
export function Select({ value, options, onChange, class: cls = '' }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [up, setUp] = useState(false);
  const root = useRef();
  const cur = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const f = (e) => !root.current?.contains(e.target) && setOpen(false);
    addEventListener('mousedown', f); return () => removeEventListener('mousedown', f);
  }, [open]);

  const toggle = () => {
    if (!open) {
      setHi(Math.max(0, options.findIndex((o) => o.value === value)));
      const r = root.current.getBoundingClientRect();
      setUp(innerHeight - r.bottom < options.length * 40 + 20 && r.top > innerHeight - r.bottom);
    }
    setOpen(!open);
  };
  const pick = (o) => { setOpen(false); if (o.value !== value) onChange(o.value); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) return toggle(); setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open ? pick(options[hi]) : toggle(); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div class={`select ${cls}`} ref={root}>
      <button type="button" class={`select-btn ${open ? 'open' : ''}`} onClick={toggle} onKeyDown={onKey} aria-haspopup="listbox" aria-expanded={open}>
        <span>{cur?.label ?? value}</span>
        <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" /></svg>
      </button>
      {open && (
        <ul class={`select-list ${up ? 'up' : ''}`} role="listbox">
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} class={`${i === hi ? 'hi' : ''} ${o.value === value ? 'sel' : ''}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              <span>{o.label}</span>{o.hint && <small>{o.hint}</small>}
              {o.value === value && <svg class="check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const modelOptions = (models) => models.map((m) => ({ value: m.id, label: m.name, hint: m.hint }));
export const effortOptions = (efforts) => efforts.map((e) => ({ value: e, label: e }));
