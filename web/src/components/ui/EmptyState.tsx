import type { ReactNode } from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: ReactNode;
  variant?: 'files' | 'search' | 'shares' | 'favorites' | 'trash' | 'playlists' | 'generic' | 'recents' | 'uploads' | 'tags' | 'no-results';
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const variantIllustrations: Record<string, ReactNode> = {
  files: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="folderGrad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5B8CFF" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#7A5CFF" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <path d="M15 85h90a5 5 0 0 0 5-5V35a5 5 0 0 0-5-5H40l-7-10a5 5 0 0 0-4-2H15a5 5 0 0 0-5 5v45a5 5 0 0 0 5 5z" fill="url(#folderGrad)" stroke="#5B8CFF" strokeWidth="1.5" opacity="0.4" />
      <path d="M25 55h70" stroke="#5B8CFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <path d="M25 65h50" stroke="#5B8CFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.2" />
      <circle cx="95" cy="75" r="3" fill="#5B8CFF" opacity="0.4" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="30" stroke="#5B8CFF" strokeWidth="2" strokeDasharray="188" strokeDashoffset="47" opacity="0.4" />
      <path d="M80 80L105 105" stroke="#5B8CFF" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      <circle cx="50" cy="50" r="8" fill="#5B8CFF" opacity="0.3" />
    </svg>
  ),
  shares: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M30 60h60M60 30v60" stroke="#5B8CFF" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <circle cx="60" cy="60" r="8" fill="#5B8CFF" opacity="0.3" />
      <circle cx="90" cy="30" r="8" fill="#7A5CFF" opacity="0.3" />
      <circle cx="30" cy="90" r="8" fill="#35D3FF" opacity="0.3" />
    </svg>
  ),
  favorites: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M60 25C95 25 95 65 60 95C25 65 25 25 60 25" stroke="#FBBF24" strokeWidth="2.5" opacity="0.4" />
      <path d="M60 25C95 25 95 65 60 95C25 65 25 25 60 25" fill="url(#starGrad)" />
      <defs>
        <linearGradient id="starGrad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#FB923C" stopOpacity="0.1" />
        </linearGradient>
      </defs>
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M35 35h50M45 35v60M75 35v60" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <path d="M35 35h50" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      <path d="M55 20h10" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
    </svg>
  ),
  playlists: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 80h80M20 50h80M20 20h80" stroke="#5B8CFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <circle cx="30" cy="80" r="8" fill="#5B8CFF" opacity="0.4" />
      <circle cx="30" cy="50" r="8" fill="#7A5CFF" opacity="0.4" />
      <circle cx="30" cy="20" r="8" fill="#35D3FF" opacity="0.4" />
    </svg>
  ),
  recents: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="40" stroke="#5B8CFF" strokeWidth="2" strokeDasharray="251" strokeDashoffset="63" opacity="0.3" />
      <path d="M60 30v20M60 50l12 12" stroke="#5B8CFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <circle cx="60" cy="60" r="6" fill="#5B8CFF" opacity="0.4" />
    </svg>
  ),
  uploads: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M60 20v60M35 45l25 25 25-25" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
      <rect x="30" y="85" width="60" height="15" rx="3" fill="#22C55E" opacity="0.2" />
    </svg>
  ),
  tags: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M25 45l10-10h5 10h50a5 5 0 0 1 5 5v65a5 5 0 0 1-5 5H25v-10z" stroke="#5B8CFF" strokeWidth="1.5" opacity="0.3" />
      <circle cx="45" cy="75" r="8" stroke="#5B8CFF" strokeWidth="1.5" opacity="0.3" />
      <circle cx="75" cy="55" r="6" stroke="#7A5CFF" strokeWidth="1.5" opacity="0.2" />
    </svg>
  ),
  "no-results": (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M60 20v80M20 60h80" stroke="#6B7A99" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <circle cx="60" cy="60" r="20" stroke="#6B7A99" strokeWidth="1.5" strokeDasharray="125" strokeDashoffset="31" opacity="0.2" />
    </svg>
  ),
  generic: (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-accent/30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="30" width="80" height="70" rx="8" stroke="#5B8CFF" strokeWidth="1.5" opacity="0.3" />
      <path d="M35 55h50M35 65h30" stroke="#5B8CFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
    </svg>
  ),
};

export function EmptyState({ icon, variant = 'generic', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 animate-fade-in">
      <div className="w-24 h-24 mb-5">
        {icon || variantIllustrations[variant]}
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
