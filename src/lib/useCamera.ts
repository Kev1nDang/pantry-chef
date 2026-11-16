import { useEffect, useRef, useState } from 'react';

export type CameraStatus = 'starting' | 'live' | 'denied' | 'unavailable' | 'error';

/** Browsers only offer the camera to pages served over HTTPS (or from localhost). */
export const cameraSupported = () =>
  typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  // The back camera on phones; whatever camera there is on laptops.
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
};

function statusOf(err: unknown): CameraStatus {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'unavailable';
  return 'error';
}

/**
 * Stream the camera into the returned video ref. The camera is released when the page is hidden
 * (phones stop it anyway) and when the component unmounts, and started again when the page is
 * shown. `retry` asks again, for example after the user allows the camera in site settings.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<CameraStatus>(() => (cameraSupported() ? 'starting' : 'unavailable'));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!cameraSupported()) return;
    let stream: MediaStream | null = null;
    let run = 0; // bumped on every start and stop, so a late getUserMedia doesn't win

    function stop() {
      run++;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    async function start() {
      stop();
      const mine = run;
      setStatus('starting');
      try {
        const s = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
        if (mine !== run) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          await video.play().catch(() => {}); // autoplay + muted + playsInline normally starts it anyway
        }
        if (mine === run) setStatus('live');
      } catch (err) {
        if (mine === run) setStatus(statusOf(err));
      }
    }

    const onVisibility = () => (document.hidden ? stop() : void start());
    void start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [attempt]);

  return { videoRef, status, retry: () => setAttempt((n) => n + 1) };
}
