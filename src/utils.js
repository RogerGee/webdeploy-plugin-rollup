/**
 * utils
 *
 * rollup (webdeploy plugin)
 */

const path = require("path");

function strip(string,match) {
    return stripLeading(stripTrailing(string,match),match);
}

function stripLeading(string,match) {
    while (string.substring(0,match.length) == match) {
        string = string.substring(match.length);
    }
    return string;
}

function stripTrailing(string,match) {
    let n;
    while ((n = string.length - match.length) && string.substring(n) == match) {
        string = string.substring(0,n);
    }
    return string;
}

module.exports = {
    strip,
    stripLeading,
    stripTrailing
};
