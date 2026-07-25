# -*- coding: utf-8 -*-
"""Uygulamayı başlatır: python run.py  ->  http://127.0.0.1:8737

Ortam değişkenleri: HOST (vars. 127.0.0.1), PORT (vars. 8737),
APP_PASSWORD (tanımlıysa HTTP Basic parola koruması açılır).
"""
import os
import threading
import webbrowser

import uvicorn

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8737"))

if __name__ == "__main__":
    if HOST in ("127.0.0.1", "localhost"):
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    uvicorn.run("backend.main:app", host=HOST, port=PORT, reload=False)
