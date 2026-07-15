import {describe, expect, it} from 'vitest';
import {defaultPetManifest} from '../../src/shared/default-pet';
import {petManifestSchema, persistedStateSchema} from '../../src/shared/contracts';

describe('runtime contracts', () => {
  it('fills persisted state defaults', () => {
    const state = persistedStateSchema.parse({});
    expect(state.settings.petSize).toBe(160);
    expect(state.settings.snapThreshold).toBe(24);
    expect(state.placement.dockSide).toBeNull();
  });

  it('accepts the bundled pet manifest', () => {
    expect(petManifestSchema.parse(defaultPetManifest)).toEqual(defaultPetManifest);
  });

  it('rejects atlases with more than sixteen frames in a row', () => {
    const invalid = structuredClone(defaultPetManifest);
    invalid.animations.idle.frames = 17;
    expect(() => petManifestSchema.parse(invalid)).toThrow();
  });
});
