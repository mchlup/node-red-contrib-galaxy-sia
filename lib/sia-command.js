// Skeleton pro generátor SIA příkazů (pro ovládání panelu).
// POZOR: TOTO JE JEN DEMO! Implementujte skutečné SIA příkazy dle DC-09.

module.exports = function(account, command, group, encryption, key, hex) {
    // Vrátí simulovaný SIA příkaz v textu
    // Příklad: "<account>|<command>|<group>"
    return `${account}|${command}|${group||""}`;
};
