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
        this.ackType = config.ackType || "A_CRLF";
        this.ackCustom = config.ackCustom;
        this.ackCrcFormat = config.ackCrcFormat || "hex";
        this.pollingType = config.pollingType || "inquiry";
        this.pollingInterval = config.pollingInterval || 10;
        this.periodicReportInterval = config.periodicReportInterval || 0;
        this.userId = config.userId;
        this.userCode = config.userCode;
        this.heartbeatInterval = config.heartbeatInterval || 60;
        this.zoneMap = config.zoneMap;
        this.userMap = config.userMap;
        this.areaMap = config.areaMap;
        this.externalMappingPath = config.externalMappingPath;

        // Properly handle credentials
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
