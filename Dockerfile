FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb \
    && rm -rf /var/lib/apt/lists/*

# rasterio/pyproj için GDAL/PROJ runtime kütüphaneleri manylinux wheel'lerinde gömülü;
# ek sistem paketi gerekmez. numba için gcc de gerekmez (wheel).
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY data ./data
RUN mkdir -p data/dem/cache data/corine/cache data/projects

ENV HOST=0.0.0.0 PORT=8737
EXPOSE 8737

CMD ["sh", "-c", "uvicorn backend.main:app --host $HOST --port $PORT --timeout-keep-alive 300 --limit-max-requests 100"]
