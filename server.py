import http.server
import socketserver
import urllib.request
import urllib.error
import json
import os

PORT = 8000

class ProxyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/chat':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            # Extract headers we need to forward
            auth_header = self.headers.get('Authorization')
            target_url = self.headers.get('X-Target-Url')
            
            if not target_url:
                self.send_error(400, "Missing X-Target-Url header")
                return

            headers_to_forward = {}
            for k, v in self.headers.items():
                if k.lower() not in ['host', 'origin', 'referer', 'x-target-url', 'content-length']:
                    headers_to_forward[k] = v
            
            headers_to_forward['Content-Type'] = 'application/json'
            if auth_header:
                headers_to_forward['Authorization'] = auth_header

            req = urllib.request.Request(
                target_url,
                data=post_data,
                headers=headers_to_forward,
                method='POST'
            )
            
            try:
                with urllib.request.urlopen(req) as response:
                    self.send_response(response.status)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(response.read())
            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(e.read())
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": str(e)}}).encode('utf-8'))
        else:
            self.send_error(404, "Not Found")

Handler = ProxyHTTPRequestHandler

# Ensure we are serving from the directory containing this script
os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving JARVIS at http://localhost:{PORT}")
    print("Proxy enabled for AI requests to bypass CORS.")
    httpd.serve_forever()
