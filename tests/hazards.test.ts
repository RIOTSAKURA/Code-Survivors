import { describe, expect, it } from 'vitest';
import { pointSegmentDistance } from '../src/systems/hazards';

describe('deadlock line distance', () => {
  it('measures the perpendicular distance inside the segment', () => {
    expect(pointSegmentDistance(0, 10, -50, 0, 50, 0)).toBeCloseTo(10, 6);
    expect(pointSegmentDistance(25, -4, -50, 0, 50, 0)).toBeCloseTo(4, 6);
  });

  it('clamps to the endpoints outside the segment', () => {
    expect(pointSegmentDistance(-60, 0, -50, 0, 50, 0)).toBeCloseTo(10, 6);
    expect(pointSegmentDistance(80, 3, -50, 0, 50, 0)).toBeCloseTo(Math.hypot(30, 3), 6);
  });

  it('handles degenerate segments', () => {
    expect(pointSegmentDistance(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6);
  });
});
