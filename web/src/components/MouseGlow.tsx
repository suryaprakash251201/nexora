
export default function MouseGlow() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(480px_circle_at_70%_20%,rgba(91,140,255,0.045),transparent_75%)]"
      aria-hidden="true"
    />
  );
}
