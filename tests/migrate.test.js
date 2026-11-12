import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateOldSettings } from '../src/main/store/migrate.js';

function folders() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-migrate-'));
    const from = path.join(base, 'PTZ Control');
    const to = path.join(base, 'Universal PTZ Controller');
    fs.mkdirSync(path.join(from, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(from, 'settings.json'), '{"cameras":[{"name":"Left"}]}');
    fs.writeFileSync(path.join(from, 'shots', 'a.jpg'), 'jpeg');
    return { from, to };
}

test('copies settings and shot pictures from the old app folder once', () => {
    const { from, to } = folders();
    assert.equal(migrateOldSettings({ from, to }), true);
    assert.equal(fs.readFileSync(path.join(to, 'settings.json'), 'utf8'), '{"cameras":[{"name":"Left"}]}');
    assert.equal(fs.readFileSync(path.join(to, 'shots', 'a.jpg'), 'utf8'), 'jpeg');
    assert.ok(fs.existsSync(path.join(from, 'settings.json')), 'old folder is left as a backup');
    assert.equal(migrateOldSettings({ from, to }), false, 'does nothing the second time');
});

test('never overwrites settings that already exist under the new name', () => {
    const { from, to } = folders();
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, 'settings.json'), '{"cameras":[]}');
    assert.equal(migrateOldSettings({ from, to }), false);
    assert.equal(fs.readFileSync(path.join(to, 'settings.json'), 'utf8'), '{"cameras":[]}');
});

test('does nothing when there was no old app', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-migrate-'));
    assert.equal(migrateOldSettings({ from: path.join(base, 'none'), to: path.join(base, 'new') }), false);
});
