# Universal Universal PTZ Controllerler: build plan

A desktop app (Windows and Mac) that lets one volunteer frame and recall shots
on a temple's PTZ cameras from a single screen. It is built first for BAPS
Raleigh and then shared with other temples, which may have one camera or
several. Modelled on the Churchfront "CueVideo" demo video.

This document is the brief for whoever builds the app. Build the phases in
order. Each phase ends with something that can be run and checked.

The app was called "PTZ Control" up to version 0.9. From 0.10 it is
**Universal PTZ Controller**, with a neon "U" logo (a PTZ camera on its stand
inside the U) in the style of the Broadcast Controller logo; the logo is drawn
by `build/make-icon.py`. On first start under the new name, settings and shot
pictures are copied from the old "PTZ Control" folder. The installer's appId
is unchanged, so it upgrades an existing install in place.

## 1. Decisions already made

| Topic | Decision |
|---|---|
| App shape | A separate app in this repo, not a page inside Broadcast Controller |
| Cameras | Added by the user in the app: name, address, port. Nothing about a temple's network is written into the code. Any number of cameras, from one upward |
| Switching | The app does not switch. No CUT, FADE or BLACK. A person switches on the ATEM as today |
| ATEM link | Optional. When connected it is used to show what is live and next, drive camera tally lights, and turn the lower-third key on and off |
| Lower thirds | One on/off button for the ATEM key that carries Broadcast Controller's output. Names and text are still cued in Broadcast Controller |
| Tracking | The camera's built-in tracking first. App-side tracking is an optional last phase |
| Platforms | Windows and Mac |

## 2. What the reference app does

Taken from the video and its narration. The layout reads top to bottom as three
numbered steps.

| Area | What it shows | In our app |
|---|---|---|
| Top left, green border | Large preview of the "next" camera | Large view of the selected camera |
| Top right, red border | Large view of what is live | Large view of the live camera or cameras, when an ATEM is connected |
| Step 1 "Pick what's next" | Row of live thumbnails with LIVE and NEXT badges and a tracking icon | Same row, one tile per camera the user has added. Clicking a tile selects that camera for control. It does not change the ATEM |
| Step 2 "Frame Cam N" | Joystick, zoom slider, speed slider with Reset, Focus, Tracking toggle with Close / Waist / Full, Exposure | Same, except Close / Waist / Full only exists with app-side tracking (phase 7) |
| Step 3 "Take it live" | FADE, CUT, BLACK, LOWER THIRDS | Only the LOWER THIRDS on/off button |
| Shots panel | One row per camera with named preset buttons and a "+" to save | Same |

The video's app always drives the "next" camera so a volunteer cannot move the
one on air. Ours lets the operator select any camera, and guards the live one
instead (feature 7).

## 3. The Raleigh setup

From the BAPS Raleigh video routing diagram, version 3.0. This is the first
site and the test case. None of it is written into the code.

- Switcher: Blackmagic ATEM 2 M/E Constellation HD, on the network.
- Three BZBGEAR BG-ADAMO-4KND25X cameras, each with SDI to the ATEM and a
  network cable.

| ATEM input | Source |
|---|---|
| 1, 2 | PC01 (Resolume Arena), two feeds |
| 3 | PTZ Left |
| 4 | PTZ Center |
| 5 | PTZ Right |
| 7 | Ronin |
| 8 | Camcorder |
| 9 | Resolume Confidence |
| 10 to 13 | Patch Panel 1 to 4 |
| 14 | Stage Input (HDMI) |
| 15 | PC02, the VFX computer running Broadcast Controller (lower thirds) |
| 16 | Apple TV |
| 17 | PTZ Mandir |
| 18 | LED Novastar multiview |
| 19 | HyperDeck |
| 20 | Axis Center |

Inputs 17 and 20 are other cameras. They are out of scope and are not added.

| ATEM output | Destination |
|---|---|
| 1 | Left LED screen |
| 2 | Right LED screen |
| 3 | Stage confidence monitor |
| 4 | Backstage TV |
| 5 | Rack distributor |
| 6 | Hallway TVs |
| 9 | HyperDeck |

Lower thirds come from Broadcast Controller
(`amlakhani/Broadcast-Controller-Public`) on PC02, input 15. Which keyer
carries it is chosen in settings.

Raleigh usually runs the show on M/E 2. Sometimes the left and right LED
screens are given different sources, so two cameras can be on screen at once
and neither M/E alone says what is live. This is why "live" is worked out from
outputs, as described in feature 10.

## 4. Facts about the BZB camera

From the BG-ADAMO-4KND product manual. Items marked "verify" are not stated
clearly in the manual and must be confirmed on a real camera.

| Item | Value |
|---|---|
| Default address | 192.168.5.163, login admin / admin |
| Web page | port 80 (HTTPS 443) |
| VISCA over IP | port 1259, UDP, plain VISCA (no Sony header). Confirmed by the Test button on a Raleigh camera |
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
(Presenter / Zone), headroom (Low / Medium / High), zone setup, "tracking lost"
preset, picture style, brightness and contrast sliders, SD card recording.
These are phase 6.

The camera's own tracking has no Close / Waist / Full framing, and its
algorithm cannot be improved from outside. Per camera, steering comes from the
camera's tracker or the app's tracker, never both.

## 5. Features

**Must have**

1. Add, edit, remove and reorder cameras in the app. Each camera has a name,
   address, VISCA port (default 1259) and optional preview address. The screen
   lays itself out for one camera or many.
2. A "Test" button when adding a camera. It finds the working VISCA transport
   by itself (UDP or TCP, with or without the 8-byte header), saves it with the
   camera, and says in plain words what failed if nothing answers.
3. Live thumbnail of every camera, plus a large view of the selected one.
4. Joystick, zoom, focus and a speed slider for the selected camera.
5. Named presets per camera with save, recall, rename, delete and a thumbnail
   picture taken when saved.
6. Tracking on/off per camera, with an icon on the thumbnail.
7. Live-camera warning: when an ATEM is connected and the selected camera is
   live, a red "LIVE · moves will be seen" note shows next to the controls.
   It does not block anything. (An "Allow moving" lock was built in phase 4
   and removed at the operators' request: it got in the way every time.)
8. Connection status for each camera and the ATEM, with automatic reconnect.
9. Export and import of all settings as one file, so a temple can back up its
   setup or copy it to another computer.

**Should have, needs the ATEM link**

10. ATEM settings: address, which ATEM input each camera is on, which keyer
    carries the lower thirds, and a "watched" list. The watched list is any
    mix of M/E rows and ATEM outputs that count as on air, for example M/E 2
    plus the left and right screen outputs.
11. LIVE and NEXT badges on the thumbnails. A camera is LIVE when it is visible
    on any watched M/E program or watched output. When an output is showing an
    M/E's program, follow it through to the cameras on that M/E, including
    ones visible through a key or SuperSource. More than one camera can be
    LIVE at the same time. A camera is NEXT when it is on the preview of a
    watched M/E and is not LIVE.
12. Camera tally lights follow the ATEM: red when live, green when next. Can be
    switched off in settings.
13. LOWER THIRDS on/off button for the chosen keyer, showing its real state.

**Should have, camera only**

14. Exposure panel: mode, exposure compensation, backlight, white balance.
15. Keyboard shortcuts: number keys select a camera, arrows move, plus and
    minus zoom.
16. Camera power: wake and standby, per camera and for all.

**Later**

17. Tracking mode, headroom and zones from the camera web page (phase 6).
18. App-side tracking with Close / Waist / Full framing (phase 7).
19. Use from a tablet browser on the same network.
20. Find cameras on the network automatically.

With no ATEM configured, features 7 and 10 to 13 are hidden and the app is a
plain camera controller.

## 6. Technology

Match Broadcast Controller, so the two apps share habits and code can move
between them.

- **Electron + React + Vite**, plain JavaScript with ES modules, Tailwind CSS,
  tests with `node --test`.
- **ATEM**: the `atem-connection` package. Start from Broadcast Controller's
  `atem_service.js`, which already handles connect, reconnect, state mirroring
  and keyers, and keep only what this app needs. Several clients can connect
  to one ATEM, so both apps can run at once.
- **Cameras**: a small VISCA client written in the app, using Node `dgram` and
  `net`. Keep it generic VISCA with the BZB specifics (tracking and tally
  bytes) in one "camera profile" file, so another camera brand can be added as
  a second profile later.
- **Preview video**: bundle the `go2rtc` binary and run it as a child process.
  It pulls each camera's RTSP sub stream and serves it to the app window as
  WebRTC, with under half a second of delay. The preview address is filled in
  from the camera address by the profile and can be overridden.
- **Settings and presets**: JSON files in Electron's `userData` folder. Preset
  positions are stored in the camera itself, so the IR remote and the camera
  web page keep working. The JSON holds each preset's name, number and
  thumbnail.
- **Packaging**: `electron-builder`, producing a Windows installer and a Mac
  `.dmg`. Copy the GitHub Actions build workflows from Broadcast Controller.
  This app has no native modules, so those builds are simpler.

All network code runs in the Electron main process. The window talks to it
over IPC through a preload script and never opens sockets itself.

```
main.js                  Electron main process
src/main/visca/          VISCA client, command builders, per-camera queue
src/main/profiles/       camera profiles (bzb-adamo.js first)
src/main/atem/           trimmed ATEM service, tally sync
src/main/video/          go2rtc process and its config
src/main/store/          settings and presets JSON, export/import
frontend/src/            React screens and components
sim/                     fake camera and fake ATEM for testing
tests/                   node --test suite
```

## 7. Phases

### Phase 1: skeleton, settings and simulators (built)

- Project setup as in section 6, with lint and tests running in CI.
- Camera list in settings: add, edit, remove, reorder.
- `sim/fake-camera`: answers VISCA on a chosen port, keeps pan, tilt, zoom and
  presets in memory, logs each command. It can be started in each of the four
  transport modes.
- `sim/fake-atem` moved to phase 4, where the ATEM service it stands in for
  is written.

Done when: the app opens with no cameras, a camera can be added, and the
screen shows the right number of tiles for one, three and six cameras.

### Phase 2: camera connection, movement and presets (built)

- VISCA client with one command queue per camera, reply handling, timeouts
  and reconnect.
- The "Test" button and transport detection from feature 2.
- Joystick: drag distance sets speed, release sends Stop. Send a new move
  command only when direction or speed changes, at most 10 per second. Always
  send Stop on release, on window blur, on camera change and on app quit.
- Zoom slider that springs back to centre, focus auto/manual with near and
  far, and the speed slider.
- Shots panel: save, recall, rename, delete.

Done when: every control produces the expected bytes in the fake camera's
log, in all four transport modes, checked by tests.

Notes from building it:

- A camera saved without a successful Test is looked for in the background
  every 10 seconds, and the transport is saved when it answers.
- Each held control re-sends its position every 400 ms, and the main process
  stops the camera if it hears nothing for 1.5 seconds. This covers a frozen
  window as well as blur and quit.
- Replies are matched using the VISCA socket number, so a late "done" reply
  for one command is not mistaken for the answer to the next.
- The large preview area shows the selected camera's name and status until
  phase 3 adds video.
- `e2e/` drives the real window against fake cameras and runs in CI.

### On-site check 1 (needs a person at the temple)

Install the phase 2 build at Raleigh. Give each camera a fixed address with
DHCP off, add the three cameras, press Test, and confirm pan, tilt, zoom and a
preset work. Record which transport was detected in
`docs/ON-SITE-CHECKLIST.md`. Also save a HAR file for phase 6: open one
camera's web page in Chrome with DevTools on the Network tab, use every
control once including Track Configuration, and export the log into `docs/`.

### Phase 3: preview video (built)

- Each camera's RTSP sub stream (`rtsp://IP:554/live/av1` for the BZB
  cameras, or an address typed in the camera form) is read by a small RTSP
  client in the main process. The video is passed to the window as H.264
  frames and decoded there with Chromium's built-in decoder (WebCodecs), once
  per camera, then drawn on the tile and the large view.
- This replaces the go2rtc plan: no extra program to download, bundle or keep
  running, and no transcoding.
- The stream must be H.264. H.265 is refused with a message telling the user
  to switch the camera's stream to H.264.
- RTSP logins (Basic and Digest) work when the username and password are put
  in the video address.
- A stream that drops is retried every 2 to 15 seconds. When there is no
  picture, the large view says why; camera control works without video.
- Saving a shot stores a small picture of the camera's view, shown on the shot
  button.
- `sim/fake-rtsp.js` streams a test clip; `npm run sim -- --video` starts fake
  cameras with video.

### Phase 4: ATEM link (built)

- Settings, ATEM section: address, what counts as on air (any mix of M/E
  programs and outputs, each output shown with its ATEM name), the
  lower-thirds key (any downstream or M/E key), and tally on/off. Each camera
  has an ATEM input. All optional; without an ATEM the screen stays as before.
- `src/main/atem/tally.js` works out LIVE and NEXT inputs from the ATEM state
  and the watched list, using atem-connection's `listVisibleInputs` for keys,
  SuperSource and nested M/Es, plus outputs that carry an M/E, clean feed or
  SuperSource. Tested for: one camera on M/E 2 program, two cameras sent
  straight to two watched outputs, an output showing an M/E program, a camera
  visible only through a key, SuperSource, and mid-transition. Badges, the
  Live view, tally and the guard all read from it.
- LIVE and NEXT badges on tiles and shot rows. A Live view beside the selected
  camera shows what is on air, split when two cameras are live; other live
  sources are named.
- Camera tally lights: red LIVE, green NEXT, off otherwise. Only changes are
  sent, and they are re-sent when a camera reconnects. With no ATEM set up,
  tally lights are left alone.
- Live-camera note: a red "LIVE · moves will be seen" tag beside the
  controls. (First built as a lock with "Allow moving" and a question before
  recalling a shot; both removed after on-site use because they slowed the
  operators down.)
- Lower thirds button in the top bar, showing the key's real state. Turning it
  on or off is the only ATEM write.
- `sim/fake-atem.js` stands in for the switcher in tests (`PTZ_FAKE_ATEM=1`).

### Phase 5: tracking hand-off, exposure and power (built)

- Moving, zooming, sending Home or recalling a shot on a camera that is auto
  tracking turns tracking off first (the tracking-off command is queued ahead
  of the move), and a blue message says so.
- Exposure panel (opens in place of the shots panel, beside the joystick):
  mode (Auto, Manual, Shutter priority, Iris priority, Bright), brighter/darker
  (exposure compensation) in the auto modes, iris, shutter and brightness
  steps in the modes that use them, backlight, and white balance (auto, fixed
  3000K to 7000K, one push with "Set white now", manual). It reads the
  camera's real settings when opened and after every change.
- Power: Standby button per camera (asks first; warns if live), a standby
  banner with Wake up, "Standby" on the tile, and Wake all / Standby all in
  Settings. The 5-second heartbeat keeps the power state current.
- The one-push white balance trigger (`8x 01 04 10 05 FF`) is standard VISCA
  but not in the BZB manual: verify on site.

### Phase 6: tracking mode and headroom (built)

From a recording of the BG-ADAMO-4KND25X web page (Settings, Record a camera's
web page). The page's WebSocket on port 8088 only carries the live video; its
settings go to `GET /ajaxcom?szCmd=<JSON>`:

| Setting | Command |
|---|---|
| Read tracking settings | `{"GetEnv":{"MonoTracking":{"nChannel":-1}}}` |
| Tracking on/off | `{"SetEnv":{"MonoTracking":{"bEnable":1}}}` (the app uses VISCA for this) |
| Presenter / Zone | `{"SetEnv":{"MonoTracking":{"nTrackMode":0}}}` / `1` |
| Headroom | `{"SetEnv":{"MonoTracking":{"nHeadRoom":0}}}`, 1, 2 |
| Tracking Lost Preset | `{"SetEnv":{"MonoTracking":{"nLostPosNo":4}}}` |
| Zone presets | `{"SysCtrl":{"AreaTrack":{"nChanel":0,"szPtzCmd":"preset_set","byValue":0}}}` plus a `PictureTrack` upload |

Replies are JSON with `nRetVal: 0` for success. The page logs in with
`POST /login/login` (username, password); no cookie is set.

Built:

- Tracking row: On/Off, Presenter / Zone, and Headroom (low, medium, high).
  In Zone mode, **Set up zones** opens the camera's own page in a window.
- Tracking on/off, mode and headroom are read from the camera when it
  connects and every 10 seconds, so the app stays right when someone uses the
  IR remote or the camera's page.
- If the camera answers with its login page instead of JSON, the app logs in
  with admin/admin once and tries again.
- `sim/fake-bzb-web.js` answers these commands for the tests.

Not built, and why:

- Headroom numbers 0, 1, 2 are taken as low, medium, high (the order of the
  page's list). The labels are in a script the recorder does not keep:
  verify on site.
- Tracking Lost Preset: what the numbers 0 to 4 mean is not clear from the
  recording.
- Zone setup: it needs the camera pointed at each zone and a picture uploaded;
  the camera's own page does it well.
- A camera web login other than admin/admin: add username and password fields
  (password in Electron `safeStorage`) if a temple changes it.

### Phase 7 (optional): app-side tracking

Only build this if the camera's tracking proves not good enough in real
services.

- Run a person-detection model on the preview stream inside the app. Good
  open options: Google MediaPipe Pose Landmarker (Apache 2.0, runs in the
  window with no extra install) or a YOLO pose model through ONNX Runtime.
  Check the YOLO model's licence before shipping it.
- Steer with VISCA move commands from a simple control loop: keep the chosen
  body point at a target place in the frame, with a dead zone in the middle so
  the camera does not twitch.
- Close / Waist / Full sets how much of the frame the person's height should
  fill, and the loop zooms to match.
- The camera's own tracking must be off on a camera while the app is tracking
  it.
- Expect several services' worth of tuning. The sub stream is small and has
  delay, so this will react more slowly than the camera's own tracker.

### Phase 8: packaging and hand-out (built)

- `electron-builder` settings in `package.json`: a Windows installer
  (`Universal-PTZ-Controller-Setup-<version>.exe`, per-user, no admin rights needed) and
  Mac disk images for Apple Silicon and Intel. Not code-signed; the setup
  guide explains the first-run warnings.
- `.github/workflows/build-installers.yml` builds both on GitHub's Windows and
  Mac machines, from the Actions tab or a `v*` tag (which also makes a
  Release). Unit tests run first.
- The packaged app was checked on Linux by `e2e/packaged.test.js`: cameras,
  video, movement and the ATEM library all work from inside the package.
- App icon in `build/icon.png`.
- Settings backup: save everything (including shot pictures) to one file, and
  load it on another computer, also from the welcome screen.
- App version shown in Settings.
- `docs/SETUP-GUIDE.md` for other temples.
- Camera web page recorder (Settings), a stand-in for Chrome's HAR export
  that also captures WebSocket messages. Its file feeds phase 6.

## 8. Rules for the builder

- No address, port, input number or camera count from section 3 may appear in
  the code. Everything site-specific comes from settings.
- Never send a move command without a matching Stop path. A camera left
  panning during a service is the worst failure this app can have.
- The app must never change what is on air. The only ATEM write is the
  lower-third key on/off.
- The ATEM is the source of truth for what is live.
- Do not add steps that block moving a live camera; operators asked for
  warnings only. Do not keep a separate
  idea of "live" in the app.
- Losing one camera, the video preview or the ATEM must not freeze the rest
  of the screen.
- No cloud services, accounts or internet access. Everything stays on the
  temple network.
- Test against the simulators in this environment. Anything that could only
  be confirmed on real hardware goes into `docs/ON-SITE-CHECKLIST.md`.

## 9. Still to confirm

- Which keyer (upstream or downstream, and its number) carries the lower
  thirds from PC02 at Raleigh. Chosen in settings; see on-site check 3.
- Which ATEM output feeds the live stream at Raleigh, so it can be ticked in
  the watched list. See on-site check 3.
- Results of on-site check 1 and the HAR file.
- Camera firmware version, shown on the web page under System, Update.
