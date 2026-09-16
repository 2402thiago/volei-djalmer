"""Testes da API FastAPI (Fase 4), usando TestClient sobre repositórios em memória."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    from app.runtime import runtime
    runtime.reiniciar()
    return TestClient(app)


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_fluxo_completo(client):
    # cria participantes
    for nome, nivel in [("Ana", "C1"), ("Bia", "LF1"), ("Caio", "M1"), ("Duda", "M2"), ("Eva", "F1"), ("Fabio", "F1")]:
        assert client.post("/api/participantes", json={"nome": nome, "nivel": nivel}).status_code == 200

    # monta times
    times = client.post("/api/times/montar", json={"num_times": 2}).json()
    assert len(times) == 2
    assert all(t["jogadores"] for t in times)



def test_validacao_nome_vazio(client):
    assert client.post("/api/participantes", json={"nome": "", "nivel": "C1"}).status_code == 400


def test_participante_com_sexo_e_ranking(client):
    r = client.post(
        "/api/participantes",
        json={"nome": "Ana", "sexo": "F", "nivel": "C1", "ranking": 1},
    )
    assert r.status_code == 200
    participante = r.json()
    assert participante["sexo"] == "F"
    assert participante["nivel"] == "C1"
    assert participante["ranking"] == "1"


def test_importacao_considera_apenas_nomes_enviados_e_preserva_duplicados(client):
    client.post("/api/participantes", json={"nome": "Antigo", "nivel": "C1"})
    r = client.post(
        "/api/participantes/importar",
        json={"nomes": ["Milena", "Milena", "Alex"]},
    )
    assert r.status_code == 200
    assert r.json()["importados"] == 3
    nomes = [p["nome"] for p in client.get("/api/participantes").json()]
    assert nomes == ["Alex", "Milena", "Milena"]
    assert all(p["nivel"] is None for p in client.get("/api/participantes").json())


def test_montar_sem_participantes(client):
    assert client.post("/api/times/montar", json={"num_times": 2}).status_code == 400


def test_servir_index(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Vôlei Djalmer" in r.text
