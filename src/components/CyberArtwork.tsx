/**
 * Original abstract artwork for public account screens. It uses layered
 * geometry, arcs, and light trails rather than cultural or sacred motifs.
 * Decorative only: hidden from assistive technology and disabled by
 * prefers-reduced-motion in index.css.
 */
export function CyberArtwork() {
  return (
    <svg
      className="cyber-artwork"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="cyber-glow-cyan" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00FFFF" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#00FFFF" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#00FFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cyber-glow-magenta" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF00FF" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#FF00FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cyber-facet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4B0082" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#BF00FF" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#080B14" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cyber-trail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#29AB87" stopOpacity="0" />
          <stop offset="45%" stopColor="#00FFFF" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#FF4500" stopOpacity="0" />
        </linearGradient>
        <pattern id="cyber-grid" width="72" height="72" patternUnits="userSpaceOnUse">
          <path d="M72 0H0V72" fill="none" stroke="#38B899" strokeOpacity="0.12" />
        </pattern>
      </defs>

      <rect width="1600" height="1000" fill="url(#cyber-grid)" className="cyber-artwork__grid" />
      <ellipse cx="1240" cy="210" rx="560" ry="430" fill="url(#cyber-glow-cyan)" />
      <ellipse cx="340" cy="790" rx="470" ry="360" fill="url(#cyber-glow-magenta)" />

      <g className="cyber-artwork__facet">
        <path
          d="M930 -80 1680 240 1420 920 620 700 520 120Z"
          fill="url(#cyber-facet)"
          stroke="#4B0082"
          strokeOpacity="0.45"
        />
        <path d="M1080 60 1500 250 1300 650 980 540Z" fill="none" stroke="#29AB87" strokeOpacity="0.28" />
      </g>

      <g className="cyber-artwork__orbit" fill="none">
        <ellipse cx="1210" cy="260" rx="430" ry="280" stroke="#00FFFF" strokeOpacity="0.22" strokeWidth="1.5" />
        <ellipse cx="1210" cy="260" rx="350" ry="220" stroke="#29AB87" strokeOpacity="0.3" strokeDasharray="9 18" />
        <ellipse cx="1210" cy="260" rx="270" ry="160" stroke="#A875E8" strokeOpacity="0.35" strokeWidth="2" />
        <path
          d="M880 490c170 90 430 60 560-90"
          stroke="#E88960"
          strokeOpacity="0.45"
          strokeWidth="2"
        />
      </g>

      <g className="cyber-artwork__shards" fill="none">
        <path d="M90 250 280 150 350 330 180 390Z" stroke="#29AB87" strokeOpacity="0.5" />
        <path d="M250 130 330 70 390 185 300 220Z" fill="#29AB87" fillOpacity="0.08" stroke="#29AB87" strokeOpacity="0.6" />
        <path d="M1090 760 1290 690 1370 840 1160 910Z" stroke="#DC68CC" strokeOpacity="0.4" />
        <path d="M1180 700 1260 650 1325 760" stroke="#FF4500" strokeOpacity="0.4" />
        <path d="M520 850 610 820 640 900 540 930Z" stroke="#00FFFF" strokeOpacity="0.26" />
      </g>

      <path
        className="cyber-artwork__trail"
        d="M-40 780c220-120 320 90 520 30s240-250 470-210 300 210 650 80"
        fill="none"
        stroke="url(#cyber-trail)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <g className="cyber-artwork__drift" fill="none">
        <circle cx="1130" cy="330" r="180" stroke="#00FFFF" strokeOpacity="0.08" />
        <circle cx="1130" cy="330" r="124" stroke="#29AB87" strokeOpacity="0.2" strokeDasharray="3 12" />
        <path d="M1010 450 1130 190 1250 450Z" stroke="#A875E8" strokeOpacity="0.22" />
        <path d="M1035 420 1130 220 1225 420Z" stroke="#29AB87" strokeOpacity="0.18" />
      </g>

      <g className="cyber-artwork__ticks" stroke="#7EE0D5" strokeOpacity="0.4">
        <path d="M1440 100v48M1416 124h48" />
        <path d="M120 640v32M104 656h32" />
        <path d="M760 80v22M749 91h22" />
      </g>
    </svg>
  );
}
