"""Sincronização bidirecional com o Google Sheets.

Estratégia (decisão da Fase 0): **última escrita vence**, comparando o
campo `atualizado_em` (ISO-8601, ordenável) de cada registro.

Regras:
- Registro só no lado local  -> envia (push) para a planilha.
- Registro só na planilha    -> importa (pull) para o lado local (edição manual).
- Registro nos dois lados    -> o mais novo (maior `atualizado_em`) vence e
  é aplicado nos dois lados; empate mantém o valor já presente (sem loop).
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

# Tipo de um "lado" do sync: mapa id -> linha (dict). Linhas têm ao menos "id"
# e "atualizado_em".
Linha = dict[str, str]
MapaLinhas = dict[str, Linha]


def _tempo(linha: Linha) -> str:
    return linha.get("atualizado_em") or ""


def mesclar(
    local: MapaLinhas,
    remoto: MapaLinhas,
) -> tuple[MapaLinhas, list[str]]:
    """Mescla dois lados de uma aba e devolve o resultado unificado.

    Retorna (resultado, ações): o mapa unificado de linhas e a lista de
    ações legíveis usada para logs/relatórios.
    """
    resultado: MapaLinhas = {}
    acoes: list[str] = []
    ids = set(local) | set(remoto)

    for id_ in ids:
        l = local.get(id_)
        r = remoto.get(id_)
        if l is not None and r is None:
            resultado[id_] = l
            acoes.append(f"push: {id_}")
        elif r is not None and l is None:
            resultado[id_] = r
            acoes.append(f"pull: {id_}")
        elif l is not None and r is not None:
            if _tempo(l) == _tempo(r):
                resultado[id_] = l
                acoes.append(f"igual: {id_}")
            elif _tempo(l) > _tempo(r):
                resultado[id_] = l
                acoes.append(f"conflito-local: {id_}")
            else:
                resultado[id_] = r
                acoes.append(f"conflito-remoto: {id_}")
    return resultado, acoes


class Sincronizador:
    """Aplica a mesclagem entre o repositório local e o Google Sheets."""

    def __init__(
        self,
        ler_local: Callable[[], list[Any]],
        salvar_local: Callable[[Any], None],
        ler_remoto: Callable[[], list[Linha]],
        escrever_remoto: Callable[[str, Linha], None],
        para_linha: Callable[[Any], Linha],
        de_linha: Callable[[Linha], Any],
    ) -> None:
        self.ler_local = ler_local
        self.salvar_local = salvar_local
        self.ler_remoto = ler_remoto
        self.escrever_remoto = escrever_remoto
        self.para_linha = para_linha
        self.de_linha = de_linha

    def sincronizar(self) -> list[str]:
        """Executa um ciclo completo de sincronização da aba.

        Retorna a lista de ações executadas (para logs e relatórios).
        """
        local_map: MapaLinhas = {
            reg.id: self.para_linha(reg) for reg in self.ler_local()
        }
        remoto_map: MapaLinhas = {
            linha["id"]: linha for linha in self.ler_remoto() if linha.get("id")
        }

        resultado, acoes = mesclar(local_map, remoto_map)

        for id_, linha in resultado.items():
            atual = local_map.get(id_)
            rem = remoto_map.get(id_)
            if atual is None or atual != linha:
                self.salvar_local(self.de_linha(linha))
            if rem is None or rem != linha:
                self.escrever_remoto(id_, linha)

        return acoes