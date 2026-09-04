"""Fiação (runtime) da aplicação.

Modelo de execução compatível com deploy serverless (ex.: Vercel):
a planilha do Google Sheets é a ÚNICA fonte de verdade. Cada requisição
lê/escreve diretamente na planilha — não há estado local nem thread de
sincronização em segundo plano.

Em testes (ou sem credenciais), usa repositórios em memória.
"""
from __future__ import annotations

from typing import Any

from .repo import Repositorio, criar_repositorios
from .services import ServicoPartidas, ServicoParticipantes, ServicoTimes


class Runtime:
    """Agrupa repositórios e serviços da aplicação."""

    def __init__(self) -> None:
        self.repositorios: dict[str, Repositorio] = {}
        self.servico_participantes: ServicoParticipantes | None = None
        self.servico_times: ServicoTimes | None = None
        self.servico_partidas: ServicoPartidas | None = None
        self.modo = "memoria"
        self.reiniciar()

    def _ligar(self, repos: dict[str, Repositorio]) -> None:
        """Religa os serviços aos repositórios fornecidos."""
        self.repositorios = repos
        self.servico_participantes = ServicoParticipantes(repos["Participantes"])
        self.servico_times = ServicoTimes(
            repos["Times"], repos["Participantes"]
        )
        self.servico_partidas = ServicoPartidas(repos["Partidas"])

    def reiniciar(self) -> None:
        """Volta para repositórios em memória (usado em testes)."""
        self._ligar(criar_repositorios(em_memoria=True))
        self.modo = "memoria"

    def ativar_sheets(self) -> bool:
        """Passa a usar o Google Sheets como fonte de dados. Retorna se ok."""
        try:
            from .sheets_repo import abrir_planilha, criar_repositorios_producao
            planilha = abrir_planilha()
            self._ligar(criar_repositorios_producao(planilha))
            self.modo = "sheets"
            return True
        except Exception:
            self.reiniciar()
            return False


# Instância única usada pelo app FastAPI.
runtime = Runtime()