/**
 * auditor.js
 */

const { PluginSettings } = require("./settings");

class Auditor {
    constructor(context,settings) {
        this.context = context;
        this.settings = settings;
    }

    async exec() {
        // Validate settings. Store validated settings object on '__audited'
        // property for future access.
        const settings = new PluginSettings(this.settings);
        this.settings.__audited = settings;
        this.settings = settings;

        this.auditBuild();
    }

    auditBuild() {
        // Audit build plugins required for post-deploy 'build' phase.
        if (Array.isArray(this.settings.build)) {
            this.settings.build.forEach((handler) => {
                this.context.requireBuild(handler);
            });
        }
    }
}

module.exports = {
    Auditor
};
