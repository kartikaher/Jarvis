const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8000;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/chat') {
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', () => {
            const postData = Buffer.concat(body);
            const targetUrl = req.headers['x-target-url'];
            
            if (!targetUrl) {
                res.writeHead(400);
                res.end('Missing X-Target-Url');
                return;
            }

            const parsedUrl = new URL(targetUrl);
            const options = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers['authorization'],
                    'Content-Length': postData.length
                }
            };

            const proxyReq = https.request(options, (proxyRes) => {
                // Forward the status code
                res.writeHead(proxyRes.statusCode, {
                    'Content-Type': proxyRes.headers['content-type'] || 'application/json'
                });
                proxyRes.pipe(res);
            });

            proxyReq.on('error', (e) => {
                console.error("Proxy error:", e.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: "Backend proxy error: " + e.message } }));
            });

            proxyReq.write(postData);
            proxyReq.end();
        });
        return;
    }

    // Serve static files
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if(err.code == 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error: '+err.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`JARVIS Node Server running at http://localhost:${PORT}/`);
    console.log("Proxy enabled for AI requests (Bypassing Cloudflare blocking).");
});
