# Vôlei Djalmer

App para o organizador do vôlei, usado no celular: mantém a Lista Master de
atletas, marca a presença do dia e sorteia 4 times equilibrados.

É um site estático (HTML, CSS e JavaScript puro, sem build e sem backend).
Os dados ficam no navegador do celular (`localStorage`). Para levar a lista
para outro aparelho ou guardar um backup, use a mensagem de WhatsApp.

## Telas

- **Lista Master**: atletas agrupados por pote, na ordem C1, M1, M2, LM1, F1,
  F2, LF1. A ordem dentro de cada pote é o ranking (arraste pela alça ou use as
  setas). Toque no atleta para editar sexo, pote, potes adicionais e apelidos.
  O ícone de alianças abre os casais (vazios por padrão). *Exportar lista* gera
  a mensagem; *Importar lista* substitui a lista pela da mensagem, com prévia.
- **Lista**: os 24 confirmados do dia. Cole a mensagem do grupo (lê do primeiro
  "1." até "Do grupo", "Espera" ou "Convidados", aceita numeração que recomeça
  e ignora ✅ e "(convidado)") ou toque nos nomes. Nomes desconhecidos podem ser
  vinculados a um atleta (viram apelido) ou cadastrados.
- **Times**: sorteia com exatamente 24 confirmados, envia os times no WhatsApp,
  desfaz o último sorteio e aceita colar de volta a mensagem de times.
- **Presença**: chegada na quadra. Quando os 6 de um time chegam, o time recebe
  1º, 2º, 3º ou 4º em quadra, na ordem em que ficou completo.

## Regras do sorteio

- 6 potes: 4 C1, 4 levantadores (LM1/LF1), 4 M1, 4 F1 e 8 no bloco M2/F2.
- Os potes adicionais permitem que um atleta preencha outro pote.
- Cada time recebe 1 C1 e 1 levantador, pareando opostos do ranking.
- M1, F1, M2 e F2 são sorteados equilibrando as mulheres entre os times.
- Com "Manter casais juntos" (tela de casais na Lista Master), cada casal ativo
  cai no mesmo time.
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

O número é a posição na lista, `(M)`/`(F)` é o sexo, `+X` são os potes
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
