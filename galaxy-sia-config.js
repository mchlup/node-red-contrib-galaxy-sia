module.exports = function(RED) {
  function GalaxySIAConfigNode(n) {
    RED.nodes.createNode(this, n);
    this.account = n.account;
    this.panelIP = n.panelIP;
    this.panelPort = Number(n.panelPort) || 10002;
    this.siaLevel = Number(n.siaLevel);
    this.encryption = n.encryption === "true";
    this.encryptionKey = n.encryptionKey || "";
    this.encryptionHex = n.encryptionHex === "true";
    this.connectOnDemand = n.connectOnDemand === "true";
    this.heartbeatInterval = Number(n.heartbeatInterval);
    this.periodicReportInterval = Number(n.periodicReportInterval);
    this.discardTestMessages = n.discardTestMessages === "true";
    this.deviceList = n.deviceList || "";
  }
  RED.nodes.registerType("galaxy-sia-config", GalaxySIAConfigNode);
};
