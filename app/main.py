"""Aplicação FastAPI: API JSON + frontend estático."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .runtime import runtime
from .services import ErroDeDominio, classificacao

BASE = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE / "static"


app = FastAPI(title="Torneio de Vôlei", version="0.1.0")


def _resposta(fn):
    """Executa a função e converte ErroDeDominio em HTTP 400."""
    try:
        return fn()
    except ErroDeDominio as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -- Participantes ----------------------------------------------------
@app.get("/api/participantes")
def listar_participantes(incluir_inativos: bool = False):
    return _resposta(lambda: [
        {
            "id": p.id, "nome": p.nome, "sexo": p.sexo,
            "nivel": p.nivel, "ranking": p.ranking,
            "status": p.status,
        }
        for p in runtime.servico_participantes.listar(incluir_inativos)
    ])


@app.post("/api/participantes")
def criar_participante(payload: dict):
    return _resposta(lambda: runtime.servico_participantes.criar(
        payload.get("nome", ""), payload.get("nivel"),
        payload.get("sexo", ""), payload.get("ranking")
    ).to_linha())


@app.patch("/api/participantes/{id_}")
def editar_participante(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_participantes.editar(
        id_, payload.get("nome"), payload.get("nivel"),
        payload.get("sexo"), payload.get("ranking")
    ).to_linha())


@app.patch("/api/participantes/{id_}/status")
def alterar_status_participante(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_participantes.alterar_status(
        id_, payload.get("status", "ativo")
    ).to_linha())


@app.delete("/api/participantes/{id_}")
def remover_participante(id_: str):
    return _resposta(lambda: {"ok": runtime.servico_participantes.remover(id_)})


@app.post("/api/participantes/importar")
def importar_participantes(payload: dict):
    """Limpa lista atual e importa até 24 titulares sem nível."""
    def importar():
        nomes = payload.get("nomes", [])[:24]
        if not nomes:
            raise ErroDeDominio("Lista de nomes vazia.")
        runtime.servico_participantes.limpar_todos()
        criados = runtime.servico_participantes.criar_em_lote(nomes, nivel=None)
        return {"importados": len(criados), "nomes": [p.nome for p in criados]}

    return _resposta(importar)


# -- Times ------------------------------------------------------------
@app.post("/api/times/montar")
def montar_times(payload: dict):
    return _resposta(lambda: [
        {"id": t.id, "nome": t.nome, "nivel_medio": t.nivel_medio,
         "jogadores": t.jogadores}
        for t in runtime.servico_times.montar(payload.get("num_times", 2))
    ])


@app.get("/api/times")
def listar_times():
    return _resposta(lambda: [
        {
            "id": t.id, "nome": t.nome, "nivel_medio": t.nivel_medio,
            "jogadores": t.jogadores,
        }
        for t in runtime.servico_times.listar()
    ])


@app.get("/api/times/{id_}/composicao")
def composicao_time(id_: str):
    return _resposta(lambda: (lambda time, comp: {
        "id": time.id, "nome": time.nome, "nivel_medio": time.nivel_medio,
        "participantes": [
            {"id": p.id, "nome": p.nome, "nivel": p.nivel} for p in comp
        ],
    })(*runtime.servico_times.composicao(id_)))


# -- Partidas ---------------------------------------------------------
@app.get("/api/partidas")
def listar_partidas(status: str | None = None):
    return _resposta(lambda: [p.to_linha() for p in runtime.servico_partidas.listar(status)])


@app.post("/api/partidas")
def criar_partida(payload: dict):
    return _resposta(lambda: runtime.servico_partidas.criar(
        payload["time_a_id"], payload["time_b_id"]
    ).to_linha())


@app.patch("/api/partidas/{id_}/placar")
def pontuar(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_partidas.pontuar(
        id_, payload["time"], payload.get("delta", 1)
    ).to_linha())


@app.patch("/api/partidas/{id_}/status")
def alterar_status_partida(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_partidas.alterar_status(
        id_, payload.get("status", "em_andamento")
    ).to_linha())


@app.get("/api/classificacao")
def obter_classificacao():
    return _resposta(lambda: classificacao(runtime.servico_partidas.listar()))


# -- Sincronização / saúde -------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "env": runtime.modo}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
