/**
 * node-env-plugin.js
 *
 * rollup (webdeploy plugin)
 */

const { format } = require("util");

const VIRTUAL_MODULE_ID = "\0webdeploy-rollup-node-env:";

function createPlugin(env,settings) {
    const code = `(function() {
  var env = ${ JSON.stringify(env) };
  if (typeof globalThis !== "undefined") {
    globalThis.process = { env: env };
  }
  else if (typeof window !== "undefined") {
    window.process = { env: env };
  }
})();
`;

    return {
        name: "webdeploy-node-env",

        resolveId(id) {
            if (id == VIRTUAL_MODULE_ID) {
                return VIRTUAL_MODULE_ID;
            }

            return null;
        },

        load(id) {
            if (id !== VIRTUAL_MODULE_ID) {
                return null;
            }

            return code;
        },

        transform(code,id) {
            if (!id.match(/\.js$/)) {
                return null;
            }

            if (id === VIRTUAL_MODULE_ID) {
                return null;
            }

            return format("import '%s';\n",VIRTUAL_MODULE_ID) + code;
        }
    };
}

module.exports = createPlugin;
