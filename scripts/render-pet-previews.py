from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FRAMES_ROOT = ROOT / "work" / "pet-v1" / "frames"
OUTPUT_ROOT = ROOT / "work" / "pet-v1" / "qa" / "previews"

SOURCE_DURATIONS = {
    "idle": [280, 110, 110, 140, 140, 320],
    "look-left": [150] * 4,
    "look-right": [150] * 4,
    "click-reaction": [100, 100, 120, 140, 120, 180],
    "drag-left": [110] * 8,
    "drag-right": [110] * 8,
    "dock-left-enter": [100, 110, 120, 130, 150, 220],
    "dock-left-idle": [180] * 6,
    "dock-right-enter": [100, 110, 120, 130, 150, 220],
    "dock-right-idle": [180] * 6,
}
DURATIONS = {
    action: [half for duration in durations for half in (duration // 2, duration - duration // 2)]
    for action, durations in SOURCE_DURATIONS.items()
}

OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
for action, durations in DURATIONS.items():
    paths = sorted((FRAMES_ROOT / action).glob("*.png"))
    if len(paths) != len(durations):
        raise RuntimeError(f"{action}: expected {len(durations)} frames, found {len(paths)}")
    frames = [Image.open(path).convert("RGBA") for path in paths]
    output = OUTPUT_ROOT / f"{action}.gif"
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        transparency=0,
    )
    print(f"Wrote {output.relative_to(ROOT)}")
