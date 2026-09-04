"""Testes unitários da sincronização bidirecional.

Usamos apenas repositórios em memória: um representa o "lado local"
(aplicação) e outro o "lado remoto" (Google Sheets), ambos sem exigir
credenciais reais.
"""
from __future__ import annotations

import pytest

from app.models import Participante, novo_id
from app.sync import Sincronizador, mesclar


def _linha(id_: str, atualizado_em: str, nome: str = "x") -> dict[str, str]:
    return {
        "id": id_,
        "nome": nome,
        "nivel": "3",
        "status": "ativo",
        "criado_em": "2026-01-01T00:00:00",
        "atualizado_em": atualizado_em,
    }


def _para_linha(p: Participante) -> dict[str, str]:
    return p.to_linha()


def _de_linha(linha: dict[str, str]) -> Participante:
    return Participante.de_linha(linha)


class TestMesclar:
    def test_sem_divergencias_nao_gera_acoes(self):
        local = {"a": _linha("a", "2026-01-01T00:00:00")}
        remoto = {"a": _linha("a", "2026-01-01T00:00:00")}
        resultado, acoes = mesclar(local, remoto)
        assert resultado == local
        assert acoes == ["igual: a"]

    def test_pull_de_edicao_manual(self):
        local = {}
        remoto = {"b": _linha("b", "2026-01-02T00:00:00")}
        resultado, acoes = mesclar(local, remoto)
        assert resultado["b"] == remoto["b"]
        assert acoes == ["pull: b"]

    def test_push_de_registro_novo(self):
        local = {"c": _linha("c", "2026-01-03T00:00:00")}
        remoto = {}
        resultado, acoes = mesclar(local, remoto)
        assert resultado["c"] == local["c"]
        assert acoes == ["push: c"]

    def test_conflito_ultima_escrita_vence(self):
        remoto = {"a": _linha("a", "2026-01-02T00:00:00", nome="remoto")}
        local = {"a": _linha("a", "2026-01-01T00:00:00", nome="local")}
        resultado, acoes = mesclar(local, remoto)
        assert resultado["a"]["nome"] == "remoto"
        assert acoes == ["conflito-remoto: a"]

    def test_empate_mantem_local(self):
        local = {"a": _linha("a", "2026-01-01T00:00:00", nome="local")}
        remoto = {"a": _linha("a", "2026-01-01T00:00:00", nome="remoto")}
        resultado, acoes = mesclar(local, remoto)
        assert resultado["a"]["nome"] == "local"


class TestSincronizador:
    def _setup(self):
        self.local_storage: dict[str, Participante] = {}
        self.remoto_storage: dict[str, dict[str, str]] = {}

        def ler_local():
            return list(self.local_storage.values())

        def salvar_local(p: Participante):
            self.local_storage[p.id] = p

        def ler_remoto():
            return list(self.remoto_storage.values())

        def escrever_remoto(id_: str, linha: dict[str, str]):
            self.remoto_storage[id_] = linha

        return Sincronizador(
            ler_local, salvar_local, ler_remoto, escrever_remoto,
            _para_linha, _de_linha,
        )

    def test_push_escreve_no_remoto(self):
        s = self._setup()
        p = Participante(nome="Ana", nivel=5)
        s.salvar_local(p)
        acoes = s.sincronizar()
        assert p.id in self.remoto_storage
        assert "push" in acoes[0]

    def test_pull_importa_edicao_manual(self):
        s = self._setup()
        id_ = novo_id()
        self.remoto_storage[id_] = _linha(id_, "2026-01-02T00:00:00", nome="Manual")
        s.sincronizar()
        assert self.local_storage[id_].nome == "Manual"

    def test_conflito_atualiza_ambos_lados(self):
        s = self._setup()
        id_ = novo_id()
        local_p = Participante(id=id_, nome="App", atualizado_em="2026-01-01T00:00:00")
        s.salvar_local(local_p)
        self.remoto_storage[id_] = _linha(id_, "2026-01-02T00:00:00", nome="Planilha")
        s.sincronizar()
        # Remoto (mais novo) vence e é aplicado nos dois lados.
        assert self.local_storage[id_].nome == "Planilha"
        assert self.remoto_storage[id_]["nome"] == "Planilha"

    def test_sincronizacao_repetida_e_idempotente(self):
        s = self._setup()
        p = Participante(nome="Bia", nivel=4)
        s.salvar_local(p)
        s.sincronizar()
        acoes = s.sincronizar()
        # Nenhuma ação de escrita ocorre quando já estão iguais.
        assert not any(not a.startswith("igual:") for a in acoes)