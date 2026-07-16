import {useState} from 'react';
import type {MotionMode, PetSettings} from '../shared/contracts';

/** 设置窗口：所有字段即时通过 IPC 写入主进程，界面不保存独立副本。 */
interface Props {
  settings: PetSettings;
}

export const SettingsView = ({settings}: Props) => {
  const [saving, setSaving] = useState(false);

  const update = async (patch: Partial<PetSettings>) => {
    setSaving(true);
    try {
      // 主进程负责 schema 校验、落盘以及向全部窗口广播最新设置。
      await window.desktopPet.updateSettings(patch);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="settings-shell">
      <header>
        <div className="settings-icon" aria-hidden="true">●</div>
        <div>
          <h1>Desktop Pet</h1>
          <p>Appearance and desktop behavior</p>
        </div>
      </header>

      <section className="settings-card">
        <label className="setting-range">
          <span>
            <strong>Pet size</strong>
            <output>{settings.petSize}px</output>
          </span>
          <input
            type="range"
            min="96"
            max="240"
            step="8"
            value={settings.petSize}
            onChange={(event) => void update({petSize: Number(event.currentTarget.value)})}
          />
        </label>

        <Toggle
          label="Always on top"
          description="Keep the pet above other windows."
          checked={settings.alwaysOnTop}
          onChange={(alwaysOnTop) => void update({alwaysOnTop})}
        />
        <Toggle
          label="Snap to left and right edges"
          description="Dock after releasing the pet near an edge."
          checked={settings.snapEdges}
          onChange={(snapEdges) => void update({snapEdges})}
        />

        <label className={`setting-range ${settings.snapEdges ? '' : 'disabled'}`}>
          <span>
            <strong>Edge distance</strong>
            <output>{settings.snapThreshold}px</output>
          </span>
          <input
            type="range"
            min="8"
            max="64"
            step="4"
            disabled={!settings.snapEdges}
            value={settings.snapThreshold}
            onChange={(event) => void update({snapThreshold: Number(event.currentTarget.value)})}
          />
        </label>

        <Toggle
          label="Launch at login"
          description="Start the pet when you sign in."
          checked={settings.launchAtLogin}
          onChange={(launchAtLogin) => void update({launchAtLogin})}
        />

        <label className="setting-select">
          <span>
            <strong>Motion</strong>
            <small>Follow the operating system or choose a mode.</small>
          </span>
          <select
            value={settings.motionMode}
            onChange={(event) => void update({motionMode: event.currentTarget.value as MotionMode})}
          >
            <option value="system">System</option>
            <option value="full">Full motion</option>
            <option value="reduced">Reduced motion</option>
          </select>
        </label>
      </section>

      <button className="reset-button" type="button" onClick={() => void window.desktopPet.resetPosition()}>
        Reset pet position
      </button>
      <p className="save-status" aria-live="polite">{saving ? 'Saving…' : 'Changes save automatically'}</p>
    </main>
  );
};

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const Toggle = ({label, description, checked, onChange}: ToggleProps) => (
  // label 包裹 checkbox，让文字和开关都可点击。
  <label className="setting-toggle">
    <span>
      <strong>{label}</strong>
      <small>{description}</small>
    </span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
  </label>
);
