/**
 * source-loader.js
 *
 * rollup (webdeploy-plugin)
 */

const minimatch = require("minimatch");

class SourceImporter {
    constructor(loader,settings) {
        this.loader = loader;
        this.settings = settings;

        this.order = [];
        this.parents = new Set();
        this.content = new Map();
    }

    transform(code,id) {
        if (!this.filter(id)) {
            return null;
        }

        code = code || "";

        const entry = this.content.get(id);
        const target = this.loader.lookupTarget(id);

        if (target) {
            this.parents.add(target);
        }

        // Create/update content entry. Remember ordering for bundle generation
        // later.
        if (typeof entry === "undefined") {
            this.order.push(id);
            this.content.set(id,code);
        }
        else if (code !== entry) {
            this.content.set(id,code);
        }

        return "";
    }

    generateBundle(opts,bundle) {
        if (this.content.size == 0) {
            return;
        }

        // Create target to receive bundle contents.
        const target = this.loader.context.resolveTargets(
            this.settings.output,
            Array.from(this.parents)
        );

        // Write bundle contents in order.
        for (let i = 0;i < this.order.length;++i) {
            target.stream.write(this.content.get(this.order[i]));
        }

        target.stream.end();
        this.loader.addExtra(target);

        this.order.slice(0);
        this.parents.clear();
        this.content.clear();
    }

    filter(id) {
        return this.settings.match.some((glob) => minimatch(id,glob));
    }
}

function createPlugin(loader,settings) {
    const inst = new SourceImporter(loader,settings);

    return {
        name: 'webdeploy-source',

        transform(code,id) {
            return inst.transform(code,id);
        },

        generateBundle(opts,bundle) {
            return inst.generateBundle(opts,bundle);
        }
    };
}

module.exports = createPlugin;
