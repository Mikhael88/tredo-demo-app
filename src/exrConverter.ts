import parseExr from 'parse-exr';

/**
 * Converts an OpenEXR ArrayBuffer into a Radiance RGBE (.hdr) Blob
 * so it can be loaded natively by Babylon's HDRCubeTexture.
 */
export function convertExrToHdrBlob(exrBuffer: ArrayBuffer): Blob {
  // 1. Decode EXR using parse-exr
  const exrData: any = (parseExr as any).default ? (parseExr as any).default(exrBuffer) : (parseExr as any)(exrBuffer);
  const width = exrData.width;
  const height = exrData.height;
  const floatData: Float32Array = exrData.data;

  // Stride: 3 (RGB) or 4 (RGBA)
  const isRgba = floatData.length >= width * height * 4;
  const stride = isRgba ? 4 : 3;

  // 2. Prepare Radiance RGBE Header
  const headerStr = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(headerStr);

  // 3. Encode pixels to RGBE
  const bodyBytes = new Uint8Array(width * height * 4);
  let srcIdx = 0;
  let dstIdx = 0;

  for (let i = 0; i < width * height; i++) {
    const r = Math.max(0, floatData[srcIdx]);
    const g = Math.max(0, floatData[srcIdx + 1]);
    const b = Math.max(0, floatData[srcIdx + 2]);
    srcIdx += stride;

    const maxVal = Math.max(r, g, b);
    if (maxVal < 1e-32) {
      bodyBytes[dstIdx] = 0;
      bodyBytes[dstIdx + 1] = 0;
      bodyBytes[dstIdx + 2] = 0;
      bodyBytes[dstIdx + 3] = 0;
    } else {
      // Free-format exponent
      const e = Math.floor(Math.log2(maxVal)) + 1;
      const scale = Math.pow(2, -e) * 256.0;

      bodyBytes[dstIdx] = Math.min(255, Math.floor(r * scale));
      bodyBytes[dstIdx + 1] = Math.min(255, Math.floor(g * scale));
      bodyBytes[dstIdx + 2] = Math.min(255, Math.floor(b * scale));
      bodyBytes[dstIdx + 3] = Math.min(255, Math.max(0, e + 128));
    }
    dstIdx += 4;
  }

  // 4. Return Blob as Radiance HDR format
  return new Blob([headerBytes, bodyBytes], { type: 'image/vnd.radiance' });
}
