import { readFileSync } from 'node:fs';
import { marked } from 'marked';

const TEMPLATE = readFileSync(new URL('./templates/guide.html', import.meta.url), 'utf8');

/** La guía en HTML para leer en el navegador (#148). El título sale del primer `# `. */
export function renderGuidePage(markdown: string, version: string): string {
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? 'Guía para integradores';
  const content = marked.parse(markdown, { async: false });
  return TEMPLATE.replaceAll('{{title}}', title)
    .replaceAll('{{version}}', version)
    .replace('{{content}}', content);
}
