import { useEffect, useRef } from "react";

export default function MouseGlow() {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = glowRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let x = window.innerWidth * 0.7;
    let y = window.innerHeight * 0.2;
    let tx = x;
    let ty = y;

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!raf) {
        raf = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      raf = 0;
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;
      el.style.background = `radial-gradient(480px circle at ${x.toFixed(0)}px ${y.toFixed(0)}px, rgba(91,140,255,0.05), transparent 75%)`;
      if (Math.abs(tx - x) > 1 || Math.abs(ty - y) > 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={glowRef}
      className="pointer-events-none fixed inset-0 -z-10"
      aria-hidden="true"
    />
  );
}
