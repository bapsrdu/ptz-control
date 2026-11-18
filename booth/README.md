# Booth Video

A second app in this repository: one screen to **switch the ATEM and frame
PTZ cameras**, for Windows and Mac. Its features follow Churchfront's
open-source CueVideo (a Mac-only app for Canon cameras), rebuilt for VISCA
cameras such as the BZB BG-ADAMO, with RTSP preview video. See `NOTICE`.

Universal PTZ Controller is unchanged and still never switches. Booth Video
does switch: use one or the other at a time on the same cameras.

## Pages

- **Operate** (where it always opens): Next and Live monitors with the
  cameras' live video, the source row, saved shots for every camera,
  exposure, the joystick and zoom lever, Focus and Track, the speed dial, and
  Fade, Cut, Black, key buttons and routing buttons. The camera controls act
  on the camera on Next, so the live camera cannot be moved by accident; a
  shot on the live camera asks first.
- **Routing**: what each M/E is for, every aux output as picture to screen,
  outputs that switch together, and the operator's routing buttons.
- **Full switcher**: program and preview, mix / dip / wipe / DVE, rate, Cut,
  Auto, FTB, a T-bar, next-transition keys, keys on air, DSK tie / cut / auto,
  macros and aux outputs.
- **Setup**: switcher address and M/E, source row, key buttons, cameras
  (address, switcher input, video address, shots, named camera presets,
  find on the network), tracking, the camera web login and the setup file.
- **Status**: connections, cameras and every command sent to the switcher,
  with Copy report.

## Keys (Operate only, never while a dialog is open)

1 to 9 and 0 put that tile on Next, Shift + number puts it on Live, Space
cuts, Return fades, the arrows move the camera on Next.

## Setup file

`config.json` in the app's settings folder (Setup, Setup file, Show in
folder). Plain JSON; edits are picked up within a second. A copy of the
last good setup is kept beside it, and a file with a mistake is kept aside
before it is saved over.

## Not in this version

- NDI previews, the Claude (MCP) connection and stage scan (not wanted).
- Controlling BZB cameras over their web page (HTTP) instead of VISCA: the
  camera's HTTP commands for moving and for a preview picture are not
  published. A recording of the camera's web page (Universal PTZ
  Controller, Settings, Record a camera's web page) while panning, zooming
  and recalling a preset is needed to add it.
- White balance by exact kelvin: BZB cameras offer fixed 3000 K to 7000 K
  steps, which the White row steps through.

## Build

```
npm run start:booth          # run from the source folder
npm run dist:booth:win       # Windows installer (on Windows)
npm run dist:booth:mac       # Mac disk images (on a Mac)
```

The "Build installers" GitHub workflow builds both apps for Windows and Mac.
