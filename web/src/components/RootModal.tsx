import { useState } from "react";
import { HardDrive } from "lucide-react";
import { Modal } from "./Modal";
import { useUI } from "../store";
import { post, put } from "../api/client";
import { ROOT_ICONS } from "../lib/rootIcons";
import type { Root } from "../api/types";

export default function RootModal({
  root,
  onClose,
  onDone,
}: {
  root?: Root | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const pushToast = useUI((s) => s.pushToast);
  const isEdit = !!root;
  const [name, setName] = useState(root?.name || "");
  const [p, setP] = useState(root?.path || "");
  const [icon, setIcon] = useState(root?.icon || "hard-drive");
  const [readOnly, setReadOnly] = useState(root?.read_only || false);
  const [enabled, setEnabled] = useState(root ? root.enabled !== false : true);

  const run = async () => {
    const body = { name, path: p, icon, read_only: readOnly, enabled, indexed: true };
    try {
      if (isEdit) {
        await put(`/admin/roots/${root!.id}`, body);
        pushToast("success", "Storage root updated");
      } else {
        await post("/admin/roots", body);
        pushToast("success", "Storage root created");
      }
      onDone();
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };

  const Icon = ROOT_ICONS.find((i) => i.name === icon)?.icon || HardDrive;

  return (
    <Modal
      title={isEdit ? "Edit storage root" : "New storage root"}
      onClose={onClose}
      footer={<button onClick={run} className="px-3 py-1.5 rounded-lg accent-glass text-sm">{isEdit ? "Save" : "Create"}</button>}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="h-12 w-12 rounded-xl grid place-items-center bg-accent/15 text-accent">
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <label className="block text-sm mb-1">Icon</label>
          <div className="flex flex-wrap gap-1">
            {ROOT_ICONS.map((i) => {
              const I = i.icon;
              return (
                <button
                  key={i.name}
                  type="button"
                  onClick={() => setIcon(i.name)}
                  title={i.label}
                  className={`h-8 w-8 grid place-items-center rounded-lg border ${icon === i.name ? "border-accent text-accent bg-accent/10" : "border-transparent glass-hover"}`}
                >
                  <I className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <label className="block text-sm mb-1">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none" placeholder="Backups" />

      <label className="block text-sm mb-1">Host path</label>
      <input value={p} onChange={(e) => setP(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none font-mono" placeholder="/mnt/backups" />

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
      </div>

      <p className="mt-3 text-xs text-content-muted flex items-center gap-1"><HardDrive className="h-3 w-3" /> The directory must exist on the host / mounted volume.</p>
    </Modal>
  );
}
