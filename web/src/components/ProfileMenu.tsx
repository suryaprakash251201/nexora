import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Shield, LogOut, Sun, Moon, ChevronDown, CheckCircle2, KeyRound, Smartphone, Loader2, Check, AlertCircle, ShieldAlert } from "lucide-react";
import type { User } from "../api/types";
import { useUI } from "../store";
import { useClickOutside } from "./hooks/useClickOutside";
import { Modal } from "./Modal";
import { post } from "../api/client";

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
  const [pwModal, setPwModal] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [totpModal, setTotpModal] = useState(false);
  const [totpStep, setTotpStep] = useState<"intro" | "qr" | "verify">("intro");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQR, setTotpQR] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
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

  useClickOutside([ref, btnRef, menuRef], () => setOpen(false), open);

  const changePassword = async () => {
    setPwError(null);
    if (pwNew !== pwConfirm) { setPwError("Passwords do not match"); return; }
    if (pwNew.length < 8) { setPwError("New password must be at least 8 characters"); return; }
    setPwBusy(true);
    try {
      await post("/auth/password", { current: pwCurrent, new: pwNew });
      useUI.getState().pushToast("success", "Password changed");
      setPwModal(false);
      setPwCurrent(""); setPwNew(""); setPwConfirm("");
    } catch (e: any) {
      setPwError(e.message || "Failed to change password");
    } finally {
      setPwBusy(false);
    }
  };

  const startTotpSetup = async () => {
    setTotpBusy(true);
    setTotpError(null);
    try {
      const res = await post<{ secret: string; uri: string; qr: string }>("/auth/totp/setup");
      setTotpSecret(res.secret);
      setTotpQR(res.qr);
      setTotpStep("qr");
    } catch (e: any) {
      setTotpError(e.message || "Failed to setup TOTP");
    } finally {
      setTotpBusy(false);
    }
  };

  const verifyTotp = async () => {
    setTotpBusy(true);
    setTotpError(null);
    try {
      await post("/auth/totp/verify", { code: totpCode });
      useUI.getState().pushToast("success", "Two-factor authentication enabled");
      setTotpModal(false);
      setTotpStep("intro");
      setTotpCode("");
      user.totp_enabled = true;
    } catch (e: any) {
      setTotpError(e.message || "Invalid code");
    } finally {
      setTotpBusy(false);
    }
  };

  const disableTotp = async () => {
    const pw = prompt("Enter your password to disable two-factor authentication:");
    if (!pw) return;
    setTotpBusy(true);
    try {
      await post("/auth/totp/disable", { password: pw });
      useUI.getState().pushToast("success", "Two-factor authentication disabled");
      user.totp_enabled = false;
    } catch (e: any) {
      useUI.getState().pushToast("error", e.message || "Failed to disable TOTP");
    } finally {
      setTotpBusy(false);
    }
  };

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

      {pwModal && (
        <Modal title="Change Password" onClose={() => { setPwModal(false); setPwError(null); setPwCurrent(""); setPwNew(""); setPwConfirm(""); }}
          footer={
            <button onClick={changePassword} disabled={pwBusy || !pwCurrent || !pwNew || !pwConfirm} className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
              {pwBusy && <Loader2 className="h-4 w-4 animate-spin" />} Change Password
            </button>
          }>
          <div className="space-y-4">
            <div>
              <label htmlFor="pw-current" className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Current Password</label>
              <input id="pw-current" type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} className="w-full rounded-lg glass-input px-3 py-2.5 outline-none text-sm mt-1" placeholder="Current password" />
            </div>
            <div>
              <label htmlFor="pw-new" className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">New Password</label>
              <input id="pw-new" type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} className="w-full rounded-lg glass-input px-3 py-2.5 outline-none text-sm mt-1" placeholder="Min 8 characters" />
            </div>
            <div>
              <label htmlFor="pw-confirm" className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Confirm New Password</label>
              <input id="pw-confirm" type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} className="w-full rounded-lg glass-input px-3 py-2.5 outline-none text-sm mt-1" placeholder="Repeat new password" />
            </div>
            {pwError && <p className="text-sm text-danger flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {pwError}</p>}
          </div>
        </Modal>
      )}

      {totpModal && (
        <Modal title="Two-Factor Authentication" onClose={() => { setTotpModal(false); setTotpStep("intro"); setTotpError(null); setTotpCode(""); }}
          footer={totpStep === "verify" ? (
            <button onClick={verifyTotp} disabled={totpBusy || totpCode.length !== 6} className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
              {totpBusy && <Loader2 className="h-4 w-4 animate-spin" />} Verify & Enable
            </button>
          ) : undefined}>
          <div className="space-y-4">
            {totpStep === "intro" && (
              <div>
                <p className="text-sm text-content-muted mb-4">Secure your account with time-based one-time passwords from an authenticator app.</p>
                {user.totp_enabled ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-success text-sm font-medium"><Check className="h-4 w-4" /> Two-factor authentication is enabled</div>
                    <button onClick={disableTotp} disabled={totpBusy} className="px-3 py-1.5 rounded-lg bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors">
                      Disable Two-Factor Auth
                    </button>
                  </div>
                ) : (
                  <button onClick={startTotpSetup} disabled={totpBusy} className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium flex items-center gap-1.5">
                    {totpBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Set Up Two-Factor Auth
                  </button>
                )}
              </div>
            )}
            {totpStep === "qr" && (
              <div>
                <p className="text-sm font-medium mb-3">Scan this QR code with your authenticator app:</p>
                {totpQR && <img src={totpQR} alt="TOTP QR Code" className="mx-auto w-48 h-48 rounded-xl border glass-divider mb-3" />}
                <div className="bg-surface rounded-lg p-3 mb-3">
                  <p className="text-xs text-content-muted mb-1">Or enter this key manually:</p>
                  <p className="text-xs font-mono break-all bg-background rounded p-2 select-all">{totpSecret}</p>
                </div>
                <button onClick={() => setTotpStep("verify")} className="w-full px-3 py-2 rounded-lg accent-glass text-sm font-medium">
                  I've scanned the QR code
                </button>
              </div>
            )}
            {totpStep === "verify" && (
              <div>
                <p className="text-sm text-content-muted mb-3">Enter the 6-digit code from your authenticator app to verify:</p>
                <input
                  autoFocus
                  value={totpCode}
                  onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setTotpError(null); }}
                  className="w-full text-center text-2xl font-mono tracking-[0.5em] rounded-lg glass-input px-3 py-3 outline-none"
                  placeholder="000000"
                  maxLength={6}
                />
                {totpError && <p className="text-sm text-danger mt-2 flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {totpError}</p>}
              </div>
            )}
          </div>
        </Modal>
      )}

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

                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); setPwModal(true); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl glass-hover text-content-muted hover:text-content group"
                >
                  <div className="p-1.5 rounded-md bg-surface border border-border/50 group-hover:border-accent/30 group-hover:text-accent transition-colors">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <span className="font-medium">Change Password</span>
                </button>

                <button
                  role="menuitem"
                  onClick={() => { setOpen(false); setTotpModal(true); setTotpStep("intro"); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl glass-hover text-content-muted hover:text-content group"
                >
                  <div className="p-1.5 rounded-md bg-surface border border-border/50 group-hover:border-accent/30 group-hover:text-accent transition-colors">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <span className="font-medium">Two-Factor Auth</span>
                  {user.totp_enabled && <span className="ml-auto text-xs font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">ON</span>}
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
