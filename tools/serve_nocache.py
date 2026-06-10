"""Dev server for the web/ app with caching disabled.

The preview browser's heuristic HTTP cache pins stale files across reloads
(python -m http.server sends no cache headers). This wrapper adds
Cache-Control: no-store so every reload fetches fresh bytes.

Usage: python3 tools/serve_nocache.py [port]
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8223
WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web')


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    handler = functools.partial(NoCacheHandler, directory=WEB)
    with http.server.ThreadingHTTPServer(('', PORT), handler) as httpd:
        print(f'serving {WEB} on :{PORT} (no-store)')
        httpd.serve_forever()
