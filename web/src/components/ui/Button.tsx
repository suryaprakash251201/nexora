import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const sizeClasses = {
  sm: 'px-2.5 py-1 text-xs gap-1.5 rounded-lg',
  md: 'px-3.5 py-2 text-sm gap-2 rounded-xl',
  lg: 'px-5 py-2.5 text-base gap-2.5 rounded-xl',
};

const variantClasses = {
  primary: 'accent-glass font-medium',
  secondary: 'glass-hover border font-medium hover:border-accent/30',
  ghost: 'hover:bg-accent/10 text-content font-medium',
  danger: 'bg-danger/15 text-danger border border-danger/20 hover:bg-danger/25 font-medium',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>((
  { variant = 'secondary', size = 'md', loading, icon, children, className = '', disabled, onClick, ...props },
  ref
) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const resolvedRef = (ref as React.RefObject<HTMLButtonElement>) || btnRef;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Ripple effect
    const btn = resolvedRef.current;
    if (btn && variant === 'primary') {
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement('span');
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = e.clientX - rect.left - size / 2 + 'px';
      ripple.style.top = e.clientY - rect.top - size / 2 + 'px';
      ripple.className = 'ripple';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    }
    onClick?.(e);
  };

  return (
    <button
      ref={resolvedRef}
      className={`inline-flex items-center justify-center transition-all duration-150 ripple-container
        ${sizeClasses[size]} ${variantClasses[variant]}
        ${disabled || loading ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}
        ${className}`}
      disabled={disabled || loading}
      onClick={handleClick}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});
Button.displayName = 'Button';
