"""Testes da lógica de negócio (Fase 3)."""
from __future__ import annotations

import pytest

from app.models import Participante, Time
from app.repo import RepositorioMemoria
from app.services import (
    ServicoPartidas,
    ServicoParticipantes,
    ServicoTimes,
    balancear_times,
    classificacao,
)


@pytest.fixture
def repo_participantes():
    return RepositorioMemoria()


@pytest.fixture
def repo_times():
    return RepositorioMemoria()


@pytest.fixture
def repo_partidas():
    return RepositorioMemoria()


def _participante(nome: str, nivel: str) -> Participante:
    return Participante(nome=nome, nivel=nivel)


class TestServicoParticipantes:
    def test_criar_participante(self, repo_participantes):
        s = ServicoParticipantes(repo_participantes)
        p = s.criar("Ana", nivel="C1")
        assert p.nome == "Ana"
        assert p.nivel == "C1"
        assert p.status == "ativo"
        assert repo_participantes.obter(p.id) is not None

    def test_criar_nome_vazio_falha(self, repo_participantes):
        s = ServicoParticipantes(repo_participantes)
        with pytest.raises(Exception):
            s.criar("   ")

    def test_criar_nivel_fora_da_faixa_falha(self, repo_participantes):
        s = ServicoParticipantes(repo_participantes)
        with pytest.raises(Exception):
            s.criar("Bruno", nivel="9")

    def test_listar_ignora_inativos(self, repo_participantes):
        s = ServicoParticipantes(repo_participantes)
        p1 = s.criar("Ana", nivel="M1")
        s.alterar_status(p1.id, "inativo")
        s.criar("Bia", nivel="M2")
        assert len(s.listar()) == 1

    def test_editar_nome_e_nivel(self, repo_participantes):
        s = ServicoParticipantes(repo_participantes)
        p = s.criar("Ana", nivel="M2")
        p2 = s.editar(p.id, nome="Ana Souza", nivel="C1", sexo="F", ranking=1)
        assert p2.nome == "Ana Souza"
        assert p2.nivel == "C1"
        assert p2.sexo == "F"
        assert p2.ranking == 1


class TestBalanceamento:
    def test_snake_draft_equilibra_media(self):
        niveis = ["C1", "M1", "M1", "M2", "F1", "F2"]
        partes = [_participante(f"p{i}", n) for i, n in enumerate(niveis)]
        times = balancear_times(partes, num_times=2)
        pesos = {"C1": 7, "M1": 6, "M2": 5, "F1": 4, "F2": 3, "LM1": 2, "LF1": 1}
        medias = sorted(
            sum(pesos[p.nivel] for p in t) / len(t) for t in times
        )
        # T1=[5,3,3] 3.67 e T2=[4,4,2] 3.33 -> próximas entre si.
        assert max(medias) - min(medias) < 1.0

    def test_distribui_todos_os_ativos(self):
        partes = [_participante(f"p{i}", (i % 5) + 1) for i in range(12)]
        times = balancear_times(partes, num_times=3)
        total = sum(len(t) for t in times)
        assert total == 12
        assert all(t for t in times)  # nenhum time vazio

    def test_ignora_inativos_no_balanceamento(self):
        ativo = _participante("ativo", 5)
        inativo = _participante("inativo", 1)
        inativo.status = "inativo"
        times = balancear_times([ativo, inativo], num_times=1)
        assert [p.id for p in times[0]] == [ativo.id]


class TestServicoTimes:
    def test_montar_cria_times_balanceados(self, repo_participantes, repo_times):
        sp = ServicoParticipantes(repo_participantes)
        for nome, nivel in [("A", "C1"), ("B", "LF1"), ("C", "M1"), ("D", "M2"), ("E", "F1"), ("F", "F1")]:
            sp.criar(nome, nivel)
        st = ServicoTimes(repo_times, repo_participantes)
        times = st.montar(num_times=2)
        assert len(times) == 2
        assert all(t.jogadores for t in times)

    def test_montar_substitui_times_anteriores(self, repo_participantes, repo_times):
        sp = ServicoParticipantes(repo_participantes)
        for i in range(6):
            sp.criar(f"J{i}", ("C1", "M1", "M2", "F1", "F2")[i % 5])
        st = ServicoTimes(repo_times, repo_participantes)
        st.montar(num_times=2)
        st.montar(num_times=3)
        assert len(st.listar()) == 3

    def test_composicao(self, repo_participantes, repo_times):
        sp = ServicoParticipantes(repo_participantes)
        p = sp.criar("Ana", "M1")
        st = ServicoTimes(repo_times, repo_participantes)
        times = st.montar(num_times=1)
        time, comp = st.composicao(times[0].id)
        assert p.id in [c.id for c in comp]


class TestServicoPartidas:
    def test_criar_e_pontuar(self, repo_partidas):
        s = ServicoPartidas(repo_partidas)
        partida = s.criar("t1", "t2")
        s.pontuar(partida.id, "a", +1)
        s.pontuar(partida.id, "b", +2)
        atual = s.obter(partida.id)
        assert atual.placar_a == 1
        assert atual.placar_b == 2

    def test_pontuar_nao_fica_negativo(self, repo_partidas):
        s = ServicoPartidas(repo_partidas)
        partida = s.criar("t1", "t2")
        s.pontuar(partida.id, "a", -1)
        assert s.obter(partida.id).placar_a == 0

    def test_criar_time_contra_si_mesmo_falha(self, repo_partidas):
        s = ServicoPartidas(repo_partidas)
        with pytest.raises(Exception):
            s.criar("t1", "t1")

    def test_alterar_status(self, repo_partidas):
        s = ServicoPartidas(repo_partidas)
        partida = s.criar("t1", "t2")
        s.alterar_status(partida.id, "concluida")
        assert s.obter(partida.id).status_partida == "concluida"


class TestClassificacao:
    def test_pontuacao_por_vitoria(self):
        partidas = [
            _partida("p1", "t1", "t2", 25, 20, "concluida"),
            _partida("p2", "t1", "t3", 25, 23, "concluida"),
        ]
        tabela = classificacao(partidas)
        t1 = next(x for x in tabela if x["time_id"] == "t1")
        assert t1["pontos"] == 6
        assert t1["vitorias"] == 2

    def test_ignora_partidas_nao_concluidas(self):
        partidas = [
            _partida("p1", "t1", "t2", 25, 20, "agendado"),
        ]
        assert classificacao(partidas) == []


def _partida(id_, a, b, pa, pb, status):
    from app.models import Partida
    return Partida(
        id=id_, time_a_id=a, time_b_id=b,
        placar_a=pa, placar_b=pb, status_partida=status,
    )
