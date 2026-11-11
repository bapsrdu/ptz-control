// Words and colours for a camera's connection state.
export const STATUS = {
    online: { label: 'Connected', dot: 'bg-green-400' },
    connecting: { label: 'Connecting', dot: 'bg-amber-400' },
    'not-responding': { label: 'Not answering', dot: 'bg-red-500' },
    offline: { label: 'Not found', dot: 'bg-red-500' },
    stopped: { label: 'Stopped', dot: 'bg-zinc-500' },
};

export function statusOf(statuses, id) {
    const s = statuses?.[id] ?? { state: 'connecting', message: '' };
    return { ...s, ...(STATUS[s.state] ?? STATUS.connecting) };
}
