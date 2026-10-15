import parseExr from 'parse-exr';

/**
 * HDRI-to-CubeMap Converter
 * Based on https://github.com/matheowis/HDRI-to-CubeMap
 * 
 * Ingests spherical equirectangular HDRI images (.hdr and .exr)
 * and converts them autonomously into 4x3 Horizontal Cross Cubemaps saved in HDR format (.hdr).
 */

export interface DecodedHdrImage {
  width: number;
  height: number;
  data: Float32Array; // Stride 3: RGB in linear float
}

export interface CubemapCrossResult {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  faceSize: number;
  floatData: Float32Array; // RGB linear float data of the 4x3 cross
  rgbeData: Uint8Array;    // Raw RGBE data
}

/**
 * Read string line from Uint8Array
 */
function readStringLine(uint8array: Uint8Array, startIndex: number): string {
  let line = '';
  for (let i = startIndex; i < uint8array.length; i++) {
    const charCode = uint8array[i];
    if (charCode === 10) { // '\n'
      break;
    }
    line += String.fromCharCode(charCode);
  }
  return line;
}

/**
 * Decodes a Radiance RGBE (.hdr) ArrayBuffer into linear RGB Float32Array
 */
export function decodeHdr(buffer: ArrayBuffer): DecodedHdrImage {
  const bytes = new Uint8Array(buffer);
  
  // 1. Parse header
  let lineIndex = 0;
  let line = readStringLine(bytes, lineIndex);
  if (!line.startsWith('#?') && !line.startsWith('#')) {
    throw new Error('Formato HDR non valido: header Radiance mancante.');
  }

  let endOfHeader = false;
  let hasFormat = false;

  while (!endOfHeader && lineIndex < bytes.length) {
    lineIndex += line.length + 1;
    line = readStringLine(bytes, lineIndex);
    if (line.includes('FORMAT=32-bit_rle_rgbe')) {
      hasFormat = true;
    } else if (line.trim().length === 0) {
      endOfHeader = true;
    }
  }

  if (!hasFormat) {
    throw new Error('Header HDR non supportato: richiesto FORMAT=32-bit_rle_rgbe');
  }

  lineIndex += line.length + 1;
  line = readStringLine(bytes, lineIndex);
  const sizeMatch = /-Y\s+(\d+)\s+\+X\s+(\d+)/.exec(line);
  if (!sizeMatch) {
    throw new Error(`Risoluzione HDR non valida: "${line}"`);
  }

  const height = parseInt(sizeMatch[1], 10);
  const width = parseInt(sizeMatch[2], 10);
  let dataPos = lineIndex + line.length + 1;

  // 2. Decode scanlines into linear float RGB
  const floatData = new Float32Array(width * height * 3);
  const scanlineBuf = new Uint8Array(width * 4);

  for (let y = 0; y < height; y++) {
    if (dataPos >= bytes.length) break;

    const b0 = bytes[dataPos++];
    const b1 = bytes[dataPos++];
    const b2 = bytes[dataPos++];
    const b3 = bytes[dataPos++];

    if (b0 === 2 && b1 === 2 && (b2 & 0x80) === 0) {
      // Standard Radiance RLE scanline
      const scanlineWidth = (b2 << 8) | b3;
      if (scanlineWidth !== width) {
        throw new Error(`Dimensione scanline HDR discordante: atteso ${width}, trovato ${scanlineWidth}`);
      }

      // Read 4 channels: R, G, B, E
      for (let ch = 0; ch < 4; ch++) {
        let chPos = 0;
        while (chPos < width && dataPos < bytes.length) {
          const countOrVal = bytes[dataPos++];
          if (countOrVal > 128) {
            // Run length
            const count = countOrVal - 128;
            const val = bytes[dataPos++];
            for (let k = 0; k < count && chPos < width; k++) {
              scanlineBuf[chPos * 4 + ch] = val;
              chPos++;
            }
          } else {
            // Literal
            const count = countOrVal;
            for (let k = 0; k < count && chPos < width; k++) {
              scanlineBuf[chPos * 4 + ch] = bytes[dataPos++];
              chPos++;
            }
          }
        }
      }
    } else {
      // Uncompressed scanline
      scanlineBuf[0] = b0;
      scanlineBuf[1] = b1;
      scanlineBuf[2] = b2;
      scanlineBuf[3] = b3;
      for (let i = 1; i < width; i++) {
        scanlineBuf[i * 4] = bytes[dataPos++];
        scanlineBuf[i * 4 + 1] = bytes[dataPos++];
        scanlineBuf[i * 4 + 2] = bytes[dataPos++];
        scanlineBuf[i * 4 + 3] = bytes[dataPos++];
      }
    }

    // Convert scanline RGBE to Float32Array RGB
    const rowOffset = y * width * 3;
    for (let x = 0; x < width; x++) {
      const r = scanlineBuf[x * 4];
      const g = scanlineBuf[x * 4 + 1];
      const b = scanlineBuf[x * 4 + 2];
      const e = scanlineBuf[x * 4 + 3];

      const outIdx = rowOffset + x * 3;
      if (e > 0) {
        const factor = Math.pow(2.0, e - (128 + 8));
        floatData[outIdx] = r * factor;
        floatData[outIdx + 1] = g * factor;
        floatData[outIdx + 2] = b * factor;
      } else {
        floatData[outIdx] = 0;
        floatData[outIdx + 1] = 0;
        floatData[outIdx + 2] = 0;
      }
    }
  }

  return { width, height, data: floatData };
}

/**
 * Decodes OpenEXR ArrayBuffer into linear RGB Float32Array
 */
export function decodeExr(buffer: ArrayBuffer): DecodedHdrImage {
  const exrData: any = (parseExr as any).default ? (parseExr as any).default(buffer) : (parseExr as any)(buffer);
  const width = exrData.width;
  const height = exrData.height;
  const rawData: Float32Array = exrData.data;

  const isRgba = rawData.length >= width * height * 4;
  const floatData = new Float32Array(width * height * 3);

  let srcIdx = 0;
  let dstIdx = 0;
  for (let i = 0; i < width * height; i++) {
    floatData[dstIdx] = Math.max(0, rawData[srcIdx]);
    floatData[dstIdx + 1] = Math.max(0, rawData[srcIdx + 1]);
    floatData[dstIdx + 2] = Math.max(0, rawData[srcIdx + 2]);
    dstIdx += 3;
    srcIdx += isRgba ? 4 : 3;
  }

  return { width, height, data: floatData };
}

/**
 * Convert linear RGB float to RGBE bytes
 */
export function floatToRgbe(r: number, g: number, b: number): [number, number, number, number] {
  const maxVal = Math.max(r, g, b);
  if (maxVal < 1e-32) {
    return [0, 0, 0, 0];
  }
  const exp = Math.floor(Math.log2(maxVal)) + 1;
  const scale = Math.pow(2, -exp) * 256.0;
  return [
    Math.min(255, Math.floor(r * scale)),
    Math.min(255, Math.floor(g * scale)),
    Math.min(255, Math.floor(b * scale)),
    Math.min(255, Math.max(0, exp + 128))
  ];
}

/**
 * Projects an Equirectangular spherical HDRI to a 4x3 Horizontal Cross Cubemap.
 * 
 * Layout matching user reference and matheowis/HDRI-to-CubeMap (Unity cross layout):
 * Total Width:  faceSize * 4
 * Total Height: faceSize * 3
 * 
 * Grid:
 * Row 0: [ Empty,    Top (+Y),   Empty,     Empty ]
 * Row 1: [ Left (-X), Front (+Z), Right (+X), Back (-Z) ]
 * Row 2: [ Empty,    Bottom (-Y), Empty,     Empty ]
 */
export function equirectangularToCubemapCross(
  input: DecodedHdrImage,
  faceSize: number = 512,
  onProgress?: (progress0to1: number) => void
): { width: number; height: number; rgbeData: Uint8Array; floatData: Float32Array } {
  const inputW = input.width;
  const inputH = input.height;
  const inputData = input.data;

  const totalW = faceSize * 4;
  const totalH = faceSize * 3;

  const rgbeData = new Uint8Array(totalW * totalH * 4);
  const floatData = new Float32Array(totalW * totalH * 3);

  // 6 faces definition and placement in the 4x3 grid
  const faces = [
    { name: 'top', col: 1, row: 0 },
    { name: 'left', col: 0, row: 1 },
    { name: 'front', col: 1, row: 1 },
    { name: 'right', col: 2, row: 1 },
    { name: 'back', col: 3, row: 1 },
    { name: 'bottom', col: 1, row: 2 }
  ];

  let completedFaces = 0;

  for (const face of faces) {
    const startX = face.col * faceSize;
    const startY = face.row * faceSize;
    const faceName = face.name;

    for (let py = 0; py < faceSize; py++) {
      // Local vertical coordinate: vf in [1, -1] from top to bottom
      const vf = 1.0 - ((py + 0.5) / faceSize) * 2.0;
      const targetRow = (startY + py) * totalW;

      for (let px = 0; px < faceSize; px++) {
        // Local horizontal coordinate: uf in [-1, 1] from left to right
        const uf = ((px + 0.5) / faceSize) * 2.0 - 1.0;

        // Calculate 3D direction vector based on face
        let X = 0, Y = 0, Z = 0;
        if (faceName === 'front') {
          X = uf; Y = vf; Z = 1;
        } else if (faceName === 'right') {
          X = 1; Y = vf; Z = -uf;
        } else if (faceName === 'back') {
          X = -uf; Y = vf; Z = -1;
        } else if (faceName === 'left') {
          X = -1; Y = vf; Z = uf;
        } else if (faceName === 'top') {
          X = uf; Y = 1; Z = -vf;
        } else if (faceName === 'bottom') {
          X = uf; Y = -1; Z = vf;
        }

        // Normalize direction vector
        const invLen = 1.0 / Math.hypot(X, Y, Z);
        const dx = X * invLen;
        const dy = Y * invLen;
        const dz = Z * invLen;

        // Spherical coordinates mapping (Longitude & Latitude)
        const lon = Math.atan2(dx, dz);
        const lat = Math.asin(Math.max(-1.0, Math.min(1.0, dy)));

        const u = (lon / Math.PI) * 0.5 + 0.5;
        const v = 0.5 - (lat / Math.PI);

        // Bilinear interpolation in linear HDR space
        const sx = u * inputW - 0.5;
        const sy = v * inputH - 0.5;
        let x0 = Math.floor(sx);
        let y0 = Math.floor(sy);
        const fx = sx - x0;
        const fy = sy - y0;

        let x1 = x0 + 1;
        let y1 = y0 + 1;

        // Wrap longitude periodically
        x0 = ((x0 % inputW) + inputW) % inputW;
        x1 = ((x1 % inputW) + inputW) % inputW;
        // Clamp latitude at poles
        y0 = Math.max(0, Math.min(inputH - 1, y0));
        y1 = Math.max(0, Math.min(inputH - 1, y1));

        const w00 = (1.0 - fx) * (1.0 - fy);
        const w10 = fx * (1.0 - fy);
        const w01 = (1.0 - fx) * fy;
        const w11 = fx * fy;

        const idx00 = (y0 * inputW + x0) * 3;
        const idx10 = (y0 * inputW + x1) * 3;
        const idx01 = (y1 * inputW + x0) * 3;
        const idx11 = (y1 * inputW + x1) * 3;

        const r = inputData[idx00] * w00 + inputData[idx10] * w10 + inputData[idx01] * w01 + inputData[idx11] * w11;
        const g = inputData[idx00 + 1] * w00 + inputData[idx10 + 1] * w10 + inputData[idx01 + 1] * w01 + inputData[idx11 + 1] * w11;
        const b = inputData[idx00 + 2] * w00 + inputData[idx10 + 2] * w10 + inputData[idx01 + 2] * w01 + inputData[idx11 + 2] * w11;

        // Store linear float
        const floatDst = (targetRow + startX + px) * 3;
        floatData[floatDst] = r;
        floatData[floatDst + 1] = g;
        floatData[floatDst + 2] = b;

        // Store RGBE bytes
        const rgbe = floatToRgbe(r, g, b);
        const rgbeDst = (targetRow + startX + px) * 4;
        rgbeData[rgbeDst] = rgbe[0];
        rgbeData[rgbeDst + 1] = rgbe[1];
        rgbeData[rgbeDst + 2] = rgbe[2];
        rgbeData[rgbeDst + 3] = rgbe[3];
      }
    }

    completedFaces++;
    if (onProgress) {
      onProgress(completedFaces / faces.length);
    }
  }

  return { width: totalW, height: totalH, rgbeData, floatData };
}

/**
 * Encodes RGBE buffer into standard Radiance RLE .hdr file
 * Matches hdrConverterEmissive.js + hdrEmissive.worker.js in matheowis/HDRI-to-CubeMap
 */
export function encodeRleHdr(width: number, height: number, rgbeBuffer: Uint8Array): Blob {
  class ByteData {
    binaryData: Uint8Array;
    private _cIndex = 0;
    constructor(size: number) {
      this.binaryData = new Uint8Array(size);
    }
    push(...bytes: number[]) {
      for (let i = 0; i < bytes.length; i++) {
        this.binaryData[this._cIndex++] = bytes[i];
      }
    }
  }

  const getLine = (y: number, channel: number) => {
    const array: { value: number; length: number }[] = [];
    let localVal = 0;
    let localLength = 0;
    const lengthConstant = 128;
    const rowOffset = y * width * 4;

    for (let i = 0; i < width * 4; i += 4) {
      const val = rgbeBuffer[rowOffset + i + channel];
      if (localLength === 0) {
        localVal = val;
        localLength = 1;
      } else if (localVal === val && localLength < 127) {
        localLength++;
      } else {
        array.push({ value: localVal, length: localLength + lengthConstant });
        localVal = val;
        localLength = 1;
      }
    }
    array.push({ value: localVal, length: localLength + lengthConstant });
    return array;
  };

  const compressed: { value: number; length: number }[][][] = [];
  let fileSize = 0;

  for (let i = 0; i < height; i++) {
    const lineReds = getLine(i, 0);
    const lineGreens = getLine(i, 1);
    const lineBlues = getLine(i, 2);
    const lineEmissive = getLine(i, 3);
    const lineInitiator = 4;
    fileSize += lineInitiator + lineReds.length * 2 + lineGreens.length * 2 + lineBlues.length * 2 + lineEmissive.length * 2;
    compressed.push([lineReds, lineGreens, lineBlues, lineEmissive]);
  }

  const byteData = new ByteData(fileSize);
  const hi = (width >> 8) & 0xff;
  const lo = width & 0xff;

  for (let i = 0; i < height; i++) {
    // Each line starts with: 2, 2, high_byte, low_byte
    byteData.push(2, 2, hi, lo);
    for (let ch = 0; ch < 4; ch++) {
      const runs = compressed[i][ch];
      for (let r = 0; r < runs.length; r++) {
        byteData.push(runs[r].length, runs[r].value);
      }
    }
  }

  const headerStr = `#?RADIANCE\n# Made with TREDO Studio (HDRI-to-CubeMap)\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(headerStr);

  const fullBytes = new Uint8Array(headerBytes.length + byteData.binaryData.length);
  fullBytes.set(headerBytes, 0);
  fullBytes.set(byteData.binaryData, headerBytes.length);

  return new Blob([fullBytes], { type: 'image/vnd.radiance' });
}

export function isCubemapCross(width: number, height: number): boolean {
  return width > 0 && height > 0 && Math.abs(width / height - 4 / 3) < 0.05;
}

export function isSphericalPanorama(width: number, height: number): boolean {
  return width > 0 && height > 0 && Math.abs(width / height - 2.0) < 0.25;
}

/**
 * Converts Float32Array RGB to RGBE byte buffer
 */
export function floatArrayToRgbe(floatData: Float32Array, width: number, height: number): Uint8Array {
  const count = width * height;
  const rgbe = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = floatData[i * 3];
    const g = floatData[i * 3 + 1];
    const b = floatData[i * 3 + 2];
    const bytes = floatToRgbe(r, g, b);
    const dst = i * 4;
    rgbe[dst] = bytes[0];
    rgbe[dst + 1] = bytes[1];
    rgbe[dst + 2] = bytes[2];
    rgbe[dst + 3] = bytes[3];
  }
  return rgbe;
}

/**
 * Converts a 4x3 Horizontal Cross Cubemap into an Equirectangular spherical panorama.
 * Used when an imported HDR is already a cubemap, ensuring Babylon's HDRCubeTexture
 * can process it without distortion.
 */
export function cubemapCrossToEquirectangular(
  crossData: Float32Array,
  crossW: number,
  crossH: number,
  outWidth: number = 2048,
  outHeight: number = 1024
): Float32Array {
  const faceSize = Math.floor(crossW / 4);
  const outData = new Float32Array(outWidth * outHeight * 3);

  const faceOffsets: Record<string, { col: number; row: number }> = {
    top: { col: 1, row: 0 },
    left: { col: 0, row: 1 },
    front: { col: 1, row: 1 },
    right: { col: 2, row: 1 },
    back: { col: 3, row: 1 },
    bottom: { col: 1, row: 2 }
  };

  const sampleCrossPixel = (col: number, row: number, uFace: number, vFace: number): [number, number, number] => {
    const px = Math.floor(((uFace + 1.0) * 0.5) * faceSize);
    const py = Math.floor(((1.0 - vFace) * 0.5) * faceSize);
    const clampedPx = Math.max(0, Math.min(faceSize - 1, px));
    const clampedPy = Math.max(0, Math.min(faceSize - 1, py));

    const gx = col * faceSize + clampedPx;
    const gy = row * faceSize + clampedPy;
    const idx = (gy * crossW + gx) * 3;
    return [crossData[idx], crossData[idx + 1], crossData[idx + 2]];
  };

  for (let y = 0; y < outHeight; y++) {
    const v = (y + 0.5) / outHeight;
    const lat = (0.5 - v) * Math.PI;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);

    const rowIdx = y * outWidth * 3;

    for (let x = 0; x < outWidth; x++) {
      const u = (x + 0.5) / outWidth;
      const lon = (u - 0.5) * 2.0 * Math.PI;

      const dx = cosLat * Math.sin(lon);
      const dy = sinLat;
      const dz = cosLat * Math.cos(lon);

      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const absZ = Math.abs(dz);

      let faceName = 'front';
      let uf = 0;
      let vf = 0;

      if (absX >= absY && absX >= absZ) {
        if (dx > 0) {
          faceName = 'right';
          uf = -dz / absX;
          vf = dy / absX;
        } else {
          faceName = 'left';
          uf = dz / absX;
          vf = dy / absX;
        }
      } else if (absY >= absX && absY >= absZ) {
        if (dy > 0) {
          faceName = 'top';
          uf = dx / absY;
          vf = -dz / absY;
        } else {
          faceName = 'bottom';
          uf = dx / absY;
          vf = dz / absY;
        }
      } else {
        if (dz > 0) {
          faceName = 'front';
          uf = dx / absZ;
          vf = dy / absZ;
        } else {
          faceName = 'back';
          uf = -dx / absZ;
          vf = dy / absZ;
        }
      }

      const offset = faceOffsets[faceName];
      const rgb = sampleCrossPixel(offset.col, offset.row, uf, vf);

      const dst = rowIdx + x * 3;
      outData[dst] = rgb[0];
      outData[dst + 1] = rgb[1];
      outData[dst + 2] = rgb[2];
    }
  }

  return outData;
}

export function convertCubemapCrossToEquirectangularBlob(
  crossData: Float32Array,
  crossW: number,
  crossH: number,
  outWidth: number = 2048,
  outHeight: number = 1024
): Blob {
  const equiFloat = cubemapCrossToEquirectangular(crossData, crossW, crossH, outWidth, outHeight);
  const rgbe = floatArrayToRgbe(equiFloat, outWidth, outHeight);
  return encodeRleHdr(outWidth, outHeight, rgbe);
}

/**
 * Triggers browser download of a Blob file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Main Autonomous Pipeline:
 * Ingests an HDR or EXR file and converts it into a 4x3 Cross Cubemap saved in HDR format.
 */
export async function convertHdrToCubemapCross(
  fileOrBuffer: File | ArrayBuffer,
  fileName: string,
  faceSize: number = 512,
  onProgress?: (phase: string, pct: number) => void
): Promise<CubemapCrossResult> {
  const isFile = fileOrBuffer instanceof File;
  const rawFileName = isFile ? fileOrBuffer.name : fileName;
  const ext = rawFileName.split('.').pop()?.toLowerCase() || 'hdr';
  const baseName = rawFileName.replace(/\.[^/.]+$/, '');

  if (onProgress) onProgress('Decodifica HDRI...', 0.1);

  let buffer: ArrayBuffer;
  if (isFile) {
    buffer = await fileOrBuffer.arrayBuffer();
  } else {
    buffer = fileOrBuffer;
  }

  // 1. Decode HDR or EXR
  let decoded: DecodedHdrImage;
  if (ext === 'exr') {
    decoded = decodeExr(buffer);
  } else {
    decoded = decodeHdr(buffer);
  }

  if (onProgress) onProgress('Proiezione Cubemap 4x3...', 0.35);

  // 2. Project to 4x3 Horizontal Cross
  const cross = equirectangularToCubemapCross(decoded, faceSize, (p) => {
    if (onProgress) onProgress('Proiezione Cubemap 4x3...', 0.35 + p * 0.45);
  });

  if (onProgress) onProgress('Compressione RLE formato HDR...', 0.85);

  // 3. Encode to Radiance RLE .hdr
  const outputFileName = `${baseName}_cubemap_cross_${faceSize}px.hdr`;
  const hdrBlob = encodeRleHdr(cross.width, cross.height, cross.rgbeData);

  if (onProgress) onProgress('Salvataggio completato!', 1.0);

  return {
    blob: hdrBlob,
    fileName: outputFileName,
    width: cross.width,
    height: cross.height,
    faceSize,
    floatData: cross.floatData,
    rgbeData: cross.rgbeData
  };
}

/**
 * Helper to render the 4x3 cross Float32Array onto an HTMLCanvasElement with adjustable exposure tone mapping
 */
export function renderCubemapPreviewToCanvas(
  canvas: HTMLCanvasElement,
  floatData: Float32Array,
  width: number,
  height: number,
  exposure: number = 4.0
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  // Reinhard tone mapping matching matheowis/HDRI-to-CubeMap:
  // Exposure slider centered at 4.0 (scale = exposure / 4.0)
  const exposureScale = exposure / 4.0;

  for (let i = 0, j = 0; i < floatData.length; i += 3, j += 4) {
    const r = floatData[i];
    const g = floatData[i + 1];
    const b = floatData[i + 2];

    if (r === 0 && g === 0 && b === 0) {
      // Empty outside area of the cross: dark gray background matching reference screenshot
      data[j] = 55;
      data[j + 1] = 55;
      data[j + 2] = 55;
      data[j + 3] = 255;
    } else {
      // Reinhard tone mapping
      const mappedR = (r * exposureScale) / (1.0 + r * exposureScale);
      const mappedG = (g * exposureScale) / (1.0 + g * exposureScale);
      const mappedB = (b * exposureScale) / (1.0 + b * exposureScale);

      // Gamma curve approx
      data[j] = Math.min(255, Math.floor(Math.pow(mappedR, 1.0 / 2.2) * 255.0));
      data[j + 1] = Math.min(255, Math.floor(Math.pow(mappedG, 1.0 / 2.2) * 255.0));
      data[j + 2] = Math.min(255, Math.floor(Math.pow(mappedB, 1.0 / 2.2) * 255.0));
      data[j + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}
