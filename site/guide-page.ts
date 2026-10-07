import { readFileSync } from 'node:fs';
import { marked } from 'marked';

const TEMPLATE = readFileSync(new URL('./templates/guide.html', import.meta.url), 'utf8');

/**
 * Una guía en HTML para leer en el navegador (#148). El título sale del primer `# `. `docsRoot` es
 * cómo llegar a `docs/` desde la carpeta de la guía (`'../'` desde `docs/google-sheets/`, #180): el
 * encabezado enlaza desde ahí al OpenAPI, a `llms.txt` y a la home; el Markdown es el de al lado.
 * `copyFile` (un archivo de la misma carpeta, #219) suma arriba "Copiar el código" y el link al
 * archivo.
 */
export function renderGuidePage(
  markdown: string,
  version: string,
  docsRoot = '',
  copyFile?: string,
): string {
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? 'Guía para integradores';
  const content = marked.parse(markdown, { async: false });
  return TEMPLATE.replaceAll('{{title}}', title)
    .replaceAll('{{version}}', version)
    .replaceAll('{{docsRoot}}', docsRoot)
    .replace('{{copy}}', copyFile === undefined ? '' : copyBlock(copyFile))
    .replace('{{content}}', content);
}

/**
 * El botón baja el archivo al abrir la página y lo copia sin esperar en el click: algunos
 * navegadores (Safari) solo dejan escribir el portapapeles durante el gesto del usuario. Sin
 * portapapeles queda el link, que lo descarga.
 */
function copyBlock(file: string): string {
  return `<p class="copy"><button type="button" id="copiar" disabled>Copiar el código</button>
        <a href="${file}" download>${file}</a> <span id="copiado" role="status"></span></p>
      <script>
        (function () {
          var boton = document.getElementById('copiar');
          var estado = document.getElementById('copiado');
          var codigo = null;
          fetch('${file}')
            .then(function (respuesta) {
              return respuesta.text();
            })
            .then(function (texto) {
              codigo = texto;
              boton.disabled = false;
            });
          boton.addEventListener('click', function () {
            navigator.clipboard.writeText(codigo).then(
              function () {
                estado.textContent = 'Copiado: pegalo en Código.gs.';
              },
              function () {
                estado.textContent = 'No se pudo copiar: descargalo con el link y copialo a mano.';
              },
            );
          });
        })();
      </script>`;
}
