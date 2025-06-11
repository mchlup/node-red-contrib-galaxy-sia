# node-red-contrib-galaxy-sia

Node-RED integrace pro Honeywell Galaxy Dimension alarm panel využívající protokol SIA DC-09.

## Popis
Tento Node-RED modul poskytuje integraci s alarmovým systémem Honeywell Galaxy Dimension prostřednictvím protokolu SIA DC-09. Umožňuje příjem a odesílání zpráv, ovládání panelu a monitorování událostí.

## Funkce
- Podpora SIA DC-09 protokolu
- AES-128 šifrování
- Automatické generování a validace CRC
- Zpracování příchozích událostí
- Odesílání příkazů na panel
- Konfigurovatelné ACK odpovědi
- Stavové informace uzlů
- Filtrování testovacích zpráv

## Instalace
```bash
npm install node-red-contrib-galaxy-sia
```

## Dostupné Nody

### 1. galaxy-sia-config
Konfigurační uzel pro nastavení připojení k panelu Galaxy.

Parametry:
- Panel IP: IP adresa panelu
- Panel Port: Komunikační port (výchozí: 10002)
- Account: Identifikátor účtu
- SIA Level: Úroveň SIA protokolu (1-4)
- Encryption: Povolení AES šifrování
- Encryption Key: 16znakový šifrovací klíč
- Key in HEX: Formát klíče (text/HEX)
- Discard Test Messages: Filtrování testovacích zpráv
- ACK Type: Typ potvrzovací odpovědi
- Custom ACK: Vlastní formát potvrzení
- Periodic Report Interval: Interval pravidelných reportů

### 2. galaxy-sia-in
Příjímá události z panelu Galaxy.

Výstup:
- Payload obsahující dekódovanou SIA zprávu
- Validace CRC
- Automatické potvrzování (ACK)
- Filtrování podle účtu

### 3. galaxy-sia-out
Odesílá příkazy na panel Galaxy.

Podporované příkazy:
- Arm (Aktivace)
- Disarm (Deaktivace)
- Bypass (Přemostění zón)
- Restore (Obnovení zón)
- PGM (Ovládání výstupů)

## SIA DC-09 Protokol

### CRC Validace
- Implementace standardního SIA CRC podle specifikace DC-09 (x^16 + x^12 + x^5 + 1)
- Automatické generování CRC při odesílání
- Validace CRC u přijatých zpráv
- Pole `crcOk` v parsovaných zprávách indikuje stav CRC

### Šifrování
- Podpora AES-128 šifrování dle SIA DC-09
- Konfigurovatelný šifrovací klíč (text/HEX)
- Šifrovaná komunikace mezi Node-RED a panelem

## Použití

### Příklad konfigurace:
1. Přidejte uzel `galaxy-sia-config`
2. Nastavte IP adresu a port panelu
3. Zadejte identifikátor účtu
4. Volitelně nakonfigurujte šifrování a další parametry

### Příjem událostí:
1. Přidejte uzel `galaxy-sia-in`
2. Propojte s konfigračním uzlem
3. Události budou dostupné v payload výstupu

### Odesílání příkazů:
1. Přidejte uzel `galaxy-sia-out`
2. Propojte s konfigračním uzlem
3. Odešlete zprávu s příkazem ve formátu:
```javascript
msg.command = "arm"; // nebo jiný podporovaný příkaz
msg.params = ["1"]; // parametry příkazu
```

## Odkazy
- [SIA DC-09-2021 Standard](https://www.siaonline.org/standards/)
- [Honeywell Galaxy Dimension Engineering Guide](https://www.security.honeywell.com/)
- [Testovací nástroj: Evalink Virtual Receiver](https://documentation.evalink.io/talos/admin/work-with-integrations/alarm-transmitter-integrations/overview-alarm-transmitter-integrations/)

## Licence
MIT

## Autor
Vytvořil mchlup
Poslední aktualizace: 2025-06-11
