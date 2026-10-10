/**
 * La API de detección de códigos (Shape Detection API), que TypeScript todavía no trae. Solo lo que
 * usa `camera/scanner.tsx`. Existe en Chrome para Android; donde no, el escáner lo dice.
 */
declare global {
  interface DetectedBarcode {
    rawValue: string;
    format: string;
  }

  interface BarcodeDetector {
    detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
  }

  interface BarcodeDetectorConstructor {
    new (options?: { formats?: string[] }): BarcodeDetector;
    getSupportedFormats(): Promise<string[]>;
  }

  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

export {};
