import {describe, expect, it} from 'vitest';
import {positionForPlacement, snapOrClamp, yRatioFor} from '../../src/main/geometry';

const workArea = {x: -1920, y: 0, width: 1920, height: 1080};

describe('desktop geometry', () => {
  it('snaps the visible pet edge on a negative-coordinate display', () => {
    const result = snapOrClamp(
      {x: -2005, y: 600, width: 320, height: 320},
      workArea,
      320,
      160,
      24,
      true,
    );
    expect(result).toEqual({x: -2000, y: 600, dockSide: 'left'});
  });

  it('snaps to the right edge and clamps vertical position', () => {
    const result = snapOrClamp(
      {x: -239, y: 900, width: 320, height: 320},
      workArea,
      320,
      160,
      24,
      true,
    );
    expect(result).toEqual({x: -240, y: 760, dockSide: 'right'});
  });

  it('still snaps after the visible pet is dragged past the right edge', () => {
    const result = snapOrClamp(
      {x: -160, y: 500, width: 320, height: 320},
      workArea,
      320,
      160,
      24,
      true,
    );
    expect(result).toEqual({x: -240, y: 500, dockSide: 'right'});
  });

  it('clamps a free window when edge snapping is disabled', () => {
    const result = snapOrClamp(
      {x: 100, y: -100, width: 320, height: 320},
      workArea,
      320,
      160,
      24,
      false,
    );
    expect(result).toEqual({x: -320, y: 0, dockSide: null});
  });

  it('restores a docked position from a saved vertical ratio', () => {
    const point = positionForPlacement(
      {displayId: 2, x: null, y: null, yRatio: 0.5, dockSide: 'right'},
      workArea,
      320,
      160,
    );
    expect(point).toEqual({x: -240, y: 380});
  });

  it('normalizes vertical placement', () => {
    expect(yRatioFor({x: 0, y: 380, width: 320, height: 320}, {x: 0, y: 0, width: 1920, height: 1080})).toBe(0.5);
  });
});
