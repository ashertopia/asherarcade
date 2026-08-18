# Your Private Photo / File / Backup System (Windows)

Goal: Access your photos, videos, and files from your iPhone and Android phones,
back them up safely, and stop depending on Google — all running on your own
Windows laptop at home.

This replaces Google Photos and Google Drive with software **you** control. Nobody
can lock you out or delete your stuff.

---

## What you'll end up with

| Need | Tool you'll install |
|------|--------------------|
| Photos & videos (like Google Photos) | **Immich** |
| All files / documents (like Google Drive) | **Nextcloud** |
| Reach it from anywhere (off home WiFi) | **Tailscale** |
| Real backup (second copy) | **Your external drive + a scheduled copy** |

All four have free official **iPhone** and **Android** apps.

---

## ⚠️ Read this first: what "backup" really means

Your laptop holding the ONLY copy is **not a backup**. If that drive dies or the
laptop is lost/stolen, everything is gone — same as if Google deleted it.

The rule that keeps you safe (**3-2-1**):
- **3** copies of your data
- on **2** different drives
- with **1** copy kept somewhere else (offsite)

Your plan:
1. Phone → laptop drive  (copy 1)
2. Laptop → external USB drive, automatically  (copy 2)
3. Later: a second external drive you keep at a relative's house, OR an
   *encrypted* cloud copy  (copy 3, offsite)

---

## STEP 1 — Install Docker Desktop (the engine that runs everything)

Immich and Nextcloud run inside "containers," which keeps them tidy and easy.

1. Go to https://www.docker.com/products/docker-desktop/ and download
   **Docker Desktop for Windows**.
2. Run the installer. Accept the default options (it will enable "WSL 2" —
   say yes).
3. Restart the laptop when asked.
4. Open Docker Desktop. When it says "Engine running" (bottom-left is green),
   you're ready.

> Tip: In Docker Desktop → Settings → General, turn ON
> "Start Docker Desktop when you log in" so your media server comes back
> automatically after a reboot.

---

## STEP 2 — Install Immich (your private Google Photos)

1. Make a folder for it, e.g. `C:\server\immich`.
2. In that folder create a file named `docker-compose.yml`. Get the latest
   official contents here: https://immich.app/docs/install/docker-compose
   (copy their `docker-compose.yml` and `.env` example into this folder).
3. Open the `.env` file and set:
   - `UPLOAD_LOCATION` = where photos get stored, e.g. `C:\server\immich\library`
   - `DB_PASSWORD` = make up a strong password
4. Open **PowerShell**, then run:
   ```powershell
   cd C:\server\immich
   docker compose up -d
   ```
5. Wait a minute, then open a browser to: http://localhost:2283
6. Create your admin account. Done — that's your photo server.

**On your phones:**
- Install the **Immich** app (App Store / Play Store).
- Server URL while at home: `http://LAPTOP-LOCAL-IP:2283`
  (find the laptop IP by running `ipconfig` in PowerShell — look for
  "IPv4 Address", e.g. 192.168.1.50).
- Sign in, then turn on **Auto Backup** so new photos/videos upload
  automatically over WiFi.

---

## STEP 3 — Install Nextcloud (your private Google Drive)

The simplest path is **Nextcloud All-in-One**:

1. Make a folder `C:\server\nextcloud`.
2. Follow the AIO instructions here:
   https://github.com/nextcloud/all-in-one#how-to-use-this
   (it's a single `docker run` command you paste into PowerShell).
3. Open https://localhost:8080 and follow the on-screen setup.
4. Point its data storage at a folder on your big drive.

**On your phones:**
- Install the **Nextcloud** app.
- Sign in with your server address + account.
- You can browse, upload, and download any file. (It can also auto-upload
  photos, but let Immich handle photos and use Nextcloud for documents/files
  so you don't store everything twice.)

---

## STEP 4 — Access from anywhere with Tailscale (the important part)

Steps 2–3 only work on your home WiFi. Tailscale lets your phones reach the
laptop securely from anywhere (cellular, work, traveling) with no risky router
changes.

1. On the laptop: install Tailscale from https://tailscale.com/download and
   sign in (use the same account on all devices — e.g. your Google login is
   fine, Tailscale only connects your devices, it doesn't see your files).
2. Install the **Tailscale** app on both phones and sign in with the same
   account.
3. Tailscale gives the laptop a permanent private address like `100.x.x.x`.
   In the Immich and Nextcloud phone apps, use **that** address instead of
   the home IP — then they work both at home AND away.

> The laptop must be **powered on and awake** to be reachable. Set Windows
> power settings so it doesn't sleep (Settings → System → Power → Screen and
> sleep → "When plugged in, put my device to sleep" = Never).

---

## STEP 5 — Set up the real backup (external drive)

Now make that automatic second copy onto your external USB drive. Plug it in
and note its letter (e.g. `E:`).

**Easiest option — built-in Windows command + Task Scheduler:**

1. Create a backup script. In Notepad, save this as `C:\server\backup.bat`
   (adjust the source/destination paths to match yours):
   ```bat
   robocopy "C:\server\immich\library" "E:\backup\immich" /MIR /R:2 /W:5 /LOG:"E:\backup\immich-log.txt"
   robocopy "C:\server\nextcloud\data"  "E:\backup\nextcloud" /MIR /R:2 /W:5 /LOG:"E:\backup\nextcloud-log.txt"
   ```
   (`/MIR` keeps the external drive an exact mirror of your library.)
2. Open **Task Scheduler** (search for it in the Start menu).
3. Create a Basic Task → name it "Nightly Backup" → trigger **Daily** at, say,
   2:00 AM → action **Start a program** → browse to `C:\server\backup.bat`.
4. Finish. Now your stuff is copied to the external drive every night.

**Even friendlier alternative:** install **Duplicati** (https://www.duplicati.com)
— it has a web dashboard, scheduling, *encryption*, and can also send an
encrypted copy to a cheap cloud bucket for your offsite (copy 3) later.

---

## Quick daily reality check

- ✅ Laptop on + awake → phones see everything, at home or away.
- ✅ New phone photos upload automatically.
- ✅ Everything mirrored to the external drive nightly.
- ✅ Google has zero control over any of it.

## Sensible next upgrades (later, optional)

- Add an **offsite** copy (second drive at a relative's, or encrypted cloud) to
  complete the 3-2-1 rule.
- If leaving a laptop on all day feels wasteful, a small **mini-PC** or
  **Raspberry Pi / NAS** (like a Synology) makes a quieter always-on home for
  this. Same apps, same phone experience.

---

## If you'd rather not run two systems

You can start with **just Immich** (photos/videos are usually the most precious
and most painful to lose) plus the backup drive, and add Nextcloud later only if
you find you need general file storage. Less to manage on day one.
