import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Private Storage bucket; each user can only reach their own `<user id>/` folder (see the migration). */
const BUCKET = 'pantry-photos';
const LIST_LIMIT = 60;
/** Signed links are refreshed whenever the list reloads, so an hour is plenty. */
const URL_TTL_SECONDS = 60 * 60;

export interface SavedPhoto {
  path: string;
  url: string;
  createdAt: string;
}

/** The user's photos, newest first, with signed links to show them. */
async function fetchPhotos(userId: string): Promise<SavedPhoto[]> {
  const bucket = supabase!.storage.from(BUCKET);
  const { data: files, error: listError } = await bucket.list(userId, {
    limit: LIST_LIMIT,
    sortBy: { column: 'created_at', order: 'desc' },
  });
  if (listError) throw listError;
  const entries = files.filter((f) => f.id !== null); // skip folder placeholders
  if (entries.length === 0) return [];

  const paths = entries.map((f) => `${userId}/${f.name}`);
  const { data: signed, error: signError } = await bucket.createSignedUrls(paths, URL_TTL_SECONDS);
  if (signError) throw signError;
  return entries.flatMap((f, i) => {
    const url = signed[i]?.signedUrl;
    // File names start with the upload time, which stands in if Storage omits created_at.
    const createdAt = f.created_at ?? new Date(parseInt(f.name, 10) || Date.now()).toISOString();
    return url ? [{ path: paths[i], url, createdAt }] : [];
  });
}

/**
 * The signed-in user's saved pantry photos. The web app talks to Supabase Storage directly with
 * the user's session; the API never handles stored photos.
 */
export function usePhotos(userId: string | null) {
  const [photos, setPhotos] = useState<SavedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Clear the previous user's photos as soon as the account changes.
  const [prevUserId, setPrevUserId] = useState<string | null>(null);
  if (userId !== prevUserId) {
    setPrevUserId(userId);
    setPhotos([]);
    setError(null);
  }

  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    fetchPhotos(userId).then(
      (found) => {
        if (cancelled) return;
        setPhotos(found);
        setError(null);
      },
      (err: { message?: string }) => {
        if (!cancelled) setError(`Couldn’t load your photos: ${err.message ?? 'unknown error'}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  /** Store a (prepared, JPEG) photo in the user's folder. Throws on failure. */
  const save = useCallback(
    async (photo: Blob) => {
      if (!supabase || !userId) throw new Error('Sign in to save photos.');
      const path = `${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, photo, { contentType: 'image/jpeg' });
      if (uploadError) throw new Error(`Couldn’t save the photo: ${uploadError.message}`);
      setVersion((v) => v + 1);
    },
    [userId],
  );

  /** Delete a saved photo. Throws on failure. */
  const remove = useCallback(async (path: string) => {
    if (!supabase) return;
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
    if (removeError) throw new Error(`Couldn’t delete the photo: ${removeError.message}`);
    setPhotos((prev) => prev.filter((p) => p.path !== path));
  }, []);

  return { photos, error, save, remove };
}
