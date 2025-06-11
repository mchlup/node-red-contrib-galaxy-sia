# node-red-contrib-galaxy-sia

Node-RED SIA DC-09 integration for Honeywell Galaxy Dimension.

## Funkce

- Přijímá SIA DC-09 zprávy z Galaxy Dimension panelu přes TCP.
- Mapování čísel zón, uživatelů a oblastí na názvy pro lepší přehlednost ve výstupech.
- Flexibilní možnosti ACK odpovědí (včetně vlastních a DC-09 kompatibilních).
- Heartbeat, robustní TCP server, ošetření chyb.
- Debug/logování a bezpečnostní limity počtu spojení.

---

## Použití

1. Přidejte do Node-RED konfigurační node `galaxy-sia-config`.
2. Vyplňte IP adresu a port Galaxy panelu, číslo účtu a další volitelné parametry.
3. Zadejte mapování zón, uživatelů a oblastí ve formátu JSON:

```json
{
  "1": "Sklad",
  "2": "Kancelář"
}
```

4. Připojte `galaxy-sia-in` node a v jeho konfiguraci zvolte výše vytvořený config node.

---

## Výstupní payload

**Základní výstup:**
```json
{
  "zone": "1",
  "zoneName": "Sklad",
  "user": "007",
  "userName": "Petr Novák",
  "area": "1",
  "areaName": "Hala",
  "event": "OPN",
  "ack": "<ACK packet>",
  "raw": "<původní SIA zpráva>",
  ...
}
```

---

## Chybové stavy a jejich řešení

- **Chyba "Chyba při zpracování zprávy: ..." v debug logu**  
  Zkontrolujte formát příchozí SIA zprávy a nastavení šifrování.

- **Nezobrazují se zoneName/userName/areaName**  
  Ujistěte se, že v konfiguraci je správný JSON pro mapování a klíče odpovídají číselné hodnotě ve zprávě.

- **Zprávy se ignorují**  
  Ověřte, že pole `account` v konfiguraci odpovídá účtu ve zprávě z ústředny Galaxy.

- **"Překročen maximální počet spojení"**  
  TCP server odmítl nové spojení, protože bylo dosaženo limitu (viz MAX_CONNECTIONS v kódu).

---

## Troubleshooting

- Debug logy jsou dostupné v Node-RED logu.
- V případě pádu/parsing erroru se zpráva objeví ve druhém výstupu nodu s popisem chyby.
- Vždy validujte JSON mapování v konfiguračním node.

---

## Přispění

- Pull-requesty s novými protokoly, vylepšeními mapování, testy nebo integrací MQTT/webhook vítány!
- Pro návrhy a nahlášení chyb použijte Issues na GitHubu.

---
