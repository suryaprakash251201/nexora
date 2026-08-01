import { Trash2 } from "lucide-react";
import { Modal } from "../Modal";
import { Button } from "../ui/Button";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, description, confirmLabel, busy, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      description={description}
      icon={<Trash2 className="h-5 w-5 text-red-400" />}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-content-muted">This moves the selected photo{description.includes(",") ? "s" : ""} to the trash. You can restore them from there.</p>
    </Modal>
  );
}
