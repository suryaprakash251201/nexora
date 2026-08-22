import type { FileItem } from "../api/types";
import AudioPlayer from "./MediaPlayer/AudioPlayer";
import VideoPlayer from "./MediaPlayer/VideoPlayer";

interface MediaPlayerProps {
  kind: "audio" | "video";
  url?: string;
  item?: FileItem;
  playlist?: FileItem[];
  index?: number;
  onSelect?: (i: number) => void;
  autoPlay?: boolean;
  controlled?: boolean;
  startFullscreen?: boolean;
  onClose?: () => void;
}

export default function MediaPlayer({ kind, url, item, playlist, index = 0, onSelect, autoPlay, controlled, startFullscreen, onClose }: MediaPlayerProps) {
  if (kind === "audio") {
    return <AudioPlayer url={url} item={item} playlist={playlist} index={index} onSelect={onSelect} autoPlay={autoPlay} controlled={controlled} startFullscreen={startFullscreen} onClose={onClose} />;
  }
  return <VideoPlayer url={url} item={item} autoPlay={autoPlay} />;
}

// Re-export sub-components for direct imports if needed
export { default as AudioPlayer } from "./MediaPlayer/AudioPlayer";
export { default as VideoPlayer } from "./MediaPlayer/VideoPlayer";
export { CoverArt } from "./MediaPlayer/CoverArt";
