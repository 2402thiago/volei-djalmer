"""Eventos públicos: persistência Google Sheets, Drive privado e regras de inscrição."""
from __future__ import annotations

import io
import json
import os
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


EVENTS = "OrganizacaoEventos"
REGISTRATIONS = "OrganizacaoInscricoes"
GUESTS = "OrganizacaoConvidados"
COMMISSIONS = "OrganizacaoComissoes"
PAYMENT_PROOFS = "OrganizacaoComprovantes"
SHEETS = {
    EVENTS: ["id", "slug", "titulo", "data", "hora_inicio", "hora_fim", "capacidade", "vagas_liberadas", "maps_url", "valor", "pix", "criador_email", "criado_em"],
    REGISTRATIONS: ["id", "event_id", "google_sub", "nome", "lista", "pagamento", "criado_em"],
    GUESTS: ["id", "event_id", "registration_id", "nome", "status", "criado_em"],
    COMMISSIONS: ["id", "event_id", "email"],
    PAYMENT_PROOFS: ["id", "event_id", "tipo", "subject_id", "drive_file_id", "nome_arquivo", "mime_type", "tamanho", "status", "enviado_por", "enviado_em", "aprovado_por"],
}
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ALLOWED_FILES = {"image/jpeg", "image/png", "application/pdf"}
MAX_FILE_SIZE = 5 * 1024 * 1024


class ConfigError(RuntimeError):
    pass


class DomainError(ValueError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return value[:55] or "evento"


def valid_file(filename, mime, data):
    """Validate both the declared MIME type and the inexpensive file signature."""
    filename = Path(filename or "comprovante").name[:120]
    signatures = {
        "image/jpeg": data.startswith(b"\xff\xd8\xff"),
        "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "application/pdf": data.startswith(b"%PDF-"),
    }
    if mime not in ALLOWED_FILES or not data or len(data) > MAX_FILE_SIZE or not signatures.get(mime):
        raise DomainError("Comprovante deve ser JPG, PNG ou PDF válido de até 5 MB.")
    return filename


def drive_error_message(exc) -> str:
    status = getattr(getattr(exc, "resp", None), "status", None)
    try:
        payload = json.loads(getattr(exc, "content", b"").decode("utf-8"))
        reason = payload.get("error", {}).get("errors", [{}])[0].get("reason", "")
    except (AttributeError, TypeError, ValueError, UnicodeDecodeError):
        reason = ""
    if reason == "accessNotConfigured":
        return "A API Google Drive não está habilitada no projeto Google. Ative-a no Google Cloud."
    if reason == "storageQuotaExceeded":
        return "A conta Google usada para enviar o comprovante não possui espaço disponível."
    if status == 404:
        return "O arquivo não foi encontrado no Google Drive. Faça login novamente e tente enviar o comprovante."
    if status == 403:
        return "O Google Drive recusou o envio. Faça login novamente para autorizar o acesso ao Drive."
    return "Não foi possível enviar o comprovante ao Google Drive. Faça login novamente e tente de novo."


class GoogleOrganizationStore:
    """Pequeno adaptador gspread, deliberadamente sem apagar abas existentes."""
    def __init__(self):
        self._book = None
        self._drive = None

    def _credentials(self):
        sheet_id = os.getenv("GOOGLE_SHEETS_ID", "").strip()
        source = os.getenv("GOOGLE_SERVICE_ACCOUNT_INFO", "").strip()
        path = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        if not sheet_id or not (source or path):
            raise ConfigError("Organização não configurada: defina GOOGLE_SHEETS_ID e GOOGLE_SERVICE_ACCOUNT_JSON ou GOOGLE_SERVICE_ACCOUNT_INFO.")
        try:
            from google.oauth2.service_account import Credentials
            scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
            return Credentials.from_service_account_info(json.loads(source), scopes=scopes) if source else Credentials.from_service_account_file(path, scopes=scopes)
        except Exception as exc:
            raise ConfigError("Não foi possível carregar a conta de serviço do Google.") from exc

    def _spreadsheet(self):
        if self._book is None:
            try:
                import gspread
                self._book = gspread.authorize(self._credentials()).open_by_key(os.environ["GOOGLE_SHEETS_ID"])
            except ConfigError:
                raise
            except Exception as exc:
                raise ConfigError("Não foi possível abrir GOOGLE_SHEETS_ID. Compartilhe a planilha com a conta de serviço.") from exc
        return self._book

    def _worksheet(self, name):
        book = self._spreadsheet()
        try:
            ws = book.worksheet(name)
        except Exception:
            ws = book.add_worksheet(title=name, rows=1000, cols=len(SHEETS[name]))
        values = ws.get_all_values()
        if not values:
            ws.append_row(SHEETS[name], value_input_option="RAW")
        elif values[0] != SHEETS[name]:
            if any(any(cell for cell in row) for row in values[1:]):
                raise ConfigError(f"A aba {name} não possui a estrutura esperada e contém dados. Corrija os cabeçalhos sem remover os registros.")
            ws.clear()
            ws.append_row(SHEETS[name], value_input_option="RAW")
        return ws

    def prepare(self):
        for name in SHEETS:
            self._worksheet(name)

    def rows(self, name):
        values = self._worksheet(name).get_all_values()
        header = values[0] if values else SHEETS[name]
        return [{key: row[i] if i < len(row) else "" for i, key in enumerate(header)} for row in values[1:] if any(row)]

    def add(self, name, row):
        self._worksheet(name).append_row([str(row.get(k, "")) for k in SHEETS[name]], value_input_option="RAW")

    def update(self, name, row_id, changes):
        ws = self._worksheet(name)
        values = ws.get_all_values()
        for index, row in enumerate(values[1:], start=2):
            if row and row[0] == row_id:
                mapped = {key: row[i] if i < len(row) else "" for i, key in enumerate(SHEETS[name])}
                mapped.update(changes)
                ws.update(f"A{index}:{chr(64 + len(SHEETS[name]))}{index}", [[str(mapped.get(k, "")) for k in SHEETS[name]]], value_input_option="RAW")
                return
        raise DomainError("Registro não encontrado.")

    def upload(self, filename, mime, data, uploader_credentials):
        try:
            from googleapiclient.discovery import build
            from googleapiclient.errors import HttpError
            from googleapiclient.http import MediaIoBaseUpload
            drive = build("drive", "v3", credentials=uploader_credentials, cache_discovery=False)
            item = drive.files().create(body={"name": filename}, media_body=MediaIoBaseUpload(io.BytesIO(data), mimetype=mime, resumable=False), fields="id").execute()
            drive.permissions().create(fileId=item["id"], body={"type": "user", "role": "reader", "emailAddress": self._credentials().service_account_email}, sendNotificationEmail=False).execute()
            return item["id"]
        except ConfigError:
            raise
        except HttpError as exc:
            raise ConfigError(drive_error_message(exc)) from exc
        except Exception as exc:
            raise ConfigError("Não foi possível enviar o comprovante ao Google Drive. Faça login novamente e tente de novo.") from exc

    def download(self, file_id):
        try:
            from googleapiclient.discovery import build
            from googleapiclient.http import MediaIoBaseDownload
            if self._drive is None:
                self._drive = build("drive", "v3", credentials=self._credentials(), cache_discovery=False)
            request = self._drive.files().get_media(fileId=file_id, supportsAllDrives=True)
            output = io.BytesIO()
            downloader = MediaIoBaseDownload(output, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return output.getvalue()
        except Exception as exc:
            raise ConfigError("Não foi possível baixar o comprovante privado.") from exc


class OrganizationService:
    def __init__(self, store=None): self.store = store or GoogleOrganizationStore()
    def prepare(self): self.store.prepare()
    def organizer_allowed(self, email):
        # Acessos is owned by the existing Nivelamento integration.
        try:
            rows = self.store._spreadsheet().worksheet("Acessos").get_all_values()
        except ConfigError:
            raise
        except Exception as exc:
            raise ConfigError("Não foi possível ler a aba Acessos. Crie as colunas email e ativo na planilha Google.") from exc
        return any(len(r) > 1 and r[0].strip().casefold() == email.casefold() and r[1].strip().casefold() == "sim" for r in rows[1:])
    def create_event(self, data, actor):
        self.prepare()
        if not self.organizer_allowed(actor["email"]): raise DomainError("Seu e-mail não está autorizado em Acessos.")
        required = ["titulo", "data", "hora_inicio", "hora_fim"]
        if any(not str(data.get(k, "")).strip() for k in required): raise DomainError("Informe título, data e horários do evento.")
        capacity, released = int(data.get("capacidade", 24)), int(data.get("vagas_liberadas", 0))
        if capacity < 1 or released < 0 or released > capacity: raise DomainError("Capacidade ou vagas liberadas inválidas.")
        maps_url = str(data.get("maps_url", "")).strip()
        if maps_url:
            parsed = urlparse(maps_url)
            host = parsed.netloc.casefold()
            valid_maps = parsed.scheme == "https" and (host in {"maps.google.com", "maps.app.goo.gl"} or (host in {"google.com", "www.google.com"} and parsed.path.startswith("/maps")))
            if not valid_maps: raise DomainError("Informe um link válido do Google Maps.")
        base = slugify(data["titulo"] + "-" + data["data"])
        used = {e["slug"] for e in self.store.rows(EVENTS)}; slug = base
        while slug in used: slug = f"{base}-{uuid.uuid4().hex[:5]}"
        event = {"id": uuid.uuid4().hex, "slug": slug, "titulo": data["titulo"].strip(), "data": data["data"], "hora_inicio": data["hora_inicio"], "hora_fim": data["hora_fim"], "capacidade": capacity, "vagas_liberadas": released, "maps_url": maps_url, "valor": data.get("valor", ""), "pix": data.get("pix", "").strip(), "criador_email": actor["email"], "criado_em": now()}
        self.store.add(EVENTS, event)
        emails = {actor["email"].casefold()} | {x.strip().casefold() for x in str(data.get("emails_comissao", "")).split(",") if EMAIL.fullmatch(x.strip())}
        for email in emails: self.store.add(COMMISSIONS, {"id": uuid.uuid4().hex, "event_id": event["id"], "email": email})
        return event
    def event(self, slug):
        return next((e for e in self.store.rows(EVENTS) if e["slug"] == slug), None)
    def open_events(self, actor):
        today = date.today().isoformat()
        email = actor["email"].casefold()
        commissions = {c["event_id"] for c in self.store.rows(COMMISSIONS) if c["email"].casefold() == email}
        registrations = self.store.rows(REGISTRATIONS)
        events = []
        for event in self.store.rows(EVENTS):
            if event["data"] < today or (event["criador_email"].casefold() != email and event["id"] not in commissions):
                continue
            event_registrations = [r for r in registrations if r["event_id"] == event["id"]]
            events.append({
                "slug": event["slug"], "titulo": event["titulo"], "data": event["data"],
                "hora_inicio": event["hora_inicio"], "hora_fim": event["hora_fim"],
                "capacidade": int(event["capacidade"]),
                "principais": sum(r["lista"] == "principal" for r in event_registrations),
                "reservas": sum(r["lista"] == "reserva" for r in event_registrations),
            })
        return sorted(events, key=lambda event: (event["data"], event["hora_inicio"], event["titulo"]))
    def public_event(self, slug):
        event = self.event(slug)
        if not event: raise DomainError("Evento não encontrado.")
        registrations = self.store.rows(REGISTRATIONS)
        guests = self.store.rows(GUESTS)
        return {"event": {k: v for k, v in event.items() if k != "criador_email"}, "registrations": [{"nome": r["nome"], "lista": r["lista"], "pagamento": r["pagamento"]} for r in registrations if r["event_id"] == event["id"]], "guests": [{"nome": g["nome"], "status": g["status"]} for g in guests if g["event_id"] == event["id"]]}
    def join(self, slug, actor):
        event = self.event(slug)
        if not event: raise DomainError("Evento não encontrado.")
        rows = self.store.rows(REGISTRATIONS)
        if any(r["event_id"] == event["id"] and r["google_sub"] == actor["sub"] for r in rows): raise DomainError("Você já entrou nesta lista.")
        main = sum(r["event_id"] == event["id"] and r["lista"] == "principal" for r in rows)
        limit = min(int(event["capacidade"]), int(event["vagas_liberadas"]))
        row = {"id": uuid.uuid4().hex, "event_id": event["id"], "google_sub": actor["sub"], "nome": actor["name"], "lista": "principal" if main < limit else "reserva", "pagamento": "pendente", "criado_em": now()}
        self.store.add(REGISTRATIONS, row); return row
    def registration_for(self, event, actor):
        return next((r for r in self.store.rows(REGISTRATIONS) if r["event_id"] == event["id"] and r["google_sub"] == actor["sub"]), None)
    def add_guest(self, slug, name, actor):
        event = self.event(slug); reg = event and self.registration_for(event, actor)
        if not reg: raise DomainError("Entre na lista antes de adicionar convidado.")
        if not name.strip(): raise DomainError("Informe o nome do convidado.")
        row = {"id": uuid.uuid4().hex, "event_id": event["id"], "registration_id": reg["id"], "nome": name.strip(), "status": "pendente", "criado_em": now()}
        self.store.add(GUESTS, row); return row
    def mine(self, slug, actor):
        event = self.event(slug)
        if not event: raise DomainError("Evento não encontrado.")
        registration = self.registration_for(event, actor)
        if not registration: return {"registration": None, "guests": []}
        return {"registration": registration, "guests": [g for g in self.store.rows(GUESTS) if g["registration_id"] == registration["id"]]}
    def commission(self, event, email):
        return any(c["event_id"] == event["id"] and c["email"].casefold() == email.casefold() for c in self.store.rows(COMMISSIONS))
    def upload_proof(self, slug, kind, subject_id, actor, filename, mime, data, uploader_credentials):
        filename = valid_file(filename, mime, data)
        event = self.event(slug)
        if not event: raise DomainError("Evento não encontrado.")
        registration = self.registration_for(event, actor)
        if kind == "registration":
            if not registration or registration["id"] != subject_id: raise DomainError("Você só pode enviar seu próprio comprovante.")
        elif kind == "guest":
            if not self.commission(event, actor["email"]): raise DomainError("Apenas a comissão pode enviar comprovante de convidado.")
            guest = next((g for g in self.store.rows(GUESTS) if g["id"] == subject_id and g["event_id"] == event["id"]), None)
            if not guest or guest["status"] != "pendente":
                raise DomainError("Convidado não encontrado neste evento.")
        else: raise DomainError("Tipo de comprovante inválido.")
        if any(p["event_id"] == event["id"] and p["tipo"] == kind and p["subject_id"] == subject_id for p in self.store.rows(PAYMENT_PROOFS)):
            raise DomainError("Já existe um comprovante enviado para esta inscrição.")
        proof = {"id": uuid.uuid4().hex, "event_id": event["id"], "tipo": kind, "subject_id": subject_id, "drive_file_id": self.store.upload(filename, mime, data, uploader_credentials), "nome_arquivo": filename, "mime_type": mime, "tamanho": len(data), "status": "pendente", "enviado_por": actor["email"], "enviado_em": now(), "aprovado_por": ""}
        self.store.add(PAYMENT_PROOFS, proof); return proof
    def proofs(self, slug, actor):
        event = self.event(slug)
        if not event or not self.commission(event, actor["email"]): raise DomainError("Apenas a comissão pode ver comprovantes.")
        return self.commission_details(slug, actor)["proofs"]
    def commission_details(self, slug, actor):
        event = self.event(slug)
        if not event or not self.commission(event, actor["email"]): raise DomainError("Apenas a comissão pode ver os detalhes do evento.")
        registrations = [r for r in self.store.rows(REGISTRATIONS) if r["event_id"] == event["id"]]
        guests = [g for g in self.store.rows(GUESTS) if g["event_id"] == event["id"]]
        names = {r["id"]: r["nome"] for r in registrations} | {g["id"]: g["nome"] for g in guests}
        proofs = [{**p, "subject_name": names.get(p["subject_id"], "Participante removido")} for p in self.store.rows(PAYMENT_PROOFS) if p["event_id"] == event["id"]]
        return {"event": event, "guests": guests, "proofs": proofs}
    def approve(self, proof_id, actor):
        proof = next((p for p in self.store.rows(PAYMENT_PROOFS) if p["id"] == proof_id), None)
        event = proof and next((e for e in self.store.rows(EVENTS) if e["id"] == proof["event_id"]), None)
        if not proof or not event or not self.commission(event, actor["email"]): raise DomainError("Sem permissão para aprovar este comprovante.")
        if proof["status"] == "aprovado": raise DomainError("Este comprovante já foi aprovado.")
        self.store.update(PAYMENT_PROOFS, proof_id, {"status": "aprovado", "aprovado_por": actor["email"]})
        if proof["tipo"] == "registration": self.store.update(REGISTRATIONS, proof["subject_id"], {"pagamento": "confirmado"})
        else:
            guests = self.store.rows(GUESTS); guest = next((g for g in guests if g["id"] == proof["subject_id"] and g["event_id"] == event["id"]), None)
            if not guest: raise DomainError("Convidado não encontrado neste evento.")
            if guest["status"] != "pendente": raise DomainError("Este convidado já foi confirmado.")
            regs = self.store.rows(REGISTRATIONS); main = sum(r["event_id"] == event["id"] and r["lista"] == "principal" for r in regs)
            if main < min(int(event["capacidade"]), int(event["vagas_liberadas"])):
                self.store.add(REGISTRATIONS, {"id": uuid.uuid4().hex, "event_id": event["id"], "google_sub": "guest:" + guest["id"], "nome": guest["nome"], "lista": "principal", "pagamento": "confirmado", "criado_em": now()})
                self.store.update(GUESTS, guest["id"], {"status": "promovido"})
            else: self.store.update(GUESTS, guest["id"], {"status": "confirmado"})
        return {"ok": True}


organization = OrganizationService()
