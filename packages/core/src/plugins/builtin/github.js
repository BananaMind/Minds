import { request, PluginError, clip, pick, asText, limit } from '../http.js';
import { execFile } from 'node:child_process';

const base = () => process.env.MINDS_GITHUB_API || 'https://api.github.com';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function gh(ctx, path, opts = {}) {
  const token = ctx.secrets.get('token');
  return request(`${base()}${path}`, {
    ...opts,
    signal: ctx.signal,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
  });
}
const repoPath = (repo) => {
  if (!REPO.test(String(repo || ''))) throw new PluginError('repo must look like "owner/name"');
  return `/repos/${repo}`;
};
const q = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')).toString();

const issueView = (i) => ({
  number: i.number, title: i.title, state: i.state, author: i.user?.login, labels: (i.labels || []).map((l) => l.name),
  comments: i.comments, created: i.created_at, updated: i.updated_at, url: i.html_url, pull_request: Boolean(i.pull_request) || undefined,
});

const common = { additionalProperties: false };
const repoProp = { type: 'string', description: 'Repository as "owner/name".' };

export default {
  id: 'github',
  name: 'GitHub',
  icon: 'github',
  description: 'Search repositories and code, read files, issues and pull requests, and optionally open issues and comment.',
  setup: {
    summary: 'Public repositories work without signing in (with lower rate limits). To use private repos or write, add a personal access token.',
    steps: [
      { text: 'Open GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.', link: 'https://github.com/settings/personal-access-tokens/new' },
      { text: 'Choose the repositories this app may use (or “All repositories”).' },
      { text: 'Repository permissions: Contents → Read-only, Metadata → Read-only. To let bots open issues and comment, also set Issues and Pull requests → Read and write.' },
      { text: 'Generate the token, copy it (it starts with github_pat_), and paste it below. Notifications require a classic token with the notifications scope; private repository access with a classic token needs repo.' },
    ],
    fields: [{ key: 'token', label: 'Personal access token', secret: true, placeholder: 'github_pat_…', required: false }],
    local: { label: 'Use my GitHub CLI login (gh)' },
  },
  publicOk: true,

  /** Validate credentials; returns what to persist. */
  async connect(fields, ctx) {
    const token = String(fields.token || '').trim();
    if (!token) return { secrets: {}, account: null, detail: 'Public access (no account)' };
    const me = await request(`${base()}/user`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }, signal: ctx.signal });
    return { secrets: { token }, account: me.login, detail: `Signed in as ${me.login}` };
  },

  local: {
    detect: () => new Promise((resolve) => execFile('gh', ['auth', 'status'], { timeout: 5000, windowsHide: true }, (err) => resolve(!err))),
    read: () => new Promise((resolve, reject) => execFile('gh', ['auth', 'token'], { timeout: 5000, windowsHide: true }, (err, out) => (err ? reject(new PluginError('Could not read your GitHub CLI login. Run `gh auth login` first.')) : resolve({ token: out.trim() })))),
  },

  tools: () => [
    {
      name: 'github_search_repos', title: 'Search repositories', access: 'read',
      description: 'Search GitHub repositories. Supports GitHub search qualifiers (e.g. "language:rust stars:>1000 topic:cli").',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Max results (default 10, max 30).' } }, required: ['query'], ...common },
      summarize: (a) => a.query,
      async run(ctx, a) {
        const r = await gh(ctx, `/search/repositories?${q({ q: a.query, per_page: limit(a.limit) })}`);
        return asText({ total: r.total_count, repositories: r.items.map((x) => pick({ name: x.full_name, description: x.description, stars: x.stargazers_count, language: x.language, updated: x.pushed_at, url: x.html_url }, ['name', 'description', 'stars', 'language', 'updated', 'url'])) });
      },
    },
    {
      name: 'github_search_code', title: 'Search code', access: 'read',
      description: 'Search code across GitHub (requires a connected token). Qualifiers like "repo:owner/name language:js path:src" work.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'], ...common },
      summarize: (a) => a.query,
      async run(ctx, a) {
        if (!ctx.secrets.get('token')) throw new PluginError('GitHub code search needs a connected token. Add one in Connect apps → GitHub.');
        const r = await gh(ctx, `/search/code?${q({ q: a.query, per_page: limit(a.limit) })}`);
        return asText({ total: r.total_count, results: r.items.map((x) => ({ repo: x.repository?.full_name, path: x.path, url: x.html_url })) });
      },
    },
    {
      name: 'github_search_issues', title: 'Search issues and pull requests', access: 'read',
      description: 'Search issues and pull requests. Example queries: "repo:owner/name is:open is:issue label:bug", "is:pr author:someone".',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'], ...common },
      summarize: (a) => a.query,
      async run(ctx, a) {
        const r = await gh(ctx, `/search/issues?${q({ q: a.query, per_page: limit(a.limit) })}`);
        return asText({ total: r.total_count, items: r.items.map((i) => ({ repo: i.repository_url?.split('/').slice(-2).join('/'), ...issueView(i) })) });
      },
    },
    {
      name: 'github_get_repo', title: 'Get repository', access: 'read',
      description: 'Get details about a repository: description, default branch, topics, license, open issue count, and the start of its README.',
      parameters: { type: 'object', properties: { repo: repoProp }, required: ['repo'], ...common },
      summarize: (a) => a.repo,
      async run(ctx, a) {
        const r = await gh(ctx, repoPath(a.repo));
        let readme = '';
        try { readme = Buffer.from((await gh(ctx, `${repoPath(a.repo)}/readme`)).content || '', 'base64').toString('utf8'); } catch { /* no readme */ }
        return asText({ ...pick({ name: r.full_name, description: r.description, private: r.private, default_branch: r.default_branch, topics: r.topics, license: r.license?.spdx_id, stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count, language: r.language, pushed: r.pushed_at, url: r.html_url }, ['name', 'description', 'private', 'default_branch', 'topics', 'license', 'stars', 'forks', 'open_issues', 'language', 'pushed', 'url']), readme: clip(readme, 3000) });
      },
    },
    {
      name: 'github_read_file', title: 'Read file or folder', access: 'read',
      description: 'Read a text file (or list a folder) from a repository.',
      parameters: { type: 'object', properties: { repo: repoProp, path: { type: 'string', description: 'Path inside the repo; empty for the root.' }, ref: { type: 'string', description: 'Branch, tag or commit (default: the default branch).' } }, required: ['repo'], ...common },
      summarize: (a) => `${a.repo}/${a.path || ''}`,
      async run(ctx, a) {
        const path = String(a.path || '').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
        const r = await gh(ctx, `${repoPath(a.repo)}/contents/${path}${a.ref ? `?${q({ ref: a.ref })}` : ''}`);
        if (Array.isArray(r)) return asText(r.map((e) => ({ name: e.name, type: e.type, size: e.size })));
        if (r.type !== 'file') return asText(pick(r, ['name', 'type', 'path', 'target']));
        if (r.encoding !== 'base64') throw new PluginError('File is too large to read through the API. Use exec_command with git to clone it.');
        return clip(Buffer.from(r.content, 'base64').toString('utf8'), 60000);
      },
    },
    {
      name: 'github_list_issues', title: 'List issues', access: 'read',
      description: 'List issues in a repository (pull requests are excluded unless include_prs is true).',
      parameters: { type: 'object', properties: { repo: repoProp, state: { type: 'string', enum: ['open', 'closed', 'all'] }, labels: { type: 'string', description: 'Comma-separated label names.' }, include_prs: { type: 'boolean' }, limit: { type: 'number' } }, required: ['repo'], ...common },
      summarize: (a) => a.repo,
      async run(ctx, a) {
        const r = await gh(ctx, `${repoPath(a.repo)}/issues?${q({ state: a.state || 'open', labels: a.labels, per_page: 50 })}`);
        return asText(r.filter((i) => a.include_prs || !i.pull_request).slice(0, limit(a.limit)).map(issueView));
      },
    },
    {
      name: 'github_get_issue', title: 'Read issue or pull request', access: 'read',
      description: 'Read an issue or pull request with its description and recent comments. For pull requests, also lists changed files (set include_diff for patches).',
      parameters: { type: 'object', properties: { repo: repoProp, number: { type: 'number' }, include_diff: { type: 'boolean' } }, required: ['repo', 'number'], ...common },
      summarize: (a) => `${a.repo}#${a.number}`,
      async run(ctx, a) {
        const base = repoPath(a.repo);
        const issue = await gh(ctx, `${base}/issues/${Number(a.number)}`);
        const comments = await gh(ctx, `${base}/issues/${Number(a.number)}/comments?per_page=20`);
        const out = { ...issueView(issue), body: clip(issue.body, 6000), comments_list: comments.map((c) => ({ author: c.user?.login, at: c.created_at, body: clip(c.body, 1500) })) };
        if (issue.pull_request) {
          const files = await gh(ctx, `${base}/pulls/${Number(a.number)}/files?per_page=40`);
          out.files = files.map((f) => ({ file: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, ...(a.include_diff ? { patch: clip(f.patch, 3000) } : {}) }));
        }
        return asText(out);
      },
    },
    {
      name: 'github_list_commits', title: 'List commits', access: 'read',
      description: 'List recent commits on a repository, optionally for one path or branch.',
      parameters: { type: 'object', properties: { repo: repoProp, path: { type: 'string' }, ref: { type: 'string' }, limit: { type: 'number' } }, required: ['repo'], ...common },
      summarize: (a) => a.repo,
      async run(ctx, a) {
        const r = await gh(ctx, `${repoPath(a.repo)}/commits?${q({ path: a.path, sha: a.ref, per_page: limit(a.limit) })}`);
        return asText(r.map((c) => ({ sha: c.sha.slice(0, 8), author: c.commit.author?.name, date: c.commit.author?.date, message: clip(c.commit.message.split('\n')[0], 200) })));
      },
    },
    {
      name: 'github_notifications', title: 'List notifications', access: 'read',
      description: 'List your unread GitHub notifications (requires a classic personal access token with notifications scope).',
      parameters: { type: 'object', properties: { all: { type: 'boolean', description: 'Include read notifications.' }, limit: { type: 'number' } }, ...common },
      summarize: () => 'notifications',
      async run(ctx, a) {
        if (!ctx.secrets.get('token')) throw new PluginError('Notifications need a connected token.');
        const r = await gh(ctx, `/notifications?${q({ all: a.all ? 'true' : '', per_page: limit(a.limit, 20, 50) })}`);
        return asText(r.map((n) => ({ repo: n.repository?.full_name, type: n.subject?.type, title: n.subject?.title, reason: n.reason, updated: n.updated_at, unread: n.unread })));
      },
    },
    {
      name: 'github_create_issue', title: 'Open an issue', access: 'write',
      description: 'Open a new issue in a repository.',
      parameters: { type: 'object', properties: { repo: repoProp, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['repo', 'title'], ...common },
      summarize: (a) => `${a.repo}: ${a.title}`,
      async run(ctx, a) {
        const r = await gh(ctx, `${repoPath(a.repo)}/issues`, { method: 'POST', json: { title: a.title, body: a.body || '', labels: a.labels } });
        return asText({ created: r.html_url, number: r.number });
      },
    },
    {
      name: 'github_comment', title: 'Comment on an issue or pull request', access: 'write',
      description: 'Add a comment to an issue or pull request.',
      parameters: { type: 'object', properties: { repo: repoProp, number: { type: 'number' }, body: { type: 'string' } }, required: ['repo', 'number', 'body'], ...common },
      summarize: (a) => `${a.repo}#${a.number}: ${clip(a.body, 80)}`,
      async run(ctx, a) {
        const r = await gh(ctx, `${repoPath(a.repo)}/issues/${Number(a.number)}/comments`, { method: 'POST', json: { body: a.body } });
        return asText({ commented: r.html_url });
      },
    },
    {
      name: 'github_update_issue', title: 'Update an issue', access: 'write',
      description: 'Change an issue or pull request: close or reopen it, retitle it, or set its labels.',
      parameters: { type: 'object', properties: { repo: repoProp, number: { type: 'number' }, state: { type: 'string', enum: ['open', 'closed'] }, title: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['repo', 'number'], ...common },
      summarize: (a) => `${a.repo}#${a.number}${a.state ? ` → ${a.state}` : ''}`,
      async run(ctx, a) {
        const r = await gh(ctx, `${repoPath(a.repo)}/issues/${Number(a.number)}`, { method: 'PATCH', json: pick(a, ['state', 'title', 'labels']) });
        return asText({ updated: r.html_url, state: r.state });
      },
    },
  ],
};
