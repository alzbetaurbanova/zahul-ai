import hmac
import hashlib
import json
import subprocess
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

SECRET = os.environ.get("WEBHOOK_SECRET", "")
BRANCH = os.environ.get("WEBHOOK_BRANCH", "refs/heads/master")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/hooks/zahul":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        if SECRET:
            expected = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
            sig = self.headers.get("X-Hub-Signature-256", "")
            if not hmac.compare_digest(sig, expected):
                self.send_response(403)
                self.end_headers()
                return

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        if payload.get("ref") != BRANCH:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Ignored: not target branch")
            return

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Deploying...")
        subprocess.Popen(["bash", "/home/ubuntu/zahul-ai/webhook/deploy.sh"])

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("WEBHOOK_PORT", "9000"))
    print(f"Webhook server running on port {port}...")
    ThreadedHTTPServer(("0.0.0.0", port), Handler).serve_forever()
