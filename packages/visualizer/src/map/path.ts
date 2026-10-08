import type { Point } from '../layout/layout';

/** An orthogonal polyline with rounded corners. */
export function roundedPath(points: Point[], radius = 10) {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;
  for (let i = 0; i < rest.length; i++) {
    const prev = points[i]!;
    const curr = rest[i]!;
    const next = rest[i + 1];
    if (!next) {
      d += ` L ${curr.x} ${curr.y}`;
      break;
    }
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = { x: curr.x - ((curr.x - prev.x) / (inLen || 1)) * r, y: curr.y - ((curr.y - prev.y) / (inLen || 1)) * r };
    const b = { x: curr.x + ((next.x - curr.x) / (outLen || 1)) * r, y: curr.y + ((next.y - curr.y) / (outLen || 1)) * r };
    d += ` L ${a.x} ${a.y} Q ${curr.x} ${curr.y} ${b.x} ${b.y}`;
  }
  return d;
}
