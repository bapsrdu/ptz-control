// Each camera gets a colour from this list by its place in the camera list,
// so the colours never need setting up.
export const CAMERA_COLOURS = ['#22d3ee', '#818cf8', '#e879f9', '#fbbf24', '#34d399', '#fb7185', '#60a5fa', '#a3e635'];
export const cameraColour = (index) => CAMERA_COLOURS[index % CAMERA_COLOURS.length];
