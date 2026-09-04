# Sistema de Gestão de Torneio de Vôlei

Sistema para organizar torneios amadores de vôlei: cadastra participantes com
nível de habilidade, monta times balanceados automaticamente, registra partidas
e placar, e persiste tudo em uma planilha do Google Sheets com **sincronização
bidirecional** (o sistema escreve na planilha e também importa edições manuais).

## Funcionalidades

- Cadastro e edição de participantes (nome + nível 1–5, ativo/inativo).
- Organização automática de times por **snake draft**, equilibrando o nível médio.
- Registro de partidas e atualização de placar em tempo real.
- Classificação automática (vitória = 3 pontos).
- Sincronização bidirecional com Google Sheets (polling periódico, "última escrita vence").
- Interface web mobile-first com 4 telas: Times, Participantes, Partida e Histórico.

## Stack

- **Backend:** FastAPI + Uvicorn
- **Persistência:** Google Sheets via `gspread` (conta de serviço)
- **Frontend:** HTML/CSS/JS puro (sem build), mobile-first

## Requisitos

- Python 3.11 ou superior
- (Opcional) Uma conta do Google Cloud para integração real com Sheets

## Instalação

```bash
# 1. Crie e ative o ambiente virtual
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# 2. Instale as dependências
pip install -r requirements.txt

# 3. Configure as credenciais (ver seção abaixo)
cp .env.example .env
# edite o .env com os valores reais
```

## Configurando o Google Sheets

O sistema usa uma **conta de serviço** (service account) do Google Cloud com
escopo **restrito** a planilhas. Siga os passos:

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto.
2. Em **APIs e serviços > Biblioteca**, habilite a **Google Sheets API**.
3. Em **APIs e serviços > Credenciais**, crie uma **Conta de serviço**.
4. Na conta criada, gere uma **chave JSON** e baixe o arquivo (ex.: `credenciais/sheets.json`).
   - **Importante:** o arquivo JSON contém a chave privada. **Nunca** versionar ou compartilhar.
5. Crie a planilha no Google Sheets e **compartilhe com o e-mail da conta de serviço**
   (o endereço `xxx@projeto.iam.gserviceaccount.com`) com permissão de **Editor**.
6. Preencha o `.env`:

```dotenv
# Em desenvolvimento: caminho do arquivo JSON
GOOGLE_SERVICE_ACCOUNT_JSON=./credenciais/sheets.json
# Em produção: o JSON completo como string (alternativa à linha acima)
GOOGLE_SERVICE_ACCOUNT_INFO={"type":"service_account", ...}
GOOGLE_SHEETS_ID=SEU_ID_DA_PLANILHA
SYNC_INTERVAL_SECONDS=20
```

> **Duas formas de fornecer a credencial:** `GOOGLE_SERVICE_ACCOUNT_JSON` (caminho de
> arquivo, para dev local) ou `GOOGLE_SERVICE_ACCOUNT_INFO` (o JSON completo como
> variável de ambiente, para produção). Se ambas existirem, a `INFO` tem prioridade.

O **ID da planilha** é a parte da URL entre `/d/` e `/edit`: para
`https://docs.google.com/spreadsheets/d/1AbC.../edit`, o ID é `1AbC...`.

### Sem credenciais (modo memória)

Se não configurar o `.env`, o sistema roda em **modo memória**: a interface e a
API funcionam normalmente, mas os dados são perdidos ao reiniciar. Isso é útil
para testar antes de configurar o Google Sheets.

## Executando

```bash
uvicorn app.main:app --reload
```

Acesse no navegador: <http://127.0.0.1:8000>

Para executar a API em rede local e abrir em um celular:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Sincronização bidirecional

- Um ciclo de sincronização roda em segundo plano a cada `SYNC_INTERVAL_SECONDS` segundos.
- **Regra de conflito ("última escrita vence"):** compara o campo `atualizado_em`
  (timestamp) de cada registro. O valor mais recente — do app ou de uma edição
  manual na planilha — é aplicado nos dois lados.
- Edições manuais feitas direto na planilha são **importadas** automaticamente.
- **Observação:** as alterações feitas no app são enviadas para a planilha no
  próximo ciclo de polling (padrão de 20s), não instantaneamente.

## Estrutura de abas da planilha

| Aba | Colunas |
|---|---|
| `Participantes` | `id`, `nome`, `nivel`, `status`, `criado_em`, `atualizado_em` |
| `Times` | `id`, `nome`, `jogadores`, `nivel_medio`, `atualizado_em` |
| `Partidas` | `id`, `time_a_id`, `time_b_id`, `placar_a`, `placar_b`, `status_partida`, `atualizado_em` |

As abas são criadas automaticamente na primeira execução.

## Testes

```bash
pytest
```

## Estrutura do projeto

```
app/
  config.py        # leitura de .env e escopos
  models.py        # modelos de domínio e colunas das abas
  repo.py          # contrato de repositório + implementação em memória
  sheets_repo.py   # integração com Google Sheets (gspread)
  sync.py          # sincronização bidirecional ("última escrita vence")
  services.py      # regras de negócio (participantes, times, partidas)
  runtime.py       # fiação de repositórios/serviços/sincronização
  main.py          # API FastAPI + serve do frontend
static/            # frontend (HTML/CSS/JS)
tests/             # testes unitários e de API
Dockerfile         # imagem do deploy
render.yaml        # blueprint de deploy do Render
PROGRESSO.md       # histórico das fases e decisões
```

## Deploy (Render)

O app é um servidor Python sempre ativo (mantém estado em memória e uma thread
de sincronização). Por isso, usa-se um host **não-serverless**, como o Render.

1. **Crie o repositório no GitHub** (privado recomendado) e envie este projeto.
2. No Render, em **New > Blueprint Instance**, conecte o repositório — o Render
   detecta o `render.yaml` automaticamente.
3. Defina as variáveis de ambiente no painel (Render > Web Service > Environment):
   - `GOOGLE_SHEETS_ID` — ID da planilha.
   - `GOOGLE_SERVICE_ACCOUNT_INFO` — o JSON completo da conta de serviço (string).
   - `SYNC_INTERVAL_SECONDS` — opcional, padrão 20.
4. O Render constrói via `Dockerfile` e faz deploy. Use a URL gerada (ex.:
   `https://volei-djalmer.onrender.com`) e confira `/api/health` → `"env":"sheets"`.
5. Lembre-se de compartilhar a planilha com o e-mail da conta de serviço.

> **Importante:** o Dockerfile executa **um único worker/processo**. Não altere
> para múltiplos workers, pois o estado em memória e a thread de sincronização
> exigem processo único.

## Segurança (lembrete importante)

- A conta de serviço tem escopo **somente** em `https://www.googleapis.com/auth/spreadsheets`.
  Ela **não** tem acesso amplo ao Google Drive.
- As credenciais ficam **fora** do repositório: o `.env` e o JSON da conta de serviço
  estão no `.gitignore`. Nunca os versione.
- Ao terminar de usar, **revogue ou rotacione** a chave da conta de serviço no
  Google Cloud Console para não deixar credenciais ativas em aberto.
- Reveja o arquivo `.env` periodicamente e não o compartilhe.