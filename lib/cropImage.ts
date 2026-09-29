// Browser-side image prep (ported from NutritionDE applyPipelineToFile, WITHOUT its grayscale
// step): crop to the chosen rectangle, shrink to 2048 px, re-encode JPEG q0.85. The phone's
// browser decodes HEIC here, so the server only ever receives JPEG.
export type CropRect = { x: number; y: number; width: number; height: number }; // natural pixels

export const MAX_SIDE = 2048;

export function loadImage(file: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url); // the decoded image stays drawable; the blob is freed
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null); // undecodable here (e.g. HEIC outside Safari)
    };
    img.src = url;
  });
}

export async function cropToJpeg(img: HTMLImageElement, rect: CropRect | null): Promise<Blob | null> {
  const r = rect ?? { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight };
  const scale = Math.min(1, MAX_SIDE / Math.max(r.width, r.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(r.width * scale));
  canvas.height = Math.max(1, Math.round(r.height * scale));
  canvas.getContext("2d")!.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}
