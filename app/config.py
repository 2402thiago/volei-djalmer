"""Configuração central do sistema.

Carrega variáveis do ambiente (arquivo .env, se existir) e expõe
valores tipados e validados usados por toda a aplicação.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Carrega o .env da raiz do projeto, sem sobrescrever variáveis já existentes
# no ambiente do sistema operacional.
load_dotenv(BASE_DIR / ".env")


class Config:
    """Agrupamento de configurações da aplicação."""

    # Modo de execução. "test" dispensa credenciais reais.
    APP_ENV: str = os.getenv("APP_ENV", "production")

    # JSON da conta de serviço do Google Cloud, como string (usado em produção,
    # ex.: variável de ambiente no Render). Ex.: GOOGLE_SERVICE_ACCOUNT_INFO={...}.
    GOOGLE_SERVICE_ACCOUNT_INFO: str | None = os.getenv(
        "GOOGLE_SERVICE_ACCOUNT_INFO"
    ) or None

    # Caminho do arquivo JSON da conta de serviço (usado em desenvolvimento local).
    GOOGLE_SERVICE_ACCOUNT_JSON: str | None = os.getenv(
        "GOOGLE_SERVICE_ACCOUNT_JSON"
    ) or None

    # ID (da URL) da planilha do Google Sheets.
    GOOGLE_SHEETS_ID: str | None = os.getenv("GOOGLE_SHEETS_ID") or None

    # Intervalo do polling de sincronização (em segundos).
    SYNC_INTERVAL_SECONDS: int = int(os.getenv("SYNC_INTERVAL_SECONDS", "20"))

    # Escopo mínimo necessário para ler/escrever planilhas.
    # NÃO solicitamos acesso amplo ao Google Drive.
    SCOPES: list[str] = ["https://www.googleapis.com/auth/spreadsheets"]


config = Config()