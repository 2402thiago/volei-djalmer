"""Regras de negócio do torneio de vôlei.

Implementa cadastro/edição de participantes, organização automática de
times (balanceamento por nível com *snake draft*). Tudo opera sobre o contrato
`Repositorio` em memória.
"""
from __future__ import annotations

from . import models
from .models import Participante, Time
from .repo import Repositorio

NIVEIS = ("C1", "M1", "M2", "F1", "F2", "LM1", "LF1")
ORDEM_NIVEIS = {nivel: len(NIVEIS) - indice for indice, nivel in enumerate(NIVEIS)}
STATUS_VALIDOS = ("ativo", "inativo")
SEXOS_VALIDOS = ("", "F", "M")


class ErroDeDominio(ValueError):
    """Erro de regra de negócio, apresentável ao usuário."""


def _validar_nome(nome: str) -> str:
    nome = (nome or "").strip()
    if not nome:
        raise ErroDeDominio("O nome do participante não pode ser vazio.")
    if len(nome) > 80:
        raise ErroDeDominio("O nome deve ter no máximo 80 caracteres.")
    return nome


def _validar_nivel(nivel: str | None) -> str | None:
    if nivel is None:
        return None
    nivel = str(nivel).strip().upper()
    if not nivel:
        return None
    if nivel not in NIVEIS:
        raise ErroDeDominio(f"Nível inválido: {nivel!r}.")
    return nivel


def _validar_sexo(sexo: str | None) -> str:
    sexo = (sexo or "").strip().upper()
    if sexo not in SEXOS_VALIDOS:
        raise ErroDeDominio("Sexo deve ser F ou M.")
    return sexo


def _validar_ranking(ranking: int | None) -> int | None:
    if ranking in (None, ""):
        return None
    try:
        ranking = int(ranking)
    except (TypeError, ValueError):
        raise ErroDeDominio("Ranking deve ser um número inteiro positivo.")
    if ranking < 1:
        raise ErroDeDominio("Ranking deve ser um número inteiro positivo.")
    return ranking


# ---------------------------------------------------------------------------
# Participantes
# ---------------------------------------------------------------------------

class ServicoParticipantes:
    """Cadastro, edição e listagem de participantes."""

    def __init__(self, repo: Repositorio[Participante]) -> None:
        self.repo = repo

    def criar(
        self, nome: str, nivel: str | None = None, sexo: str | None = "",
        ranking: int | None = None,
    ) -> Participante:
        nome = _validar_nome(nome)
        nivel = _validar_nivel(nivel)
        sexo = _validar_sexo(sexo)
        ranking = _validar_ranking(ranking)
        p = Participante(nome=nome, sexo=sexo, nivel=nivel, ranking=ranking, status="ativo")
        return self.repo.salvar(p)

    def listar(self, incluir_inativos: bool = False) -> list[Participante]:
        todos = self.repo.obter_todos()
        if not incluir_inativos:
            todos = [p for p in todos if p.status == "ativo"]
        return sorted(todos, key=lambda p: (p.nome.lower(), p.id))

    def obter(self, id_: str) -> Participante:
        p = self.repo.obter(id_)
        if p is None:
            raise ErroDeDominio(f"Participante não encontrado: {id_}.")
        return p

    def editar(
        self, id_: str, nome: str | None = None, nivel: str | None = None,
        sexo: str | None = None, ranking: int | None = None,
    ) -> Participante:
        p = self.obter(id_)
        if nome is not None:
            p.nome = _validar_nome(nome)
        if nivel is not None:
            p.nivel = _validar_nivel(nivel)
        if sexo is not None:
            p.sexo = _validar_sexo(sexo)
        if ranking is not None:
            p.ranking = _validar_ranking(ranking)
        p.atualizado_em = models.agora_iso()
        return self.repo.salvar(p)

    def alterar_status(self, id_: str, status: str) -> Participante:
        if status not in STATUS_VALIDOS:
            raise ErroDeDominio(f"Status inválido: {status!r}.")
        p = self.obter(id_)
        p.status = status
        p.atualizado_em = models.agora_iso()
        return self.repo.salvar(p)

    def remover(self, id_: str) -> bool:
        p = self.obter(id_)
        return self.repo.remover(p.id)

    def limpar_todos(self) -> int:
        """Remove todos os participantes. Retorna quantidade removida."""
        todos = self.repo.obter_todos()
        for p in todos:
            self.repo.remover(p.id)
        return len(todos)

    def criar_em_lote(self, nomes: list[str], nivel: str | None = None) -> list[Participante]:
        """Cria múltiplos participantes. Ignora erros (duplicatas, inválidos)."""
        criados = []
        for nome in nomes:
            try:
                p = self.criar(nome, nivel)
                criados.append(p)
            except ErroDeDominio:
                pass
        return criados


# ---------------------------------------------------------------------------
# Times (balanceamento)
# ---------------------------------------------------------------------------

def balancear_times(
    participantes: list[Participante],
    num_times: int,
) -> list[list[Participante]]:
    """Distribui participantes em N times equilibrados (snake draft).

    Prioridade: equilibrar o nível médio dos times. Ordena por nível
    decrescente e distribui em zigue-zague entre os times.
    """
    if num_times <= 0:
        raise ErroDeDominio("O número de times deve ser maior que zero.")
    ativos = [p for p in participantes if p.status == "ativo"]
    if not ativos:
        raise ErroDeDominio("Não há participantes ativos para montar os times.")

    sem_nivel = len(NIVEIS) + 1
    ordenados = sorted(
        ativos,
        key=lambda p: (
            -ORDEM_NIVEIS.get(p.nivel, 0) if p.nivel else sem_nivel,
            p.ranking if p.ranking is not None else sem_nivel,
            p.criado_em,
        ),
    )
    times: list[list[Participante]] = [[] for _ in range(num_times)]

    for indice, participante in enumerate(ordenados):
        rodada = indice // num_times
        posicao = indice % num_times
        if rodada % 2 == 0:
            time_alvo = posicao
        else:
            time_alvo = num_times - 1 - posicao
        times[time_alvo].append(participante)

    return times


class ServicoTimes:
    """Criação de times a partir do balanceamento por nível."""

    def __init__(
        self,
        repo_times: Repositorio[Time],
        repo_participantes: Repositorio[Participante],
    ) -> None:
        self.repo_times = repo_times
        self.repo_participantes = repo_participantes

    def montar(self, num_times: int, prefixo_nome: str = "Time") -> list[Time]:
        """Monta times balanceados e os persiste (substituindo os anteriores)."""
        participantes = self.repo_participantes.obter_todos()
        agrupados = balancear_times(participantes, num_times)

        # Remove times existentes para não acumular configurações antigas.
        for t in self.repo_times.obter_todos():
            self.repo_times.remover(t.id)

        criados: list[Time] = []
        for i, grupo in enumerate(agrupados, start=1):
            jogadores = [p.id for p in grupo]
            media = (
                sum(ORDEM_NIVEIS.get(p.nivel, 0) for p in grupo) / len(grupo)
                if grupo else 0.0
            )
            time = Time(
                nome=f"{prefixo_nome} {i}",
                jogadores=jogadores,
                nivel_medio=round(media, 2),
            )
            criados.append(self.repo_times.salvar(time))
        return criados

    def listar(self) -> list[Time]:
        return sorted(self.repo_times.obter_todos(), key=lambda t: t.nome)

    def composicao(self, id_: str) -> tuple[Time, list[Participante]]:
        """Retorna um time e a lista de participantes que o compõem."""
        time = self.repo_times.obter(id_)
        if time is None:
            raise ErroDeDominio(f"Time não encontrado: {id_}.")
        participantes = [
            self.repo_participantes.obter(j) for j in time.jogadores
        ]
        participantes = [p for p in participantes if p is not None]
        return time, participantes


