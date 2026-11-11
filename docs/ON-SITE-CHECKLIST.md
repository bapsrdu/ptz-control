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
