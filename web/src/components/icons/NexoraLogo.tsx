interface NexoraLogoProps {
  /** Size in px (default 96). The logo is square. */
  size?: number;
  className?: string;
  /** Unique gradient id prefix — pass when multiple logos are on screen. */
  idPrefix?: string;
}

/**
 * Nexora brand logo — gradient shield with an "N" monogram.
 * Same artwork as public/logo.svg and the Login screen.
 */
export default function NexoraLogo({ size = 96, className, idPrefix = "nl" }: NexoraLogoProps) {
  const body = `${idPrefix}-body`;
  const shine = `${idPrefix}-shine`;
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg" aria-label="Nexora">
      <defs>
        <linearGradient id={body} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="25%" stopColor="#6366F1" />
          <stop offset="50%" stopColor="#8B5CF6" />
          <stop offset="75%" stopColor="#D946EF" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
        <linearGradient id={shine} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0.5" />
          <stop offset="40%" stopColor="white" stopOpacity="0.15" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M18 2 L32 8 L32 20 C32 29 26 34 18 36 C10 34 4 29 4 20 L4 8 Z" fill={`url(#${body})`} />
      <path d="M18 2 L32 8 L32 20 C32 29 26 34 18 36 C10 34 4 29 4 20 L4 8 Z" fill={`url(#${shine})`} />
      <text
        x="18"
        y="25"
        textAnchor="middle"
        fill="white"
        fontSize="22"
        fontWeight="900"
        fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        letterSpacing="-0.05em"
      >
        N
      </text>
    </svg>
  );
}
