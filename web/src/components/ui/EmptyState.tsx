import type { ReactNode } from 'react';
import { FolderOpen, Search, Share2, Star, Trash2, Inbox, Music } from 'lucide-react';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: ReactNode;
  variant?: 'files' | 'search' | 'shares' | 'favorites' | 'trash' | 'playlists' | 'generic';
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const variantIcons: Record<string, ReactNode> = {
  files: <FolderOpen className="h-10 w-10 text-accent" />,
  search: <Search className="h-10 w-10 text-accent" />,
  shares: <Share2 className="h-10 w-10 text-accent" />,
  favorites: <Star className="h-10 w-10 text-accent" />,
  trash: <Trash2 className="h-10 w-10 text-accent" />,
  playlists: <Music className="h-10 w-10 text-accent" />,
  generic: <Inbox className="h-10 w-10 text-accent" />,
};

export function EmptyState({ icon, variant = 'generic', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 animate-fade-in">
      <div className="empty-state-icon w-20 h-20 mb-5">
        {icon || variantIcons[variant]}
      </div>
      <h3 className="text-lg font-semibold mb-1.5">{title}</h3>
      {description && <p className="text-sm text-content-muted text-center max-w-xs mb-4">{description}</p>}
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
