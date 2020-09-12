/**
 * error.js
 */

const { format } = require("util");

class PluginError extends Error {
    constructor(formatStr,...args) {
        super("module: " + format(formatStr,...args));
    }
}

module.exports = {
    PluginError
};
