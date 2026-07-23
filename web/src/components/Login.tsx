import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { LogIn, Eye, EyeOff } from "lucide-react";
import { post } from "../api/client";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username || !password) { setError("Please fill in all fields"); return; }
    setBusy(true);
    try {
      await post("/auth/login", { login: username, password });
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    }
    setBusy(false);
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
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent via-accent-secondary to-accent-tertiary grid place-items-center text-white font-bold text-xl shadow-lg shadow-accent-glow mb-4">
              N
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-accent-secondary">Nexora</span>
            </h1>
            <p className="text-sm text-text-tertiary mt-1">Sign in to your private file workspace</p>
          </motion.div>

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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </motion.div>

            {error && (
              <motion.p
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
