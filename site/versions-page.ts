import { isCompatibleContract } from '../src/domain/contract-version.ts';
import type { BackendEntry } from './backends.ts';
import type { BackendFacts } from './query-backend.ts';
import type { VersionInfo } from './version-info.ts';

export type KnownBackend = { entry: BackendEntry; facts: BackendFacts };
export type Cell = { kind: 'demo'; href: string } | { kind: 'incompatible'; text: string };

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Misma regla que el POS (`isCompatibleContract`), con el piso de cada carpeta publicada. */
export function cellFor(version: VersionInfo, backend: KnownBackend): Cell {
  if (isCompatibleContract(backend.facts.contract, version.minBackendContract)) {
    return {
      kind: 'demo',
      href: `../${version.version}/?demo=true&backend=${encodeURIComponent(backend.entry.url)}`,
    };
  }
  const major = version.minBackendContract.split('.')[0] ?? '';
  return {
    kind: 'incompatible',
    text: `Incompatible: el backend habla ${backend.facts.contract}; este POS acepta ${major}.x desde ${version.minBackendContract}`,
  };
}

const GENERATED_AT = /<time data-generated[^>]*>[^<]*<\/time>/;

export function sameIgnoringGeneratedAt(a: string, b: string): boolean {
  return a.replace(GENERATED_AT, '') === b.replace(GENERATED_AT, '');
}

function renderCell(cell: Cell): string {
  return cell.kind === 'demo'
    ? `<td><a href="${escape(cell.href)}">Abrir demo</a></td>`
    : `<td class="muted">${escape(cell.text)}</td>`;
}

/**
 * `/versions` (#148): todas las carpetas publicadas × la lista actual de backends. HTML plano, sin
 * JavaScript. Se regenera entera: si un backend cambia de contrato, las filas viejas lo reflejan.
 */
export function renderVersionsPage(
  versions: VersionInfo[],
  backends: KnownBackend[],
  generatedAt: string,
): string {
  const backendList = backends
    .map(
      ({
        entry,
        facts,
      }) => `<li><strong>${escape(entry.name)}</strong> · <code>${escape(entry.url)}</code>
        · contrato ${escape(facts.contract)} · capacidades: ${escape(facts.capabilities.join(', '))}
        ${entry.notes !== undefined ? `<br><span class="muted">${escape(entry.notes)}</span>` : ''}</li>`,
    )
    .join('\n');
  const header = backends.map(({ entry }) => `<th>${escape(entry.name)}</th>`).join('');
  const rows = versions
    .map(
      (version) => `<tr><th scope="row">${escape(version.version)}</th>
        <td>${escape(version.contract)}</td>
        <td><a href="../${escape(version.version)}/docs/">Docs</a></td>
        <td><a href="../${escape(version.version)}.zip">Zip</a></td>
        ${backends.map((backend) => renderCell(cellFor(version, backend))).join('')}</tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Versiones · offline-pos</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #666; --line: #ddd; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #e8e8e8; --muted: #999; --line: #333; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  .muted { color: var(--muted); }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); }
  a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>offline-pos: versiones publicadas</h1>
<p>Cada versión vive en su carpeta, nunca cambia y guarda sus datos aparte de las demás. El link de
demo abre esa versión conectada al backend. Docs para integradores y para IA en cada versión y en
<a href="../llms.txt">llms.txt</a>.</p>
<h2>Backends conocidos</h2>
<ul>
${backendList}
</ul>
<p class="muted">Consultados el <time data-generated datetime="${escape(generatedAt)}">${escape(generatedAt)}</time>.</p>
<h2>Versiones</h2>
<div class="scroll">
<table>
<thead><tr><th>Versión</th><th>Contrato</th><th>Docs</th><th>Zip</th>${header}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</main>
</body>
</html>
`;
}

/** `/llms.txt` del sitio (formato llmstxt.org): la versión más nueva primero. */
export function renderRootLlms(versions: VersionInfo[]): string {
  const latest = versions[0];
  const docs =
    latest === undefined
      ? ''
      : `## Docs

- [Guía para integradores (${latest.version})](${latest.version}/docs/guia.md): cómo probar el POS y cómo implementar el Connector API.
- [Connector API ${latest.contract} (OpenAPI)](${latest.version}/docs/connector-api.openapi.yaml): el contrato completo.

`;
  return `# offline-pos

> POS web offline-first y genérico que se conecta a cualquier backend que implemente el Connector API (REST/JSON versionado). Cada versión publicada vive en su carpeta inmutable, con sus propias docs para integradores.

${docs}## Versiones

${versions.map((v) => `- [${v.version}](${v.version}/docs/llms.txt): contrato ${v.contract}`).join('\n')}
`;
}
