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
