import { isCompatibleContract } from '../src/domain/contract-version.ts';
import type { BackendEntry } from './backends.ts';
import { channelFor, type ChannelInfo } from './channel-info.ts';
import type { BackendFacts } from './query-backend.ts';

export type KnownBackend = { entry: BackendEntry; facts: BackendFacts };
export type Action = { kind: 'demo'; href: string } | { kind: 'incompatible'; text: string };

const TAGS_URL = 'https://github.com/rauldiazsolis/offline-pos/tags';

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Qué puede hacer quien entra con cada backend (#54): abrir una demo en el canal del major de su
 * contrato, si existe y su piso lo acepta (misma regla que el POS, `isCompatibleContract`).
 */
export function actionFor(backend: KnownBackend, channels: ChannelInfo[]): Action {
  const { contract } = backend.facts;
  const major = contract.split('.')[0] ?? '';
  const channel = channels.find((c) => c.channel === channelFor(contract));
  if (channel === undefined) {
    return { kind: 'incompatible', text: `Incompatible: no hay POS para el contrato ${major}.x` };
  }
  if (!isCompatibleContract(contract, channel.minBackendContract)) {
    return {
      kind: 'incompatible',
      text: `Incompatible: el backend habla ${contract}; el POS de /${channel.channel}/ acepta ${major}.x desde ${channel.minBackendContract}`,
    };
  }
  return {
    kind: 'demo',
    href: `${channel.channel}/?demo=true&backend=${encodeURIComponent(backend.entry.url)}`,
  };
}

const GENERATED_AT = /<time data-generated[^>]*>[^<]*<\/time>/;

export function sameIgnoringGeneratedAt(a: string, b: string): boolean {
  return a.replace(GENERATED_AT, '') === b.replace(GENERATED_AT, '');
}

function renderAction(action: Action): string {
  return action.kind === 'demo'
    ? `<td><a href="${escape(action.href)}">Abrir demo</a></td>`
    : `<td class="muted">${escape(action.text)}</td>`;
}

/**
 * La home del sitio (#54, reemplaza a `/versions` de #148): los backends conocidos, cada uno con su
 * link de demo al canal de su contrato, y para integradores las docs de cada canal. Quien entra
 * elige el backend, no la versión del POS (esa llega sola por el service worker). HTML plano, sin
 * JavaScript; se regenera entera.
 */
export function renderHomePage(
  channels: ChannelInfo[],
  backends: KnownBackend[],
  generatedAt: string,
): string {
  const rows = backends
    .map(
      (backend) => `<tr><th scope="row">${escape(backend.entry.name)}<br><code>${escape(backend.entry.url)}</code>${
        backend.entry.notes !== undefined
          ? `<br><span class="muted">${escape(backend.entry.notes)}</span>`
          : ''
      }</th>
        <td>${escape(backend.facts.contract)}</td>
        <td>${escape(backend.facts.capabilities.join(', '))}</td>
        ${renderAction(actionFor(backend, channels))}</tr>`,
    )
    .join('\n');
  const channelList = channels
    .map(
      (c) =>
        `<li><code>/${escape(c.channel)}/</code>: POS ${escape(c.version)}, contrato ${escape(c.contract)} · <a href="${escape(c.channel)}/docs/">Docs</a></li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>offline-pos</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #666; --line: #ddd; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #e8e8e8; --muted: #999; --line: #333; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  .muted { color: var(--muted); font-weight: normal; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>offline-pos</h1>
<p>POS web offline-first para comercios, que se conecta a cualquier backend que implemente el
Connector API. Elegí un backend y abrí una demo: el POS se instala en su canal y se actualiza solo.</p>
<h2>Backends</h2>
<div class="scroll">
<table>
<thead><tr><th>Backend</th><th>Contrato</th><th>Capacidades</th><th>Demo</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p class="muted">Consultados el <time data-generated datetime="${escape(generatedAt)}">${escape(generatedAt)}</time>.</p>
<h2>Para integradores</h2>
<ul>
${channelList}
</ul>
<p>Una versión exacta del POS: <a href="${TAGS_URL}">tags del repo</a>. Índice para IA:
<a href="llms.txt">llms.txt</a>.</p>
</main>
</body>
</html>
`;
}

/** `/llms.txt` del sitio (formato llmstxt.org): las docs del canal más nuevo y la lista de canales. */
export function renderRootLlms(channels: ChannelInfo[]): string {
  const latest = channels[0];
  const docs =
    latest === undefined
      ? ''
      : `## Docs

- [Guía para integradores (/${latest.channel}/, POS ${latest.version})](${latest.channel}/docs/guia.md): cómo probar el POS y cómo implementar el Connector API.
- [Connector API ${latest.contract} (OpenAPI)](${latest.channel}/docs/connector-api.openapi.yaml): el contrato completo.

`;
  return `# offline-pos

> POS web offline-first y genérico que se conecta a cualquier backend que implemente el Connector API (REST/JSON versionado). Cada canal (\`/v4/\`) sirve el último POS de ese major del contrato y se actualiza solo; una versión exacta está en los tags del repo (${TAGS_URL}).

${docs}## Canales

${channels.map((c) => `- [/${c.channel}/](${c.channel}/docs/llms.txt): contrato ${c.contract}`).join('\n')}
`;
}
