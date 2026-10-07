#!/usr/bin/env python3
"""Servidor local do PEDRO CITY (sem cache). Uso: python3 server.py  ->  http://localhost:8000"""
import http.server, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('', PORT), Handler) as httpd:
    print(f'PEDRO CITY rodando em http://localhost:{PORT}  (Ctrl+C para parar)')
    httpd.serve_forever()
