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

## Organização de eventos

A aba **Organização** cria eventos persistidos na mesma planilha. O backend cria, sem apagar nenhuma aba existente, as abas `OrganizacaoEventos`, `OrganizacaoInscricoes`, `OrganizacaoConvidados`, `OrganizacaoComissoes` e `OrganizacaoComprovantes`. A aba existente `Acessos` continua sendo a lista global de criadores autorizados (`email`, `ativo`, com `sim`).

Configure a conta de serviço somente no servidor com `GOOGLE_SHEETS_ID` e `GOOGLE_SERVICE_ACCOUNT_JSON` (ou `GOOGLE_SERVICE_ACCOUNT_INFO`) para a planilha. Os comprovantes são criados no Google Drive da pessoa que os envia, usando OAuth, e compartilhados somente com a conta de serviço para o download privado da comissão. Habilite as APIs Google Sheets e Google Drive.

Para login de identidade, habilite Google OAuth e cadastre exatamente `GOOGLE_OAUTH_REDIRECT_URI` como redirect URI autorizado no Google Cloud:

```env
GOOGLE_OAUTH_ENABLED=true
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://seu-dominio/auth/callback
GOOGLE_OAUTH_SESSION_SECRET=uma-string-longa-aleatoria
```

Ao entrar novamente, o Google pedirá a permissão para criar comprovantes no Drive da pessoa autenticada. A autorização é mantida cifrada na sessão `HttpOnly`; os comprovantes não recebem link público.

O fluxo é authorization-code OAuth, com cookie de sessão `HttpOnly`, `SameSite=Lax` e `Secure` fora de `APP_ENV=local`. A página pública isolada é `/lista/{slug}` e mostra somente nomes, nunca e-mails, nas listas Principal, Espera Grupo e Convidados. Ela inclui valor, PIX, botão para verificar a lista atual e o compartilhamento WhatsApp com a lista numerada e confirmações `✅`. Inscrições usam a identidade Google e não podem se repetir por evento. JPG, PNG e PDF válidos de até 5 MB são aceitos para comprovantes.

### Acessos e OAuth futuro

A planilha pode conter a aba `Acessos`, preservada ao conectar ou reinicializar
`Nivelamento`. Ela deve ter as colunas `email` e `ativo`; somente linhas com
`ativo` igual a `sim` concederão acesso quando o login OAuth for ativado.

```text
email | ativo
organizadora@exemplo.com | sim
```

Enquanto `GOOGLE_OAUTH_ENABLED=false`, o login Google não é usado. Quando ele
for implementado, configure no Vercel `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` e
`GOOGLE_OAUTH_SESSION_SECRET`. Os usuários só autenticarão sua identidade;
a conta de serviço continuará sendo a única credencial com acesso à planilha.

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

## Sincronização com o Google Sheets

A planilha é a **fonte única de verdade**:

- Mudanças feitas no app vão **direto** para a planilha (escritas imediatas).
- Mudanças feitas manualmente na planilha aparecem no app na próxima atualização
  da tela (o frontend recarrega as listas a cada 30s).
- Como existe uma única cópia dos dados, não há conflito de merge entre cópias
  locais e remotas.

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
  sync.py          # sincronização (merge "última escrita vence")
  services.py      # regras de negócio (participantes, times, partidas)
  runtime.py       # fiação de repositórios/serviços
  main.py          # API FastAPI + serve do frontend
api/index.py       # ponto de entrada do deploy no Vercel
static/            # frontend (HTML/CSS/JS)
tests/             # testes unitários e de API
vercel.json        # configuração de deploy do Vercel
PROGRESSO.md       # histórico das fases e decisões
```

## Deploy (Vercel)

O app foi adaptado para o modelo **serverless**: a planilha do Google Sheets é a
**única fonte de verdade** e cada requisição lê/escreve diretamente nela (sem
estado local nem thread em segundo plano). O frontend recarrega as listas a cada
30s para refletir edições manuais feitas na planilha.

1. **Crie o repositório no GitHub** (privado recomendado) e envie este projeto.
2. Instale o CLI do Vercel e faça login:
   ```bash
   npm i -g vercel
   vercel login
   ```
3. Defina as variáveis de ambiente no projeto (via `vercel env add` ou no painel):
   - `GOOGLE_SHEETS_ID` — ID da planilha.
   - `GOOGLE_SERVICE_ACCOUNT_INFO` — o JSON completo da conta de serviço (string).
   - `SYNC_INTERVAL_SECONDS` — opcional (não é mais usado em runtime).
4. Faça o deploy:
   ```bash
   vercel            # preview
   vercel --prod     # produção
   ```
5. Acesse a URL gerada e confira `/api/health` → `"env":"sheets"`.
6. Lembre-se de compartilhar a planilha com o e-mail da conta de serviço.

> **Sobre o modelo de dados:** como a planilha é a fonte única, mudanças feitas
> manualmente nela aparecem no app na próxima atualização da tela (polling de 30s),
> e mudanças feitas no app vão direto para a planilha.

## Segurança (lembrete importante)

- A conta de serviço tem escopo **somente** em `https://www.googleapis.com/auth/spreadsheets`.
  Ela **não** tem acesso amplo ao Google Drive.
- As credenciais ficam **fora** do repositório: o `.env` e o JSON da conta de serviço
  estão no `.gitignore`. Nunca os versione.
- Ao terminar de usar, **revogue ou rotacione** a chave da conta de serviço no
  Google Cloud Console para não deixar credenciais ativas em aberto.
- Reveja o arquivo `.env` periodicamente e não o compartilhe.
