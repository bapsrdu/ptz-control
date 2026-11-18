// The only bridge between the window and the main process. The window cannot
// open sockets or files itself; everything goes through these calls.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel) => (...args) => ipcRenderer.send(channel, ...args);

contextBridge.exposeInMainWorld('ptz', {
    getState: invoke('state:get'),
    onState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('state', listener);
        return () => ipcRenderer.removeListener('state', listener);
    },
    onNotice: (callback) => {
        const listener = (_event, notice) => callback(notice);
        ipcRenderer.on('notice', listener);
        return () => ipcRenderer.removeListener('notice', listener);
    },

    // Video frames: callback(cameraId, { codec, key, data })
    onVideoFrame: (callback) => {
        const listener = (_event, cameraId, frame) => callback(cameraId, frame);
        ipcRenderer.on('video:frame', listener);
        return () => ipcRenderer.removeListener('video:frame', listener);
    },

    // Camera list
    addCamera: invoke('camera:add'),
    updateCamera: invoke('camera:update'),
    removeCamera: invoke('camera:remove'),
    moveCamera: invoke('camera:move'),
    testCamera: invoke('camera:test'),
    // Cameras and ATEM switchers on the local network
    findDevices: invoke('tools:findDevices'),

    // ATEM: setAtem({ host, port, watched, lowerThirds, tally })
    setAtem: invoke('atem:set'),
    lowerThirds: invoke('atem:lowerThirds'),

    // Backup and support tools
    exportSettings: invoke('settings:export'),
    importSettings: invoke('settings:import'),
    recordWebPage: invoke('tools:recordWebPage'),

    // Screen preferences: { speed, selectedCameraId }
    setUi: invoke('ui:set'),

    // Continuous movement. Fire and forget, for low delay.
    move: send('ptz:move'),
    stopMove: send('ptz:stopMove'),
    zoom: send('ptz:zoom'),
    stopZoom: send('ptz:stopZoom'),
    focus: send('ptz:focus'),
    stopAll: send('ptz:stopAll'),

    // One-off commands. Each resolves to { ok, message? }.
    home: invoke('ptz:home'),
    focusMode: invoke('ptz:focusMode'),
    tracking: invoke('ptz:tracking'),
    trackingSettings: invoke('ptz:trackingSettings'),
    // Routing: aux outputs to screens
    routing: {
        mixName: invoke('routing:mixName'),
        saveScreen: invoke('routing:saveScreen'),
        removeScreen: invoke('routing:removeScreen'),
        addButton: invoke('routing:addButton'),
        renameButton: invoke('routing:renameButton'),
        moveButton: invoke('routing:moveButton'),
        removeButton: invoke('routing:removeButton'),
        route: invoke('routing:route'),
        run: invoke('routing:run'),
    },
    // App tracking (phase 7)
    appTracking: invoke('track:app'),
    trackObserve: send('track:observe'),
    trackUnavailable: send('track:unavailable'),
    // The operator clicked a person to follow: start looking afresh.
    trackRestart: send('track:restart'),
    openWebPage: invoke('tools:openWebPage'),
    exposure: invoke('ptz:exposure'),
    readExposure: invoke('ptz:readExposure'),
    // Copy exposure / white balance: matchExposure(fromId, [toIds], { exposure, whiteBalance })
    matchExposure: invoke('ptz:matchExposure'),
    power: invoke('ptz:power'),
    powerAll: invoke('ptz:powerAll'),

    // Shots
    savePreset: invoke('preset:save'),
    recallPreset: invoke('preset:recall'),
    renamePreset: invoke('preset:rename'),
    deletePreset: invoke('preset:delete'),
    movePreset: invoke('preset:move'),
});
