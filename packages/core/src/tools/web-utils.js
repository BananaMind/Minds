import { parseHTML } from 'linkedom';

export function webUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (url.username || url.password) throw new Error('URLs containing login credentials are not supported.');
  return url;
}

export async function fetchText(ctx, value, { maxBytes = 3_000_000 } = {}) {
  let url = webUrl(value);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects <= 8; redirects++) {
    signal.throwIfAborted();
    const response = await (ctx.fetch || fetch)(url.href, {
      signal, redirect: 'manual', headers: { 'User-Agent': 'Minds/0.1 (web tools)', Accept: 'text/html, text/plain, application/json;q=0.9, application/xml;q=0.8' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error(`HTTP ${response.status}: redirect has no destination.`);
      url = webUrl(location, url);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url.href}`); }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/^(text\/|application\/(?:json|xml|xhtml\+xml|[^;]+\+json|[^;]+\+xml))/i.test(contentType)) {
      await response.body?.cancel();
      throw new Error(`Unsupported content type: ${contentType}. This tool reads HTML and text, not binary files.`);
    }
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error(`Website exceeds the ${maxBytes}-byte limit.`); }
    const reader = response.body?.getReader();
    if (!reader) return { url: url.href, text: '', contentType, status: response.status };
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new Error(`Website exceeds the ${maxBytes}-byte limit.`);
        chunks.push(chunk);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] || 'utf-8';
    let decoder;
    try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
    return { url: url.href, text: decoder.decode(Buffer.concat(chunks)), contentType, status: response.status };
  }
  throw new Error('Too many website redirects.');
}

export function htmlDocument(html) { return parseHTML(/<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`).document; }
export const cleanText = (value) => String(value || '').replace(/[\t \f\v\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export function pageText(document) {
  for (const element of document.querySelectorAll('script,style,noscript,template,svg,nav,footer,[hidden],[aria-hidden="true"]')) element.remove();
  const root = document.querySelector('main,article') || document.body || document.documentElement;
  for (const element of root.querySelectorAll('p,div,section,article,li,tr,br,h1,h2,h3,h4,h5,h6,pre,blockquote')) {
    element.appendChild(document.createTextNode('\n'));
  }
  return cleanText(root.textContent);
}
