import { useState } from "react";
import { Music } from "lucide-react";
import type { FileItem } from "../../api/types";
import { thumbUrl } from "../../lib/preview";

export function CoverArt({ item, className }: { item: FileItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`h-full w-full grid place-items-center bg-gradient-to-br from-accent/30 to-purple-500/20 ${className || ""}`}>
        <Music className="h-1/3 w-1/3 text-white/80 drop-shadow-md" />
      </div>
    );
  }
  return (
    <img
      src={thumbUrl(item)}
      alt=""
      className={`h-full w-full object-cover transition-transform duration-700 hover:scale-105 ${className || ""}`}
      onError={() => setFailed(true)}
    />
  );
}

export default CoverArt;
