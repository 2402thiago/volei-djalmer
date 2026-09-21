import pytest

from app.organizacao import ConfigError, EVENTS, GUESTS, REGISTRATIONS, SHEETS, GoogleOrganizationStore, OrganizationService, drive_error_message


class FakeStore:
    def __init__(self): self.data = {name: [] for name in SHEETS}
    def prepare(self): pass
    def rows(self, name): return [dict(r) for r in self.data[name]]
    def add(self, name, row): self.data[name].append(dict(row))
    def update(self, name, row_id, changes):
        next(r for r in self.data[name] if r["id"] == row_id).update(changes)
    def upload(self, filename, mime, data): return "drive-1"


class Service(OrganizationService):
    def organizer_allowed(self, email): return email == "organizador@example.com"


ORGANIZER = {"sub": "1", "name": "Organizador", "email": "organizador@example.com"}
PLAYER = {"sub": "2", "name": "Ana", "email": "ana@example.com"}


def event(service, released=1):
    return service.create_event({"titulo": "Jogo", "data": "2099-10-01", "hora_inicio": "19:00", "hora_fim": "21:00", "capacidade": 2, "vagas_liberadas": released}, ORGANIZER)


def test_join_once_and_reserve_after_released_slots():
    service = Service(FakeStore()); created = event(service)
    assert service.join(created["slug"], PLAYER)["lista"] == "principal"
    try:
        service.join(created["slug"], PLAYER)
        assert False, "duplicate identity must be rejected"
    except ValueError: pass
    assert service.join(created["slug"], {"sub": "3", "name": "Bia", "email": "bia@example.com"})["lista"] == "reserva"


def test_guest_only_promotes_when_released_slot_is_available():
    service = Service(FakeStore()); created = event(service, released=1)
    guest = service.add_guest(created["slug"], "Convidada", PLAYER) if service.join(created["slug"], PLAYER) else None
    proof = service.upload_proof(created["slug"], "guest", guest["id"], ORGANIZER, "x.pdf", "application/pdf", b"%PDF-1.7")
    service.approve(proof["id"], ORGANIZER)
    assert service.store.rows(GUESTS)[0]["status"] == "confirmado"


def test_participant_proof_is_private_and_confirmed_after_approval():
    service = Service(FakeStore()); created = event(service); registration = service.join(created["slug"], PLAYER)
    proof = service.upload_proof(created["slug"], "registration", registration["id"], PLAYER, "x.png", "image/png", b"\x89PNG\r\n\x1a\nbody")
    service.approve(proof["id"], ORGANIZER)
    assert service.store.rows(REGISTRATIONS)[0]["pagamento"] == "confirmado"


def test_public_data_includes_pix_guests_and_commission_proof_name():
    service = Service(FakeStore()); created = event(service)
    registration = service.join(created["slug"], PLAYER)
    guest = service.add_guest(created["slug"], "Convidada", PLAYER)
    proof = service.upload_proof(created["slug"], "guest", guest["id"], ORGANIZER, "guest.pdf", "application/pdf", b"%PDF-1.7")
    public = service.public_event(created["slug"])
    assert public["event"]["pix"] == ""
    assert public["guests"] == [{"nome": "Convidada", "status": "pendente"}]
    details = service.commission_details(created["slug"], ORGANIZER)
    assert details["proofs"][0]["subject_name"] == "Convidada"
    assert registration["nome"] == "Ana"


def test_rejects_file_with_spoofed_mime_type():
    service = Service(FakeStore()); created = event(service); registration = service.join(created["slug"], PLAYER)
    try:
        service.upload_proof(created["slug"], "registration", registration["id"], PLAYER, "bad.png", "image/png", b"not-a-png")
        assert False, "invalid file signature must be rejected"
    except ValueError:
        pass


def test_rejects_duplicate_proof_for_the_same_guest():
    service = Service(FakeStore()); created = event(service)
    service.join(created["slug"], PLAYER)
    guest = service.add_guest(created["slug"], "Convidada", PLAYER)
    service.upload_proof(created["slug"], "guest", guest["id"], ORGANIZER, "guest.pdf", "application/pdf", b"%PDF-1.7")
    try:
        service.upload_proof(created["slug"], "guest", guest["id"], ORGANIZER, "guest-2.pdf", "application/pdf", b"%PDF-1.7")
        assert False, "duplicate proof must be rejected"
    except ValueError:
        pass


def test_open_events_only_returns_future_events_for_creator_or_commission():
    service = Service(FakeStore())
    future = event(service)
    service.store.add(EVENTS, {"id": "old", "slug": "old", "titulo": "Antigo", "data": "2000-01-01", "hora_inicio": "19:00", "hora_fim": "21:00", "capacidade": 24, "vagas_liberadas": 24, "maps_url": "", "valor": "", "pix": "", "criador_email": ORGANIZER["email"], "criado_em": ""})
    assert [item["slug"] for item in service.open_events(ORGANIZER)] == [future["slug"]]


def test_organization_uses_namespaced_sheets_to_avoid_existing_tab_names():
    assert EVENTS == "OrganizacaoEventos"
    assert "Event" not in SHEETS


class Worksheet:
    def __init__(self, values): self.values = values; self.cleared = False
    def get_all_values(self): return self.values
    def clear(self): self.values = []; self.cleared = True
    def append_row(self, row, **_): self.values.append(row)


class Book:
    def __init__(self, worksheet): self.worksheet_value = worksheet
    def worksheet(self, _): return self.worksheet_value


def organization_store_with(values):
    store = GoogleOrganizationStore()
    worksheet = Worksheet(values)
    store._book = Book(worksheet)
    return store, worksheet


def test_organization_repairs_wrong_header_when_sheet_has_no_records():
    store, worksheet = organization_store_with([["Eventos"]])
    store._worksheet(EVENTS)
    assert worksheet.cleared
    assert worksheet.values == [SHEETS[EVENTS]]


def test_organization_does_not_overwrite_sheet_with_records_and_wrong_header():
    store, worksheet = organization_store_with([["Eventos"], ["evento existente"]])
    with pytest.raises(ConfigError, match="contém dados"):
        store._worksheet(EVENTS)
    assert not worksheet.cleared


class DriveFailure:
    def __init__(self, status, reason):
        self.resp = type("Response", (), {"status": status})()
        self.content = ('{"error":{"errors":[{"reason":"' + reason + '"}]}}').encode()


def test_drive_error_message_explains_folder_access_and_api_failures():
    assert "GOOGLE_DRIVE_FOLDER_ID" in drive_error_message(DriveFailure(404, "notFound"))
    assert "Editor" in drive_error_message(DriveFailure(403, "insufficientPermissions"))
    assert "API Google Drive" in drive_error_message(DriveFailure(403, "accessNotConfigured"))
