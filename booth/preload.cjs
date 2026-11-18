// What Booth Video's window may ask of the main process. window.ptz keeps the
// names Universal PTZ Controller's shared parts (joystick, zoom lever, video)
// use; window.booth has the rest.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (callback) => {
    const listener = (_e, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('ptz', {
    move: (id, v) => ipcRenderer.send('ptz:move', id, v),
    stopMove: (id) => ipcRenderer.send('ptz:stopMove', id),
    zoom: (id, value) => ipcRenderer.send('ptz:zoom', id, value),
    stopZoom: (id) => ipcRenderer.send('ptz:stopZoom', id),
    stopAll: () => ipcRenderer.send('ptz:stopAll'),
    onVideoFrame: on('video:frame'),
    trackObserve: (id, points) => ipcRenderer.send('track:observe', id, points),
    trackRestart: (id) => ipcRenderer.send('track:restart', id),
    trackUnavailable: (id, message) => ipcRenderer.send('track:unavailable', id, message),
});

contextBridge.exposeInMainWorld('booth', {
    getState: () => ipcRenderer.invoke('state:get'),
    onState: on('state'),
    onNotice: on('notice'),
    setConfig: (config) => ipcRenderer.invoke('config:set', config),
    showConfig: () => ipcRenderer.invoke('config:show'),
    copy: (text) => ipcRenderer.invoke('clipboard:write', text),
    saveLogin: (user, password) => ipcRenderer.invoke('login:save', user, password),
    clearLogin: () => ipcRenderer.invoke('login:clear'),
    findDevices: () => ipcRenderer.invoke('tools:findDevices'),
    openWebPage: (id) => ipcRenderer.invoke('tools:openWebPage', id),
    atem: (name, ...args) => ipcRenderer.invoke('atem:cmd', name, ...args),
    route: (set) => ipcRenderer.invoke('atem:route', set),
    focusOnce: (id) => ipcRenderer.invoke('ptz:focusOnce', id),
    focusMode: (id, mode) => ipcRenderer.invoke('ptz:focusMode', id, mode),
    home: (id) => ipcRenderer.invoke('ptz:home', id),
    recallPreset: (id, n) => ipcRenderer.invoke('ptz:recallPreset', id, n),
    clearPreset: (id, n) => ipcRenderer.invoke('ptz:clearPreset', id, n),
    readExposure: (id) => ipcRenderer.invoke('ptz:readExposure', id),
    exposure: (id, action) => ipcRenderer.invoke('ptz:exposure', id, action),
    saveShot: (id, opts) => ipcRenderer.invoke('shot:save', id, opts),
    goShot: (id, shotId) => ipcRenderer.invoke('shot:go', id, shotId),
    trackStart: (id, opts) => ipcRenderer.invoke('track:start', id, opts),
    trackStop: (id) => ipcRenderer.invoke('track:stop', id),
    trackStopAll: () => ipcRenderer.invoke('track:stopAll'),
});
