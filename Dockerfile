FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pennyroute ./pennyroute
COPY static ./static
RUN useradd -r -u 10001 penny && mkdir -p /app/data && chown penny /app/data
USER penny
VOLUME /app/data
EXPOSE 8490
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8490/healthz')"
CMD ["uvicorn", "pennyroute.app:app", "--host", "0.0.0.0", "--port", "8490", "--proxy-headers"]
