# On-site checklist

Things that can only be confirmed with the real cameras at the temple. Fill in
the results and commit them, so the next phases are built on facts.

## Check 1: after phase 2

Needs: a laptop on the same network as the cameras, with this app installed or
running from source.

### Before starting

- [ ] Give each camera a fixed IP address and turn DHCP off (camera web page,
      Configuration, Ethernet). Write the addresses here.

| Camera | IP address | Port | Firmware version |
|---|---|---|---|
| Left | | 1259 | |
| Centre | | 1259 | |
| Right | | 1259 | |

Firmware version is on the camera web page under System, Update.

### In the app

- [ ] Add each camera and press **Test connection**. Record what it found:

| Camera | Test result (copy the green or red message) |
|---|---|
| Left | |
| Centre | |
| Right | |

- [ ] Joystick: each direction moves the camera that way, and it stops when you
      let go.
- [ ] Diagonals move both pan and tilt.
- [ ] Speed slider: 10% is slow enough for a gentle reframe; 100% is not
      dangerously fast.
- [ ] Zoom lever: up zooms in, down zooms out, stops when let go.
- [ ] Focus: Manual, then hold Near and Far. Focus changes and stops on release.
      Switch back to Auto.
- [ ] Home button returns the camera to its home position.
- [ ] Save a shot with **+**, move away, click the shot. The camera goes back.
- [ ] The IR remote can still recall presets 1 to 9, and they match the shots
      saved in the app.
- [ ] Tracking button: turning it on starts the camera's auto tracking, and
      turning it off stops it. Note whether the camera's web page shows the
      same state.
- [ ] While dragging the joystick, click on another program. The camera stops.
- [ ] Unplug one camera's network cable. Its tile turns red within about ten
      seconds, and the other cameras keep working. Plug it back in; it
      reconnects without restarting the app.

## Check 2: after phase 3 (video)

- [ ] Each camera's tile and the large view show live video within a few
      seconds of opening the app.
- [ ] Wave at a camera. The delay before it shows in the app is about
      ____ seconds. (Under half a second is good; over one second, tell us.)
- [ ] If a tile says "No video", copy its message here. If it mentions H.265,
      open the camera's web page, Configuration, Video Encode, and set the Sub
      Stream to H.264.
- [ ] Save a shot. Its button shows a small picture of the camera's view.
- [ ] Unplug a camera's network cable. Its video stops with a message, the
      other cameras keep playing, and the video comes back by itself when the
      cable is plugged back in.
- [ ] Leave the app running for an hour with all cameras. It stays smooth and
      the computer does not get hot or slow. Note the app's memory and CPU in
      Task Manager: ____ MB, ____ %.

### For phase 6

- [ ] Open one camera's web page in Chrome. Open DevTools (F12) on the Network
      tab, tick "Preserve log", then use every control once, including Track
      Configuration (tracking mode, headroom, zones). Right-click the request
      list, choose "Save all as HAR", and add the file to `docs/` here.

### Results

- Raleigh: the Test button found a BG-ADAMO-4KND25X on port 1259 using UDP,
  plain VISCA (no Sony header).

Write anything surprising here: commands the camera refused, movements in the
wrong direction, speeds that feel wrong.
