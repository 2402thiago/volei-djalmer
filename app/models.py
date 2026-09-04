"""Modelos de domínio do torneio de vôlei.

Cada modelo mapeia uma linha da planilha para um objeto Python tipado.
A conversão para linhas (dicts) é usada pela camada de planilha.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone


def agora_iso() -> str:
    """Retorna o timestamp atual em ISO-8601 (UTC), com precisão de segundos."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def novo_id() -> str:
    """Gera um UUID como chave primária."""
    return str(uuid.uuid4())


# Colunas de cada aba. A ordem define o layout da planilha.
PARTICIPANTES_COLUNAS = [
    "id", "nome", "nivel", "status", "criado_em", "atualizado_em",
]
# `atualizado_em` no Time garante a resolução "última escrita vence"
# na sincronização bidirecional (decisão da Fase 0).
TIMES_COLUNAS = ["id", "nome", "jogadores", "nivel_medio", "atualizado_em"]
PARTIDAS_COLUNAS = [
    "id", "time_a_id", "time_b_id", "placar_a", "placar_b",
    "status_partida", "atualizado_em",
]


@dataclass
class Participante:
    """Um participante cadastrado no torneio."""

    nome: str
    nivel: int = 3
    status: str = "ativo"
    id: str = field(default_factory=novo_id)
    criado_em: str = field(default_factory=agora_iso)
    atualizado_em: str = field(default_factory=agora_iso)

    def to_linha(self) -> dict[str, str]:
        """Converte para um dict alinhado às colunas da planilha."""
        return {
            "id": self.id,
            "nome": self.nome,
            "nivel": str(self.nivel),
            "status": self.status,
            "criado_em": self.criado_em,
            "atualizado_em": self.atualizado_em,
        }

    @classmethod
    def de_linha(cls, linha: dict[str, str]) -> "Participante":
        """Reconstrói um Participante a partir de uma linha da planilha."""
        return cls(
            id=linha["id"],
            nome=linha["nome"],
            nivel=int(linha["nivel"]),
            status=linha["status"],
            criado_em=linha["criado_em"],
            atualizado_em=linha["atualizado_em"],
        )


@dataclass
class Time:
    """Uma equipe formada por participantes."""

    nome: str
    jogadores: list[str] = field(default_factory=list)
    nivel_medio: float = 0.0
    id: str = field(default_factory=novo_id)
    atualizado_em: str = field(default_factory=agora_iso)

    def to_linha(self) -> dict[str, str]:
        return {
            "id": self.id,
            "nome": self.nome,
            "jogadores": ",".join(self.jogadores),
            "nivel_medio": f"{self.nivel_medio:.2f}",
            "atualizado_em": self.atualizado_em,
        }

    @classmethod
    def de_linha(cls, linha: dict[str, str]) -> "Time":
        jogadores = [x for x in linha.get("jogadores", "").split(",") if x]
        return cls(
            id=linha["id"],
            nome=linha["nome"],
            jogadores=jogadores,
            nivel_medio=float(linha.get("nivel_medio") or 0),
            atualizado_em=linha.get("atualizado_em", ""),
        )


@dataclass
class Partida:
    """Uma partida entre dois times."""

    time_a_id: str
    time_b_id: str
    status_partida: str = "agendado"
    placar_a: int = 0
    placar_b: int = 0
    id: str = field(default_factory=novo_id)
    atualizado_em: str = field(default_factory=agora_iso)

    def to_linha(self) -> dict[str, str]:
        return {
            "id": self.id,
            "time_a_id": self.time_a_id,
            "time_b_id": self.time_b_id,
            "placar_a": str(self.placar_a),
            "placar_b": str(self.placar_b),
            "status_partida": self.status_partida,
            "atualizado_em": self.atualizado_em,
        }

    @classmethod
    def de_linha(cls, linha: dict[str, str]) -> "Partida":
        return cls(
            id=linha["id"],
            time_a_id=linha["time_a_id"],
            time_b_id=linha["time_b_id"],
            placar_a=int(linha.get("placar_a") or 0),
            placar_b=int(linha.get("placar_b") or 0),
            status_partida=linha.get("status_partida", "agendado"),
            atualizado_em=linha.get("atualizado_em", ""),
        )


# Registro de abas e seus modelos, usado pela camada de sincronização.
ABAS: dict[str, type] = {
    "Participantes": Participante,
    "Times": Time,
    "Partidas": Partida,
}