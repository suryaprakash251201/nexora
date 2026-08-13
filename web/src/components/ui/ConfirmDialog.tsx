import { type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "../Modal";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <Modal
      title={title}
      onClose={() => { if (!loading) onCancel(); }}
      icon={danger ? <AlertTriangle className="h-5 w-5 text-danger" /> : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof description === "string" ? (
        <p className="text-sm text-content-muted leading-relaxed">{description}</p>
      ) : (
        description
      )}
    </Modal>
  );
}
