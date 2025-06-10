## SIA CRC

Tento plugin podporuje standardní SIA CRC podle specifikace SIA DC-09 (x^16 + x^12 + x^5 + 1).  
CRC je automaticky generováno při odesílání příkazů a validováno u přijatých zpráv.

- Všechny SIA DC-09 kompatibilní ústředny (Honeywell Galaxy, DSC, UTC, atd.) tímto ověří integritu dat.
- Ve výstupu z parseru najdete pole `crcOk` (true/false/null), které indikuje správnost CRC.

**Poznámka:** Pokud panel používá šifrování (AES), lze parser i command rozšířit (napište mi, připravím podporu).

---

### Odkazy

- SIA DC-09 standard: [SIA DC-09-2021](https://www.siaonline.org/standards/)
- Honeywell Galaxy Dimension Engineering Guide
- Testovací nástroj: [Evalink Virtual Receiver](https://documentation.evalink.io/talos/admin/work-with-integrations/alarm-transmitter-integrations/overview-alarm-transmitter-integrations/)
