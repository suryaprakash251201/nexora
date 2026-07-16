import { forwardRef, useState, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'search' | 'ghost';
}

export const Input = forwardRef<HTMLInputElement, InputProps>((
  { label, error, icon, variant = 'default', className = '', id, ...props },
  ref
) => {
  const [focused, setFocused] = useState(false);
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  const base = 'w-full transition-all duration-200 outline-none text-sm';
  const variants = {
    default: 'glass-input rounded-xl px-3 py-2.5',
    search: 'glass-input rounded-xl pl-9 pr-3 py-2.5',
    ghost: 'bg-transparent border-b border-border/50 px-1 py-2 focus:border-accent/70',
  };

  return (
    <div className="relative">
      {label && (
        <label
          htmlFor={inputId}
          className={`absolute left-3 transition-all duration-200 pointer-events-none
            ${focused || props.value ? 'top-0.5 text-[10px] text-accent font-medium' : 'top-2.5 text-sm text-content-muted'}`}
        >
          {label}
        </label>
      )}
      {icon && variant === 'search' && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted">{icon}</span>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`${base} ${variants[variant]} ${error ? 'border-danger/50 focus:border-danger' : ''} ${className}`}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
});
Input.displayName = 'Input';
