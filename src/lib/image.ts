/** Claude scales anything with a longer edge than this down anyway, so larger uploads only cost time. */
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export const PHOTO_TYPES = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;

/** Phones don't always fill in `type` (HEIC often comes through empty), so check the name too. */
export const isPhoto = (file: Blob, name: string) => file.type.startsWith('image/') || PHOTO_TYPES.test(name);

/** A rectangle of a source image, in its pixels. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draw `crop` of `source` (a photo, or a frame of a live <video>) scaled so its longer edge is at
 * most MAX_EDGE px, and encode it as JPEG. The source is read synchronously, before this returns.
 */
export function encodeJpeg(source: CanvasImageSource, crop: Crop): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(crop.width, crop.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  canvas
    .getContext('2d')!
    .drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Couldn’t process that photo.'))),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
}

/**
 * Shrink a camera photo to at most MAX_EDGE px and re-encode it as JPEG. Phone photos are 3–8 MB;
 * this brings them to a few hundred KB, applies the EXIF rotation, and turns formats Claude can't
 * read (HEIC on browsers that can decode it) into JPEG.
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Couldn’t open that photo. Try a JPEG or PNG.');
  }
  const jpeg = encodeJpeg(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height });
  bitmap.close(); // already drawn
  return jpeg;
}
