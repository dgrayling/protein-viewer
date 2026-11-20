import { useState } from 'react';
import { useDrag } from '@use-gesture/react';
import type { Direction } from '../nav/treeCursor';

const DISTANCE = 50; // px
const VELOCITY = 0.4; // px/ms, a quick flick counts even if short

/**
 * Swipe-to-navigate. Finger moves left → next protein ('right'), like a
 * carousel; finger moves up → ancestor ('up'); down → descendant.
 *
 * Returns a bind function for the swipe surface and the live drag offset,
 * so the surface can follow the finger.
 */
export function useTreeSwipe(onNavigate: (dir: Direction) => void, opts: { axis?: 'x' | 'y' } = {}) {
  const [offset, setOffset] = useState<[number, number]>([0, 0]);

  const bind = useDrag(
    ({ active, last, canceled, movement: [mx, my], velocity: [vx, vy], direction: [dx, dy], axis, tap }) => {
      if (tap) return;
      if (active) {
        setOffset(axis === 'x' ? [mx, 0] : [0, my]);
        return;
      }
      setOffset([0, 0]);
      // Navigate exactly once per gesture, on release.
      if (!last || canceled) return;
      if (axis === 'x' && (Math.abs(mx) > DISTANCE || vx > VELOCITY)) {
        onNavigate((dx || Math.sign(mx)) < 0 ? 'right' : 'left');
      } else if (axis === 'y' && (Math.abs(my) > DISTANCE || vy > VELOCITY)) {
        onNavigate((dy || Math.sign(my)) < 0 ? 'up' : 'down');
      }
    },
    {
      axis: opts.axis,
      // Lock to the dominant axis after a few px so diagonal drags pick one.
      threshold: 8,
      filterTaps: true,
      pointer: { touch: true },
    },
  );

  return { bind, offset };
}
