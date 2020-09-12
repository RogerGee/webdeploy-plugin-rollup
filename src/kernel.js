/**
 * kernel.js
 */

const { PluginSettings } = require("./settings");

class Kernel {
    constructor(context,settings) {
        this.context = context;
        this.settings = new PluginSettings(settings);

        console.log(this.settings);
    }

    async exec() {

    }
}

module.exports = {
    Kernel
};
