import { useState } from "react";
import { LogIn, User, Lock, AlertCircle } from "lucide-react";
import { post } from "../api/client";
import { useUI } from "../store";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pushToast = useUI((s) => s.pushToast);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post("/auth/login", { login, password });
      pushToast("success", "Welcome back");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row overflow-hidden relative">
      {/* Background ambient lights for mobile */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] md:hidden pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px] md:hidden pointer-events-none" />

      {/* Left side - Branding / Visual (Hidden on small screens) */}
      <div className="hidden md:flex flex-1 relative bg-surface-muted border-r border-border/50 items-center justify-center overflow-hidden">
        {/* Animated Background Gradients */}
        <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-background to-purple-500/10" />
        <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-accent/20 rounded-full blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute -bottom-[20%] -right-[10%] w-[70%] h-[70%] bg-purple-500/20 rounded-full blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        
        {/* Glass geometric shapes */}
        <div className="absolute top-1/4 left-1/4 w-32 h-32 rounded-2xl glass-strong rotate-12 animate-float pointer-events-none" style={{ animationDelay: '0s' }} />
        <div className="absolute bottom-1/3 right-1/4 w-48 h-48 rounded-full glass-strong border border-white/10 shadow-2xl -rotate-12 animate-float pointer-events-none" style={{ animationDelay: '1s', animationDuration: '7s' }} />
        <div className="absolute top-1/2 right-1/3 w-16 h-16 rounded-xl glass-strong rotate-45 animate-float pointer-events-none" style={{ animationDelay: '2.5s', animationDuration: '5s' }} />
        
        <div className="relative z-10 p-12 max-w-lg text-center animate-slide-up">
          <div className="mx-auto h-24 w-24 rounded-3xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-5xl shadow-2xl shadow-accent/30 mb-8 transform hover:scale-105 transition-transform duration-500">
            N
          </div>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-content to-content-muted">
            Your Private Cloud Workspace
          </h1>
          <p className="text-content-muted text-lg font-medium">
            Secure, fast, and beautiful file management for your personal server.
          </p>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 md:p-12 relative z-10">
        <div className="w-full max-w-[400px] animate-scale-in">
          <div className="mb-10 text-center md:text-left">
            <div className="md:hidden mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-3xl shadow-xl shadow-accent/20 mb-6">
              N
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight mb-2">Welcome Back</h2>
            <p className="text-content-muted text-base">Sign in to access your files.</p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Username or Email</label>
              <Input
                autoFocus
                value={login}
                onChange={(e) => {
                  setLogin(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="admin"
                icon={<User className="h-5 w-5" />}
                className="h-14 text-base bg-surface/50 backdrop-blur-md"
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="••••••••"
                icon={<Lock className="h-5 w-5" />}
                className="h-14 text-base bg-surface/50 backdrop-blur-md"
              />
            </div>

            {error && (
              <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-medium animate-slide-up flex items-start gap-3 mt-4">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            <div className="pt-6">
              <Button
                type="submit"
                variant="primary"
                className="w-full h-14 text-lg font-bold shadow-xl shadow-accent/20"
                loading={busy}
                disabled={!login || !password || busy}
                icon={!busy && <LogIn className="h-5 w-5 ml-1" />}
              >
                Sign In
              </Button>
            </div>
          </form>
          
          <div className="mt-12 text-center">
            <p className="text-xs font-medium text-content-muted opacity-60 font-mono tracking-wider">
              NEXORA ENTERPRISE FILE SYSTEM
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
