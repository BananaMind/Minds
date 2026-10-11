import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });
DOMPurify.addHook('afterSanitizeAttributes', (n) => {
  if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
});

export function Markdown({ text }) {
  const html = DOMPurify.sanitize(marked.parse(text || ''));
  return <div class="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
