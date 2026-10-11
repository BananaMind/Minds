import { useEffect, useState } from 'preact/hooks';
import { AppIcon } from './AppIcon.jsx';
import { Select } from './Select.jsx';

const parseLines = (text, sep) => Object.fromEntries(String(text).split('\n').map((l) => l.trim()).filter((l) => l && l.includes(sep)).map((l) => { const i = l.indexOf(sep); return [l.slice(0, i).trim(), l.slice(i + sep.length).trim()]; }));

const TRUST = 'Community apps run code on your computer or connect to a third-party server, with the access you give them. Only install ones you trust.';

/** Add a community app: browse the official registry, or give a command, URL, folder or git repo. */
export function CommunityDialog({ api, onClose, onInstalled }) {
  const [tab, setTab] = useState('browse');
  const [trust, setTrust] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // browse
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState(null);       // {entry, option}
  const [values, setValues] = useState({});
  // manual
  const [m, setM] = useState({ name: '', command: '', env: '', url: '', headers: '', where: '' });

  useEffect(() => {
    if (tab !== 'browse') return;
    let active = true;
    setSearching(true);
    const t = setTimeout(() => api.call('plugins.registry', { q }).then((r) => { if (active) { setResults(r.results); setErr(''); } }).catch((e) => { if (active) setErr(e.message); }).finally(() => { if (active) setSearching(false); }), q ? 400 : 0);
    return () => { active = false; clearTimeout(t); };
  }, [q, tab]);

  const install = async (req) => {
    setBusy(true); setErr('');
    try { onInstalled(await api.call('plugins.install', { ...req, confirmed: true })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const chosen = pick && pick.entry.options[pick.option];
  const missingField = chosen?.fields.some((f) => f.required && !String(values[f.key] ?? f.default ?? '').trim());
  const preview = !chosen ? '' : chosen.kind === 'package' ? `${chosen.runtime} ${chosen.runtime === 'npx' ? '-y ' : ''}${chosen.identifier}${chosen.version ? `@${chosen.version}` : ''}` : chosen.url;

  return (
    <div class="modal-wrap top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal app-dialog wide">
        <header><h3>Add a community app</h3><button class="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></header>
        <p class="muted">Add an app through an MCP server or a Minds plugin folder. Each app has its own account and setup requirements.</p>
        <div class="seg three tabs">
          {[['browse', 'Browse'], ['manual', 'Command or URL'], ['folder', 'Folder or git']].map(([k, label]) => <button key={k} type="button" class={tab === k ? 'on' : ''} onClick={() => { setTab(k); setErr(''); }}>{label}</button>)}
        </div>

        {tab === 'browse' && !pick && (
          <>
            <input class="field" placeholder="Search the official registry (e.g. notion, slack, postgres)" value={q} onInput={(e) => setQ(e.target.value)} />
            <div class="results">
              {searching && <p class="muted tiny">Searching…</p>}
              {results?.map((e) => (
                <button key={e.name} class="result" onClick={() => { setPick({ entry: e, option: 0 }); setValues({}); setTrust(false); }}>
                  <AppIcon icon="plugin" size={32} />
                  <span><b>{e.title}</b><small>{e.description}</small><small class="mono">{e.name}</small></span>
                </button>
              ))}
              {results && !results.length && !searching && <p class="muted tiny">Nothing found. Try another word, or use “Command or URL”.</p>}
            </div>
          </>
        )}

        {tab === 'browse' && pick && (
          <div class="picked">
            <button class="btn ghost tiny" onClick={() => setPick(null)}>← Back to results</button>
            <h4>{pick.entry.title}</h4>
            <p class="muted">{pick.entry.description}</p>
            {pick.entry.repo && <p class="tiny"><a href={pick.entry.repo} target="_blank" rel="noreferrer">{pick.entry.repo} ↗</a></p>}
            {pick.entry.options.length > 1 && (
              <div class="install-options">{pick.entry.options.map((o, i) => <button key={i} type="button" class={`btn ${pick.option === i ? 'primary' : ''}`} onClick={() => { setPick({ ...pick, option: i }); setValues({}); setTrust(false); }}>{o.label}</button>)}</div>
            )}
            <p class="muted tiny">Will use: <code>{preview}</code></p>
            <p class="muted tiny">{chosen.kind === 'remote' ? 'Hosted apps may need an API token in the fields below. For a server that requires browser OAuth, use an authenticated local MCP bridge as a command.' : chosen.runtime === 'uvx' ? 'Requires uv (uvx) on your computer. The first run downloads the Python package.' : chosen.runtime === 'docker' ? 'Requires Docker installed and running on your computer.' : 'Requires Node.js and npm (npx) on your computer. The first run downloads the package.'}</p>
            {chosen.fields.map((f) => (
              <div class="fieldrow" key={f.key}>
                <label>{f.label}{f.required ? '' : ' (optional)'}</label>
                {f.choices?.length ? <Select value={values[f.key] ?? f.default ?? ''} options={[{ value: '', label: 'Choose…' }, ...f.choices.map((v) => ({ value: v, label: v }))]} onChange={(v) => setValues({ ...values, [f.key]: v })} /> : <input class="field" type={f.secret ? 'password' : 'text'} placeholder={f.placeholder || f.description || ''} value={values[f.key] ?? f.default ?? ''} autocomplete="off" onInput={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
              </div>
            ))}
            <label class="check trust"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> {TRUST}</label>
            <div class="row end"><button class="btn primary" disabled={busy || !trust || missingField} onClick={() => install({ source: 'registry', name: pick.entry.name, option: pick.option, values })}>{busy ? 'Installing… (first run can take a minute)' : 'Install'}</button></div>
          </div>
        )}

        {tab === 'manual' && (
          <div class="picked">
            <div class="fieldrow"><label>Name</label><input class="field" placeholder="e.g. Notion" value={m.name} onInput={(e) => setM({ ...m, name: e.target.value })} /></div>
            <div class="fieldrow"><label>Command to run (local app)</label><input class="field mono" placeholder="npx -y @modelcontextprotocol/server-memory" value={m.command} onInput={(e) => setM({ ...m, command: e.target.value, url: '' })} /></div>
            <p class="muted tiny">Use the command from the plugin author. Install its runtime first: Node.js for npx, uv for uvx, or Docker for containers.</p>
            <div class="fieldrow"><label>Environment variables, one per line (optional)</label><textarea class="field mono" rows={3} placeholder="API_KEY=abc123" value={m.env} onInput={(e) => setM({ ...m, env: e.target.value })} /></div>
            <p class="muted tiny center-text">— or a hosted app —</p>
            <div class="fieldrow"><label>MCP server URL</label><input class="field mono" placeholder="https://mcp.example.com/mcp" value={m.url} onInput={(e) => setM({ ...m, url: e.target.value, command: '' })} /></div>
            <p class="muted tiny">Supports HTTP and older SSE servers, including API tokens in headers. Servers that require browser OAuth need an authenticated local MCP bridge.</p>
            <div class="fieldrow"><label>Headers, one per line (optional)</label><textarea class="field mono" rows={2} placeholder="Authorization: Bearer abc123" value={m.headers} onInput={(e) => setM({ ...m, headers: e.target.value })} /></div>
            <label class="check trust"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> {TRUST}</label>
            <div class="row end"><button class="btn primary" disabled={busy || !trust || !(m.command.trim() || m.url.trim())} onClick={() => install(m.url.trim() ? { source: 'url', url: m.url.trim(), name: m.name.trim(), headers: parseLines(m.headers, ':') } : { source: 'command', command: m.command.trim(), name: m.name.trim(), env: parseLines(m.env, '=') })}>{busy ? 'Installing…' : 'Install'}</button></div>
          </div>
        )}

        {tab === 'folder' && (
          <div class="picked">
            <p class="muted">Point at a plugin folder on this computer, or a git repository. A plugin has a <code>plugin.json</code> and an <code>index.js</code>; see docs/PLUGINS.md.</p>
            <div class="fieldrow"><label>Folder path or https git URL</label><input class="field mono" placeholder="~/my-plugin   or   https://github.com/someone/minds-plugin" value={m.where} onInput={(e) => setM({ ...m, where: e.target.value })} /></div>
            <label class="check trust"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> {TRUST}</label>
            <div class="row end"><button class="btn primary" disabled={busy || !trust || !m.where.trim()} onClick={() => install(/^(https:\/\/|git@)/.test(m.where.trim()) ? { source: 'git', url: m.where.trim() } : { source: 'folder', path: m.where.trim() })}>{busy ? 'Installing…' : 'Install'}</button></div>
          </div>
        )}
        {err && <p class="error">{err}</p>}
      </div>
    </div>
  );
}
