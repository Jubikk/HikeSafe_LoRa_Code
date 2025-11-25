# Files and directories to archive for HikeSafe slim build

This file lists directories and files that can be moved into `archive/` to trim the repository for the LilyGo HikeSafe firmware.

Suggested items to archive (script below will attempt to move these if they exist):

- `arch/esp32` (keep only the LilyGo/TTGO variant if needed)
- `arch/rp2040`
- `arch/nrf52`
- `boards/` (keep only the necessary LilyGo board json)
- `device_firmware/`
- `examples/` (keep only `examples/companion_radio` and `examples/simple_secure_chat`)
- `variants/` (keep only LilyGo variant)
- `docs/` (optional)
- `lib/ed25519` (if you plan to vendor crypto keep it, otherwise leave)

If you want me to physically move these files, run the included PowerShell script `scripts/archive-unneeded.ps1` which will move the listed directories into `archive/`.

Review the list before running the script.

-- HikeSafe (automated archive list)
