/** Claude scales anything with a longer edge than this down anyway, so larger uploads only cost time. */
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export const PHOTO_TYPES = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;

/** Phones don't always fill in `type` (HEIC often comes through empty), so check the name too. */
export const isPhoto = (file: Blob, name: string) => file.type.startsWith('image/') || PHOTO_TYPES.test(name);

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
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Couldn’t process that photo.'))),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
}
