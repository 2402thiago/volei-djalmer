"""Ponto de entrada do Vercel para a aplicação FastAPI.

Garante que a raiz do projeto esteja no `sys.path` para importar o pacote
`app`, e expõe o app ASGI que o Vercel (@vercel/python) detecta.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app as app  # noqa: E402, F401  (nome "app" esperado pelo Vercel)