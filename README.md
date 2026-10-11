# AURELIA: Empires of the Sun — Unity Web

A Roman single-player RTS with four ages, economy, construction, research, fog, AI combat, tactical pause, and local saves.

## Architecture

The battlefield runs in a Unity 6.3 LTS Web player. Unity C# owns the camera, terrain meshes, fog mesh, sprite GameObjects, selection overlays, building previews, and movement interpolation. The existing deterministic JavaScript simulation remains in its browser Worker; browser HTML controls and save storage are retained. This is a Unity rendering migration, not a full C# simulation rewrite. Canvas is used to bake original art textures and draw the minimap; the main battlefield is rendered by Unity WebGL.

## Files

- `Unity/Assets`: C# client, Editor build entry point, scene, and JavaScript plug-in.
- `Unity/Packages` and `Unity/ProjectSettings`: Unity project configuration.
- `Web`: deployable Unity player, original game simulation, browser UI, and art.
- `tests`: original simulation and projection regressions adapted to the Web directory.
- `scripts/build-unity.ps1`: reproducible local build using Unity 6000.3.26f1 with Web build support.

## Build and run

```powershell
.\scripts\build-unity.ps1 -EditorPath 'C:\path\to\Editor\Unity.exe'
npm.cmd test
npm.cmd run serve
```

Open the printed local URL. Vercel serves `Web` as a static site; no Unity installation is required for players. A rebuild requires a licensed Unity Editor with Web build support. Generated Library, local profiles, logs, and provider credentials are excluded from Git.

## Controls and saves

Select with left click or drag, give contextual orders with right click, pan with arrow keys, zoom with the wheel, and use Space for tactical pause. The in-game field guide covers commands, hotkeys, formations, and progression. Saves belong to the browser and site origin; saves from ChatGPT Sites do not automatically transfer to a Vercel origin.

The game source was imported from the original Sites release, commit `faf05afcafad367298ee6caec586153d89ed12ed`.
