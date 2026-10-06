import { readFileSync } from 'node:fs';
import { marked } from 'marked';

const TEMPLATE = readFileSync(new URL('./templates/guide.html', import.meta.url), 'utf8');

/**
 * Una guía en HTML para leer en el navegador (#148). El título sale del primer `# `. `docsRoot` es
 * cómo llegar a `docs/` desde la carpeta de la guía (`'../'` desde `docs/google-sheets/`, #180): el
 * encabezado enlaza desde ahí al OpenAPI, a `llms.txt` y a la home; el Markdown es el de al lado.
 */
export function renderGuidePage(markdown: string, version: string, docsRoot = ''): string {
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? 'Guía para integradores';
  const content = marked.parse(markdown, { async: false });
  return TEMPLATE.replaceAll('{{title}}', title)
    .replaceAll('{{version}}', version)
    .replaceAll('{{docsRoot}}', docsRoot)
    .replace('{{content}}', content);
}
