import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "./schemas";

/** Supported aspect ratio closest to an image's dimensions (by log-ratio distance). */
export function nearestAspectRatio(width: number, height: number): ImageAspectRatio {
  if (!width || !height) return "3:4";
  const target = Math.log(width / height);
  let best: ImageAspectRatio = "3:4";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const [w, h] = ratio.split(":").map(Number) as [number, number];
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

/** Reference photos are stored per upload batch: <org>/references/<batchId>/<uuid>.<ext>. */
export function isReferencePath(path: string, org: string): boolean {
  return new RegExp(`^${org}/references/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(path);
}
