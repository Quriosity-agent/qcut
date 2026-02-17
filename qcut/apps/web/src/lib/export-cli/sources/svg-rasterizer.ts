/**
 * SVG Rasterizer
 *
 * Converts SVG images to PNG using an offscreen Canvas.
 * FFmpeg has limited SVG support (no CSS, no web fonts), so we
 * rasterize to PNG at target pixel dimensions before export.
 */

/**
 * Rasterize an SVG blob to PNG at the given dimensions.
 *
 * @param svgBlob - SVG source as a Blob
 * @param width - Target width in pixels
 * @param height - Target height in pixels
 * @returns PNG image as Uint8Array
 */
export async function rasterizeSvgToPng(
  svgBlob: Blob,
  width: number,
  height: number
): Promise<Uint8Array> {
  // Ensure minimum dimensions for legibility
  const w = Math.max(width, 64);
  const h = Math.max(height, 64);

  // Read SVG as data URL for Image element
  const dataUrl = await blobToDataUrl(svgBlob);

  // Load SVG into Image element
  const img = await loadImage(dataUrl);

  // Draw to offscreen canvas
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas 2D context for SVG rasterization");
  }

  // Clear with transparent background
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  // Export as PNG
  const pngBlob = await canvasToBlob(canvas, "image/png");
  const arrayBuffer = await pngBlob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Check if a blob or URL represents an SVG image.
 */
export function isSvgContent(blob: Blob, url?: string): boolean {
  if (blob.type === "image/svg+xml") return true;
  if (url?.startsWith("data:image/svg+xml")) return true;
  if (url?.endsWith(".svg")) return true;
  return false;
}

/** Convert Blob to data URL via FileReader. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read blob as data URL"));
    reader.readAsDataURL(blob);
  });
}

/** Load an image from a URL. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load SVG image"));
    img.src = src;
  });
}

/** Convert canvas to Blob. */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob returned null"));
      },
      mimeType,
      1.0
    );
  });
}
