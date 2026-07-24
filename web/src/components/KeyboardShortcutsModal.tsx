import { Modal } from "./Modal";

interface ShortcutGroup {
  category: string;
  items: { key: string; description: string }[];
}

export default function KeyboardShortcutsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  const groups: ShortcutGroup[] = [
    {
      category: "General & Navigation",
      items: [
        { key: "⌘ K / Ctrl K", description: "Open Command Palette" },
        { key: "/", description: "Focus Search" },
        { key: "?", description: "Show Keyboard Shortcuts" },
        { key: "Esc", description: "Clear Selection / Close Modals" },
        { key: "F5", description: "Refresh File List" },
      ],
    },
    {
      category: "File Operations",
      items: [
        { key: "N", description: "Create New Folder" },
        { key: "U", description: "Upload Files" },
        { key: "Delete", description: "Delete Selected Items" },
        { key: "⌘ A / Ctrl A", description: "Select All Items" },
      ],
    },
    {
      category: "View & Media",
      items: [
        { key: "⌘ V / Ctrl V", description: "Toggle Grid / List View" },
        { key: "I", description: "Toggle File Info Panel (in Preview)" },
        { key: "← / →", description: "Navigate Gallery (in Image Preview)" },
        { key: "Space", description: "Play / Pause Audio Player" },
      ],
    },
  ];

  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose}>
      <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1 custom-scrollbar">
        {groups.map((group) => (
          <div key={group.category} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-accent">{group.category}</h4>
            <div className="grid grid-cols-1 gap-2">
              {group.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-2.5 rounded-xl glass-subtle border border-white/[0.05]"
                >
                  <span className="text-sm text-content-muted">{item.description}</span>
                  <kbd className="px-2.5 py-1 rounded-md bg-surface-muted border border-border/60 font-mono text-xs text-content font-semibold shadow-sm">
                    {item.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
