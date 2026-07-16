import {copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {app} from 'electron';
import {
  persistedStateSchema,
  placementSchema,
  settingsSchema,
  type PersistedState,
  type PetPlacement,
  type PetSettings,
} from '../shared/contracts';

/**
 * 主进程唯一的设置/位置存储。
 * Renderer 只能经 IPC 读写，避免它直接访问用户目录。
 */
const DEFAULT_STATE: PersistedState = persistedStateSchema.parse({});

export class StateStore {
  private readonly filePath: string;
  private state: PersistedState;

  constructor(userDataPath = app.getPath('userData')) {
    this.filePath = path.join(userDataPath, 'state.json');
    this.state = this.load();
  }

  getSettings(): PetSettings {
    return structuredClone(this.state.settings);
  }

  getPlacement(): PetPlacement {
    return structuredClone(this.state.placement);
  }

  updateSettings(patch: Partial<PetSettings>): PetSettings {
    const safePatch = settingsSchema.partial().parse(patch);
    this.state.settings = settingsSchema.parse({...this.state.settings, ...safePatch});
    this.save();
    return this.getSettings();
  }

  updatePlacement(patch: Partial<PetPlacement>): PetPlacement {
    const safePatch = placementSchema.partial().parse(patch);
    this.state.placement = placementSchema.parse({...this.state.placement, ...safePatch});
    this.save();
    return this.getPlacement();
  }

  private load(): PersistedState {
    mkdirSync(path.dirname(this.filePath), {recursive: true});
    if (!existsSync(this.filePath)) return structuredClone(DEFAULT_STATE);

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      return persistedStateSchema.parse(JSON.parse(raw));
    } catch {
      // 损坏文件保留现场，应用仍可使用默认状态启动。
      const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        copyFileSync(this.filePath, backupPath);
      } catch {
        // A failed backup must not prevent the app from recovering with defaults.
      }
      return structuredClone(DEFAULT_STATE);
    }
  }

  private save(): void {
    // 先写临时文件再原子重命名，避免中断时留下半截 JSON。
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, this.filePath);
  }
}
