# PTZ Control

A simple desktop app for running PTZ cameras during services. A volunteer picks
a camera, frames it with a joystick and zoom lever, and saves or recalls named
shots. Built for BZBGEAR BG-ADAMO cameras, and works with any camera that
speaks standard VISCA over IP.

Works on Windows and Mac. Cameras are added in the app, so the same install
works at any temple with any number of cameras.

The full plan is in [PLAN.md](PLAN.md). Phases 1 and 2 are built: adding
cameras, moving them, and saved shots. Video preview and the ATEM link come
next.

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
     click a shot to send the camera back there.

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

## Trying it without cameras

Start some pretend cameras in a second terminal:

```bash
npm run sim -- --mode udp-sony --port 1259 --count 3
```

Then add them in the app as `127.0.0.1`, ports 1259, 1260 and 1261. Every
command they receive is printed in the terminal. `--mode` can be `udp-sony`,
`udp-raw`, `tcp-raw` or `tcp-sony`.

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
src/main/store/          Settings file and the rules for cameras and shots
frontend/src/            The window (React)
sim/fake-camera.js       Pretend camera for tests and trying the app
tests/                   Unit and network tests (node --test)
e2e/                     Tests that drive the real app window
docs/                    On-site checklist
```
