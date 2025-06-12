module.exports = function(RED) {
    function GalaxySiaConfigNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.panelIP = config.panelIP;
        this.panelPort = config.panelPort;
        this.account = config.account;
        this.siaLevel = config.siaLevel;
        this.encryption = config.encryption;
        this.encryptionKey = config.encryptionKey;
        this.encryptionHex = config.encryptionHex;
        this.discardTestMessages = config.discardTestMessages;
        this.ackType = config.ackType;
        this.ackCustom = config.ackCustom;
        this.periodicReportInterval = config.periodicReportInterval;
        this.userId = config.userId;
        this.userCode = config.userCode;
        this.heartbeatInterval = config.heartbeatInterval;
        this.zoneMap = config.zoneMap;
        this.userMap = config.userMap;
        this.areaMap = config.areaMap;
        this.externalMappingPath = config.externalMappingPath;
        if (config.credentials) {
            this.credentials = config.credentials;
        }
    }
    RED.nodes.registerType("galaxy-sia-config", GalaxySiaConfigNode, {
        credentials: {
            pin: {type:"password"}
        }
    });
};
