// Dados de teste: 24 atletas que fecham exatamente os potes.

export function rngSemente(semente) {
  // mulberry32: aleatório determinístico para testes reproduzíveis.
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function vinteQuatro() {
  const grupos = [
    ["C1", "M", 2], ["C1", "F", 2], ["LM1", "M", 2], ["LF1", "F", 2],
    ["M1", "M", 4], ["F1", "F", 4], ["M2", "M", 4], ["F2", "F", 4],
  ];
  const atletas = [];
  grupos.forEach(([pote, sexo, quantidade]) => {
    for (let i = 1; i <= quantidade; i++) {
      atletas.push({ id: `${pote}-${sexo}-${i}`, nome: `${pote} ${sexo}${i}`, sexo, pote, potesAdicionais: [], aliases: [] });
    }
  });
  return atletas.map((a, indice) => ({ ...a, ranking: indice + 1 }));
}
