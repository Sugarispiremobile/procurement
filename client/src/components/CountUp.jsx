import { useEffect, useState } from 'react';

/** Число, которое плавно «накручивается» до значения. */
export default function CountUp({ to }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(to); return; }
    let raf; const t0 = performance.now(); const dur = 700;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n}</>;
}
