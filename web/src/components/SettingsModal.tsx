import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Smartphone, MonitorSmartphone, Shield, ShieldAlert, Check, AlertCircle, ArrowLeft, ChevronRight, X, Sun, Moon, Power, Music } from "lucide-react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { isTauri as isTauriRuntime } from "../lib/desktop";
import type { User } from "../api/types";
import { useUI } from "../store";
;
import { authApi } from "../api/endpoints";
import { Button } from "./ui/Button";
import { useFocusTrap } from "../lib/useFocusTrap";
type View = "main" | "password" | "totp" | "sessions" | "tokens";
import { useAccentTheme, accentThemes } from "../lib/useAccentTheme";
import { SessionsBody } from "./SessionsModal";
import { TokensBody } from "./TokensModal";
export default function SettingsModal({ user, onClose, initialView = "main" }: { user: User; onClose: () => void; initialView?: View }) {
  const [view, setView] = useState<View>(initialView);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const [accent, setAccent] = useAccentTheme();
  const queryClient = useQueryClient();
  const dialogRef = useFocusTrap(true);
  const isTauri = isTauriRuntime();
  const [nativeAudioOn, setNativeAudioOn] = useState<boolean>(
    () => localStorage.getItem("nexora.nativeAudio") !== "0",
  );
  const toggleNativeAudio = () => {
    const next = !nativeAudioOn;
    setNativeAudioOn(next);
    localStorage.setItem("nexora.nativeAudio", next ? "1" : "0");
    // Takes effect on the next track; current playback continues on the
    // active engine so we never cut audio mid-note.
    useUI.getState().pushToast(
      "info",
      next
        ? "Native audio enabled — applies to the next track"
        : "Native audio disabled — applies to the next track",
    );
  };
  // ── Auto-start ─────────────────────────────────────────────
  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { isAutostartEnabled } = await import("./TauriShell");
        setAutoStart(await isAutostartEnabled());
      } catch { /* ignore */ }
    })();
  }, [isTauri]);
  const toggleAutoStart = async () => {
    try {
      const { setAutostart } = await import("./TauriShell");
      const next = !autoStart;
      await setAutostart(next);
      setAutoStart(next);
    } catch { /* ignore */ }
  };
  const setTotpStatus = (enabled: boolean) => {
    queryClient.setQueryData<{ user: User }>(["session"], (current) => (
      current ? { ...current, user: { ...current.user, totp_enabled: enabled } } : current
    ));
  };
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [totpStep, setTotpStep] = useState<"intro" | "qr" | "verify" | "disable">("intro");
  const [totpPw, setTotpPw] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQR, setTotpQR] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const changePassword = async () => {
    setPwError(null);
    if (pwNew !== pwConfirm) { setPwError("Passwords do not match"); return; }
    if (pwNew.length < 8) { setPwError("New password must be at least 8 characters"); return; }
    setPwBusy(true);
    try {
      await authApi.changePassword(pwCurrent, pwNew);
      useUI.getState().pushToast("success", "Password changed");
      setView("main");
      setPwCurrent(""); setPwNew(""); setPwConfirm("");
    } catch (e: any) {
      setPwError(e.message || "Failed to change password");
    } finally { setPwBusy(false); }
  };
  const startTotpSetup = async () => {
    setTotpBusy(true); setTotpError(null);
    try {
      const res = await authApi.totpSetup();
      setTotpSecret(res.secret); setTotpQR(res.qr); setTotpStep("qr");
    } catch (e: any) { setTotpError(e.message || "Failed to setup TOTP"); }
    finally { setTotpBusy(false); }
  };
  const verifyTotp = async () => {
    setTotpBusy(true); setTotpError(null);
    try {
      await authApi.totpVerify(totpCode);
      useUI.getState().pushToast("success", "Two-factor authentication enabled");
      setView("main"); setTotpStep("intro"); setTotpCode("");
      setTotpStatus(true);
    } catch (e: any) { setTotpError(e.message || "Invalid code"); }
    finally { setTotpBusy(false); }
  };
  const disableTotp = async () => {
    if (!totpPw) return;
    setTotpBusy(true); setTotpError(null);
    try {
      await authApi.totpDisable(totpPw);
      useUI.getState().pushToast("success", "Two-factor authentication disabled");
      setTotpStatus(false);
      setTotpStep("intro"); setTotpPw("");
    } catch (e: any) { setTotpError(e.message || "Failed to disable TOTP"); }
    finally { setTotpBusy(false); }
  };
  const resetView = () => {
    setView("main");
    setPwCurrent(""); setPwNew(""); setPwConfirm(""); setPwError(null);
    setTotpStep("intro"); setTotpCode(""); setTotpError(null); setTotpPw("");
  };
  const title =
    view === "password" ? "Change Password"
    : view === "totp" ? "Two-Factor Authentication"
    : view === "sessions" ? "Active Sessions"
    : view === "tokens" ? "API Tokens"
    : "Settings";
  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  return createPortal(
    <div className="fixed inset-0 z-[var(--z-modal)] grid place-items-center p-4 scrim backdrop-blur-sm" onMouseDown={onBackdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabIndex={-1}
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] glass-strong rounded-2xl shadow-2xl overflow-hidden animate-scale-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-surface/30">
          <div className="flex items-center gap-3 min-w-0">
            {view !== "main" && (
              <button onClick={resetView} className="p-1 rounded-lg glass-hover text-content-muted hover:text-content transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <h2 id="settings-modal-title" className="text-lg font-bold text-content truncate">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close settings" className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg glass-hover text-content-muted hover:text-content transition-colors">
            <span className="text-sm font-medium">Close</span>
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {view === "main" && (
            <div className="space-y-8">
              {/* Appearance Section */}
              <div>
                <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider mb-3">Appearance</h3>
                <div className="space-y-3">
                  {/* Dark/Light Toggle */}
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface-muted/30 border border-border/50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-accent/10 text-accent">
                        {isDark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-content">Color Mode</p>
                        <p className="text-xs text-content-muted">{isDark ? "Dark mode" : "Light mode"}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setTheme(isDark ? "light" : "dark")}
                      role="switch"
                      aria-checked={isDark}
                      aria-label="Toggle color mode"
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        isDark ? "bg-accent" : "bg-surface-muted border border-border"
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        isDark ? "translate-x-6" : "translate-x-1"
                      }`} />
                    </button>
                  </div>
                  {/* Accent Theme Selector */}
                  <div>
                    <p className="text-xs text-content-muted mb-2 px-1">Accent Color</p>
                    <div className="grid grid-cols-4 gap-2">
                      {accentThemes.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setAccent(t.id)}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-200 ${
                            accent === t.id
                              ? "border-accent bg-accent/5 shadow-sm"
                              : "border-border/50 bg-surface-muted/30 hover:border-border hover:bg-surface-muted/50"
                          }`}
                        >
                          <div className="flex gap-0.5">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: t.colors[0] }} />
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: t.colors[1] }} />
                          </div>
                          <span className="text-[10px] font-medium text-content">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {/* System Section — Tauri native settings */}
              {isTauri && (
                <div>
                  <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider mb-3">System</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-surface-muted/30 border border-border/50">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-accent/10 text-accent">
                          <Music className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-content">Native audio engine</p>
                          <p className="text-xs text-content-muted">
                            {nativeAudioOn
                              ? "Decodes in-app — no server buffering (next track)"
                              : "Uses browser/transcode pipeline (next track)"}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={toggleNativeAudio}
                        role="switch"
                        aria-checked={nativeAudioOn}
                        aria-label="Native audio engine"
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          nativeAudioOn ? "bg-accent" : "bg-surface-muted"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            nativeAudioOn ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                    <div
                      className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-surface-muted/30 border border-border/50"
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-accent/10 text-accent">
                          <Power className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-content">Launch at Startup</p>
                          <p className="text-xs text-content-muted">
                            {autoStart === null
                              ? "Checking…"
                              : autoStart
                              ? "Nexora starts automatically"
                              : "Open Nexora when you log in"}
                          </p>
                        </div>
                      </div>
                      {autoStart !== null && (
                        <button
                          onClick={toggleAutoStart}
                          role="switch"
                          aria-checked={autoStart}
                          aria-label="Launch at startup"
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            autoStart ? "bg-accent" : "bg-surface-muted border border-border"
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                            autoStart ? "translate-x-6" : "translate-x-1"
                          }`} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {/* Security Section */}
              <div>
                <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider mb-3">Security</h3>
                <div className="space-y-2">
                  <button onClick={() => { setPwError(null); setView("password"); }}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-surface-muted/30 hover:bg-surface-muted/50 border border-border/50 transition-all group text-left">
                    <div className="p-2 rounded-lg bg-accent/10 text-accent">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-content">Change Password</p>
                      <p className="text-xs text-content-muted">Update your account password</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-content-muted/40 group-hover:text-content-muted transition-colors" />
                  </button>
                  <button onClick={() => { setTotpError(null); setTotpStep("intro"); setView("totp"); }}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-surface-muted/30 hover:bg-surface-muted/50 border border-border/50 transition-all group text-left">
                    <div className="p-2 rounded-lg bg-accent/10 text-accent">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-content">Two-Factor Authentication</p>
                      <p className="text-xs text-content-muted">{user.totp_enabled ? "Authenticator app is active" : "Add an extra layer of security"}</p>
                    </div>
                    {user.totp_enabled ? (
                      <span className="text-xs font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">ON</span>
                    ) : (
                      <ChevronRight className="h-5 w-5 text-content-muted/40 group-hover:text-content-muted transition-colors" />
                    )}
                  </button>
                  <button onClick={() => setView("sessions")}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-surface-muted/30 hover:bg-surface-muted/50 border border-border/50 transition-all group text-left">
                    <div className="p-2 rounded-lg bg-accent/10 text-accent">
                      <MonitorSmartphone className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-content">Active Sessions</p>
                      <p className="text-xs text-content-muted">Devices signed into your account</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-content-muted/40 group-hover:text-content-muted transition-colors" />
                  </button>
                  <button onClick={() => setView("tokens")}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-surface-muted/30 hover:bg-surface-muted/50 border border-border/50 transition-all group text-left">
                    <div className="p-2 rounded-lg bg-accent/10 text-accent">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-content">API Tokens</p>
                      <p className="text-xs text-content-muted">Bearer credentials for scripts and apps</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-content-muted/40 group-hover:text-content-muted transition-colors" />
                  </button>
                </div>
              </div>
            </div>
          )}
          {view === "sessions" && <SessionsBody />}
          {view === "tokens" && <TokensBody />}
          {view === "password" && (
            <form onSubmit={(e) => { e.preventDefault(); changePassword(); }} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1" htmlFor="settings-pw-current">Current Password</label>
                <input id="settings-pw-current" type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)}
                  className="w-full mt-1 rounded-lg border border-border/60 bg-surface/50 px-3 py-2.5 text-sm text-content outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50 transition-colors"
                  placeholder="Current password" />
              </div>
              <div>
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1" htmlFor="settings-pw-new">New Password</label>
                <input id="settings-pw-new" type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)}
                  className="w-full mt-1 rounded-lg border border-border/60 bg-surface/50 px-3 py-2.5 text-sm text-content outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50 transition-colors"
                  placeholder="Min 8 characters" />
              </div>
              <div>
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1" htmlFor="settings-pw-confirm">Confirm New Password</label>
                <input id="settings-pw-confirm" type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)}
                  className="w-full mt-1 rounded-lg border border-border/60 bg-surface/50 px-3 py-2.5 text-sm text-content outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50 transition-colors"
                  placeholder="Repeat new password" />
              </div>
              {pwError && <p className="text-sm text-danger flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {pwError}</p>}
              <div className="pt-2">
                <Button type="submit" variant="primary" onClick={changePassword} loading={pwBusy} disabled={!pwCurrent || !pwNew || !pwConfirm} className="w-full">
                  Change Password
                </Button>
              </div>
            </form>
          )}
          {view === "totp" && (
            <div className="space-y-4">
              {totpStep === "intro" && (
                <div>
                  <p className="text-sm text-content-muted mb-4">Secure your account with time-based one-time passwords from an authenticator app.</p>
                  {user.totp_enabled ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-success text-sm font-medium">
                        <Check className="h-4 w-4" /> Two-factor authentication is enabled
                      </div>
                      <Button variant="danger" onClick={() => { setTotpError(null); setTotpPw(""); setTotpStep("disable"); }}>
                        Disable Two-Factor Auth
                      </Button>
                    </div>
                  ) : (
                    <Button variant="primary" onClick={startTotpSetup} loading={totpBusy} icon={<ShieldAlert className="h-4 w-4" />} className="w-full">
                      Set Up Two-Factor Auth
                    </Button>
                  )}
                </div>
              )}
              {totpStep === "qr" && (
                <div className="space-y-5">
                  <p className="text-sm text-content-muted text-center">Scan this code with your authenticator app to enroll</p>
                  <div className="mx-auto max-w-[260px] bg-[#0F1119] rounded-2xl border border-border/50 shadow-lg overflow-hidden">
                    <div className="bg-gradient-to-r from-accent to-[#7A5CFF] px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-white/90" />
                        <span className="text-white/90 text-[11px] font-bold tracking-widest uppercase">Nexora Auth</span>
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="flex justify-center mb-4">
                        <div className="bg-[#1A1D2E] rounded-xl p-2 border border-border/50">
                          {totpQR && <img src={totpQR} alt="TOTP QR Code" className="w-32 h-32" />}
                        </div>
                      </div>
                      <div className="bg-[#1A1D2E] rounded-lg p-3 border border-border/50">
                        <p className="text-[10px] text-content-muted/60 font-mono mb-1">Manual entry key</p>
                        <p className="text-content text-xs font-mono tracking-wider select-all text-center break-all">{totpSecret}</p>
                      </div>
                      <div className="flex justify-between items-center mt-3">
                        <span className="text-[10px] text-content-muted/60 font-mono">TOTP &middot; Time-based</span>
                        <span className="text-[10px] text-content-muted/60 font-mono">nexora</span>
                      </div>
                    </div>
                  </div>
                  <Button variant="primary" onClick={() => setTotpStep("verify")} className="w-full">
                    I've scanned the QR code
                  </Button>
                  {totpError && <p className="text-sm text-danger flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {totpError}</p>}
                </div>
              )}
              {totpStep === "verify" && (
                <div>
                  <p className="text-sm text-content-muted mb-3">Enter the 6-digit code from your authenticator app to verify:</p>
                  <input
                    autoFocus
                    value={totpCode}
                    onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setTotpError(null); }}
                    className="w-full text-center text-2xl font-mono tracking-[0.5em] rounded-lg border border-border/60 bg-surface/50 px-3 py-3 text-content outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50 transition-colors"
                    placeholder="000000"
                    maxLength={6}
                  />
                  {totpError && <p className="text-sm text-danger mt-2 flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {totpError}</p>}
                  <div className="mt-4">
                    <Button variant="primary" onClick={verifyTotp} loading={totpBusy} disabled={totpCode.length !== 6} className="w-full">
                      Verify &amp; Enable
                    </Button>
                  </div>
                </div>
              )}
              {totpStep === "disable" && (
                <form onSubmit={(e) => { e.preventDefault(); disableTotp(); }} className="space-y-3">
                  <p className="text-sm text-content-muted">Enter your password to disable two-factor authentication.</p>
                  <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Password</label>
                  <input
                    autoFocus
                    type="password"
                    value={totpPw}
                    onChange={(e) => { setTotpPw(e.target.value); setTotpError(null); }}
                    className="w-full rounded-lg border border-border/60 bg-surface/50 px-3 py-2.5 text-sm text-content outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50 transition-colors"
                    placeholder="Current password"
                  />
                  {totpError && <p className="text-sm text-danger flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {totpError}</p>}
                  <div className="flex gap-2 pt-1">
                    <Button variant="ghost" type="button" onClick={() => { setTotpError(null); setTotpStep("intro"); setTotpPw(""); }} className="flex-1">
                      Cancel
                    </Button>
                    <Button variant="danger" type="submit" loading={totpBusy} disabled={!totpPw} className="flex-1">
                      Disable TOTP
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>, document.body
  );
}