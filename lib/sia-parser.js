// Jednoduchý skeleton pro SIA parser.
// POZOR: TOTO JE JEN DEMO! Implementujte skutečné parsování SIA DC-09 protokolu podle potřeby.

module.exports = function(raw, siaLevel) {
    // Pro test: simulace výstupu
    return {
        account: "000001",
        code: "BA",
        zone: 1,
        timestamp: Date.now(),
        description: "Simulovaná SIA zpráva",
        raw: raw
    };
};
