# Home Media Tools (Windows)

Two helper tools that work alongside Immich (your private Google Photos):

1. **`split_video.py`** — cut a long home video into separate clips, one per
   scene.
2. **`ai_captions.py`** — automatically write a description for each photo and
   video using AI that runs entirely on your own laptop (nothing uploaded
   anywhere).

Both are designed so the output feeds straight into Immich, which then sorts,
indexes, and lets you search everything.

---

## One-time setup

You'll install four free things. Don't worry — each is a normal installer.

### 1. Python
- Download from https://www.python.org/downloads/windows/
- During install, **check "Add Python to PATH"**.

### 2. FFmpeg (handles the actual video cutting / frame grabbing)
- Easiest: open PowerShell and run `winget install Gyan.FFmpeg`
- Or download from https://www.gyan.dev/ffmpeg/builds/ and add its `bin`
  folder to your PATH.
- Verify: `ffmpeg -version` should print something.

### 3. ExifTool (writes descriptions into your files)
- `winget install OliverBetz.ExifTool`  (or https://exiftool.org/)
- Verify: `exiftool -ver` should print a version number.

### 4. Ollama (runs the AI captioning model locally — only needed for captions)
- Download from https://ollama.com/download
- After install, open PowerShell and pull a vision model:
  ```powershell
  ollama pull llava
  ```
  (`llava` is light and good. For sharper captions and if your laptop is
  beefy, try `ollama pull llama3.2-vision` and pass `--model llama3.2-vision`.)

### 5. Install the Python packages
From inside this `home-media-tools` folder:
```powershell
pip install -r requirements.txt
```

---

## Tool 1 — Split a video by scene

```powershell
# Simplest: clips land in a "<name>_clips" folder next to the video
python split_video.py "C:\videos\christmas2003.mp4"

# Send clips straight to your Immich import folder
python split_video.py "C:\videos\big.mp4" --out "C:\immich-import\clips"

# Fewer, longer clips:
python split_video.py "C:\videos\big.mp4" --threshold 35 --min-seconds 5

# More, shorter clips:
python split_video.py "C:\videos\big.mp4" --threshold 20
```

How to think about the settings:
- **`--threshold`**: sensitivity. Lower = more cuts (more clips). Higher = fewer.
  Start at the default 27; nudge by ±5 until the clips feel right.
- **`--min-seconds`**: throw away scenes shorter than this so you aren't buried
  in tiny fragments.
- **`--copy`**: split super-fast with zero quality loss, but cuts snap to the
  nearest keyframe (can be a second or two off). Without it, cuts are
  frame-accurate but the video is re-encoded (slower).

The tool reads the whole video once to find scene changes, then writes each
scene as its own `.mp4`. **Your original file is never modified.** Review the
clips, then move the keepers into Immich.

---

## Tool 2 — AI descriptions for photos & videos

```powershell
# Caption everything in a folder
python ai_captions.py "C:\immich-import"

# Include subfolders
python ai_captions.py "C:\photos" --recursive

# Re-do files that already have a description
python ai_captions.py "C:\photos" --overwrite
```

What happens:
- Each **photo** is shown to the local AI model, which writes a one-sentence
  description into the file's metadata (EXIF/XMP `Description`).
- Each **video** gets a frame grabbed from a few seconds in, that frame is
  captioned, and the description is written to the video file.
- Files that already have a description are **skipped** (use `--overwrite` to
  redo them), so you can run it repeatedly as new media arrives.

After it runs, tell Immich to re-read metadata so the descriptions show up and
become searchable:
> Immich → Administration → Jobs → run **Extract Metadata** (or rescan the
> library).

Privacy: the AI model runs through Ollama **on your laptop**. No images, video,
or captions are sent over the internet.

---

## Suggested workflow for a pile of old home videos

1. `split_video.py` each big video into clips (into a staging folder).
2. Skim the clips, delete any junk scenes.
3. `ai_captions.py` on the staging folder to describe them.
4. Move the folder into Immich's import location.
5. In Immich: name the faces it finds, fix any wrong dates on the timeline,
   add albums/tags as you like.

---

## Troubleshooting

- **"ffmpeg/exiftool not found"** — it isn't on your PATH. Re-open PowerShell
  after installing, or reinstall with the PATH option, and re-check with
  `ffmpeg -version` / `exiftool -ver`.
- **"Can't reach Ollama"** — make sure the Ollama app is running and you've run
  `ollama pull llava` at least once.
- **Captioning is slow** — that's the AI model thinking; it's faster on a PC
  with a decent GPU. `llava` is the lighter option.
- **Scene splitting found one giant scene** — lower `--threshold` (e.g. 20).
- **Too many tiny clips** — raise `--threshold` and/or `--min-seconds`.
