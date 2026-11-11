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

## Check 3: after phase 4 (ATEM)

Setup, in Settings:

- [ ] Enter the ATEM's IP address and press Connect. It says "Connected to"
      and the model. ATEM IP: ____________
- [ ] Edit each camera and choose its ATEM input (Left 3, Centre 4, Right 5 on
      the routing diagram).
- [ ] Under "What counts as on air", tick M/E 2 program, Output 1 (Left
      Screen), Output 2 (Right Screen), and whichever output feeds the live
      stream. Output feeding the stream: ____
- [ ] Choose the lower-thirds key: the key that carries PC02 (input 15).
      Key used: ____

On the controls:

- [ ] Cut a camera to M/E 2 program on the ATEM panel. Its tile says LIVE, its
      tally light turns red, and it shows in the Live view.
- [ ] Put a camera on M/E 2 preview. Its tile says NEXT and its tally turns
      green.
- [ ] Send different cameras to the left and right screens. Both show LIVE
      and the Live view splits.
- [ ] Pick a live camera. A red "LIVE · moves will be seen" note shows, and
      the joystick and shots work straight away.
- [ ] Lower thirds button turns the lower third on and off, and follows the
      ATEM panel if someone presses the key there.
- [ ] Check with the director: the app never changed what was on air.
- [ ] Untick "tally lights follow the ATEM". The tally lights go off.

## Check 4: after phase 5

- [ ] Turn tracking on for a camera, then move it with the joystick. Tracking
      turns off by itself and a blue message says so. The camera does not
      fight the joystick.
- [ ] Exposure panel: each mode (Auto, Manual, Shutter, Iris, Bright) changes
      the picture, and the panel shows the mode the camera is really in.
- [ ] Brighter/darker: turn it on, press + a few times. The picture gets
      brighter. Note how many steps there are: ____
- [ ] Backlight on with a bright window behind someone. The person gets
      brighter.
- [ ] White balance: try 3000K and 5500K; the colours change. Choose One
      push, fill the shot with a white card, press "Set white now". Does it
      work? ____
- [ ] Standby: the camera turns to its rest position and the tile says
      Standby. Wake up brings it back, and its shots still work.
- [ ] Standby all / Wake all from Settings.

### For phase 6

Chrome's HAR export came out empty, so the app has its own recorder.

- [ ] In the app: Settings, "Record a camera's web page". Pick one BZB camera
      and press **Open and record**. The camera's page opens in a new window.
- [ ] Log in. Then use each of these once: Track Configuration (tracking
      On/Off, Presenter and Zone, each Headroom setting, set a zone, the
      Tracking Lost Preset), and Image Style if there is one.
- [ ] Close the camera window. Save the file, and send it. It includes the
      camera login, so change the camera password afterwards if that matters.

### Results

- Raleigh: the Test button found a BG-ADAMO-4KND25X on port 1259 using UDP,
  plain VISCA (no Sony header).

Write anything surprising here: commands the camera refused, movements in the
wrong direction, speeds that feel wrong.
