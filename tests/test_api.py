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
    for nome, nivel in [("Ana", 5), ("Bia", 1), ("Caio", 4), ("Duda", 2), ("Eva", 3), ("Fabio", 3)]:
        assert client.post("/api/participantes", json={"nome": nome, "nivel": nivel}).status_code == 200

    # monta times
    times = client.post("/api/times/montar", json={"num_times": 2}).json()
    assert len(times) == 2
    assert all(t["jogadores"] for t in times)

    # partida + placar + conclusão
    p = client.post("/api/partidas", json={"time_a_id": times[0]["id"], "time_b_id": times[1]["id"]}).json()
    pid = p["id"]
    client.patch(f"/api/partidas/{pid}/placar", json={"time": "a", "delta": 1})
    client.patch(f"/api/partidas/{pid}/placar", json={"time": "a", "delta": 1})
    client.patch(f"/api/partidas/{pid}/status", json={"status": "concluida"})

    assert int(client.get("/api/partidas").json()[0]["placar_a"]) == 2
    classificacao = client.get("/api/classificacao").json()
    assert classificacao[0]["time_id"] == times[0]["id"]


def test_validacao_nome_vazio(client):
    assert client.post("/api/participantes", json={"nome": "", "nivel": 3}).status_code == 400


def test_montar_sem_participantes(client):
    assert client.post("/api/times/montar", json={"num_times": 2}).status_code == 400


def test_servir_index(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Torneio de Vôlei" in r.text