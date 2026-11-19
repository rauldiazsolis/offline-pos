import type { PendingExportFile } from '../sync/pending-export.ts';

/**
 * Adaptadores del navegador de la pantalla "caja vinculada en otro dispositivo" (4.7.0, #230),
 * aparte del controller para que sus tests los reemplacen.
 */

/** Baja el `.json` de lo pendiente con `<a download>`, como `pos.export()`. */
export function downloadPendingFile(file: PendingExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function reloadPage(): void {
  window.location.reload();
}
