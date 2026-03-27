## Summary

Short one-line description of the release.

## What's New

- Feature one description
- Feature two description
- Feature three description

## Improvements

- Performance improvement
- UX refinement
- Internal optimization

## Fixes

- Fixed issue with stealth activation
- Resolved crash on startup
- Corrected UI alignment issue

## Technical

- Dependency updates
- Refactored updater logic

## ⚠️macOS Installation (Unsigned Build)

Download the correct architecture .zip or .dmg file for your device (Apple Silicon or Intel).

If you see "App is damaged":

- **For .zip downloads:**
  1. Move the app to your Applications folder.
  2. Open Terminal and run: `xattr -cr /Applications/Pika.app`

- **For .dmg downloads:**
  1. Open Terminal and run:
     ```bash
     xattr -cr ~/Downloads/Pika-2.0.2-arm64.dmg
     # Or for Intel Macs:
     xattr -cr ~/Downloads/Pika-2.0.2-x64.dmg
     ```
  2. Install the downloaded DMG
  3. Open Terminal and run: `xattr -cr /Applications/Pika.app`

## ⚠️Windows Installation (Unsigned Build)

When running the installer on Windows, you might see a "Windows protected your PC" warning from Microsoft Defender SmartScreen saying it prevented an unrecognized app from starting. 

Since this is an unsigned build, this is expected. You can safely ignore it by clicking **More info** and then **Run anyway**.

\\ refer to change.md for detailed changes
