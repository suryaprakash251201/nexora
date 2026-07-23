import { useEffect, useRef } from "react";

export default function MouseGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf: number;
    let mx = -999;
    let my = -999;

    const handle = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el!.style.maskImage = `radial-gradient(600px circle at ${mx}px ${my}px, black, transparent 80%)`;
        el!.style.webkitMaskImage = `radial-gradient(600px circle at ${mx}px ${my}px, black, transparent 80%)`;
      });
    };

    window.addEventListener("mousemove", handle, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handle);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(600px_circle_at_50%_50%,rgba(91,140,255,0.06),transparent_80%)]"
      style={{ maskImage: "none", WebkitMaskImage: "none" }}
    />
  );
}
