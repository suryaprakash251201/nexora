import type { FileItem } from "../api/types";
import TextWorkspace from "./text/TextWorkspace";

/**
 * Legacy entry: the file browser opens this for editing. The actual
 * experience now lives in <TextWorkspace>, which opens in Edit mode.
 */
export default function Editor({ item, rootId, onClose, onSaved }: {
  item: FileItem;
  rootId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  return (
    <TextWorkspace
      item={item}
      rootId={rootId}
      initialMode="edit"
      canWrite
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
