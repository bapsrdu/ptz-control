# Temple PTZ Control: build plan

A desktop app (Windows and Mac) that lets one volunteer run three BZBGEAR
BG-ADAMO-4KND25X cameras and a Blackmagic ATEM switcher from a single screen.
Modelled on the Churchfront "CueVideo" demo video.

This document is the brief for whoever builds the app. Build the phases in
order. Each phase ends with something that can be run and checked.

## 1. What the reference app does

Taken from the video and its narration. The layout reads top to bottom as three
numbered steps.

| Area | What it shows |
|---|---|
| Top left, green border | Large preview of the camera that is "next" |
| Top right, red border | Large view of what is live |
| Step 1 "Pick what's next" | A row of small live thumbnails: Cam 1, Cam 2, Cam 3, Graphics. Badges mark LIVE (red) and NEXT (green). An icon shows which cameras are tracking. Clicking a thumbnail makes it "next" |
| Step 2 "Frame Cam N" | Controls for the "next" camera: a round joystick, a vertical zoom slider, a speed slider (turtle to rabbit, e.g. 1.6x) with Reset, a Focus button, a Tracking toggle with Close / Waist / Full framing and a tracking speed, and an Exposure button |
| Step 3 "Take it live" | A big red FADE button, plus CUT, BLACK and LOWER THIRDS |
| Shots panel, bottom left | One row per camera with named preset buttons (for example "Home") and a "+" to save the current position. A label marks the shot a camera is sitting on |

The key idea is that the joystick always drives the "next" camera, never the
live one, so a volunteer cannot move a camera that is on air by accident.

## 2. How this differs for our cameras

- The video uses Canon cameras with no tracking of their own, so that app finds
  the person on the Mac and steers the camera. Our BZB cameras track by
  themselves. The app turns that on and off.
- The camera's own tracking offers two modes (Presenter, Zone) and a Headroom
  setting (Low / Medium / High). It has no Close / Waist / Full framing. Those
  three buttons only exist if we build app-side tracking (phase 7).
- The camera's tracking algorithm cannot be improved from outside. The choice
  per camera is either the camera's tracker or the app's tracker, not both at
  once. See phase 7.

## 3. Facts about the camera

From the BG-ADAMO-4KND product manual. Items marked "verify" are not stated
clearly in the manual and must be confirmed on a real camera in phase 0.

| Item | Value |
|---|---|
| Default address | 192.168.5.163, login admin / admin |
| Web page | port 80 (HTTPS 443) |
| VISCA over IP | port 1259. UDP or TCP, and raw VISCA or Sony 8-byte header: verify |
| Web page live channel | WebSocket, port 8088 |
| ONVIF | port 2000 |
| Preview video | `rtsp://IP:554/live/av1` (sub stream, up to 720x480). Main stream is `live/av0` |
| RTSP login | Off by default. If enabled: `rtsp://user:pass@IP:554/live/av1` |
| Presets | 255 (numbers 0 to 254). Preset 0 is the power-on home position |
| Pan speed | 0x01 to 0x18 |
| Tilt speed | 0x01 to 0x14 |

VISCA commands the app needs. `8x` is `81` for camera address 1.

| Action | Bytes |
|---|---|
| Move | `81 01 06 01 VV WW PP TT FF`. VV pan speed, WW tilt speed. PP: 01 left, 02 right, 03 none. TT: 01 up, 02 down, 03 none |
| Stop | `81 01 06 01 VV WW 03 03 FF` |
| Home | `81 01 06 04 FF` |
| Zoom | in `81 01 04 07 2p FF`, out `81 01 04 07 3p FF`, stop `81 01 04 07 00 FF` |
| Focus | auto `81 01 04 38 02 FF`, manual `81 01 04 38 03 FF`, far `81 01 04 08 02 FF`, near `81 01 04 08 03 FF`, stop `81 01 04 08 00 FF`. The manual's focus table is garbled, so these are the standard VISCA values: verify |
| Preset | save `81 01 04 3F 01 pp FF`, recall `81 01 04 3F 02 pp FF`, clear `81 01 04 3F 00 pp FF` |
| Tracking | on `81 0A 01 32 00 00 02 00 FF`, off `81 0A 01 32 00 00 03 00 FF` |
| Tally light | red on `81 01 7E 01 0A 00 02 00 FF`, red off `... 00 03 00 FF`, green on `81 01 7E 01 0A 00 00 02 FF`, green off `... 00 00 03 FF` |
| Exposure mode | auto `81 01 04 39 00 FF`, manual `03`, shutter priority `0A`, iris priority `0B`, bright `0D` |
| Exposure comp | on `81 01 04 3E 02 FF`, up `81 01 04 0E 02 FF`, down `81 01 04 0E 03 FF`, reset `81 01 04 0E 00 FF` |
| Backlight | on `81 01 04 33 02 FF`, off `81 01 04 33 03 FF` |
| White balance | auto `81 01 04 35 00 FF`, one push `03`, manual `05`, fixed 3000K to 7000K `01 02 04 06 07 08 09 0A 0B` |
| Power | on `81 01 04 00 02 FF`, standby `81 01 04 00 03 FF` |
| Read position | pan/tilt `81 09 06 12 FF`, zoom `81 09 04 47 FF` |

Replies: `90 41 FF` accepted, `90 51 FF` done, `90 60 02 FF` syntax error,
`90 61 41 FF` cannot run now.

Not available over VISCA, only on the camera's web page: tracking mode
(Presenter / Zone), headroom, zone setup, "tracking lost" preset, picture style,
brightness and contrast sliders, SD card recording. These are phase 6.

## 4. Features

**Must have**

1. Live thumbnails of all three cameras, plus large Next and Live views.
2. Click a camera to make it "next". Joystick, zoom and focus drive that camera.
3. Speed slider for joystick and zoom.
4. Named presets per camera with save, recall, rename, delete and a thumbnail
   picture taken when saved.
5. CUT, FADE and BLACK through the ATEM. Live and Next always mirror the ATEM,
   including when someone presses buttons on the ATEM itself.
6. Tracking on/off per camera, with an icon on the thumbnail.
7. Guard on the live camera: moving it or recalling a preset on it needs an
   extra confirmation.
8. Connection status for each camera and the ATEM, with automatic reconnect.

**Should have**

9. Camera tally lights follow the ATEM: red when live, green when next.
10. Lower thirds on/off (ATEM upstream or downstream key).
11. Exposure panel: mode, exposure compensation, backlight, white balance.
12. Keyboard shortcuts: 1/2/3 pick next, Space cut, Enter fade, arrows move.
13. Settings screen for camera names, addresses and ATEM input numbers.

**Later**

14. Tracking mode, headroom and zones from the camera web page (phase 6).
15. App-side tracking with Close / Waist / Full framing (phase 7).
16. Use from a tablet browser on the same network.

## 5. Technology

- **Electron + React + TypeScript**, built with Vite. One codebase for Windows
  and Mac.
- **ATEM**: the `atem-connection` npm package.
- **Cameras**: a small VISCA client written in the app, using Node `dgram` and
  `net`. No library needed.
- **Preview video**: bundle the `go2rtc` binary and run it as a child process.
  It pulls each camera's RTSP sub stream and serves it to the app window as
  WebRTC, with under half a second of delay. The Live view is whichever camera
  the ATEM has on program. Non-camera inputs such as Graphics show a labelled
  tile, not video.
- **Settings and presets**: one JSON file in the user's app-data folder. Preset
  positions are stored in the camera itself, so the IR remote and the camera web
  page keep working. The JSON file holds each preset's name, number and
  thumbnail.
- **Packaging**: `electron-builder`, producing a Windows installer and a Mac
  `.dmg`.

All network code runs in the Electron main process. The window talks to it over
a typed IPC interface, so the user interface never opens sockets itself.

```
src/main/visca/      VISCA client, command builders, per-camera queue
src/main/atem/       ATEM wrapper, state mirror, tally sync
src/main/video/      go2rtc process and its config
src/main/store/      settings and presets JSON
src/main/ipc.ts      typed channel between main and window
src/renderer/        React screens and components
sim/                 fake camera and fake ATEM for testing
```

## 6. Phases

### Phase 0: checks at the temple (needs a person on site)

The build environment cannot reach the cameras, so these answers have to come
from the temple network.

1. Give each camera a fixed address and turn DHCP off. Write down the three
   addresses and the ATEM's address and model.
2. Run `tools/visca-probe` (built in phase 1) against one camera. It tries UDP
   and TCP on port 1259, with and without the 8-byte header, sends a
   zoom-position query and reports which combination answers.
3. Open one camera's web page in Chrome with DevTools on the Network tab. Use
   every control once, including Track Configuration, then save the log as a
   HAR file and add it to `docs/`. This is the source for phase 6.
4. Confirm `rtsp://IP:554/live/av1` plays in VLC.

### Phase 1: skeleton and simulators

- Electron + Vite + React + TypeScript project, lint and unit test setup.
- `sim/fake-camera`: answers VISCA on port 1259, keeps pan, tilt, zoom and
  presets in memory, logs each command.
- `sim/fake-atem`, or a mock behind the ATEM wrapper's interface.
- `tools/visca-probe` as described above.
- Settings file with the three cameras and the ATEM.

Done when: the app opens, shows three empty camera tiles, and the probe gets an
answer from the fake camera.

### Phase 2: camera movement and presets

- VISCA client with one command queue per camera, reply handling, timeouts and
  reconnect. The transport (UDP/TCP, header or not) is a setting, filled in from
  phase 0.
- Joystick: drag distance sets speed, release sends Stop. Send a new move
  command only when direction or speed changes, at most 10 per second. Always
  send Stop on release, on window blur and on app quit.
- Zoom slider that springs back to centre, focus auto/manual with near and far.
- Speed slider scaling pan, tilt and zoom speeds.
- Shots panel: save, recall, rename, delete.

Done when: every control produces the expected bytes in the fake camera's log,
checked by unit tests.

### Phase 3: preview video

- Start go2rtc with a generated config for the three sub streams. Restart it if
  it exits.
- Thumbnails and the Next view play over WebRTC. Show a clear "no video" tile
  when a stream is down.
- Capture a still frame when a preset is saved and use it as the thumbnail.

### Phase 4: ATEM

- Connect, mirror program and preview, map ATEM inputs to cameras in settings.
- Clicking a thumbnail sets ATEM preview. CUT, FADE (auto transition) and BLACK
  (fade to black) buttons.
- Lower thirds toggle on a key chosen in settings.
- Tally sync to the cameras.
- Live-camera guard from feature 7.

### Phase 5: tracking toggle and exposure

- Tracking on/off per camera. Turn tracking off automatically when the operator
  touches the joystick or recalls a preset on that camera, and show that it
  happened.
- Exposure panel from feature 11.

### Phase 6: web-page-only features

Using the HAR file from phase 0, add tracking mode, headroom, zone setup,
"tracking lost" preset and picture style. If the camera requires a login for
these calls, store the password with Electron `safeStorage`, not in the JSON
file.

### Phase 7 (optional): app-side tracking

Only build this if the camera's tracking proves not good enough in real
services.

- Run a person-detection model on the preview stream inside the app. Good open
  options: Google MediaPipe Pose Landmarker (Apache 2.0, runs in the window with
  no extra install) or a YOLO pose model through ONNX Runtime. Check the YOLO
  model's licence before shipping it.
- Steer with VISCA move commands from a simple control loop: keep the chosen
  body point at a target place in the frame, with a dead zone in the middle so
  the camera does not twitch.
- Close / Waist / Full sets how much of the frame the person's height should
  fill, and the loop zooms to match.
- The camera's own tracking must be off on a camera while the app is tracking
  it.
- Expect several services' worth of tuning. The sub stream is small and has
  delay, so this will react more slowly than the camera's own tracker.

### Phase 8: packaging

Installers for Windows and Mac, an app icon, and a one-page volunteer guide.

## 7. Rules for the builder

- Never send a move command without a matching Stop path. A camera left panning
  during a service is the worst failure this app can have.
- The ATEM is the source of truth for what is live. Do not keep a separate idea
  of "live" in the app.
- Losing one camera or the ATEM must not freeze the rest of the screen.
- No cloud services, accounts or internet access. Everything stays on the
  temple network.
- Test against the simulators in this environment. Anything that could only be
  confirmed on real hardware goes into `docs/ON-SITE-CHECKLIST.md`.

## 8. Still to confirm

- ATEM model and address, and which input each camera and the graphics computer
  are on.
- Results of the phase 0 probe and the HAR file.
- Whether lower thirds come from an ATEM key or from another program.
- Camera firmware version, shown on the web page under System, Update.
