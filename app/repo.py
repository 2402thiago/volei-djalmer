"""Contrato e implementação em memória do repositório."""
from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from . import models

T = TypeVar("T")


class Repositorio(ABC, Generic[T]):
    """Contrato de leitura/escrita de registros de uma aba.

    Todos os métodos trabalham com chave `id` e timestamps, o que
    permite à camada de sincronização comparar versões.
    """

    @abstractmethod
    def obter_todos(self) -> list[T]:
        """Retorna todos os registros da aba."""

    @abstractmethod
    def obter(self, id_: str) -> T | None:
        """Retorna um registro pela chave."""

    @abstractmethod
    def salvar(self, registro: T) -> T:
        """Insere ou atualiza um registro (upsert por id)."""

    @abstractmethod
    def remover(self, id_: str) -> bool:
        """Remove um registro pela chave."""


class RepositorioMemoria(Repositorio[T]):
    """Repositório em memória, protegido por lock para uso concorrente."""

    def __init__(self) -> None:
        self._dados: dict[str, T] = {}
        self._lock = threading.Lock()

    def obter_todos(self) -> list[T]:
        with self._lock:
            return list(self._dados.values())

    def obter(self, id_: str) -> T | None:
        with self._lock:
            return self._dados.get(id_)

    def salvar(self, registro: T) -> T:
        with self._lock:
            self._dados[registro.id] = registro
        return registro

    def remover(self, id_: str) -> bool:
        with self._lock:
            return self._dados.pop(id_, None) is not None


def criar_repositorios(em_memoria: bool) -> dict[str, Repositorio]:
    """Cria repositórios em memória para cada aba do sistema."""
    return {nome: RepositorioMemoria() for nome in models.ABAS}
