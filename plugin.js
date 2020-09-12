/**
 * plugin.js
 *
 * webdeploy * rollup
 *
 * Copyright (C) Roger P. Gee
 */

const { Kernel } = require("./src/kernel");
const { Auditor } = require("./src/auditor");

module.exports = {
    async exec(context,settings) {
        const kernel = new Kernel(context,settings);

        return kernel.exec();
    },

    async audit(context,settings) {
        const auditor = new Auditor(context,settings);

        return auditor.exec();
    }
};
