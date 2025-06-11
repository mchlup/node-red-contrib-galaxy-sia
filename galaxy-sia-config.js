/**
 * Galaxy SIA Config Node – funkční konfigurace odpovídající HTML šabloně
 */
module.exports = function(RED) {
  function GalaxySiaConfigNode(config) {
    RED.nodes.createNode(this, config);

    this.name                   = config.name;
    this.panelIP                = config.panelIP;
    this.panelPort              = Number(config.panelPort) || 10002;
    this.account                = config.account;
    this.siaLevel               = Number(config.siaLevel) || 4;
    this.encryption             = !!config.encryption;
    this.encryptionKey          = config.encryptionKey || "";
    this.encryptionHex          = !!config.encryptionHex;
    this.discardTestMessages    = !!config.discardTestMessages;
    this.ackType                = config.ackType || "A_CRLF";
    this.ackCustom              = config.ackCustom || "";
    this.periodicReportInterval = Number(config.periodicReportInterval) || 0;

    // PIN uložený jako credentials
    this.pin = this.credentials.pin;
  }

  RED.nodes.registerType(
    "galaxy-sia-config",
    GalaxySiaConfigNode,
    {
      credentials: {
        pin: { type: "password" }
      }
    }
  );
};
