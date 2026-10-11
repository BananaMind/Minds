import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request, PluginError, clip, pick, asText, limit } from '../http.js';

const hub = () => process.env.MINDS_HF_HUB || 'https://huggingface.co';
const router = () => process.env.MINDS_HF_ROUTER || 'https://router.huggingface.co';

const KINDS = { model: 'models', dataset: 'datasets', space: 'spaces' };
const REPO_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.-]+)?$/;

function hf(ctx, url, opts = {}) {
  const token = ctx.secrets.get('token');
  return request(url, { ...opts, signal: ctx.signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers } });
}
const kindOf = (k) => {
  if (!KINDS[k || 'model']) throw new PluginError('kind must be one of: model, dataset, space');
  return k || 'model';
};
const repoOf = (id) => {
  if (!REPO_ID.test(String(id || ''))) throw new PluginError('id must look like "owner/name"');
  return id;
};
// Files for models live at /{id}/resolve/..., datasets and spaces under their own prefix.
const filePrefix = (kind, id) => (kind === 'model' ? `${hub()}/${id}` : `${hub()}/${KINDS[kind]}/${id}`);
const q = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')).toString();

const summary = (kind, x) => {
  if (kind === 'paper') return pick({ title: x.title || x.paper?.title, id: x.id || x.paper?.id, summary: clip(x.summary || x.paper?.summary, 400), upvotes: x.upvotes ?? x.paper?.upvotes, published: x.publishedAt || x.paper?.publishedAt, url: `${hub()}/papers/${x.id || x.paper?.id}` }, ['title', 'id', 'summary', 'upvotes', 'published', 'url']);
  return pick({ id: x.id, task: x.pipeline_tag, downloads: x.downloads, likes: x.likes, updated: x.lastModified, sdk: x.sdk, tags: (x.tags || []).slice(0, 8), url: `${kind === 'model' ? hub() : `${hub()}/${KINDS[kind]}`}/${x.id}` }, ['id', 'task', 'downloads', 'likes', 'updated', 'sdk', 'tags', 'url']);
};

export default {
  id: 'huggingface',
  name: 'Hugging Face',
  icon: 'huggingface',
  description: 'Search models, datasets, Spaces and papers; read model cards and files; and run hosted inference.',
  setup: {
    summary: 'Searching and reading public models, datasets and papers works without signing in. Add an access token for private or gated repos and for running inference.',
    steps: [
      { text: 'Open Hugging Face → Settings → Access Tokens → Create new token.', link: 'https://huggingface.co/settings/tokens' },
      { text: 'Pick “Read” for browsing. For running models (inference), use a fine-grained token with “Make calls to Inference Providers” enabled.' },
      { text: 'Copy the token (it starts with hf_) and paste it below.' },
      { text: 'If you already ran `huggingface-cli login`, you can import that token with one click.' },
    ],
    fields: [{ key: 'token', label: 'Access token', secret: true, placeholder: 'hf_…', required: false }],
    local: { label: 'Use my Hugging Face CLI login' },
  },
  publicOk: true,

  async connect(fields, ctx) {
    const token = String(fields.token || '').trim();
    if (!token) return { secrets: {}, account: null, detail: 'Public access (no account)' };
    const me = await request(`${hub()}/api/whoami-v2`, { headers: { Authorization: `Bearer ${token}` }, signal: ctx.signal });
    return { secrets: { token }, account: me.name, detail: `Signed in as ${me.name}` };
  },

  local: {
    detect: async () => Boolean(process.env.HF_TOKEN) || fs.existsSync(path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'token')),
    read: async () => {
      const t = (process.env.HF_TOKEN || (() => { try { return fs.readFileSync(path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'token'), 'utf8'); } catch { return ''; } })()).trim();
      if (!t) throw new PluginError('No Hugging Face login found. Run `huggingface-cli login` first.');
      return { token: t };
    },
  },

  tools: () => [
    {
      name: 'hf_search', title: 'Search the Hub', access: 'read',
      description: 'Search Hugging Face for models, datasets, Spaces or papers.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['kind', 'query'],
        properties: {
          kind: { type: 'string', enum: ['model', 'dataset', 'space', 'paper'] },
          query: { type: 'string' },
          task: { type: 'string', description: 'Models only: pipeline tag such as "text-generation" or "automatic-speech-recognition".' },
          author: { type: 'string', description: 'Restrict to an organization or user.' },
          sort: { type: 'string', enum: ['downloads', 'likes', 'trending', 'recent'], description: 'Default: downloads (models/datasets).' },
          limit: { type: 'number' },
        },
      },
      summarize: (a) => `${a.kind}: ${a.query}`,
      async run(ctx, a) {
        const n = limit(a.limit);
        if (a.kind === 'paper') {
          const r = await hf(ctx, `${hub()}/api/papers/search?${q({ q: a.query, limit: n })}`);
          return asText((Array.isArray(r) ? r : []).slice(0, n).map((x) => summary('paper', x)));
        }
        const kind = kindOf(a.kind);
        const sort = { downloads: 'downloads', likes: 'likes', trending: 'trendingScore', recent: 'lastModified' }[a.sort || 'downloads'];
        const r = await hf(ctx, `${hub()}/api/${KINDS[kind]}?${q({ search: a.query, limit: n, sort, direction: '-1', pipeline_tag: kind === 'model' ? a.task : undefined, author: a.author })}`);
        return asText(r.map((x) => summary(kind, x)));
      },
    },
    {
      name: 'hf_info', title: 'Get model, dataset or Space info', access: 'read',
      description: 'Get details for a model, dataset or Space, including its card (README) text.',
      parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { kind: { type: 'string', enum: ['model', 'dataset', 'space'] }, id: { type: 'string', description: 'Repo id such as "meta-llama/Llama-3.2-1B-Instruct".' } } },
      summarize: (a) => a.id,
      async run(ctx, a) {
        const kind = kindOf(a.kind), id = repoOf(a.id);
        const info = await hf(ctx, `${hub()}/api/${KINDS[kind]}/${id}`);
        let card = '';
        try { card = await hf(ctx, `${filePrefix(kind, id)}/resolve/main/README.md`); } catch { /* no card */ }
        return asText({ ...pick({ id: info.id, task: info.pipeline_tag, library: info.library_name, downloads: info.downloads, likes: info.likes, license: info.cardData?.license, gated: info.gated, private: info.private, updated: info.lastModified, sdk: info.sdk, tags: (info.tags || []).slice(0, 20), files: (info.siblings || []).slice(0, 40).map((s) => s.rfilename) }, ['id', 'task', 'library', 'downloads', 'likes', 'license', 'gated', 'private', 'updated', 'sdk', 'tags', 'files']), card: clip(String(card).replace(/^---[\s\S]*?---\n/, ''), 5000) });
      },
    },
    {
      name: 'hf_list_files', title: 'List repo files', access: 'read',
      description: 'List files in a model, dataset or Space repository.',
      parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { kind: { type: 'string', enum: ['model', 'dataset', 'space'] }, id: { type: 'string' }, path: { type: 'string', description: 'Subfolder (default: root).' }, revision: { type: 'string' }, recursive: { type: 'boolean' } } },
      summarize: (a) => `${a.id}/${a.path || ''}`,
      async run(ctx, a) {
        const kind = kindOf(a.kind), id = repoOf(a.id);
        const sub = String(a.path || '').replace(/^\/+/, '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
        const r = await hf(ctx, `${hub()}/api/${KINDS[kind]}/${id}/tree/${encodeURIComponent(a.revision || 'main')}${sub ? `/${sub}` : ''}${a.recursive ? '?recursive=true' : ''}`);
        return asText(r.slice(0, 200).map((e) => pick({ path: e.path, type: e.type, size: e.size }, ['path', 'type', 'size'])));
      },
    },
    {
      name: 'hf_read_file', title: 'Read a repo file', access: 'read',
      description: 'Read a text file from a model, dataset or Space repository (for example README.md, config.json, app.py).',
      parameters: { type: 'object', additionalProperties: false, required: ['id', 'path'], properties: { kind: { type: 'string', enum: ['model', 'dataset', 'space'] }, id: { type: 'string' }, path: { type: 'string' }, revision: { type: 'string' } } },
      summarize: (a) => `${a.id}/${a.path}`,
      async run(ctx, a) {
        const kind = kindOf(a.kind), id = repoOf(a.id);
        const file = String(a.path).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
        const r = await hf(ctx, `${filePrefix(kind, id)}/resolve/${encodeURIComponent(a.revision || 'main')}/${file}`, { raw: true });
        if (/^(image|audio|video)\//.test(r.res.headers.get('content-type') || '') || r.text.includes('\u0000')) throw new PluginError('That file is binary.');
        return clip(r.text, 60000);
      },
    },
    {
      name: 'hf_whoami', title: 'Show connected account', access: 'read',
      description: 'Show which Hugging Face account is connected (requires a token).',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      summarize: () => 'whoami',
      async run(ctx) {
        if (!ctx.secrets.get('token')) throw new PluginError('No token connected: only public access is available.');
        const me = await hf(ctx, `${hub()}/api/whoami-v2`);
        return asText({ ...pick(me, ['name', 'fullname', 'type']), orgs: (me.orgs || []).map((o) => o.name) });
      },
    },
    {
      name: 'hf_chat', title: 'Run a hosted model', access: 'write',
      description: 'Ask a hosted model on Hugging Face Inference Providers (OpenAI-compatible chat). Requires a token that can call Inference Providers; usage may be billed to that account.',
      parameters: { type: 'object', additionalProperties: false, required: ['model', 'prompt'], properties: { model: { type: 'string', description: 'Model id, e.g. "meta-llama/Llama-3.1-8B-Instruct". Optionally add ":provider".' }, prompt: { type: 'string' }, system: { type: 'string' }, max_tokens: { type: 'number' }, temperature: { type: 'number' } } },
      summarize: (a) => `${a.model}: ${clip(a.prompt, 80)}`,
      async run(ctx, a) {
        if (!ctx.secrets.get('token')) throw new PluginError('Running models needs a connected token (with Inference Providers permission).');
        const r = await hf(ctx, `${router()}/v1/chat/completions`, {
          method: 'POST', timeoutMs: 120000,
          json: { model: a.model, messages: [...(a.system ? [{ role: 'system', content: a.system }] : []), { role: 'user', content: a.prompt }], max_tokens: Math.min(Math.max(Number(a.max_tokens) || 512, 1), 4096), temperature: a.temperature },
        });
        return clip(r.choices?.[0]?.message?.content ?? asText(r), 20000);
      },
    },
  ],
};
