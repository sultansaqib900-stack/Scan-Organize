import { FolderColor } from '@/lib/model';

export function FolderGlyph({ color = 'sage' }: { color?: FolderColor }) {
  return <svg className={`folder-glyph ${color}`} viewBox="0 0 64 54" fill="none" aria-hidden="true"><path d="M3 12a6 6 0 0 1 6-6h15l6 6h25a6 6 0 0 1 6 6v28a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V12Z" className="folder-back" /><path d="M3 23a6 6 0 0 1 6-6h46a6 6 0 0 1 6 6v23a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V23Z" className="folder-front" /><path d="M26 31h12m-12 6h8" className="folder-mark" strokeWidth="2.3" strokeLinecap="round" /></svg>;
}

export function ScanIllustration() {
  return <svg className="scan-illustration" viewBox="0 0 450 300" fill="none" aria-hidden="true">
    <defs>
      <filter id="paper-shadow" x="-60%" y="-50%" width="230%" height="230%"><feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#365b4c" floodOpacity=".12" /></filter>
      <pattern id="hero-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" stroke="#b8d2c4" strokeOpacity=".23" /></pattern>
      <linearGradient id="scan-beam" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#3b906a" stopOpacity="0" /><stop offset="1" stopColor="#3b906a" stopOpacity=".14" /></linearGradient>
    </defs>
    <rect x="20" y="6" width="410" height="286" rx="60" fill="url(#hero-grid)" />
    <circle cx="222" cy="153" r="111" stroke="#bdd2c5" strokeOpacity=".45" strokeDasharray="4 6" />
    <g transform="rotate(13 275 162)" filter="url(#paper-shadow)"><rect x="207" y="65" width="129" height="177" rx="8" fill="#f3e8cc" /><rect x="225" y="85" width="45" height="6" rx="3" fill="#cfc099" /><path d="M226 106h89m-89 10h89m-89 10h63" stroke="#d7cbaa" strokeWidth="3" strokeLinecap="round" /><rect x="225" y="164" width="92" height="49" rx="4" fill="#e5d8b6" /><path d="m247 188 12 9 22-23" stroke="#c3b28a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></g>
    <g transform="rotate(-9 203 146)" filter="url(#paper-shadow)">
      <rect x="125" y="33" width="155" height="226" rx="8" fill="#fff" />
      <path d="M149 64h26" stroke="#35674f" strokeWidth="4" strokeLinecap="round" /><path d="M149 77h67" stroke="#c7d7cc" strokeWidth="3" strokeLinecap="round" />
      <text x="147" y="109" fontFamily="'DM Sans', sans-serif" fontSize="17" fontWeight="650" fill="#345845">all in order.</text>
      <path d="M149 128h106" stroke="#e2e8e2" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M149 144h55m34 0h17m-106 16h46m43 0h17m-106 16h59m30 0h17" stroke="#d4ddd5" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M149 194h106" stroke="#e2e8e2" strokeWidth="1.5" /><path d="M149 211h32m48 0h26" stroke="#96b09e" strokeWidth="4" strokeLinecap="round" />
      <rect x="137" y="102" width="131" height="73" fill="url(#scan-beam)" />
      <path d="M136 175h133" stroke="#5b9876" strokeWidth="1.5" />
    </g>
    <path d="M114 59V39h20m133-3h20v20M97 232v20h20m158-2h20v-20" stroke="#448363" strokeWidth="2.5" strokeLinecap="round" />
    <g filter="url(#paper-shadow)"><circle cx="319" cy="225" r="27" fill="#fff" /><circle cx="319" cy="225" r="21" fill="#dfece2" /><path d="m310 225 6 6 12-13" stroke="#3f7858" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></g>
    <path d="M359 96v12m-6-6h12M83 182v10m-5-5h10" stroke="#97b4a0" strokeWidth="1.7" strokeLinecap="round" /><circle cx="322" cy="46" r="3" fill="#b5c7ab" /><circle cx="78" cy="103" r="4" fill="#d7cba7" />
  </svg>;
}

export function EmptyDocumentsIllustration() {
  return <svg width="67" height="67" viewBox="0 0 67 67" fill="none" aria-hidden="true"><rect x="0" y="0" width="67" height="67" rx="20" fill="#eef2eb" /><rect x="20" y="13" width="29" height="38" rx="4" transform="rotate(10 20 13)" fill="#d8e2d4" /><rect x="16" y="17" width="29" height="37" rx="4" fill="#fafcf8" stroke="#a7b8a0" strokeWidth="1.3" /><path d="M23 27h15m-15 6h15m-15 6h9" stroke="#9dad96" strokeWidth="1.6" strokeLinecap="round" /><circle cx="46" cy="48" r="9" fill="#dde9d9" stroke="#fafcf8" strokeWidth="3" /><path d="M43 48h6m-3-3v6" stroke="#6c8961" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}
