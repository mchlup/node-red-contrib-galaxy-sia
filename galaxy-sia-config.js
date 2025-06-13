module.exports = function(RED) {
    function GalaxySiaConfigNode(config) {
        RED.nodes.createNode(this, config);
        // Store all configuration values
        this.name = config.name || "";
        this.panelIP = config.panelIP;
        this.panelPort = config.panelPort;
        this.account = config.account;
        this.siaLevel = config.siaLevel || 4;
        this.encryption = config.encryption || false;
        this.encryptionKey = config.encryptionKey;
        this.encryptionHex = config.encryptionHex || false;
        this.discardTestMessages = config.discardTestMessages || false;
        this.ackType = config.ackType || "SIA_PACKET";
        this.ackCustom = config.ackCustom;
        this.periodicReportInterval = config.periodicReportInterval || 0;
        this.userId = config.userId;
        this.userCode = config.userCode;
        this.heartbeatInterval = config.heartbeatInterval || 60;
        this.zoneMap = config.zoneMap;
        this.userMap = config.userMap;
        this.areaMap = config.areaMap;
        this.externalMappingPath = config.externalMappingPath;
        this.debug = config.debug || false;
        this.ackCrcFormat = config.ackCrcFormat || "hex";
        this.pollingType = config.pollingType || "inquiry";
        this.ackFullAccount = config.ackFullAccount || false;
        this.ackAlwaysCRLF = config.ackAlwaysCRLF !== false; // default true
        if (this.credentials) {
            this.pin = this.credentials.pin;
        }
    }
    RED.nodes.registerType("galaxy-sia-config", GalaxySiaConfigNode, {
        credentials: {
            pin: {type: "password"}
        }
    });
}
