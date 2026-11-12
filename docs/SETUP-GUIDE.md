# Universal PTZ Controller: setup guide

For anyone setting up Universal PTZ Controller at a new temple. About 30 minutes, without
anything technical beyond knowing the cameras' IP addresses.

## What you need

- A Windows or Mac computer at the AV desk, plugged into the same network as
  the cameras (and the ATEM, if you have one). Wired network is best.
- Your PTZ cameras on the network. BZBGEAR BG-ADAMO cameras work out of the
  box; other cameras work if they support "VISCA over IP".
- The installer, from the GitHub Releases page or from whoever set up the
  app at another temple.

## 1. Give each camera a fixed address

The app finds cameras by IP address, so an address must not change.

1. Find the camera's current address. BZB cameras show it on the HDMI/SDI
   output when they start up, or press `*` `*` `3` on the IR remote.
2. Open that address in a web browser and log in (BZB default: admin / admin).
3. Configuration, Ethernet: untick DHCP, enter an address your network admin
   gives you, Save, and restart the camera.
4. Change the camera password from the default while you are there.

Write the addresses down; you will type them into the app.

## 2. Install the app

- **Windows:** run `Universal-PTZ-Controller-Setup-<version>.exe`. If Windows says "Windows
  protected your PC", choose **More info**, then **Run anyway**. (The app is
  not signed with a paid certificate; this warning is expected.)
- **Mac:** open the `.dmg` for your Mac (`arm64` for M1/M2/M3/M4 Macs, `x64`
  for older Intel Macs) and drag Universal PTZ Controller to Applications. The first time,
  right-click the app and choose **Open**, then **Open** again.

When Windows Firewall asks whether Universal PTZ Controller may use the network, allow it
on **private networks**. Without this the app cannot reach the cameras.

## 3. Add the cameras

If another temple sent you their settings file, choose **Or load settings
saved on another computer** on the welcome screen instead, then change the
addresses to yours under Settings.

Otherwise:

1. **Add a camera**. Give it a name volunteers will understand (Left, Centre,
   Mandir).
2. Choose the camera model, enter its IP address, and leave Port empty for
   the usual port.
3. Press **Test connection**. A green "Found it" means it works.
4. Leave **Video address** empty for BZB cameras. For other cameras, enter the
   camera's RTSP address (see its manual). The video stream must be H.264.
5. **Add camera**. Repeat for each camera.

## 4. The ATEM (optional)

Only if you have a Blackmagic ATEM switcher on the network.

1. Settings, ATEM switcher: enter the ATEM's IP address and press **Connect**.
2. Edit each camera and choose its **ATEM input**.
3. Under **What counts as on air**, tick the M/E row that feeds your stream or
   projector, and any outputs that go straight to screens.
4. If your lower thirds come in through an ATEM key, choose it under **Lower
   thirds key** to get an on/off button.

The app never switches the ATEM; it only watches it, lights the camera tally
lights, and turns the lower-thirds key on and off.

## 5. Save shots

On the controls, frame each camera with the joystick and zoom, then press
**+** in the Shots panel and give the shot a name (Pulpit, Wide, Choir).
Volunteers then click a shot to send the camera there.

## 6. Keep a backup

Settings, Backup: **Save settings to a file**, and keep the file somewhere
safe. It holds every camera, shot and ATEM setting, and can set up a
replacement computer in one step.

## If something does not work

- **Camera tile is red, "Not found"**: check the address, that the camera is
  on, and that the computer is on the same network. Press Test connection in
  the camera's settings for a plain-words reason.
- **"No video"**: the message under the picture says why. If it mentions
  H.265, set the camera's sub stream to H.264 on its web page (Configuration,
  Video Encode).
- **ATEM not connected**: check the ATEM's address in ATEM Setup, and that the
  computer can reach it.
- Anything else: in Settings, Backup, save your settings to a file and send it
  along with a description of what happened.
