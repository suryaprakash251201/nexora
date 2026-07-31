import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { engine } from "../../store/player";

interface Device {
  deviceId: string;
  label: string;
}

/**
 * OutputDevicePicker lets audiophiles route playback to a specific DAC or
 * audio interface using HTMLMediaElement.setSinkId(). Hidden entirely when
 * the platform doesn't support it (no secure context / older engines).
 */
export default function OutputDevicePicker() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const audio = engine.audio;
    const canSink = typeof audio?.setSinkId === "function";
    setSupported(canSink);
    if (!canSink || !navigator.mediaDevices?.enumerateDevices) return;

    let cancelled = false;
    const refresh = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devs) => {
          if (cancelled) return;
          const outs = devs
            .filter((d) => d.kind === "audiooutput")
            .map((d) => ({ deviceId: d.deviceId, label: d.label || "Speaker" }));
          setDevices(outs);
        })
        .catch(() => {});
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, []);

  if (!supported) return null;

  const apply = async (deviceId: string) => {
    const audio = engine.audio;
    if (!audio || typeof audio.setSinkId !== "function") return;
    try {
      await audio.setSinkId(deviceId);
      setCurrent(deviceId);
      setOpen(false);
    } catch {
      // Some engines only allow setSinkId on a paused/loaded element — the
      // first attempt already covers most cases; a retry is harmless.
      try {
        await audio.setSinkId(deviceId);
        setCurrent(deviceId);
        setOpen(false);
      } catch {
        /* unsupported device — ignore */
      }
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Output device"
        className={`rounded-full p-2 transition hover:bg-white/10 ${current ? "text-accent" : "text-white/60"}`}
      >
        <Volume2 size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-11 right-0 z-50 min-w-[190px] rounded-xl glass-strong border border-white/10 p-1.5 shadow-2xl animate-scale-in">
            <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45">
              Output device
            </p>
            {devices.length === 0 ? (
              <p className="px-2 pb-2 text-xs text-white/50">No devices found</p>
            ) : (
              devices.map((d) => (
                <button
                  key={d.deviceId}
                  onClick={() => apply(d.deviceId)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-white/10 ${
                    d.deviceId === current ? "text-accent font-semibold" : "text-white/80"
                  }`}
                >
                  <Volume2 size={12} className="shrink-0 opacity-60" />
                  <span className="truncate">{d.label}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
