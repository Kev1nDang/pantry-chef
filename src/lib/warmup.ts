/**
 * Wake the API as soon as the app opens. The API scales to zero when idle, and starting it takes
 * ~25 s; a first-time visitor's empty pantry sends no request until they tap Scan, so that wait
 * landed on the scan. The ping starts the instance (and its photo detector loading) while they
 * look around. Fire and forget: failures don't matter, the real requests report their own.
 */
export function warmUpApi() {
  const url = `${import.meta.env.VITE_API_URL ?? ''}/api/health`;
  fetch(url, { cache: 'no-store' }).catch(() => {});
}
