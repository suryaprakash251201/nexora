import { useAudioInfo } from "./hooks/useAudioInfo";
import { getAudioQuality } from "../../lib/audioQuality";
import type { FileItem } from "../../api/types";

interface Props {
  item: FileItem;
  /** Compact inline badge (used in the mini player); false = full panel. */
  compact?: boolean;
}

/**
 * AudioInfoPanel surfaces real ffprobe metadata: codec, bit depth, sample
 * rate, channel layout, bitrate and (when present) ID3 tags. The badge is
 * color-coded by quality tier (HI-RES gold, LOSSLESS green, etc.).
 */
export default function AudioInfoPanel({ item, compact = false }: Props) {
  const { info, loading } = useAudioInfo(item.root_id, item.path);
  const q = getAudioQuality(item, info);

  if (compact) {
    if (loading && !info) {
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white/50 bg-white/5 animate-pulse">…</span>;
    }
    return (
      <span
        title={q.detail ? `${q.label} · ${q.detail}` : q.label}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-white/10 ${q.color}`}
      >
        {q.isLossless ? (
          <LosslessWave className="h-3.5 w-auto" />
        ) : (
          <>
            {q.badge}
            {q.needsTranscode && <span className="text-white/50 font-medium">· stream</span>}
          </>
        )}
      </span>
    );
  }

  const rows: Array<[string, string]> = [];
  if (info) {
    const codec = info.codec_long || info.codec || "—";
    rows.push(["Codec", codec]);
    if (info.bit_depth > 0) rows.push(["Bit depth", `${info.bit_depth}-bit`]);
    if (info.sample_rate > 0) rows.push(["Sample rate", `${(info.sample_rate / 1000).toFixed(info.sample_rate % 1000 === 0 ? 0 : 1)} kHz`]);
    if (info.channel_layout) rows.push(["Channels", info.channel_layout]);
    else if (info.channels > 0) rows.push(["Channels", `${info.channels} ch`]);
    if (info.bit_rate > 0) rows.push(["Bitrate", `${Math.round(info.bit_rate / 1000)} kbps`]);
    if (info.duration > 0) rows.push(["Duration", `${Math.round(info.duration)} s`]);
  } else if (!loading) {
    rows.push(["Format", (item.extension || "audio").toUpperCase()]);
  }

  const tags = info?.tags || {};
  const title = tags.title || tags.TITLE;
  const artist = tags.artist || tags.ARTIST;
  const album = tags.album || tags.ALBUM;
  const year = tags.year || tags.date || tags.DATE;

  return (
    <div className="w-full max-w-sm rounded-2xl glass-strong border border-white/10 p-3 sm:p-4 text-left space-y-3 animate-scale-in">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-black tracking-[0.14em] ${q.color}`}>
          {q.isLossless ? <LosslessWave className="h-3.5 w-auto" /> : q.badge}
        </span>
        <span className="text-[10px] font-medium text-white/45 uppercase tracking-wider">
          {loading ? "reading metadata…" : q.label}
        </span>
      </div>

      {(title || artist || album) && (
        <div className="space-y-0.5">
          {title && <p className="text-sm font-bold text-white truncate">{title}</p>}
          {(artist || album) && (
            <p className="text-xs text-white/60 truncate">
              {[artist, album, year].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[9px] font-semibold uppercase tracking-wider text-white/40">{k}</dt>
              <dd className="text-[12px] font-medium text-white/85 truncate" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {q.needsTranscode && (
        <p className="text-[10px] leading-relaxed text-amber-300/80 bg-amber-400/10 rounded-lg px-2 py-1.5">
          {q.isLossless
            ? `This ${q.label.split("·")[0]?.trim() || "codec"} can't be decoded by your webview — streaming lossless FLAC instead.`
            : "Transcoding to a playable format for your webview."}
        </p>
      )}
    </div>
  );
}

/**
 * LosslessWave — the lossless sound-wave glyph. Ships dark + light variants
 * so it reads correctly in both the dark and light web themes.
 */
function LosslessWave({ className = "h-2.5 w-auto" }: { className?: string }) {
  return (
    <>
      <img src="/lossless-wave-light.png" alt="" className={`${className} dark:hidden`} />
      <img src="/lossless-wave.png" alt="" className={`${className} hidden dark:block`} />
    </>
  );
}
