#!/usr/bin/env python3

import os
import sys
import webbrowser
import http.server
import socketserver
import threading
import time

# Get the directory of the script
script_dir = os.path.dirname(os.path.abspath(__file__))

# Define the port for the server
PORT = 8000

class MyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=script_dir, **kwargs)
    
    def log_message(self, format, *args):
        # Suppress log messages
        pass

def start_server():
    with socketserver.TCPServer(("", PORT), MyHandler) as httpd:
        print(f"Server started at http://localhost:{PORT}")
        print("Press Ctrl+C to stop the server")
        httpd.serve_forever()

if __name__ == "__main__":
    # Start the server in a separate thread
    server_thread = threading.Thread(target=start_server)
    server_thread.daemon = True
    server_thread.start()
    
    # Give the server a moment to start
    time.sleep(1)
    
    # Open the browser
    print("Opening GitHub Browsealizer in your default browser...")
    webbrowser.open(f"http://localhost:{PORT}")
    
    try:
        # Keep the main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down the server...")
        sys.exit(0)