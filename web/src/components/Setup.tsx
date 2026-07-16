import { useState } from "react";
import { Loader2, ShieldCheck, ArrowRight, CheckCircle2, User as UserIcon, Lock, Mail } from "lucide-react";
import { post } from "../api/client";
import { useUI } from "../store";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

export default function Setup({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const pushToast = useUI((s) => s.pushToast);

  const canProceedToStep2 = username.length > 2 && email.includes("@");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await post("/auth/setup", { username, email, password, display_name: displayName });
      pushToast("success", "Admin account created successfully");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background Ornaments */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md animate-scale-in relative z-10">
        <div className="mb-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-accent to-purple-500 grid place-items-center text-white font-bold text-3xl shadow-xl shadow-accent/20 mb-6 relative">
            <span className="relative z-10">N</span>
            <div className="absolute inset-0 bg-white/20 rounded-2xl" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-2">Welcome to Nexora</h1>
          <p className="text-content-muted text-base">Let's set up your administrator account.</p>
        </div>

        <div className="glass-strong rounded-3xl p-8 border border-border/50 shadow-2xl backdrop-blur-xl relative overflow-hidden">
          {/* Progress Indicator */}
          <div className="flex items-center justify-between mb-8 relative">
            <div className="absolute top-1/2 left-0 right-0 h-1 bg-border/50 -translate-y-1/2 z-0 rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all duration-500" style={{ width: step === 1 ? '50%' : '100%' }} />
            </div>
            
            <div className={`relative z-10 h-8 w-8 rounded-full grid place-items-center font-bold text-xs transition-colors duration-300 ${step >= 1 ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'bg-surface border border-border/50 text-content-muted'}`}>
              {step > 1 ? <CheckCircle2 className="h-5 w-5" /> : '1'}
            </div>
            <div className={`relative z-10 h-8 w-8 rounded-full grid place-items-center font-bold text-xs transition-colors duration-300 ${step >= 2 ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'bg-surface border border-border/50 text-content-muted'}`}>
              2
            </div>
          </div>

          <form onSubmit={step === 1 ? (e) => { e.preventDefault(); if (canProceedToStep2) setStep(2); } : submit}>
            <div className="relative overflow-hidden" style={{ minHeight: '260px' }}>
              {/* Step 1: Profile */}
              <div className={`absolute inset-0 transition-all duration-500 ease-in-out ${step === 1 ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Username</label>
                    <Input 
                      value={username} 
                      onChange={(e) => setUsername(e.target.value)} 
                      placeholder="admin" 
                      icon={<UserIcon className="h-4 w-4" />}
                      autoFocus={step === 1}
                      className="h-12"
                    />
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Email Address</label>
                    <Input 
                      type="email" 
                      value={email} 
                      onChange={(e) => setEmail(e.target.value)} 
                      placeholder="you@example.com" 
                      icon={<Mail className="h-4 w-4" />}
                      className="h-12"
                    />
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-content-muted uppercase tracking-wider flex justify-between">
                      Display Name <span className="opacity-50 font-normal normal-case">Optional</span>
                    </label>
                    <Input 
                      value={displayName} 
                      onChange={(e) => setDisplayName(e.target.value)} 
                      placeholder="Administrator" 
                      className="h-12"
                    />
                  </div>
                </div>

                <div className="mt-8 pt-4">
                  <Button 
                    type="submit" 
                    variant="primary" 
                    className="w-full h-12 text-base"
                    disabled={!canProceedToStep2}
                    icon={<ArrowRight className="h-5 w-5 ml-1" />}
                  >
                    Continue
                  </Button>
                </div>
              </div>

              {/* Step 2: Security */}
              <div className={`absolute inset-0 transition-all duration-500 ease-in-out ${step === 2 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'}`}>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Secure Password</label>
                    <Input 
                      type="password" 
                      value={password} 
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }} 
                      placeholder="••••••••" 
                      icon={<Lock className="h-4 w-4" />}
                      autoFocus={step === 2}
                      className="h-12"
                    />
                    <p className="text-[11px] text-content-muted mt-1">Must be at least 8 characters long.</p>
                  </div>
                </div>

                {error && (
                  <div className="mt-4 p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-medium animate-slide-up flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <div className="mt-8 pt-4 flex gap-3">
                  <Button 
                    type="button" 
                    variant="secondary" 
                    className="h-12 px-4"
                    onClick={() => setStep(1)}
                  >
                    Back
                  </Button>
                  <Button 
                    type="submit" 
                    variant="primary" 
                    className="flex-1 h-12 text-base"
                    loading={busy}
                    disabled={password.length < 8 || busy}
                    icon={!busy && <ShieldCheck className="h-5 w-5" />}
                  >
                    Complete Setup
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </div>
        
        <p className="text-center text-xs text-content-muted mt-8 opacity-60">
          Nexora Administrator Setup
        </p>
      </div>
    </div>
  );
}
