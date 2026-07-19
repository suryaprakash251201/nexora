import { Home, Search, Folder, Star, Trash2, Clock, Share2, ListMusic } from "lucide-react";
import type { SidebarView } from "../Sidebar";

interface MobileNavProps {
  view: SidebarView;
  onSelectView: (v: SidebarView) => void;
}

const tabs: { id: SidebarView; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "files", label: "Files", icon: Folder },
  { id: "search", label: "Search", icon: Search },
  { id: "favorites", label: "Stars", icon: Star },
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "recents", label: "Recents", icon: Clock },
  { id: "shares", label: "Shares", icon: Share2 },
  { id: "playlists", label: "Playlists", icon: ListMusic },
];

export function MobileNav({ view, onSelectView }: MobileNavProps) {
  return (
    <div className="md:hidden mobile-nav fixed bottom-0 left-0 right-0 z-40 pb-safe">
      <div className="flex items-center gap-1 px-2 py-2 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = view === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectView(tab.id)}
              aria-label={tab.label}
              className={`flex flex-col items-center justify-center w-16 h-12 gap-1 rounded-xl transition-all duration-200 shrink-0 ${
                isActive ? "text-accent" : "text-content-muted hover:text-content"
              }`}
            >
              <div className={`relative transition-transform duration-300 ${isActive ? "-translate-y-1" : ""}`}>
                <Icon className="h-5 w-5" />
                {isActive && (
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent animate-scale-in" />
                )}
              </div>
              <span className={`text-[10px] font-medium transition-opacity duration-300 ${isActive ? "opacity-100" : "opacity-0"}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
