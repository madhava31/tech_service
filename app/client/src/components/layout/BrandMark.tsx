import { useId } from 'react';

/** The TS monogram, drawn in theme colours (top in ink, lower part in muted grey). */
export function BrandLogo({ className = '' }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`ts-logo ${className}`} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <mask id={`tsCut${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <circle cx="50" cy="50" r="50" fill="#fff" />
          <path d="M-2 23.6 L62.6 23.6 L60.2 35 L-2 35 Z" fill="#000" />
          <path d="M31.4 34 L41.8 34 L32.2 67.6 L21.6 67.6 Z" fill="#000" />
          <path d="M83 52.4 L62 52.4 C47 52.4 39.6 54.6 39.6 59.4 C39.6 64 46.2 65 57.8 66 C71.2 67.2 77.4 69.2 77.4 73.6 C77.4 78.8 71.6 81.2 60 81.2 L34.2 81.2" fill="none" stroke="#000" strokeWidth="7.8" />
        </mask>
      </defs>
      <g mask={`url(#tsCut${id})`}>
        <rect className="b" width="100" height="100" />
        <path className="t" d="M0 0 H100 V39.4 L39 47.8 L42 35 L0 35 Z" />
      </g>
    </svg>
  );
}

export function BrandMark() {
  return (
    <span className="ts-brand">
      <span className="ts-logo-wrap"><BrandLogo /></span>
      <span className="ts-bn">
        <span className="ts-brand-name"><b>Technicon</b> Services</span>
        <small className="ts-tagline">Advancing Analytical Science</small>
      </span>
    </span>
  );
}
