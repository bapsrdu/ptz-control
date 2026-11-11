import test from 'node:test';
import assert from 'node:assert/strict';
import { readBackup, BACKUP_KIND } from '../src/main/store/backup.js';

test('reads a settings file and cleans what it loads', () => {
    const out = readBackup(JSON.stringify({
        kind: BACKUP_KIND,
        settings: { cameras: [{ name: 'Left', host: '10.0.0.1' }, { name: 'Bad', host: 'not valid!' }], atem: { host: '10.0.0.240' } },
        pictures: { abc: 'AAAA' },
    }));
    assert.equal(out.ok, true);
    assert.deepEqual(out.settings.cameras.map((c) => c.name), ['Left']);
    assert.equal(out.settings.atem.host, '10.0.0.240');
    assert.deepEqual(out.pictures, { abc: 'AAAA' });
});

test('refuses files that are not settings files', () => {
    assert.match(readBackup('not json').message, /could not be read/);
    assert.match(readBackup('{"kind":"something-else","settings":{}}').message, /not a PTZ Control settings file/);
    assert.match(readBackup('{"kind":"ptz-control-settings"}').message, /not a PTZ Control settings file/);
});
