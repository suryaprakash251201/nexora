/**
 * Custom SVG file-type icons for Nexora.
 * Full-color, brand-accurate icons for popular file formats.
 * Falls back to Lucide icons for unlisted types via FileIcon.tsx.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const d = (size = 24) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" });

/* ── PDF ──────────────────────────────────────── */
export function PdfIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="3" y="1" width="18" height="22" rx="2" fill="#DC2626" />
      <rect x="3" y="1" width="18" height="22" rx="2" fill="url(#pdf-g)" fillOpacity="0.4" />
      <path d="M7 7h3.5c1.1 0 2 .9 2 2s-.9 2-2 2H7V7z" stroke="#fff" strokeWidth="1.2" fill="none" />
      <path d="M7 7v7" stroke="#fff" strokeWidth="1.2" />
      <path d="M14 7h3.5c1.1 0 2 .9 2 2s-.9 2-2 2H14V7zm0 4v3" stroke="#fff" strokeWidth="1.2" fill="none" />
      <rect x="5" y="16" width="14" height="5" rx="1" fill="#B91C1C" />
      <text x="12" y="20" textAnchor="middle" fill="white" fontSize="4" fontWeight="700" fontFamily="system-ui">PDF</text>
      <defs><linearGradient id="pdf-g" x1="12" y1="1" x2="12" y2="23"><stop stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

/* ── Word / DOCX ──────────────────────────────── */
export function DocxIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="3" y="1" width="18" height="22" rx="2" fill="#2563EB" />
      <rect x="3" y="1" width="18" height="22" rx="2" fill="url(#doc-g)" fillOpacity="0.3" />
      <path d="M7 7h2l1.5 5 1.5-5h2" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="5" y="16" width="14" height="5" rx="1" fill="#1D4ED8" />
      <text x="12" y="20" textAnchor="middle" fill="white" fontSize="4" fontWeight="700" fontFamily="system-ui">DOC</text>
      <defs><linearGradient id="doc-g" x1="12" y1="1" x2="12" y2="23"><stop stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

/* ── Excel / XLSX ─────────────────────────────── */
export function XlsxIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="3" y="1" width="18" height="22" rx="2" fill="#16A34A" />
      <rect x="3" y="1" width="18" height="22" rx="2" fill="url(#xls-g)" fillOpacity="0.3" />
      <path d="M8 7l3 5-3 5M16 7l-3 5 3 5" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="6" y="8" width="5" height="3" rx="0.5" fill="#15803D" stroke="#fff" strokeWidth="0.5" />
      <rect x="13" y="8" width="5" height="3" rx="0.5" fill="#15803D" stroke="#fff" strokeWidth="0.5" />
      <rect x="5" y="16" width="14" height="5" rx="1" fill="#15803D" />
      <text x="12" y="20" textAnchor="middle" fill="white" fontSize="4" fontWeight="700" fontFamily="system-ui">XLS</text>
      <defs><linearGradient id="xls-g" x1="12" y1="1" x2="12" y2="23"><stop stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

/* ── PowerPoint / PPTX ────────────────────────── */
export function PptxIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="3" y="1" width="18" height="22" rx="2" fill="#EA580C" />
      <rect x="3" y="1" width="18" height="22" rx="2" fill="url(#ppt-g)" fillOpacity="0.3" />
      <circle cx="12" cy="10" r="4" stroke="#fff" strokeWidth="1.2" fill="none" />
      <path d="M12 6v4h4" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <rect x="5" y="16" width="14" height="5" rx="1" fill="#C2410C" />
      <text x="12" y="20" textAnchor="middle" fill="white" fontSize="4" fontWeight="700" fontFamily="system-ui">PPT</text>
      <defs><linearGradient id="ppt-g" x1="12" y1="1" x2="12" y2="23"><stop stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

/* ── JavaScript ───────────────────────────────── */
export function JsIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#F7DF1E" />
      <text x="17" y="18" textAnchor="end" fill="#323330" fontSize="11" fontWeight="800" fontFamily="monospace">JS</text>
    </svg>
  );
}

/* ── TypeScript ───────────────────────────────── */
export function TsIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#3178C6" />
      <text x="17" y="18" textAnchor="end" fill="#fff" fontSize="11" fontWeight="800" fontFamily="monospace">TS</text>
    </svg>
  );
}

/* ── Python ───────────────────────────────────── */
export function PythonIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#3776AB" />
      <circle cx="10" cy="8" r="1.5" fill="#FFD43B" />
      <path d="M12 5c-3 0-5 1.5-5 4v3h5v1H6v3c0 2.5 2 4 5 4s5-1.5 5-4v-3h-5v-1h6V9c0-2.5-2-4-5-4z" fill="#FFD43B" fillOpacity="0.3" />
      <circle cx="14" cy="16" r="1.5" fill="#fff" />
    </svg>
  );
}

/* ── Go ───────────────────────────────────────── */
export function GoIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#00ADD8" />
      <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="800" fontFamily="monospace">Go</text>
    </svg>
  );
}

/* ── Rust ──────────────────────────────────────── */
export function RustIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#CE422B" />
      <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="800" fontFamily="monospace">Rs</text>
    </svg>
  );
}

/* ── HTML ──────────────────────────────────────── */
export function HtmlIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#E44D26" />
      <path d="M6 4l1.5 16 4.5 2 4.5-2L18 4H6z" fill="#F16529" />
      <path d="M12 6v14l3.5-1.5L17 6H12z" fill="#E44D26" />
      <text x="12" y="15" textAnchor="middle" fill="#fff" fontSize="5" fontWeight="700" fontFamily="system-ui">&lt;/&gt;</text>
    </svg>
  );
}

/* ── CSS ───────────────────────────────────────── */
export function CssIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#264DE4" />
      <path d="M6 4l1.5 16 4.5 2 4.5-2L18 4H6z" fill="#2965F1" />
      <text x="12" y="15" textAnchor="middle" fill="#fff" fontSize="5" fontWeight="700" fontFamily="system-ui">{`{ }`}</text>
    </svg>
  );
}

/* ── JSON ──────────────────────────────────────── */
export function JsonIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#292929" />
      <text x="12" y="15" textAnchor="middle" fill="#F7DF1E" fontSize="7" fontWeight="700" fontFamily="monospace">{`{}`}</text>
    </svg>
  );
}

/* ── React / JSX / TSX ────────────────────────── */
export function ReactIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#20232A" />
      <circle cx="12" cy="12" r="2" fill="#61DAFB" />
      <ellipse cx="12" cy="12" rx="8" ry="3" stroke="#61DAFB" strokeWidth="0.8" fill="none" />
      <ellipse cx="12" cy="12" rx="8" ry="3" stroke="#61DAFB" strokeWidth="0.8" fill="none" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="8" ry="3" stroke="#61DAFB" strokeWidth="0.8" fill="none" transform="rotate(120 12 12)" />
    </svg>
  );
}

/* ── Markdown ─────────────────────────────────── */
export function MarkdownIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="3" width="20" height="18" rx="2" fill="#354150" stroke="#6B7B8D" strokeWidth="0.5" />
      <path d="M6 16V8l3 4 3-4v8" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 11v5m0 0l-2-2.5M17 16l2-2.5" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── ZIP / Archive ────────────────────────────── */
export function ZipIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="3" y="1" width="18" height="22" rx="2" fill="#D97706" />
      <rect x="3" y="1" width="18" height="22" rx="2" fill="url(#zip-g)" fillOpacity="0.3" />
      <rect x="10" y="3" width="4" height="2" rx="0.5" fill="#92400E" />
      <rect x="10" y="6" width="4" height="2" rx="0.5" fill="#92400E" />
      <rect x="10" y="9" width="4" height="2" rx="0.5" fill="#92400E" />
      <rect x="9" y="12" width="6" height="5" rx="1" fill="#92400E" stroke="#fff" strokeWidth="0.5" />
      <circle cx="12" cy="14.5" r="1" fill="#D97706" />
      <rect x="5" y="18" width="14" height="4" rx="1" fill="#92400E" />
      <text x="12" y="21" textAnchor="middle" fill="white" fontSize="3.5" fontWeight="700" fontFamily="system-ui">ZIP</text>
      <defs><linearGradient id="zip-g" x1="12" y1="1" x2="12" y2="23"><stop stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

/* ── Image ────────────────────────────────────── */
export function ImageFileIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="3" y="1" width="18" height="22" rx="2" fill="#059669" />
      <rect x="3" y="1" width="18" height="22" rx="2" fill="url(#img-g)" fillOpacity="0.3" />
      <circle cx="9" cy="8" r="2" fill="#fff" fillOpacity="0.6" />
      <path d="M5 16l4-5 3 3 2-2 5 4H5z" fill="#fff" fillOpacity="0.4" />
      <rect x="5" y="18" width="14" height="4" rx="1" fill="#047857" />
      <text x="12" y="21" textAnchor="middle" fill="white" fontSize="3.5" fontWeight="700" fontFamily="system-ui">IMG</text>
      <defs><linearGradient id="img-g" x1="12" y1="1" x2="12" y2="23"><stop stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

/* ── Audio / MP3 ──────────────────────────────── */
export function AudioIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="3" y="1" width="18" height="22" rx="2" fill="#DB2777" />
      <rect x="3" y="1" width="18" height="22" rx="2" fill="url(#aud-g)" fillOpacity="0.3" />
      <circle cx="10" cy="14" r="3" stroke="#fff" strokeWidth="1.2" fill="none" />
      <path d="M13 14V6l4 2" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="5" y="18" width="14" height="4" rx="1" fill="#BE185D" />
      <text x="12" y="21" textAnchor="middle" fill="white" fontSize="3.5" fontWeight="700" fontFamily="system-ui">MP3</text>
      <defs><linearGradient id="aud-g" x1="12" y1="1" x2="12" y2="23"><stop stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

/* ── Video / MP4 ──────────────────────────────── */
export function VideoIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="3" y="1" width="18" height="22" rx="2" fill="#7C3AED" />
      <rect x="3" y="1" width="18" height="22" rx="2" fill="url(#vid-g)" fillOpacity="0.3" />
      <path d="M10 8v8l6-4-6-4z" fill="#fff" fillOpacity="0.8" />
      <rect x="5" y="18" width="14" height="4" rx="1" fill="#6D28D9" />
      <text x="12" y="21" textAnchor="middle" fill="white" fontSize="3.5" fontWeight="700" fontFamily="system-ui">MP4</text>
      <defs><linearGradient id="vid-g" x1="12" y1="1" x2="12" y2="23"><stop stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

/* ── Docker ────────────────────────────────────── */
export function DockerIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#2496ED" />
      <g fill="#fff" fillOpacity="0.9">
        <rect x="5" y="9" width="3" height="2.5" rx="0.3" />
        <rect x="9" y="9" width="3" height="2.5" rx="0.3" />
        <rect x="13" y="9" width="3" height="2.5" rx="0.3" />
        <rect x="9" y="6" width="3" height="2.5" rx="0.3" />
        <rect x="13" y="6" width="3" height="2.5" rx="0.3" />
      </g>
      <path d="M3 13c1-1 3-1 4 0s3 2 8 1 5-3 5-3" stroke="#fff" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ── Git ───────────────────────────────────────── */
export function GitIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#F05032" />
      <circle cx="8" cy="9" r="1.5" fill="#fff" />
      <circle cx="16" cy="9" r="1.5" fill="#fff" />
      <circle cx="8" cy="16" r="1.5" fill="#fff" />
      <path d="M8 10.5v4M9.5 9h5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/* ── Shell / Bash ─────────────────────────────── */
export function ShellIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#1E293B" />
      <path d="M7 8l4 4-4 4" stroke="#22D3EE" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 16h5" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── YAML / TOML ──────────────────────────────── */
export function ConfigIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#4338CA" />
      <path d="M7 7h2v3l3-3h0l3 3V7h2" stroke="#A5B4FC" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M7 13h10M7 16h7" stroke="#C7D2FE" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/* ── SVG ───────────────────────────────────────── */
export function SvgIcon({ size, ...p }: IconProps) {
  return (
    <svg {...d(size)} {...p}>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#F59E0B" />
      <circle cx="9" cy="10" r="3" stroke="#fff" strokeWidth="1" fill="none" />
      <rect x="13" y="7" width="5" height="5" rx="0.5" stroke="#fff" strokeWidth="1" fill="none" />
      <polygon points="9,15 6,19 12,19" stroke="#fff" strokeWidth="1" fill="none" />
    </svg>
  );
}

/**
 * Extension → custom icon component mapping.
 * Keys are lowercase file extensions (without dot).
 */
export const customIconMap: Record<string, React.FC<IconProps>> = {
  // Documents
  pdf: PdfIcon,
  doc: DocxIcon, docx: DocxIcon, odt: DocxIcon, pages: DocxIcon,
  xls: XlsxIcon, xlsx: XlsxIcon, ods: XlsxIcon, numbers: XlsxIcon, csv: XlsxIcon,
  ppt: PptxIcon, pptx: PptxIcon, odp: PptxIcon, key: PptxIcon,

  // Code
  js: JsIcon, mjs: JsIcon, cjs: JsIcon,
  ts: TsIcon, mts: TsIcon, cts: TsIcon,
  jsx: ReactIcon, tsx: ReactIcon,
  py: PythonIcon, pyw: PythonIcon,
  go: GoIcon,
  rs: RustIcon,
  html: HtmlIcon, htm: HtmlIcon,
  css: CssIcon, scss: CssIcon, less: CssIcon, sass: CssIcon,
  json: JsonIcon, jsonc: JsonIcon,
  yaml: ConfigIcon, yml: ConfigIcon, toml: ConfigIcon, ini: ConfigIcon,
  sh: ShellIcon, bash: ShellIcon, zsh: ShellIcon, fish: ShellIcon,
  md: MarkdownIcon, markdown: MarkdownIcon, mdx: MarkdownIcon,

  // Archives
  zip: ZipIcon, "7z": ZipIcon, rar: ZipIcon, tar: ZipIcon, gz: ZipIcon, bz2: ZipIcon, xz: ZipIcon,

  // Media (when thumbnail is unavailable)
  mp3: AudioIcon, flac: AudioIcon, wav: AudioIcon, ogg: AudioIcon, m4a: AudioIcon, aac: AudioIcon, opus: AudioIcon, wma: AudioIcon,
  mp4: VideoIcon, webm: VideoIcon, mov: VideoIcon, mkv: VideoIcon, avi: VideoIcon, m4v: VideoIcon, wmv: VideoIcon,

  // Images (fallback when no thumbnail)
  jpg: ImageFileIcon, jpeg: ImageFileIcon, png: ImageFileIcon, gif: ImageFileIcon, webp: ImageFileIcon, bmp: ImageFileIcon, avif: ImageFileIcon,
  svg: SvgIcon,

  // DevOps & Tools
  dockerfile: DockerIcon, "docker-compose": DockerIcon,
  gitignore: GitIcon, gitmodules: GitIcon, gitattributes: GitIcon,
};
