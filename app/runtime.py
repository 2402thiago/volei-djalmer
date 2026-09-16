"""Fiação do runtime usando repositórios em memória."""
from __future__ import annotations

from .repo import Repositorio, criar_repositorios
from .services import ServicoParticipantes, ServicoTimes


class Runtime:
    """Agrupa repositórios e serviços da aplicação."""

    def __init__(self) -> None:
        self.repositorios: dict[str, Repositorio] = {}
        self.servico_participantes: ServicoParticipantes | None = None
        self.servico_times: ServicoTimes | None = None
        self.modo = "memoria"
        self.reiniciar()

    def _ligar(self, repos: dict[str, Repositorio]) -> None:
        """Religa os serviços aos repositórios fornecidos."""
        self.repositorios = repos
        self.servico_participantes = ServicoParticipantes(repos["Participantes"])
        self.servico_times = ServicoTimes(
            repos["Times"], repos["Participantes"]
        )

    def reiniciar(self) -> None:
        """Volta para repositórios em memória (usado em testes)."""
        self._ligar(criar_repositorios(em_memoria=True))
        self.modo = "memoria"

# Instância única usada pelo app FastAPI.
runtime = Runtime()
