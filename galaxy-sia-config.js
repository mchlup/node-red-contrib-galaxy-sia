// Node-RED konfigurační node pro Galaxy SIA DC-09
module.exports = function(RED) {
  function GalaxySIAConfigNode(n) {
    RED.nodes.createNode(this, n);

    // Základní parametry
    this.account = n.account || "";
    this.panelIP = n.panelIP || "";
    this.panelPort = Number(n.panelPort) || 10002;
    this.siaLevel = Number(n.siaLevel) || 4;

    // Šifrování
    // Podporuje jak string, tak HEX (pro AES-128)
    this.encryption = n.encryption === true || n.encryption === "true";
    this.encryptionKey = n.encryptionKey || "";
    this.encryptionHex = n.encryptionHex === true || n.encryptionHex === "true";

    // Další volby
    this.connectOnDemand = n.connectOnDemand === true || n.connectOnDemand === "true";
    this.heartbeatInterval = Number(n.heartbeatInterval) || 60;
    this.periodicReportInterval = Number(n.periodicReportInterval) || 0;
    this.discardTestMessages = n.discardTestMessages === true || n.discardTestMessages === "true";
    this.deviceList = n.deviceList || "";
    this.ackType = n.ackType || "A_CRLF";
    this.ackCustom = n.ackCustom || "";
  }

  RED.nodes.registerType("galaxy-sia-config", GalaxySIAConfigNode);
};
