import { useEffect, useState } from 'react';

export function reportLocation(hash: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(hash.split('?')[1] ?? ''));
}
export function patchReportLocation(hash: string, patch: Record<string, string | null>) {
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') params.delete(key); else params.set(key, value);
  }
  return `${hash.split('?')[0] || '#/specs'}?${params}`;
}
export function useReportLocation() {
  const [location, setLocation] = useState(() => reportLocation(window.location.hash));
  useEffect(() => {
    const update = () => setLocation(reportLocation(window.location.hash));
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
  }, []);
  return [location, (patch: Record<string, string | null>, replace = false) => {
    const next = patchReportLocation(window.location.hash, patch);
    if (replace) window.history.replaceState(null, '', next); else window.history.pushState(null, '', next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }] as const;
}
