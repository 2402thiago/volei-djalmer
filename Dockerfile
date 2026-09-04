# Imagem Python leve e determinística para o deploy no Render.
FROM python:3.12-slim

# Evita a criação de arquivos .pyc e mantém os logs disponíveis.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Instala as dependências primeiro (aproveita o cache de camadas do Docker).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia o código da aplicação.
COPY app ./app
COPY static ./static

# Porta usada pelo Render ($PORT).
EXPOSE 8000

# Importante: UM único worker/processo, pois o app mantém estado em memória
# e uma thread de sincronização em segundo plano (dois workers duplicariam o sync).
# A porta vem da variável $PORT injetada pelo Render.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]