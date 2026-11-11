# PTZ Control

A simple desktop app for running PTZ cameras during services. A volunteer picks
a camera, frames it with a joystick and zoom lever, and saves or recalls named
shots. Built for BZBGEAR BG-ADAMO cameras, and works with any camera that
speaks standard VISCA over IP.

Works on Windows and Mac. Cameras are added in the app, so the same install
works at any temple with any number of cameras.

The full plan is in [PLAN.md](PLAN.md). Phases 1 to 5 are built: adding
cameras, moving them, saved shots, live video from each camera, the optional
ATEM link, exposure and white balance, camera power, and turning auto
tracking off when someone takes over.

## Using it

1. Open **Cameras** (top right) and choose **Add a camera**.
2. Enter a name, the camera's IP address, and the port if it is not the
   default (1259 for BZB cameras).
3. Press **Test connection**. The app works out how the camera wants to be
   spoken to and remembers it. You can also save without testing; the app keeps
   looking for the camera in the background.
4. Back on the controls, click a camera tile to pick it, then:
   - drag the round joystick to pan and tilt. The further you drag, the faster
     it moves. Let go and it stops.
   - push the zoom lever up to zoom in, down to zoom out. It springs back and
     stops when you let go.
   - use the speed slider (turtle to rabbit) to set the top speed.
   - press **+** in the Shots panel to save where a camera is pointing, and
     click a shot to send the camera back there. The shot button shows a
     small picture of what the camera saw.

Picture: **Exposure** (next to the joystick) opens the exposure and white
balance controls for the selected camera. **Standby** puts a camera to sleep;
**Wake up** brings it back. Settings has Wake all and Standby all.

Auto tracking: if a camera is tracking and someone moves it, zooms it, or
sends it to a shot, tracking turns off by itself so the camera does not fight
the operator.

Video: each camera's tile and the large view show its live video. For BZB
cameras this is the camera's sub stream, `rtsp://<IP>:554/live/av1`, found
automatically. For other cameras, or if the camera asks for a login, enter the
video address in the camera's settings, for example
`rtsp://admin:password@192.168.1.50:554/live/av1`. The stream must be H.264.

With an ATEM switcher (optional, set up under **Settings**): tiles show which
camera is LIVE and which is NEXT, a Live view shows what is on air, the
cameras' tally lights follow the switcher, a red note warns when the camera
you are moving is live, and a **Lower thirds** button turns
the lower-thirds key on and off. The app never switches cameras; that stays on
the ATEM.

Safety: every camera is told to stop whenever the app window loses focus, the
window stops responding, or the app closes. A held control also has to keep
checking in; if it stops doing that for 1.5 seconds the camera is stopped.

## Running from source

Needs [Node.js](https://nodejs.org/) 22 or newer.

```bash
npm install
```

```bash
npm start
```

Settings are saved in Electron's user data folder as `settings.json`.

If `npm start` says Electron failed to install, your npm is blocking
Electron's download step. Run these once, then `npm start` again:

```bash
npm install-scripts approve electron
```

```bash
npm rebuild electron
```

## Trying it without cameras

Start some pretend cameras in a second terminal:

```bash
npm run sim -- --port 1259 --count 3 --video
```

Then add them in the app as `127.0.0.1`, ports 1259, 1260 and 1261, with the
video addresses the terminal prints (`rtsp://127.0.0.1:8554/live/av1` and up).
Every command they receive is printed in the terminal. Add `--mode` to pick
how they talk: `udp-raw` (like the BZB cameras, the default), `udp-sony`,
`tcp-raw` or `tcp-sony`.

## Tests

```bash
npm test
```

```bash
npm run lint
```

App tests open the real window and drive it against pretend cameras. On Linux
without a screen, run them inside `xvfb-run -a`:

```bash
npm run test:e2e
```

## Layout

```
main.js                  Electron main process: settings, cameras, IPC
preload.cjs              The only bridge between the window and main.js
src/main/visca/          VISCA commands, framing, transports, client, auto-detect
src/main/profiles/       Camera models (BZB ADAMO, generic VISCA)
src/main/cameras/        One connection per camera; joystick rate limit and watchdog
src/main/video/          RTSP client and H.264 unpacking for the video
src/main/atem/           ATEM connection, LIVE/NEXT calculation, tally lights
src/main/store/          Settings file, the rules for cameras and shots, shot pictures
frontend/src/            The window (React)
sim/fake-camera.js       Pretend camera for tests and trying the app
sim/fake-rtsp.js         Pretend camera video stream (loops sim/assets/test-pattern.h264)
sim/fake-atem.js         Pretend ATEM for the app tests (PTZ_FAKE_ATEM=1)
tests/                   Unit and network tests (node --test)
e2e/                     Tests that drive the real app window
docs/                    On-site checklist
```
