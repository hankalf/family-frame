/**
 * Inline weather icons — no remote images, so the frame renders with no
 * internet. Same convention as the other kiosk icons: 24×24 viewBox, stroked
 * with currentColor, sized by the `size` prop.
 */

const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

const CLOUD_PATH = 'M6.5 18a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.5 1.4A3.5 3.5 0 0 1 17 18z';

function Clear({ size }) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </svg>
  );
}

function ClearNight({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8.2 8.2 0 1 0 20 14.5z" />
    </svg>
  );
}

function Partly({ size }) {
  return (
    <svg {...base(size)}>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M8.5 2.6v1.4M3.1 8h1.4M4.7 4.2l1 1M12.3 4.2l-1 1" />
      <path d={CLOUD_PATH} />
    </svg>
  );
}

function PartlyNight({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M14.5 7.8A5 5 0 0 1 8 3.2a5.1 5.1 0 1 0 6.5 4.6z" />
      <path d={CLOUD_PATH} />
    </svg>
  );
}

function Cloud({ size }) {
  return (
    <svg {...base(size)}>
      <path d={CLOUD_PATH} />
    </svg>
  );
}

function Fog({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 15a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.5 1.4A3.5 3.5 0 0 1 17 15z" />
      <path d="M4 18.5h16M6.5 21.5h11" />
    </svg>
  );
}

function Drizzle({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 14a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.5 1.4A3.5 3.5 0 0 1 17 14z" />
      <path d="M9 17.5v1.5M13 17.5v1.5M17 17.5v1.5" />
    </svg>
  );
}

function Rain({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 14a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.5 1.4A3.5 3.5 0 0 1 17 14z" />
      <path d="M8.5 17l-1 3.5M12.5 17l-1 3.5M16.5 17l-1 3.5" />
    </svg>
  );
}

function Sleet({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 14a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.5 1.4A3.5 3.5 0 0 1 17 14z" />
      <path d="M9 17l-1 3.5M16 17l-1 3.5" />
      <path d="M12.5 18h1.5M13.25 17.25v1.5" />
    </svg>
  );
}

function Snow({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 14a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.5 1.4A3.5 3.5 0 0 1 17 14z" />
      <path d="M8 18.5h2M9 17.5v2M14 18.5h2M15 17.5v2M11 21h2M12 20v2" />
    </svg>
  );
}

function Thunder({ size }) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 14a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.5 1.4A3.5 3.5 0 0 1 17 14z" />
      <path d="M13 16l-3 4h3.5l-1 3.2" />
    </svg>
  );
}

const ICONS = {
  clear: Clear,
  clearNight: ClearNight,
  partly: Partly,
  partlyNight: PartlyNight,
  cloud: Cloud,
  fog: Fog,
  drizzle: Drizzle,
  rain: Rain,
  sleet: Sleet,
  snow: Snow,
  thunder: Thunder,
};

/** Accent colours so a glance reads the condition without the label. */
const TINTS = {
  clear: 'text-amber-300',
  clearNight: 'text-slate-300',
  partly: 'text-amber-200',
  partlyNight: 'text-slate-300',
  cloud: 'text-slate-300',
  fog: 'text-slate-400',
  drizzle: 'text-sky-300',
  rain: 'text-sky-400',
  sleet: 'text-sky-200',
  snow: 'text-sky-100',
  thunder: 'text-violet-300',
};

export default function WeatherIcon({ icon, size = 24, className = '' }) {
  const Component = ICONS[icon] || Cloud;
  return (
    <span className={`${TINTS[icon] || 'text-slate-300'} ${className}`}>
      <Component size={size} />
    </span>
  );
}
