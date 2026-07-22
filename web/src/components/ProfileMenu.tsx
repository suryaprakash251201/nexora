import { useState } from "react";
import { Shield, LogOut, CheckCircle2, Settings } from "lucide-react";
import type { User } from "../api/types";
import SettingsModal from "./SettingsModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const roleColors: Record<string, string> = {
  admin: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  user: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  viewer: "bg-teal-500/10 text-teal-400 border-teal-500/20",
};

function roleBadge(role: string) {
  const map: Record<string, string> = { admin: "Administrator", user: "User", viewer: "Viewer" };
  const colors = roleColors[role] || "bg-gray-500/10 text-gray-400 border-gray-500/20";
  return (
    <span className={`inline-flex items-center text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${colors}`}>
      {map[role] || role}
    </span>
  );
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full transition-all duration-200 border border-transparent hover:border-glass-border hover:bg-glass-bg-subtle" aria-label="Account menu">
          <Avatar className="h-8 w-8 ring-2 ring-accent/20 hover:ring-accent/40 transition-all">
            <AvatarFallback className="bg-gradient-to-br from-accent to-accent-secondary text-white text-xs font-bold">
              {initials(user.display_name || user.username)}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 mt-2">
          {/* User info header - plain div, not DropdownMenuLabel (avoids Base UI #31) */}
          <div className="px-4 pt-4 pb-3 border-b border-border/50">
            <div className="flex items-start gap-4">
              <div className="relative">
                <Avatar className="h-12 w-12 ring-2 ring-accent/20">
                  <AvatarFallback className="bg-gradient-to-br from-accent to-accent-secondary text-white text-base font-bold">
                    {initials(user.display_name || user.username)}
                  </AvatarFallback>
                </Avatar>
                {user.status === "active" && (
                  <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-background flex items-center justify-center shadow-lg">
                    <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="font-semibold text-foreground truncate text-base leading-tight">
                  {user.display_name || user.username}
                </p>
                <p className="text-xs text-text-tertiary font-mono truncate mt-0.5">
                  {user.email}
                </p>
                <div className="mt-2">
                  {roleBadge(user.role)}
                </div>
              </div>
            </div>
          </div>
          <div className="p-1 pt-2">
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20 mr-3">
                <Settings className="h-4 w-4 text-accent" />
              </div>
              <span className="font-medium">Settings</span>
              {user.totp_enabled && (
                <span className="ml-auto flex items-center gap-1 text-xs font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  2FA
                </span>
              )}
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem onClick={() => { onAdmin(); }}>
                <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20 mr-3">
                  <Shield className="h-4 w-4 text-accent" />
                </div>
                <span className="font-medium">Administration</span>
              </DropdownMenuItem>
            )}
          </div>
          <DropdownMenuSeparator />
          <div className="p-1">
            <DropdownMenuItem onClick={() => { onLogout(); }} className="text-danger focus:text-danger focus:bg-danger/10">
              <div className="p-1.5 rounded-lg bg-danger/10 border border-danger/20 mr-3">
                <LogOut className="h-4 w-4 text-danger" />
              </div>
              <span className="font-medium">Sign Out</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {settingsOpen && (
        <SettingsModal user={user} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
