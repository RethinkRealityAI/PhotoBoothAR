/** The pure encoder inside `qrcode` (no canvas, no fs). Only what qrMatrix.ts uses. */
declare module 'qrcode/lib/core/qrcode' {
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; version?: number; maskPattern?: number },
  ): { modules: { size: number; data: Uint8Array }; version: number };
}
