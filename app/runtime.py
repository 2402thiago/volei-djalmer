"""Fiação (runtime) da aplicação: repositórios, serviços e sincronização.

Em `APP_ENV=test` ou sem credenciais, usa repositórios em memória, o que
permite rodar o app e a interface sem conexão com o Google Sheets. Quando
há credenciais (`GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_SHEETS_ID`),
conecta ao Sheets e inicia um ciclo de sincronização bidirecional.
"""
from __future__ import annotations

import threading
import time
from typing import Any

from . import models
from .config import config
from .repo import Repositorio, RepositorioMemoria, criar_repositorios
from .services import ServicoPartidas, ServicoParticipantes, ServicoTimes
from .sync import Sincronizador


class Runtime:
    """Agrupa repositórios, serviços e o estado de sincronização."""

    def __init__(self) -> None:
        self.repositorios: dict[str, Repositorio] = criar_repositorios(em_memoria=True)
        self.remoto: dict[str, Any] | None = None
        self._sync_thread: threading.Thread | None = None
        self._parar = threading.Event()
        self.ultimo_log: list[str] = []

        self.servico_participantes = ServicoParticipantes(self.repositorios["Participantes"])
        self.servico_times = ServicoTimes(
            self.repositorios["Times"], self.repositorios["Participantes"]
        )
        self.servico_partidas = ServicoPartidas(self.repositorios["Partidas"])

    def reiniciar(self) -> None:
        """Recria repositórios em memória e religa os serviços (usado em testes)."""
        self.repositorios = criar_repositorios(em_memoria=True)
        self.ultimo_log = []
        self.servico_participantes = ServicoParticipantes(self.repositorios["Participantes"])
        self.servico_times = ServicoTimes(
            self.repositorios["Times"], self.repositorios["Participantes"]
        )
        self.servico_partidas = ServicoPartidas(self.repositorios["Partidas"])

    # -- Sincronização -----------------------------------------------
    def _construir_sincronizadores(self) -> list[Sincronizador]:
        if not self.remoto:
            return []
        modelos = models.ABAS
        sincronizadores = []
        for nome, remoto_repo in self.remoto.items():
            modelo = modelos[nome]
            local_repo = self.repositorios[nome]

            def ler_local(r=local_repo):
                return r.obter_todos()

            def salvar_local(reg, r=local_repo):
                return r.salvar(reg)

            def ler_remoto(r=remoto_repo):
                return r.ler_todas()

            def escrever_remoto(id_, linha, r=remoto_repo):
                return r.escrever(id_, linha)

            sincronizadores.append(
                Sincronizador(
                    ler_local, salvar_local, ler_remoto, escrever_remoto,
                    para_linha=lambda reg: reg.to_linha(),
                    de_linha=lambda linha, m=modelo: m.de_linha(linha),
                )
            )
        return sincronizadores

    def ativar_sheets(self) -> bool:
        """Conecta ao Google Sheets e prepara a sincronização. Retorna se ok."""
        try:
            from .sheets_repo import abrir_planilha, criar_repositorios_producao
            planilha = abrir_planilha()
            self.remoto = criar_repositorios_producao(planilha)
            return True
        except Exception as exc:  # credenciais ausentes ou inválidas
            self.ultimo_log.append(f"sheets-offline: {exc}")
            self.remoto = None
            return False

    def iniciar_sync_loop(self) -> None:
        """Inicia o polling periódico de sincronização em segundo plano."""
        if not self.remoto:
            return
        if self._sync_thread and self._sync_thread.is_alive():
            return

        def loop():
            while not self._parar.is_set():
                self.sincronizar()
                self._parar.wait(config.SYNC_INTERVAL_SECONDS)

        self._sync_thread = threading.Thread(target=loop, daemon=True)
        self._sync_thread.start()

    def sincronizar(self) -> list[str]:
        """Executa um ciclo de sincronização; retorna o log de ações."""
        acoes: list[str] = []
        for sinc in self._construir_sincronizadores():
            try:
                acoes.extend(sinc.sincronizar())
            except Exception as exc:  # não derruba o ciclo por uma aba
                acoes.append(f"erro: {exc}")
        self.ultimo_log = acoes
        return acoes

    def encerrar(self) -> None:
        self._parar.set()


# Instância única usada pelo app FastAPI.
runtime = Runtime()