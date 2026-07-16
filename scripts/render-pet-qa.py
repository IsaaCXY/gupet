import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


"""从正式 atlas 与 manifest 生成接触表和 GIF，检查运行时实际会播放的帧。"""

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description="Render contact sheet and GIF previews from the current Pet atlas.")
    parser.add_argument("--manifest", type=Path, default=ROOT / "public" / "pets" / "default" / "pet.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "work" / "pet-v2" / "qa")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    atlas_path = args.manifest.parent / Path(manifest["atlasPath"]).name
    atlas = Image.open(atlas_path).convert("RGBA")
    cell = manifest["cell"]["width"]
    preview_dir = args.output_dir / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    actions = sorted(manifest["animations"].items(), key=lambda item: item[1]["row"])
    label_width = 220
    preview_cell = 128
    # 接触表每行最多展示 32 帧；长动画通过 GIF 复核完整时序，静态表则均匀抽样。
    contact = Image.new("RGBA", (label_width + cell // 2 * manifest["cell"]["columns"], preview_cell * len(actions)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(contact)

    for action_index, (name, animation) in enumerate(actions):
        row_y = action_index * preview_cell
        background = (232, 234, 238, 255) if action_index % 2 == 0 else (215, 218, 223, 255)
        draw.rectangle((0, row_y, contact.width, row_y + preview_cell), fill=background)
        draw.text((16, row_y + 44), name, fill=(32, 35, 41, 255))
        draw.text((16, row_y + 68), f'{animation["frames"]} frames @ 30fps', fill=(80, 86, 96, 255))

        frames = []
        for frame in range(animation["frames"]):
            column = frame % manifest["cell"]["columns"]
            row = animation["row"] + frame // manifest["cell"]["columns"]
            source = atlas.crop((column * cell, row * cell, (column + 1) * cell, (row + 1) * cell))
            frames.append(source)
            if animation["frames"] <= manifest["cell"]["columns"]:
                # 常规动作逐格展示，不能套用长动画的抽样反推公式。
                contact_frame = frame
                contact.alpha_composite(source.resize((preview_cell, preview_cell)), (label_width + contact_frame * preview_cell, row_y))
            else:
                # 长动画仅在接触表均匀抽样；完整时序由 GIF 逐帧复核。
                contact_frame = round(frame * (manifest["cell"]["columns"] - 1) / (animation["frames"] - 1))
                if frame == round(contact_frame * (animation["frames"] - 1) / (manifest["cell"]["columns"] - 1)):
                    contact.alpha_composite(source.resize((preview_cell, preview_cell)), (label_width + contact_frame * preview_cell, row_y))

        # Pillow 的 GIF 写入需要整数毫秒；与 manifest 的 30fps 浮点值取最近整数。
        durations = [max(1, round(duration)) for duration in animation["durationsMs"]]
        frames[0].save(
            preview_dir / f"{name}.gif",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            disposal=2,
            transparency=0,
        )

    contact.convert("RGB").save(args.output_dir / "contact-sheet.png")
    print(f"Wrote {args.output_dir.relative_to(ROOT) / 'contact-sheet.png'}")
    print(f"Wrote {preview_dir.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
