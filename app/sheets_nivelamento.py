"""Persistência do cadastro permanente na aba Nivelamento do Google Sheets."""
from __future__ import annotations

import json
import os
from pathlib import Path


HEADERS = ["id", "nome", "sexo", "pote", "potes_adicionais", "aliases", "ordem", "atualizado_em"]


class SheetsNivelamento:
    def __init__(self) -> None:
        self.sheet_id = os.getenv("GOOGLE_SHEETS_ID", "")
        self.service_account_info = os.getenv("GOOGLE_SERVICE_ACCOUNT_INFO", "")
        self.client = None

    def configurar(self, sheet_id: str, service_account_info: str) -> None:
        sheet_id = sheet_id.strip()
        service_account_info = service_account_info.strip()
        if sheet_id:
            self.sheet_id = sheet_id
        if not self.sheet_id:
            raise ValueError("Informe o ID da planilha Google.")
        if service_account_info:
            try:
                dados = json.loads(service_account_info)
            except json.JSONDecodeError as exc:
                raise ValueError("O JSON da conta de serviço é inválido.") from exc
            obrigatorios = {"type", "client_email", "private_key"}
            if not obrigatorios.issubset(dados):
                raise ValueError("O JSON da conta de serviço não contém os campos obrigatórios.")
            self.service_account_info = service_account_info
        if not self.service_account_info and not os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", ""):
            raise ValueError("Informe o JSON da conta de serviço.")
        self.client = None

    def _spreadsheet(self):
        if self.client is None:
            try:
                import gspread
                from google.oauth2.service_account import Credentials
            except ImportError as exc:
                raise RuntimeError("Dependências do Google Sheets não instaladas.") from exc
            info = self.service_account_info
            if info:
                credentials = Credentials.from_service_account_info(json.loads(info), scopes=["https://www.googleapis.com/auth/spreadsheets"])
            else:
                caminho = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
                if not caminho:
                    raise RuntimeError("Configure GOOGLE_SHEETS_ID e uma credencial de conta de serviço.")
                credentials = Credentials.from_service_account_file(str(Path(caminho)), scopes=["https://www.googleapis.com/auth/spreadsheets"])
            self.client = gspread.authorize(credentials)
        if not self.sheet_id:
            raise RuntimeError("Configure GOOGLE_SHEETS_ID.")
        return self.client.open_by_key(self.sheet_id)

    def conectar_resetar(self) -> None:
        spreadsheet = self._spreadsheet()
        worksheets = spreadsheet.worksheets()
        worksheet = worksheets[0] if worksheets else spreadsheet.add_worksheet(title="Nivelamento", rows=1000, cols=len(HEADERS))
        for other in worksheets[1:]:
            spreadsheet.del_worksheet(other)
        if worksheet.title != "Nivelamento":
            worksheet.update_title("Nivelamento")
        worksheet.clear()
        worksheet.resize(rows=1000, cols=len(HEADERS))
        worksheet.append_row(HEADERS, value_input_option="RAW")

    def _worksheet(self):
        spreadsheet = self._spreadsheet()
        try:
            worksheet = spreadsheet.worksheet("Nivelamento")
        except Exception:
            worksheet = spreadsheet.add_worksheet(title="Nivelamento", rows=1000, cols=len(HEADERS))
            worksheet.append_row(HEADERS, value_input_option="RAW")
        return worksheet

    def sincronizar(self, atletas: list[dict]) -> dict:
        worksheet = self._worksheet()
        valores = worksheet.get_all_values()
        existentes = {linha[0]: indice for indice, linha in enumerate(valores[1:], start=2) if linha}
        adicionados = 0
        atualizados = 0
        for atleta in atletas:
            linha = [atleta.get("id", ""), atleta.get("nome", ""), atleta.get("sexo", ""), atleta.get("pote", ""), json.dumps(atleta.get("potesAdicionais", []), ensure_ascii=False), json.dumps(atleta.get("aliases", []), ensure_ascii=False), str(atleta.get("ordem", 0)), atleta.get("atualizado_em", "")]
            if atleta.get("id") in existentes:
                worksheet.update(f"A{existentes[atleta['id']]}:H{existentes[atleta['id']]}", [linha], value_input_option="RAW")
                atualizados += 1
            else:
                worksheet.append_row(linha, value_input_option="RAW")
                adicionados += 1
        return {"adicionados": adicionados, "atualizados": atualizados}

    def importar(self) -> list[dict]:
        valores = self._worksheet().get_all_values()
        atletas = []
        for linha in valores[1:]:
            if not linha or not linha[0]:
                continue
            atletas.append({"id": linha[0], "nome": linha[1] if len(linha) > 1 else "", "sexo": linha[2] if len(linha) > 2 else "", "pote": linha[3] if len(linha) > 3 else "", "potesAdicionais": json.loads(linha[4]) if len(linha) > 4 and linha[4] else [], "aliases": json.loads(linha[5]) if len(linha) > 5 and linha[5] else [], "ordem": int(linha[6]) if len(linha) > 6 and linha[6].isdigit() else 0, "atualizado_em": linha[7] if len(linha) > 7 else ""})
        return atletas
