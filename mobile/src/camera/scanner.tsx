import { useEffect, useRef, useState } from 'preact/hooks';

export type ScanKind = 'qr' | 'product';

const FORMATS: Record<ScanKind, string[]> = {
  qr: ['qr_code'],
  product: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
};

/** Cada cuánto se mira un cuadro del video. */
const DETECT_EVERY_MS = 250;

type Status =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'unsupported' }
  | { kind: 'denied'; message: string };

/** Si este navegador puede leer códigos con la cámara (Chrome para Android, sí). */
export function canScan(): boolean {
  return (
    typeof window.BarcodeDetector === 'function' &&
    'mediaDevices' in navigator &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * Lee un código con la cámara trasera (adaptador de `getUserMedia` y `BarcodeDetector`, los únicos
 * `try/catch`). Avisa el primer código leído y deja de mirar; la cámara se apaga al desmontarse.
 */
export function Scanner({ kind, onCode }: { kind: ScanKind; onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>(() =>
    canScan() ? { kind: 'starting' } : { kind: 'unsupported' },
  );
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    const Detector = window.BarcodeDetector;
    if (Detector === undefined || !canScan()) {
      return;
    }
    const state: {
      stream?: MediaStream;
      timer?: ReturnType<typeof setTimeout>;
      stopped: boolean;
    } = { stopped: false };

    const stop = (): void => {
      state.stopped = true;
      if (state.timer !== undefined) clearTimeout(state.timer);
      state.stream?.getTracks().forEach((track) => {
        track.stop();
      });
    };

    void (async () => {
      try {
        const supported = await Detector.getSupportedFormats();
        const formats = FORMATS[kind].filter((format) => supported.includes(format));
        const detector = new Detector({ formats });
        state.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const video = videoRef.current;
        if (state.stopped || video === null) {
          stop();
          return;
        }
        video.srcObject = state.stream;
        await video.play();
        setStatus({ kind: 'scanning' });
        const tick = async (): Promise<void> => {
          if (state.stopped) return;
          try {
            const codes = await detector.detect(video);
            const first = codes[0];
            if (first !== undefined && first.rawValue !== '') {
              stop();
              onCodeRef.current(first.rawValue);
              return;
            }
          } catch {
            // Un cuadro que no se pudo analizar: se sigue con el próximo.
          }
          state.timer = setTimeout(() => void tick(), DETECT_EVERY_MS);
        };
        void tick();
      } catch (error) {
        stop();
        const name = error instanceof Error ? error.name : '';
        setStatus({
          kind: 'denied',
          message:
            name === 'NotAllowedError'
              ? 'No hay permiso para usar la cámara. Habilitalo en los permisos del sitio.'
              : 'No se pudo abrir la cámara.',
        });
      }
    })();
    return stop;
  }, [kind]);

  if (status.kind === 'unsupported') {
    return (
      <p class="note" role="status">
        Este navegador no puede leer códigos con la cámara. Usá Chrome en Android.
      </p>
    );
  }
  if (status.kind === 'denied') {
    return (
      <p class="note" role="alert">
        {status.message}
      </p>
    );
  }
  return (
    <div class="stack">
      <div class="scanner">
        <video ref={videoRef} muted playsInline />
        <div class="frame" />
      </div>
      <p class="note" role="status">
        {status.kind === 'starting'
          ? 'Abriendo la cámara…'
          : kind === 'qr'
            ? 'Apuntá al código QR.'
            : 'Apuntá al código de barras.'}
      </p>
    </div>
  );
}
