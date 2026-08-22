import { useState, useEffect, type FormEvent } from "react";
import { motion } from "motion/react";
import { LogIn, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { authApi } from "../api/endpoints";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import NexoraLogo from "./icons/NexoraLogo";
export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tailscaleBusy, setTailscaleBusy] = useState(false);
  const [tailscaleAvailable, setTailscaleAvailable] = useState(false);
  // Check if Tailscale auth is available by probing the header
  // We'll just always show the button — it fails gracefully if not available.
  useEffect(() => {
    // If accessed via Tailscale, the header will be present and the endpoint will work.
    // We optimistically show the button; the error message explains if it's not available.
    setTailscaleAvailable(true);
  }, []);
  const login = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username || !password) { setError("Please fill in all fields"); return; }
    setBusy(true);
    try {
      const res = await authApi.login(username, password);
      if (res && res.token) {
        localStorage.setItem("nexora-token", res.token);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    }
    setBusy(false);
  };
  const tailscaleLogin = async () => {
    setError("");
    setTailscaleBusy(true);
    try {
      const res = await authApi.tailscaleLogin();
      if (res && res.token) {
        localStorage.setItem("nexora-token", res.token);
      }
      onSuccess();
    } catch (err: any) {
      if (err.message?.includes("tailscale_user_missing") || err.message?.includes("tailscale_auth_disabled")) {
        setError("Tailscale authentication is not available. Make sure you're accessing this server via Tailscale and that Tailscale Auth is enabled on the server.");
      } else {
        setError(err.message || "Tailscale login failed");
      }
    }
    setTailscaleBusy(false);
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-full max-w-sm"
      >
        <div className="glass-strong rounded-2xl p-8 shadow-2xl">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="flex flex-col items-center mb-8"
          >
            <NexoraLogo size={80} idPrefix="login" className="mb-4 drop-shadow-[0_4px_12px_rgba(139,92,246,0.5)]" />
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-accent-secondary">Nexora</span>
            </h1>
            <p className="text-sm text-text-tertiary mt-1">Sign in to your private file workspace</p>
          </motion.div>
          {/* Tailscale Sign In */}
          {tailscaleAvailable && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="mb-6"
            >
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={tailscaleLogin}
                loading={tailscaleBusy}
                icon={!tailscaleBusy ? <ShieldCheck className="h-5 w-5" /> : undefined}
              >
                Sign in with Tailscale
              </Button>
            </motion.div>
          )}
          {/* Divider */}
          {tailscaleAvailable && (
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-border/50" />
              <span className="text-xs text-content-muted font-medium">or sign in with password</span>
              <div className="flex-1 h-px bg-border/50" />
            </div>
          )}
          <form onSubmit={login} className="space-y-4">
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15, duration: 0.3 }}
            >
              <Input
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="relative"
            >
              <Input
                label="Password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-tertiary hover:text-foreground transition-colors focus-visible:outline-none"
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </motion.div>
            {error && (
              <motion.p
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs text-danger bg-danger/10 px-3 py-2 rounded-lg border border-danger/20"
              >
                {error}
              </motion.p>
            )}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.3 }}
            >
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={busy}
                className="w-full mt-2"
                icon={!busy ? <LogIn className="h-4 w-4" /> : undefined}
              >
                Sign In
              </Button>
            </motion.div>
          </form>
        </div>
        <p className="text-center text-xs text-text-tertiary mt-6">
          Your data stays on your server.
        </p>
      </motion.div>
    </div>
  );
}