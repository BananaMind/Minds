import test from 'node:test';
import assert from 'node:assert/strict';
import search, { searchResults } from '../src/tools/web_search.js';
import website from '../src/tools/fetch_website.js';
import { fetchText } from '../src/tools/web-utils.js';
import { review } from '../src/safety.js';
import { toolByName } from '../src/tools/index.js';

test('DuckDuckGo Lite extracts snippets, decodes result URLs and distinguishes challenges from no results', async () => {
  const html = `<table><tr><td><a class='result-link' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F%3Fq%3Da%26b%3Dc'>A &amp; B</a></td></tr>
    <tr><td class='result-snippet'>A <b>useful</b> snippet.</td></tr>
    <tr><td><a class='result-link' href='https://example.com/?q=a&amp;b=c'>Duplicate</a></td></tr>
    <tr><td><a class='result-link' href='https://second.example/'>Second</a></td></tr></table>`;
  const ctx = { fetch: async (url) => { assert.equal(new URL(url).searchParams.get('q'), 'a & b'); return new Response(html, { headers: { 'content-type': 'text/html' } }); } };
  const output = JSON.parse(await search.run(ctx, { query: 'a & b', limit: 2 }));
  assert.deepEqual(output.results[0], { title: 'A & B', url: 'https://example.com/?q=a&b=c', snippet: 'A useful snippet.' });
  assert.equal(output.results.length, 2);
  assert.throws(() => searchResults('<form id="challenge-form"></form>', 'https://lite.duckduckgo.com/', 5), /CAPTCHA/);
  assert.deepEqual(searchResults('<p>No results found.</p>', 'https://lite.duckduckgo.com/', 5), []);
  assert.throws(() => searchResults('<p>Unexpected page</p>', 'https://lite.duckduckgo.com/', 5), /recognizable/);
});

test('fetch_website follows redirects, extracts readable content and resolves links using the final page', async () => {
  let calls = 0;
  const ctx = { fetch: async (url) => {
    if (++calls === 1) return new Response(null, { status: 302, headers: { location: '/docs/' } });
    assert.equal(url, 'https://example.com/docs/');
    return new Response('<html><head><title>Guide &amp; help</title><style>hidden style</style></head><body><nav>Noise</nav><main><h1>Heading</h1><p>Read <a href="next">next</a>.</p><script>ignore me</script></main></body></html>', { headers: { 'content-type': 'text/html' } });
  } };
  const result = JSON.parse(await website.run(ctx, { url: 'https://example.com/start' }));
  assert.equal(result.url, 'https://example.com/docs/');
  assert.equal(result.title, 'Guide & help');
  assert.match(result.content, /Heading\nRead next\./);
  assert.doesNotMatch(result.content, /ignore me|hidden style|Noise/);
  assert.deepEqual(result.links, [{ text: 'next', url: 'https://example.com/docs/next' }]);
});

test('website fetching handles text, limits streaming size and rejects invalid redirects, binary data and cancelled requests', async () => {
  const text = JSON.parse(await website.run({ fetch: async () => new Response('x'.repeat(1500), { headers: { 'content-type': 'text/plain' } }) }, { url: 'https://example.com', max_chars: 1000 }));
  assert.equal(text.content.length, 1000); assert.equal(text.truncated, true);
  await assert.rejects(fetchText({}, 'file:///etc/passwd'), /HTTP and HTTPS/);
  await assert.rejects(fetchText({ fetch: async () => new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }) }, 'https://example.com'), /HTTP and HTTPS/);
  await assert.rejects(fetchText({ fetch: async () => new Response('binary', { headers: { 'content-type': 'image/png' } }) }, 'https://example.com'), /Unsupported content/);
  await assert.rejects(fetchText({ fetch: async () => new Response('too long') }, 'https://example.com', { maxBytes: 2 }), /byte limit/);
  await assert.rejects(fetchText({ signal: AbortSignal.abort(), fetch: () => assert.fail('Cancelled fetch ran') }, 'https://example.com'), { name: 'AbortError' });
});

test('web tools are registered and available as reads in ask mode', async () => {
  for (const tool of [search, website]) {
    assert.equal(toolByName(tool.name), tool);
    assert.equal((await review({}, tool.name, {}, { mode: 'ask' })).action, 'allow');
  }
});
