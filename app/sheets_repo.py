"""Repositórios conectados ao Google Sheets (produção).

Usa a biblioteca `gspread` com conta de serviço e escopo restrito a
planilhas. Cada aba vira um `SheetsRepositorio` que lê e escreve linhas
como dicts, aproveitando o contrato da camada de sincronização.
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, TypeVar

import gspread
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials

from . import models
from .config import config
from .repo import Repositorio

T = TypeVar("T")

if TYPE_CHECKING:
    from googleapiclient.discovery import Resource  # pragma: no cover

_CREDENTIALS_CACHE: Credentials | None = None


def obter_credenciais() -> Credentials:
    """Cria credenciais da conta de serviço com escopo mínimo de planilhas.

    Aceita as credenciais por variável de ambiente (GOOGLE_SERVICE_ACCOUNT_INFO,
    usado em produção) ou por caminho de arquivo (GOOGLE_SERVICE_ACCOUNT_JSON,
    usado em desenvolvimento local).
    """
    global _CREDENTIALS_CACHE
    if _CREDENTIALS_CACHE is not None:
        return _CREDENTIALS_CACHE

    info = config.GOOGLE_SERVICE_ACCOUNT_INFO
    if info:
        credenciais = service_account.Credentials.from_service_account_info(
            json.loads(info), scopes=config.SCOPES
        )
    else:
        caminho = config.GOOGLE_SERVICE_ACCOUNT_JSON
        if not caminho:
            raise RuntimeError(
                "Credenciais ausentes. Configure GOOGLE_SERVICE_ACCOUNT_INFO "
                "(string JSON, em produção) ou GOOGLE_SERVICE_ACCOUNT_JSON "
                "(caminho do arquivo, em desenvolvimento)."
            )
        credenciais = service_account.Credentials.from_service_account_file(
            caminho, scopes=config.SCOPES
        )
    _CREDENTIALS_CACHE = credenciais
    return credenciais


def abrir_planilha() -> gspread.Spreadsheet:
    """Abre a planilha definida em GOOGLE_SHEETS_ID."""
    if not config.GOOGLE_SHEETS_ID:
        raise RuntimeError(
            "Configuração GOOGLE_SHEETS_ID ausente. "
            "Informe o ID da planilha no arquivo .env."
        )
    cliente = gspread.authorize(obter_credenciais())
    return cliente.open_by_key(config.GOOGLE_SHEETS_ID)


class SheetsRepositorio:
    """Leitura/escrita de uma aba da planilha como lista de dicts.

    A chave é o `id` (UUID). Mantemos o mapeamento id -> índice de linha
    para atualizações precisas sem reescrever a aba inteira.
    """

    def __init__(self, planilha: gspread.Spreadsheet, nome_aba: str, colunas: list[str]) -> None:
        self.planilha = planilha
        self.nome_aba = nome_aba
        self.colunas = colunas
        self._aba = self._obter_ou_criar_aba()

    def _obter_ou_criar_aba(self) -> Any:
        """Retorna a planilha interna, criando a aba e o cabeçalho se preciso."""
        try:
            return self.planilha.worksheet(self.nome_aba)
        except gspread.exceptions.WorksheetNotFound:
            aba = self.planilha.add_worksheet(self.nome_aba, rows=2, cols=len(self.colunas))
            aba.update([self.colunas], range_name="A1")
            return aba

    def _indice_linha(self, id_: str) -> int | None:
        """Retorna o índice (1-based) da linha que contém o id."""
        ids = self._aba.col_values(1)
        try:
            # col_values(1) retorna [cabeçalho, ...]; +1 compensa o cabeçalho.
            return ids.index(id_) + 1
        except ValueError:
            return None

    def ler_todas(self) -> list[dict[str, str]]:
        """Lê todas as linhas como dicts {coluna: valor}."""
        linhas = self._aba.get_all_records()
        return [
            {k: ("" if v is None else str(v)) for k, v in linha.items()}
            for linha in linhas
        ]

    def escrever(self, id_: str, linha: dict[str, str]) -> None:
        """Insere ou atualiza a linha correspondente ao id."""
        valores = [linha.get(col, "") for col in self.colunas]
        indice = self._indice_linha(id_)
        if indice is None:
            self._aba.append_row(valores, value_input_option="USER_ENTERED")
        else:
            self._aba.update([valores], range_name=f"A{indice}")

    def remover(self, id_: str) -> None:
        """Limpa o conteúdo da linha do registro (sem quebrar referências)."""
        indice = self._indice_linha(id_)
        if indice is not None:
            intervalo = f"A{indice}:{self._coluna_final()}{indice}"
            self._aba.update([[ "" for _ in self.colunas ]], range_name=intervalo)

    def _coluna_final(self) -> str:
        """Letra da última coluna baseada no nº de colunas."""
        n = len(self.colunas)
        letra = ""
        while n:
            n, resto = divmod(n - 1, 26)
            letra = chr(65 + resto) + letra
        return letra or "A"


def criar_repositorios_producao(planilha: gspread.Spreadsheet) -> dict[str, Repositorio]:
    """Cria os repositórios de produção para cada aba conhecida.

    Retorna repositórios que implementam o contrato `Repositorio` e que
    leem/escrevem DIRETAMENTE na planilha (a planilha é a única fonte de
    verdade — adequado para deploy serverless, sem estado local).
    """
    abas = {
        "Participantes": (models.PARTICIPANTES_COLUNAS, models.Participante),
        "Times": (models.TIMES_COLUNAS, models.Time),
        "Partidas": (models.PARTIDAS_COLUNAS, models.Partida),
    }
    return {
        nome: SheetBackedRepo(SheetsRepositorio(planilha, nome, colunas), modelo)
        for nome, (colunas, modelo) in abas.items()
    }


class SheetBackedRepo(Repositorio[T]):
    """Adapta `SheetsRepositorio` (baixo nível, linhas) ao contrato `Repositorio`.

    Cada operação lê ou escreve na planilha em tempo real, sem cache local.
    Isso mantém o comportamento "bidirecional": edições manuais na planilha
    aparecem na próxima leitura, e escritas do app vão direto para a planilha.
    """

    def __init__(self, sheets: SheetsRepositorio, modelo: type) -> None:
        self._sheets = sheets
        self._modelo = modelo

    def obter_todos(self) -> list[T]:
        return [
            self._modelo.de_linha(linha)
            for linha in self._sheets.ler_todas()
            if linha.get("id")
        ]

    def obter(self, id_: str) -> T | None:
        for linha in self._sheets.ler_todas():
            if linha.get("id") == id_:
                return self._modelo.de_linha(linha)
        return None

    def salvar(self, registro: T) -> T:
        self._sheets.escrever(registro.id, registro.to_linha())
        return registro

    def remover(self, id_: str) -> bool:
        self._sheets.remover(id_)
        return True