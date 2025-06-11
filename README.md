# node-red-contrib-galaxy-sia

Node-RED SIA DC-09 integration for Honeywell Galaxy Dimension.

## Funkce

- Přijímá SIA DC-09 zprávy z Galaxy Dimension panelu přes TCP.
- Mapování čísel zón, uživatelů a oblastí na názvy pro lepší přehlednost ve výstupech.
- Možnost dynamicky načítat mapování zón, uživatelů a oblastí z externího JSON souboru.
- Flexibilní možnosti ACK odpovědí (včetně vlastních a DC-09 kompatibilních).
- Heartbeat, robustní TCP server, ošetření chyb.
- Debug/logování a bezpečnostní limity počtu spojení.

---

## Použití

1. Přidejte do Node-RED konfigurační node `galaxy-sia-config`.
2. Vyplňte IP adresu a port Galaxy panelu, číslo účtu a další volitelné parametry.
3. Pro statické mapování zadejte mapování zón/uživatelů/oblastí jako JSON.
4. **Pro dynamické mapování** zadejte cestu k externímu JSON souboru (např. `/data/sia-zone-map.json`) do pole „Cesta k externímu mapování“ (nová volba).

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

## Dynamické načítání mapování

Pokud je v konfiguraci vyplněna cesta k externímu JSON souboru s mapováním, bude tento soubor načítán při každé zprávě (lze nasadit např. v Dockeru s bind-mountem nebo na síťový disk).  
Struktura JSON souboru:
```json
{
  "zoneMap": {
    "1": "Sklad",
    "2": "Kancelář"
  },
  "userMap": {
    "007": "Petr Novák"
  },
  "areaMap": {
    "1": "Hala"
  }
}
```
Pokud soubor není dostupný nebo je nevalidní, použije se statické mapování z konfigurace node.

---

## Chybové stavy a jejich řešení

- **Chyba "Chyba při zpracování zprávy: ..." v debug logu**  
  Zkontrolujte formát příchozí SIA zprávy a nastavení šifrování.

- **Nezobrazují se zoneName/userName/areaName**  
  Ujistěte se, že v konfiguraci je správný JSON pro mapování nebo že cesta k externímu mapování je správná a soubor obsahuje odpovídající klíče.

- **Zprávy se ignorují**  
  Ověřte, že pole `account` v konfiguraci odpovídá účtu ve zprávě z ústředny Galaxy.

- **"Překročen maximální počet spojení"**  
  TCP server odmítl nové spojení, protože bylo dosaženo limitu (viz MAX_CONNECTIONS v kódu).

---

## Troubleshooting

- Debug logy jsou dostupné v Node-RED logu.
- V případě pádu/parsing erroru se zpráva objeví ve druhém výstupu nodu s popisem chyby.
- Vždy validujte JSON mapování v konfiguračním node.
