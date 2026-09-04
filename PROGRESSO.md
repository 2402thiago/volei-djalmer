# PROGRESSO — Sistema de Gestão de Torneio de Vôlei

> Atualizado continuamente. Este arquivo garante continuidade caso a sessão seja
> interrompida por limite de contexto ou de requisições do provedor gratuito.

---

## Estado atual

- **Fases concluídas:** Fase 0, 1, 2, 3, 4, 5 — **projeto concluído.**
- **Integração real com Google Sheets configurada e validada.**
- **Deploy (em andamento):** refatorado para **Vercel** (modelo serverless, fonte única = Sheets). Preparando commit + push + deploy.

---

## Deploy — GitHub + Vercel (EM ANDAMENTO)

### Mudança de arquitetura (Fonte única = Google Sheets)
- O Vercel é serverless (sem estado em memória nem thread em 2º plano). Refatorado para:
  - A planilha é a **única fonte de verdade**; cada requisição lê/escreve direto nela.
  - `app/sheets_repo.py`: novo `SheetBackedRepo` (implementa `Repositorio`) lendo/escrevendo em tempo real.
  - `app/runtime.py`: simplificado, sem thread/sync loop; `ativar_sheets()` troca memória→Sheets; `reiniciar()` para testes.
  - `app/main.py`: lifespan só conecta ao Sheets; removido `/api/sync/log`; health usa `runtime.modo`.
  - `static/app.js`: polling de recarga a cada 30s (em vez de `/api/sync/log`).
  - `app/services.py`, `repo.py`, `sync.py`: mantidos (testes continuam válidos).
- Validado: **31/31 testes**; write stateless → planilha; releitura da planilha; limpeza OK.

### Arquivos de deploy (Vercel)
- `vercel.json` (rota `/(.*)` → função Python), `api/index.py` (expõe o app ASGI), `.vercelignore`.
- Removidos `Dockerfile` e `render.yaml` (não usados no Vercel).
- `README.md` atualizado (seção Vercel + modelo de dados).

### Já feito antes (base)
- Credenciais por env var (`GOOGLE_SERVICE_ACCOUNT_INFO`), repo local com branch `main`, remote `origin` configurado.

### BLOQUEIO ANTERIOR (resolvido)
- `github.com:443` ficou inalcançável num momento (transitório); voltou a funcionar. Nenhum bloqueio real.

### Próximo passo
1. `git add -A` + commit.
2. `gh repo create volei-djalmer --private --source . --remote origin --push`.
3. `vercel` (link) + `vercel env add` (GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_INFO) + `vercel --prod`.
4. Validar `/api/health` → `"env":"sheets"`.

---

## Fase 0 — Levantamento e proposta de arquitetura (APROVADA)

### Decisões tomadas

| Tema | Decisão |
|---|---|
| Conflito de sincronização | Última escrita vence (comparação de timestamp por linha) |
| Nível de habilidade | Inteiro de 1 (iniciante) a 5 (avançado) |
| Times por torneio | Variável, definido pelo usuário ao montar |
| Stack | Backend FastAPI; integração com gspread; frontend HTML/CSS/JS mobile-first |
| Estrutura de abas | Participantes, Times, Partidas, `_Meta` |
| Sincronização | Polling 15–30s configurável; detecção por `atualizado_em` por linha |
| Telas | Dashboard/Times, Participantes, Partida em andamento, Histórico/Placar |
| Segurança | Service account com escopo restrito a `spreadsheets`; credencial via `.env` |

### Abas da planilha

**Participantes:** `id`, `nome`, `nivel`, `status`, `criado_em`, `atualizado_em`
**Times:** `id`, `nome`, `jogadores` (IDs separados por vírgula), `nivel_medio`
**Partidas:** `id`, `time_a_id`, `time_b_id`, `placar_a`, `placar_b`, `status_partida`, `atualizado_em`
**`_Meta`:** versão do esquema, nomes das abas, hash/versão global de detecção de mudanças

### Pendências
- Python não instalado na máquina (usuário se responsabilizou em instalar e avisar).

---

## Fase 1 — Modelagem de dados (APROVADA)

### Esquema de abas (confirmado)

**Participantes:** `id` (PK, UUID), `nome`, `nivel` (int 1–5), `status` (`ativo`/`inativo`), `criado_em` (ISO), `atualizado_em` (ISO)
**Times:** `id` (PK, UUID), `nome`, `jogadores` (IDs separados por vírgula), `nivel_medio` (decimal, cache)
**Partidas:** `id` (PK, UUID), `time_a_id` (FK), `time_b_id` (FK), `placar_a` (int ≥0), `placar_b` (int ≥0), `status_partida` (`agendado`/`em_andamento`/`concluida`), `atualizado_em` (ISO)
**`_Meta`:** `chave` (PK, texto) + `valor` (texto) — versão do esquema, lista de abas

### Algoritmo de balanceamento (confirmado)

- Prioridade: **equilibrar nível médio** dos times.
- *Snake draft*: ordenar por `nivel` decrescente, distribuir em zigue-zague entre N times.
- Exemplo N=2, níveis [5,4,4,3,3,2]: T1=[5,3,3] média 3.67, T2=[4,4,2] média 3.33.

### Decisões adicionais
- Chaves em UUID para evitar colisão com edição manual.
- Sincronização por `atualizado_em` por linha.

### Pendências
- Python ainda não instalado (aguardando usuário).

---

## Fase 2 — Camada de integração com Google Sheets (APROVADA)

### O que foi feito
- **Ambiente:** Python 3.12.10 instalado via winget; venv `.venv` criado; dependências instaladas (`fastapi`, `uvicorn`, `gspread`, `google-auth`, `python-dotenv`, `pytest`).
- **Arquivos criados:**
  - `app/config.py` — leitura de `.env`, escopo restrito a `spreadsheets`.
  - `app/models.py` — modelos `Participante`, `Time`, `Partida`; colunas das abas; conversão linha ↔ modelo.
  - `app/repo.py` — contrato `Repositorio` + `RepositorioMemoria` (para testes).
  - `app/sheets_repo.py` — repositório gspread de produção (ler/escrever/remover linhas, criar abas e cabeçalhos).
  - `app/sync.py` — `mesclar()` (regra "última escrita vence") + `Sincronizador`.
  - `tests/test_sync.py` — 9 testes unitários.
  - `requirements.txt`, `.env.example`, `.gitignore`.
- **Decisão:** adicionado `atualizado_em` à aba `Times` para viabilizar a resolução "última escrita vence" em todas as abas.

### Testes
- **9/9 passando** (`pytest`). Cobrem push, pull de edição manual, conflito por timestamp, empate e idempotência.
- Dois bugs iniciais eram nos testes (dados malformados e asserção incorreta), não na lógica.

### Pendências
- Integração real com a planilha exige credenciais de service account (`GOOGLE_SERVICE_ACCOUNT_JSON`) e ID da planilha (`GOOGLE_SHEETS_ID`) no `.env` — a ser fornecido/validado pelo usuário.
- Limitação conhecida: exclusão de registros não é propagada de forma bidirecional (exige tombstones); atual exclusão só é propagada do app para a planilha quando o app remove a linha.

---

## Fase 3 — Lógica de negócio (APROVADA)

### O que foi feito
- `app/services.py` com:
  - `ServicoParticipantes` — criar, listar (ignora inativos), editar nome/nível, alterar status; validações (nome ≤ 80, nível 1–5).
  - `balancear_times()` — *snake draft*: ordena por nível decrescente e distribui em zigue-zague; prioriza equilíbrio do nível médio.
  - `ServicoTimes` — `montar(num_times)` persiste times (substitui anteriores); `composicao()` retorna time + jogadores.
  - `ServicoPartidas` — criar, listar por status, alterar status, `pontuar()` (+1/-1, sem placar negativo).
  - `classificacao()` — tabela por pontos/vitórias/sets a partir de partidas concluídas.

### Decisões
- Classificação: vitória = 3 pontos; empate não atribui pontos (regra simples de vôlei amador).

### Testes
- **26/26 passando** (9 de sync + 17 novos de negócio).

### Pendências
- Nenhuma nova. (Seguem as de credenciais da Fase 2.)

---

## Fase 4 — Interface (APROVADA)

### O que foi feito
- `app/runtime.py` — fiação: repositórios em memória (padrão, roda sem credenciais) ou Google Sheets (se configurado); ciclo de sincronização em segundo plano (`thread` + polling); método `reiniciar()` para testes.
- `app/main.py` — API FastAPI JSON (`/api/participantes`, `/api/times`, `/api/partidas`, `/api/classificacao`, `/api/sync/log`, `/api/health`) + serve o frontend estático.
- `static/index.html`, `static/style.css`, `static/app.js` — frontend mobile-first com 4 telas (Times/Dashboard, Participantes, Partida, Histórico), estética de cards (inspirada na referência), indicador de sincronização e navegação inferior.
- `tests/test_api.py` — testes da API com TestClient.
- Adicionada dependência de teste `httpx`.

### Validação
- Servidor iniciado e fluxo completo testado via API: criação de participantes → montagem de times balanceados (média 3.17 vs 3.0, 6 jogadores cada) → partida → placar → conclusão → classificação.

### Testes
- **31/31 passando** (9 sync + 17 negócio + 5 API).

### Pendências
- Integração real com Google Sheets depende das credenciais do usuário (Fase 5).

---

## Fase 5 — Integração final e documentação (CONCLUÍDA)

### O que foi feito
- `README.md` em português: descrição, funcionalidades, stack, instalação, passo a passo
  de configuração do Google Sheets (conta de serviço), modos de execução, sincronização,
  estrutura do projeto e revisão de segurança.
- `.gitignore` ampliado para cobrir `credenciais/` e JSONs de service account.
- Validação final: servidor sobe limpo, `/api/health` ok, `/` serve o frontend (UTF-8);
  suíte de testes completa **31/31 passando**.

### Revisão de segurança (realizada)
- Escopo da service account: apenas `https://www.googleapis.com/auth/spreadsheets` (em `app/config.py`).
- Credenciais e `.env` fora do repositório (`.gitignore`).
- Lembrete ao usuário: revogar/rotacionar a chave da service account após o uso.

### Pendências / próximos passos
- ~~Configurar credenciais reais~~ **FEITO**: `.env` aponta para `./credenciais/sheets.json`
  (project `djalmer`) e `GOOGLE_SHEETS_ID=1_WqthJyyrtfBMNgMmDwg2MtyIAGrTVLKl5cTNuo5ZG4`.

### Integração real validada (Google Sheets)
- Conexão com a planilha "Djalmer" OK; abas `Participantes`, `Times`, `Partidas` criadas automaticamente.
- Sincronização bidirecional testada ao vivo: push local→planilha e pull de edição manual
  planilha→app (regra "última escrita vence" com timestamps reais) — **OK**.
- Servidor FastAPI conecta no startup (`lifespan`) e inicia o sync em 2º plano (`/api/health` → `env: sheets`).
- Observação: o push para a planilha ocorre no ciclo de polling (padrão 20s), não instantaneamente.

### Lembrete de segurança
- A service account tem escopo apenas de planilhas. Como o JSON foi colado no chat, recomenda-se
  **revogar/rotacionar a chave** no Google Cloud Console após finalizar a configuração.

---

## Fim das fases

Todas as 6 fases (0–5) foram concluídas e validadas. Ver `README.md` para executar.

---

## Como registrar uma nova fase concluída

1. Atualizar "Estado atual".
2. Criar uma nova seção com: o que foi feito, decisões, pendências e o próximo passo.
3. Marcar a fase concluída no check-list.