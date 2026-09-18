"""Testes da persistência e da lista de acessos do Google Sheets."""
from __future__ import annotations

from app.sheets_nivelamento import ACCESS_HEADERS, HEADERS, SheetsNivelamento


class PlanilhaFalsa:
    def __init__(self, titulo: str, valores: list[list[str]] | None = None):
        self.title = titulo
        self.valores = valores or []
        self.limpa = False
        self.tamanho = None

    def clear(self):
        self.limpa = True
        self.valores = []

    def resize(self, rows: int, cols: int):
        self.tamanho = (rows, cols)

    def append_row(self, valores: list[str], value_input_option: str):
        assert value_input_option == "RAW"
        self.valores.append(valores)

    def get_all_values(self):
        return self.valores


class DocumentoFalso:
    def __init__(self, planilhas: list[PlanilhaFalsa]):
        self.planilhas = {planilha.title: planilha for planilha in planilhas}

    def worksheet(self, titulo: str):
        if titulo not in self.planilhas:
            raise ValueError(titulo)
        return self.planilhas[titulo]

    def add_worksheet(self, title: str, rows: int, cols: int):
        planilha = PlanilhaFalsa(title)
        self.planilhas[title] = planilha
        return planilha


def _servico(documento: DocumentoFalso) -> SheetsNivelamento:
    servico = SheetsNivelamento()
    servico._spreadsheet = lambda: documento
    return servico


def test_conectar_resetar_preserva_abas_e_cria_acessos():
    nivelamento = PlanilhaFalsa("Nivelamento", [["dados antigos"]])
    externa = PlanilhaFalsa("Relatórios", [["manter"]])
    documento = DocumentoFalso([nivelamento, externa])

    _servico(documento).conectar_resetar()

    assert nivelamento.limpa is True
    assert nivelamento.valores == [HEADERS]
    assert documento.worksheet("Relatórios").valores == [["manter"]]
    assert documento.worksheet("Acessos").valores == [ACCESS_HEADERS]


def test_emails_autorizados_filtra_linhas_ativas_e_validas():
    acessos = PlanilhaFalsa("Acessos", [
        ["email", "ativo"],
        ["ANA@EXEMPLO.COM", "sim"],
        ["bloqueado@exemplo.com", "não"],
        ["invalido", "sim"],
        ["  bia@exemplo.com ", " SIM "],
    ])

    autorizados = _servico(DocumentoFalso([acessos])).emails_autorizados()

    assert autorizados == {"ana@exemplo.com", "bia@exemplo.com"}
