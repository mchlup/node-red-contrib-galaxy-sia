// Node-RED konfigurační node pro Galaxy SIA DC-09
module.exports = function(RED) {
  function GalaxySIAConfigNode(n) {
    RED.nodes.createNode(this, n);

    // Základní parametry
    this.account = n.account || "";
    this.userId = n.userId || "";
    this.userCode = n.userCode || "";
    this.panelIP = n.panelIP || "";
    this.panelPort = Number(n.panelPort) || 10002;
    this.siaLevel = Number(n.siaLevel) || 4;

    // Dynamické načítání mapování
    this.externalMappingPath = n.externalMappingPath || "";

    // Mapování entit (parse JSON, pokud je validní)
    try { this.zoneMap = n.zoneMap ? JSON.parse(n.zoneMap) : {}; } catch(e) { this.zoneMap = {}; }
    try { this.userMap = n.userMap ? JSON.parse(n.userMap) : {}; } catch(e) { this.userMap = {}; }
    try { this.areaMap = n.areaMap ? JSON.parse(n.areaMap) : {}; } catch(e) { this.areaMap = {}; }

    // Šifrování
    this.encryption = n.encryption === true || n.encryption === "true";
    this.encryptionKey = n.encryptionKey || "";
    this.encryptionHex = n.encryptionHex === true || n.encryptionHex === "true";

    // Další volby
    this.connectOnDemand = n.connectOnDemand === true || n.connectOnDemand === "true";
    this.heartbeatInterval = Number(n.heartbeatInterval) || 60;
    this.periodicReportInterval = Number(n.periodicReportInterval) || 0;
    this.discardTestMessages = n.discardTestMessages === true || n.discardTestMessages === "true";
    this.deviceList = n.deviceList || "";

    // ACK handshake – defaultně echo bez CRLF
    this.ackType = n.ackType || "ECHO_TRIM_END";
    this.ackCustom = n.ackCustom || "";

    // Debug flag
    this.debug = n.debug === true || n.debug === "true";
  }
  RED.nodes.registerType("galaxy-sia-config", GalaxySIAConfigNode);
};
