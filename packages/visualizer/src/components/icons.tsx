import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 14, children, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />
  </Svg>
);

export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.2 1.2 3.4 9.1h4.1l-1 5.7 6.1-8.2H8.4l.8-5.4Z" fill="currentColor" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 4.6V8l2.4 1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const HandOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4.5h6.5a3 3 0 0 1 0 6H4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="m6.5 8.2-2.4 2.3 2.4 2.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

export const FitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

export const NoteIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 7.2v4M8 4.8v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

export const WarnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.2 1.8 13h12.4L8 2.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M8 6.5v3M8 11.3v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

export const MapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m1.8 3.6 4-1.4 4.4 1.6 4-1.4v10l-4 1.4-4.4-1.6-4 1.4v-10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M5.8 2.2v10M10.2 3.8v10" stroke="currentColor" strokeWidth="1.5" />
  </Svg>
);

export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3.5 6 4.5 4.5L12.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.7" />
    <path d="m10.5 10.5 3.2 3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3.2 8.4 3 3 6.6-6.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5h6M12 4.5h1.5M2.5 11.5H4M7.5 11.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="10.2" cy="4.5" r="1.7" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="5.8" cy="11.5" r="1.7" stroke="currentColor" strokeWidth="1.6" />
  </Svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8H3.5M7.5 3.8 3.3 8l4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h9.5M8.5 3.8 12.7 8l-4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="2.8" height="10" rx="0.8" fill="currentColor" />
    <rect x="9.2" y="3" width="2.8" height="10" rx="0.8" fill="currentColor" />
  </Svg>
);

export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 2.8h3.7v3.7M13 3 7.6 8.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M11.5 9.5v2.6a1.1 1.1 0 0 1-1.1 1.1H3.9a1.1 1.1 0 0 1-1.1-1.1V5.6a1.1 1.1 0 0 1 1.1-1.1h2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </Svg>
);

export const RouteIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="3.8" cy="12.2" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="12.2" cy="3.8" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    <path d="M5.6 12.2h4.2a2.2 2.2 0 0 0 0-4.4H6.2a2.2 2.2 0 0 1 0-4.4h4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </Svg>
);

export const ReplayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 1 0 1.6-3.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M3.2 2.6v2.6h2.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
