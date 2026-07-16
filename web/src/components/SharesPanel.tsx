import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, Link2, ExternalLink, Shield, Clock, Download, Globe } from "lucide-react";
import { get, del } from "../api/client";
import { useUI } from "../store";
import { formatDate } from "../lib/format";
import type { ShareItem } from "../api/types";
import { Button } from "./ui/Button";
import { SkeletonList } from "./ui/Skeleton";
import { EmptyState } from "./ui/EmptyState";

export default function SharesPanel() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading } = useQuery({ queryKey: ["shares"], queryFn: () => get<{ items: ShareItem[] }>("/shares") });

  const revoke = async (id: string, name: string) => {
    if (!confirm(`Revoke share link for "${name}"? It will stop working immediately.`)) return;
    try {
      await del(`/shares/${id}`);
      pushToast("success", "Share link revoked");
      qc.invalidateQueries({ queryKey: ["shares"] });
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };

  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    pushToast("success", "Link copied to clipboard");
  };

  const items = data?.items || [];

  return (
    <div className="flex-1 overflow-auto bg-background custom-scrollbar">
      {/* Header */}
      <div className="bg-surface/50 backdrop-blur-xl border-b border-border/50 sticky top-0 z-10 p-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Active Shares</h1>
              <p className="text-sm text-content-muted">Manage your shared files and links</p>
            </div>
          </div>
          <div className="px-3 py-1 rounded-full bg-surface-strong border border-border/50 text-xs font-bold text-content-muted">
            {items.length} {items.length === 1 ? 'Link' : 'Links'}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 pb-20">
        {isLoading ? (
          <SkeletonList />
        ) : items.length === 0 ? (
          <div className="py-12 animate-fade-in">
            <EmptyState 
              title="No active shares" 
              description="Files you share with others will appear here." 
              icon={<ShareIcon />}
            />
          </div>
        ) : (
          <div className="space-y-4 animate-slide-up stagger-children">
            {items.map((s) => {
              const isExpired = s.expires_at && new Date(s.expires_at).getTime() < Date.now();
              const isDepleted = s.max_downloads > 0 && s.download_count >= s.max_downloads;
              const isInactive = isExpired || isDepleted;
              
              return (
                <div key={s.id} className={`glass-strong rounded-2xl border transition-all duration-200 group
                  ${isInactive ? 'opacity-60 border-border/30' : 'border-border/50 hover:border-accent/40 hover:shadow-md'}`}>
                  
                  <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-bold text-content truncate pr-4 text-base">{s.name}</h3>
                        {isInactive && (
                          <span className="shrink-0 px-2 py-0.5 rounded-md bg-warning/10 text-warning text-[10px] font-bold uppercase tracking-wider">
                            Inactive
                          </span>
                        )}
                      </div>
                      
                      <p className="text-xs text-content-muted font-mono truncate mb-3">{s.path}</p>
                      
                      <div className="flex flex-wrap gap-2 text-[11px] font-medium text-content-muted">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border/50">
                          <Globe className="h-3 w-3" />
                          <span className="capitalize">{s.scope}</span>
                        </span>
                        
                        {s.has_password && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border/50 text-amber-500">
                            <Shield className="h-3 w-3" />
                            Password
                          </span>
                        )}
                        
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border/50 ${isExpired ? 'text-danger' : ''}`}>
                          <Clock className="h-3 w-3" />
                          {s.expires_at ? formatDate(s.expires_at) : "No expiry"}
                        </span>
                        
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border/50 ${isDepleted ? 'text-danger' : ''}`}>
                          <Download className="h-3 w-3" />
                          {s.download_count}{s.max_downloads ? ` / ${s.max_downloads}` : ""}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 pt-3 sm:pt-0 border-t sm:border-t-0 border-border/50 sm:pl-4 mt-2 sm:mt-0">
                      <Button variant="secondary" onClick={() => copy(s.url)} icon={<Copy className="h-4 w-4 sm:mr-0" />}>
                        <span className="sm:hidden">Copy</span>
                      </Button>
                      <a href={s.url} target="_blank" rel="noreferrer" className="flex-1 sm:flex-none">
                        <Button variant="secondary" className="w-full" icon={<ExternalLink className="h-4 w-4 sm:mr-0" />}>
                          <span className="sm:hidden">Open</span>
                        </Button>
                      </a>
                      <Button variant="danger" onClick={() => revoke(s.id, s.name)} icon={<Trash2 className="h-4 w-4 sm:mr-0" />}>
                        <span className="sm:hidden">Revoke</span>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <div className="relative">
      <Link2 className="h-10 w-10 text-accent opacity-80" />
      <div className="absolute -bottom-2 -right-2 bg-background rounded-full p-1 border-2 border-surface">
        <Globe className="h-4 w-4 text-content-muted" />
      </div>
    </div>
  );
}
