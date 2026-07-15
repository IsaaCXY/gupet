import {z} from 'zod';

export const WINDOW_SIZE = 320;
export const DRAG_THRESHOLD = 6;

export const dockSideSchema = z.enum(['left', 'right']).nullable();
export type DockSide = z.infer<typeof dockSideSchema>;

export const motionModeSchema = z.enum(['system', 'reduced', 'full']);
export type MotionMode = z.infer<typeof motionModeSchema>;

export const settingsSchema = z.object({
  petSize: z.number().int().min(96).max(240).default(160),
  alwaysOnTop: z.boolean().default(true),
  snapEdges: z.boolean().default(true),
  snapThreshold: z.number().int().min(8).max(64).default(24),
  launchAtLogin: z.boolean().default(false),
  motionMode: motionModeSchema.default('system'),
});

export type PetSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: PetSettings = {
  petSize: 160,
  alwaysOnTop: true,
  snapEdges: true,
  snapThreshold: 24,
  launchAtLogin: false,
  motionMode: 'system',
};

export const placementSchema = z.object({
  displayId: z.number().nullable().default(null),
  x: z.number().int().nullable().default(null),
  y: z.number().int().nullable().default(null),
  yRatio: z.number().min(0).max(1).default(0.72),
  dockSide: dockSideSchema.default(null),
});

export type PetPlacement = z.infer<typeof placementSchema>;

export const DEFAULT_PLACEMENT: PetPlacement = {
  displayId: null,
  x: null,
  y: null,
  yRatio: 0.72,
  dockSide: null,
};

export const persistedStateSchema = z.object({
  settings: settingsSchema.default(DEFAULT_SETTINGS),
  placement: placementSchema.default(DEFAULT_PLACEMENT),
});

export type PersistedState = z.infer<typeof persistedStateSchema>;

export interface AnimationDefinition {
  row: number;
  frames: number;
  durationsMs: number[];
  loop: boolean;
  reducedMotionFrame: number;
}

export interface PetManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  atlasPath: string;
  cell: {
    width: 256;
    height: 256;
    columns: 16;
  };
  animations: Record<string, AnimationDefinition>;
  bindings: {
    idle: string;
    pointerLeft: string;
    pointerRight: string;
    click: string;
    dragLeft: string;
    dragRight: string;
    dockLeftEnter: string;
    dockLeftIdle: string;
    dockRightEnter: string;
    dockRightIdle: string;
  };
  hitTest: {
    alphaThreshold: number;
  };
}

const animationDefinitionSchema = z
  .object({
    row: z.number().int().min(0),
    frames: z.number().int().min(1).max(16),
    durationsMs: z.array(z.number().positive()).min(1).max(16),
    loop: z.boolean(),
    reducedMotionFrame: z.number().int().min(0),
  })
  .superRefine((animation, context) => {
    if (animation.durationsMs.length !== animation.frames) {
      context.addIssue({code: 'custom', message: 'durationsMs must contain one value per frame', path: ['durationsMs']});
    }
    if (animation.reducedMotionFrame >= animation.frames) {
      context.addIssue({code: 'custom', message: 'reducedMotionFrame must reference a used frame', path: ['reducedMotionFrame']});
    }
  });

export const petManifestSchema: z.ZodType<PetManifest> = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    displayName: z.string().min(1),
    atlasPath: z.string().min(1),
    cell: z.object({
      width: z.literal(256),
      height: z.literal(256),
      columns: z.literal(16),
    }),
    animations: z.record(z.string(), animationDefinitionSchema),
    bindings: z.object({
      idle: z.string(),
      pointerLeft: z.string(),
      pointerRight: z.string(),
      click: z.string(),
      dragLeft: z.string(),
      dragRight: z.string(),
      dockLeftEnter: z.string(),
      dockLeftIdle: z.string(),
      dockRightEnter: z.string(),
      dockRightIdle: z.string(),
    }),
    hitTest: z.object({
      alphaThreshold: z.number().int().min(0).max(255),
    }),
  })
  .superRefine((manifest, context) => {
    for (const [binding, animation] of Object.entries(manifest.bindings)) {
      if (!manifest.animations[animation]) {
        context.addIssue({code: 'custom', message: `Binding ${binding} references missing animation ${animation}`, path: ['bindings', binding]});
      }
    }
  });

export interface DragPoint {
  screenX: number;
  screenY: number;
  grabX: number;
  grabY: number;
}

export interface DesktopPetApi {
  getSettings(): Promise<PetSettings>;
  updateSettings(patch: Partial<PetSettings>): Promise<PetSettings>;
  onSettingsChanged(listener: (settings: PetSettings) => void): () => void;
  getPlacement(): Promise<PetPlacement>;
  setIgnoreMouseEvents(ignore: boolean): void;
  movePet(point: DragPoint): void;
  finishDrag(): Promise<DockSide>;
  resetPosition(): Promise<PetPlacement>;
  openContextMenu(): void;
}
