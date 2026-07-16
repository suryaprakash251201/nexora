import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Shield, LogOut, Sun, Moon, ChevronDown, CheckCircle2 } from "lucide-react";
import type { User } from "../api/types";
import { useUI } from "../store";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleBadge(role: string) {
  const map: Record<string, string> = { admin: "Administrator", user: "User", viewer: "Viewer" };
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
  const theme = useUI((s) => s.theme);
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
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
        className={`flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-full transition-all duration-200 border 
          ${open ? "bg-surface-strong border-border/50 shadow-sm" : "border-transparent hover:bg-surface-muted"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="h-8 w-8 rounded-full bg-gradient-to-br from-accent to-purple-500 grid place-items-center text-white text-xs font-bold shrink-0 shadow-sm shadow-accent/20">
          {initials(user.display_name || user.username)}
        </span>
        <ChevronDown className={`h-4 w-4 text-content-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              role="menu"
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-[81] w-72 glass-strong rounded-2xl p-2 border border-border/50 shadow-2xl animate-scale-in origin-top-right backdrop-blur-xl"
            >
              <div className="flex items-start gap-4 p-4 border-b border-border/50 mb-2 bg-surface/30 rounded-t-xl">
                <div className="relative">
                  <span className="h-12 w-12 rounded-full bg-gradient-to-br from-accent to-purple-500 grid place-items-center text-white text-base font-bold shrink-0 shadow-lg shadow-accent/30">
                    {initials(user.display_name || user.username)}
                  </span>
                  {user.status === "active" && (
                    <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-success border-2 border-surface flex items-center justify-center">
                      <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="font-bold text-content truncate text-base leading-tight">
                    {user.display_name || user.username}
                  </p>
                  <p className="text-xs text-content-muted font-mono truncate mt-0.5">
                    {user.email}
                  </p>
                  <div className="mt-2">
                    <span className="inline-flex items-center text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20">
                      {roleBadge(user.role)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-1 p-1">
                <button
                  role="menuitem"
                  onClick={() => { toggleTheme(); }}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-xl glass-hover text-content-muted hover:text-content group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-md bg-surface border border-border/50 group-hover:border-accent/30 group-hover:text-accent transition-colors">
                      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </div>
                    <span className="font-medium">Theme</span>
                  </div>
                  <span className="text-xs capitalize">{theme}</span>
                </button>

                {isAdmin && (
                  <button
                    role="menuitem"
                    onClick={() => { setOpen(false); onAdmin(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl glass-hover text-content-muted hover:text-content group"
                  >
                    <div className="p-1.5 rounded-md bg-surface border border-border/50 group-hover:border-accent/30 group-hover:text-accent transition-colors">
                      <Shield className="h-4 w-4" />
                    </div>
                    <span className="font-medium">Administration</span>
                  </button>
                )}
              </div>

              <div className="h-px bg-border/50 my-1 mx-2" />

              <div className="p-1">
                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); onLogout(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl text-danger hover:bg-danger/10 transition-colors group"
                >
                  <div className="p-1.5 rounded-md bg-danger/10 border border-danger/20 transition-colors">
                    <LogOut className="h-4 w-4" />
                  </div>
                  <span className="font-medium">Sign Out</span>
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
