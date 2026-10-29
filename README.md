# Vôlei Djalmer

App para o organizador do vôlei, usado no celular: mantém a Lista Master de
atletas, marca a presença do dia e sorteia 4 times equilibrados.

É um site estático (HTML, CSS e JavaScript puro, sem build e sem backend).
Os dados ficam no navegador do celular (`localStorage`). Para levar a lista
para outro aparelho ou guardar um backup, use a mensagem de WhatsApp.

## Telas

- **Lista Master**: atletas com sexo, pote principal, potes adicionais e
  apelidos. A ordem da lista é o ranking (arraste pela alça ou use ▲▼).
  Também guarda os casais. *Exportar lista* gera a mensagem; *Importar lista*
  substitui a lista pela da mensagem, mostrando uma prévia antes.
- **Presença**: cole a lista de confirmados do grupo (lê os primeiros 24 até
  "Espera Grupo" ou "Convidados") ou toque nos nomes. Nomes desconhecidos podem
  ser vinculados a um atleta (viram apelido) ou cadastrados.
- **Times**: sorteia com exatamente 24 presentes, envia os times no WhatsApp e
  permite desfazer o último sorteio.

## Regras do sorteio

- 6 potes: 4 C1, 4 levantadores (LM1/LF1), 4 M1, 4 F1 e 8 no bloco M2/F2.
- Os potes adicionais permitem que um atleta preencha outro pote.
- Cada time recebe 1 C1 e 1 levantador, pareando opostos do ranking.
- M1, F1, M2 e F2 são sorteados equilibrando as mulheres entre os times.
- Com "Manter casais juntos", cada casal ativo cai no mesmo time.
- O time recebe o nome do seu C1.

## Mensagem da Lista Master

```
*Lista Master - Vôlei Djalmer*

*C1*
1. João (M) +M1 [Joãozinho]
4. Ana (F)

*M1*
2. Pedro (M)

*Casais*
João & Ana
```

O número é o ranking geral, `(M)`/`(F)` é o sexo, `+X` são os potes
adicionais e `[...]` são os outros nomes usados na lista do grupo.

## Desenvolvimento

```bash
npx serve .          # ou: python -m http.server
npm test             # node --test, sem dependências
```

Código em `js/`: `sorteio.js` (regras do sorteio), `mensagem.js` (mensagens de
WhatsApp), `dados.js` (estado, persistência e migração do app anterior) e
`main.js` (interface).

Na primeira abertura, os dados do app anterior (chaves `volei.*`) são
convertidos automaticamente e uma cópia intacta fica em `djalmer.backup.v1`.

## Deploy

Vercel, como site estático (`vercel.json` sem build).
