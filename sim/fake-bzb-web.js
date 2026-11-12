// A pretend BZB camera web page, answering the /ajaxcom tracking commands the
// way the real BG-ADAMO-4KND25X does. Used by the tests.

import http from 'node:http';

export class FakeBzbWeb {
    constructor({ port = 0, host = '127.0.0.1', requireLogin = false, username = 'admin', password = 'admin' } = {}) {
        this.requestedPort = port;
        this.host = host;
        this.requireLogin = requireLogin;
        this.username = username;
        this.password = password;
        this.loggedIn = false;
        this.tracking = { bEnable: 0, nTrackMode: 0, nHeadRoom: 0, nLostPosNo: 0 };
        this.commands = [];
        this.server = null;
    }

    start() {
        this.server = http.createServer((req, res) => this.#handle(req, res));
        return new Promise((resolve) => this.server.listen(this.requestedPort, this.host, () => {
            this.port = this.server.address().port;
            resolve(this);
        }));
    }

    stop() {
        return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    }

    #json(res, obj) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(JSON.stringify(obj));
    }

    #handle(req, res) {
        const url = new URL(req.url, 'http://x');
        if (req.method === 'POST' && url.pathname === '/login/login') {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                const p = new URLSearchParams(body);
                this.loggedIn = p.get('username') === this.username && p.get('password') === this.password;
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('');
            });
            return;
        }
        if (url.pathname !== '/ajaxcom') {
            res.writeHead(404);
            res.end();
            return;
        }
        if (this.requireLogin && !this.loggedIn) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>Please log in</body></html>');
            return;
        }
        let cmd;
        try {
            cmd = JSON.parse(url.searchParams.get('szCmd'));
        } catch {
            this.#json(res, { nRetVal: -1, szError: 'bad command' });
            return;
        }
        this.commands.push(cmd);
        if (cmd.GetEnv?.MonoTracking) {
            this.#json(res, { stValue: { ...this.tracking, stRegion: [], stLostPos: [] }, nRetVal: 0 });
        } else if (cmd.SetEnv?.MonoTracking) {
            Object.assign(this.tracking, cmd.SetEnv.MonoTracking);
            this.#json(res, { nRetVal: 0, szError: '' });
        } else {
            this.#json(res, { nRetVal: -1879048186, szError: '' });
        }
    }
}
