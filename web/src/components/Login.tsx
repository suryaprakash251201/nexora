import { useState } from "react";
import { LogIn, User, Lock, AlertCircle, ArrowLeft, KeyRound, Shield } from "lucide-react";
import { post } from "../api/client";
import { useUI } from "../store";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

type Step = "login" | "forgot-request" | "forgot-reset" | "totp";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<Step>("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pushToast = useUI((s) => s.pushToast);

  // Forgot password state
  const [forgotLogin, setForgotLogin] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");

  // TOTP state
  const [totpCode, setTotpCode] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post<{ user?: any; totp_required?: boolean; user_id?: string }>("/auth/login", { login, password });
      if (res.totp_required) {
        setStep("totp");
        return;
      }
      pushToast("success", "Welcome back");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post("/auth/totp/verify-login", { login, password, code: totpCode });
      pushToast("success", "Welcome back");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function requestReset() {
    setError(null);
    setBusy(true);
    try {
      const res = await post<{ token?: string; message?: string }>("/auth/forgot-password", { login: forgotLogin });
      if (res.token) {
        setResetToken(res.token);
        setStep("forgot-reset");
      } else {
        pushToast("info", res.message || "Check your account for reset instructions");
        setStep("login");
      }
    } catch (err: any) {
      setError(err.message || "Failed to request reset");
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    setError(null);
    if (resetPassword !== resetConfirm) { setError("Passwords do not match"); return; }
    if (resetPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    setBusy(true);
    try {
      await post("/auth/reset-password", { token: resetToken, password: resetPassword });
      pushToast("success", "Password reset successfully. Please log in.");
      setStep("login");
      setLogin("");
      setPassword("");
      setForgotLogin("");
      setResetToken("");
      setResetPassword("");
      setResetConfirm("");
    } catch (err: any) {
      setError(err.message || "Failed to reset password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row overflow-hidden relative">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] md:hidden pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px] md:hidden pointer-events-none" />

      <div className="hidden md:flex flex-1 relative bg-surface-muted border-r border-border/50 items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-background to-purple-500/10" />
        <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-accent/20 rounded-full blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute -bottom-[20%] -right-[10%] w-[70%] h-[70%] bg-purple-500/20 rounded-full blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute top-1/4 left-1/4 w-32 h-32 rounded-2xl glass-strong rotate-12 animate-float pointer-events-none" style={{ animationDelay: '0s' }} />
        <div className="absolute bottom-1/3 right-1/4 w-48 h-48 rounded-full glass-strong border border-white/10 shadow-2xl -rotate-12 animate-float pointer-events-none" style={{ animationDelay: '1s', animationDuration: '7s' }} />
        <div className="absolute top-1/2 right-1/3 w-16 h-16 rounded-xl glass-strong rotate-45 animate-float pointer-events-none" style={{ animationDelay: '2.5s', animationDuration: '5s' }} />
        <div className="relative z-10 p-12 max-w-lg text-center animate-slide-up">
          <div className="mx-auto h-24 w-24 rounded-3xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-5xl shadow-2xl shadow-accent/30 mb-8 transform hover:scale-105 transition-transform duration-500">N</div>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-content to-content-muted">Your Private Cloud Workspace</h1>
          <p className="text-content-muted text-lg font-medium">Secure, fast, and beautiful file management for your personal server.</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center p-6 md:p-12 relative z-10">
        <div className="w-full max-w-[400px] animate-scale-in">
          <div className="mb-10 text-center md:text-left">
            <div className="md:hidden mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-3xl shadow-xl shadow-accent/20 mb-6">N</div>
            {step === "login" && <><h2 className="text-3xl font-extrabold tracking-tight mb-2">Welcome Back</h2><p className="text-content-muted text-base">Sign in to access your files.</p></>}
            {step === "forgot-request" && <><h2 className="text-3xl font-extrabold tracking-tight mb-2">Reset Password</h2><p className="text-content-muted text-base">Enter your username or email to receive a reset code.</p></>}
            {step === "forgot-reset" && <><h2 className="text-3xl font-extrabold tracking-tight mb-2">Enter New Password</h2><p className="text-content-muted text-base">Your reset code has been generated below.</p></>}
            {step === "totp" && <><h2 className="text-3xl font-extrabold tracking-tight mb-2">Two-Factor Auth</h2><p className="text-content-muted text-base">Enter the 6-digit code from your authenticator app.</p></>}
          </div>

          {step === "login" && (
            <form onSubmit={submit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Username or Email</label>
                <Input autoFocus value={login} onChange={(e) => { setLogin(e.target.value); if (error) setError(null); }} placeholder="admin" icon={<User className="h-5 w-5" />} className="h-14 text-base bg-surface/50 backdrop-blur-md" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Password</label>
                <Input type="password" value={password} onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }} placeholder="••••••••" icon={<Lock className="h-5 w-5" />} className="h-14 text-base bg-surface/50 backdrop-blur-md" />
              </div>
              {error && (
                <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-medium animate-slide-up flex items-start gap-3 mt-4">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" /><p>{error}</p>
                </div>
              )}
              <div className="pt-6">
                <Button type="submit" variant="primary" className="w-full h-14 text-lg font-bold shadow-xl shadow-accent/20" loading={busy} disabled={!login || !password || busy} icon={!busy && <LogIn className="h-5 w-5 ml-1" />}>Sign In</Button>
              </div>
              <div className="text-center pt-2">
                <button type="button" onClick={() => { setStep("forgot-request"); setForgotLogin(login); setError(null); }} className="text-sm text-accent hover:underline font-medium">Forgot password?</button>
              </div>
            </form>
          )}

          {step === "forgot-request" && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Username or Email</label>
                <Input autoFocus value={forgotLogin} onChange={(e) => { setForgotLogin(e.target.value); setError(null); }} placeholder="admin" icon={<User className="h-5 w-5" />} className="h-14 text-base bg-surface/50 backdrop-blur-md" />
              </div>
              {error && (
                <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-medium flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" /><p>{error}</p>
                </div>
              )}
              <Button onClick={requestReset} variant="primary" className="w-full h-14 text-lg font-bold" loading={busy} disabled={!forgotLogin || busy}>Generate Reset Code</Button>
              <div className="text-center pt-2">
                <button type="button" onClick={() => { setStep("login"); setError(null); }} className="text-sm text-accent hover:underline font-medium flex items-center justify-center gap-1"><ArrowLeft className="h-4 w-4" /> Back to login</button>
              </div>
            </div>
          )}

          {step === "forgot-reset" && (
            <div className="space-y-5">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <p className="text-sm font-medium text-amber-400 flex items-center gap-2 mb-2"><KeyRound className="h-4 w-4" /> Your reset code</p>
                <p className="text-lg font-mono font-bold text-amber-300 text-center select-all tracking-wider bg-background/50 rounded-lg p-3">{resetToken}</p>
                <p className="text-xs text-amber-400/70 mt-2 text-center">This code expires in 15 minutes. Copy it now.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">New Password</label>
                <Input type="password" value={resetPassword} onChange={(e) => { setResetPassword(e.target.value); setError(null); }} placeholder="Min 8 characters" icon={<Lock className="h-5 w-5" />} className="h-14 text-base bg-surface/50 backdrop-blur-md" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Confirm New Password</label>
                <Input type="password" value={resetConfirm} onChange={(e) => { setResetConfirm(e.target.value); setError(null); }} placeholder="Repeat password" icon={<Lock className="h-5 w-5" />} className="h-14 text-base bg-surface/50 backdrop-blur-md" />
              </div>
              {error && (
                <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-medium flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" /><p>{error}</p>
                </div>
              )}
              <Button onClick={doReset} variant="primary" className="w-full h-14 text-lg font-bold" loading={busy} disabled={!resetPassword || !resetConfirm || busy}>Reset Password</Button>
              <div className="text-center pt-2">
                <button type="button" onClick={() => { setStep("login"); setError(null); }} className="text-sm text-accent hover:underline font-medium flex items-center justify-center gap-1"><ArrowLeft className="h-4 w-4" /> Back to login</button>
              </div>
            </div>
          )}

          {step === "totp" && (
            <form onSubmit={submitTotp} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Authentication Code</label>
                <Input
                  autoFocus
                  value={totpCode}
                  onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                  placeholder="000000"
                  icon={<Shield className="h-5 w-5" />}
                  className="h-14 text-2xl text-center font-mono tracking-[0.3em] bg-surface/50 backdrop-blur-md"
                  maxLength={6}
                />
              </div>
              {error && (
                <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-medium animate-slide-up flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" /><p>{error}</p>
                </div>
              )}
              <Button type="submit" variant="primary" className="w-full h-14 text-lg font-bold shadow-xl shadow-accent/20" loading={busy} disabled={totpCode.length !== 6 || busy} icon={!busy && <Shield className="h-5 w-5 ml-1" />}>Verify & Sign In</Button>
              <div className="text-center pt-2">
                <button type="button" onClick={() => { setStep("login"); setTotpCode(""); setError(null); }} className="text-sm text-accent hover:underline font-medium flex items-center justify-center gap-1"><ArrowLeft className="h-4 w-4" /> Back to login</button>
              </div>
            </form>
          )}

          <div className="mt-12 text-center">
            <p className="text-xs font-medium text-content-muted opacity-60 font-mono tracking-wider">NEXORA ENTERPRISE FILE SYSTEM</p>
          </div>
        </div>
      </div>
    </div>
  );
}
