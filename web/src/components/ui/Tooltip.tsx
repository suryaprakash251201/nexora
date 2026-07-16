import type { ReactNode } from 'react';

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const positionClasses = {
  top: 'bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2',
  bottom: 'top-[calc(100%+6px)] left-1/2 -translate-x-1/2',
  left: 'right-[calc(100%+6px)] top-1/2 -translate-y-1/2',
  right: 'left-[calc(100%+6px)] top-1/2 -translate-y-1/2',
};

export function Tooltip({ text, children, position = 'top', className = '' }: TooltipProps) {
  return (
    <div className={`tooltip-container ${className}`}>
      {children}
      <div className={`tooltip-text ${positionClasses[position]}`} role="tooltip">
        {text}
      </div>
    </div>
  );
}
