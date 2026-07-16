import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Shield, LogOut, Sun, Moon, ChevronDown } from "lucide-react";
import type { User } from "../api/types";
import { useUI } from "../store";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleBadge(role: string) {
  const map: Record<string, string> = { admin: "Admin", user: "User", viewer: "Viewer" };
  return map[role] || role;
}

export default function ProfileMenu({
  user,
  isAdmin,
  onLogout,
  onAdmin,
}: {
  user: User;
  isAdmin: boolean;
  onLogout: () => void;
  onAdmin: () => void;
}) {
  const toggleTheme = useUI((s) => s.toggleTheme);
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  useEffect(() => {
    const sync = () => setIsDark(document.documentElement.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full glass-hover"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="h-8 w-8 rounded-full bg-accent grid place-items-center text-accent-fg text-sm font-semibold shrink-0">
          {initials(user.display_name || user.username)}
        </span>
        <ChevronDown className="h-4 w-4 text-content-muted" />
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
            <div
              role="menu"
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-[81] w-64 glass-strong rounded-xl p-2"
            >
              <div className="flex items-center gap-3 px-2 py-2">
                <span className="h-11 w-11 rounded-full bg-accent grid place-items-center text-accent-fg text-base font-semibold shrink-0">
                  {initials(user.display_name || user.username)}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{user.display_name || user.username}</p>
                  <p className="text-xs text-content-muted truncate">{user.email}</p>
                </div>
              </div>
              <div className="px-2 pb-2">
                <span className="inline-block text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-full glass-chip">
                  {roleBadge(user.role)} · {user.status}
                </span>
              </div>

              <div className="h-px glass-divider my-1" />

              <button
                role="menuitem"
                onClick={() => { toggleTheme(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg glass-hover"
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {isDark ? "Light theme" : "Dark theme"}
              </button>

              {isAdmin && (
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); onAdmin(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg glass-hover"
                >
                  <Shield className="h-4 w-4" /> Admin
                </button>
              )}

              <button
                role="menuitem"
                onClick={() => { setOpen(false); onLogout(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg glass-hover text-red-500"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
