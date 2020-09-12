/**
 * kernel.js
 */

const path = require("path");
const rollup = require("rollup");

const { PluginError } = require("./error");
const { PluginSettings } = require("./settings");
const { Loader } = require("./loader");

class Kernel {
    constructor(context,settings) {
        this.context = context;
        this.settings = new PluginSettings(settings);
        this.loader = new Loader(this.settings.loader);
    }

    async exec() {
        await this.loader.addTargets(this.context);

        const targets = [];
        for (let i = 0;i < this.settings.bundles.length;++i) {
            const newTargets = await this.compileBundle(this.settings.bundles[i]);
            for (let j = 0;j < newTargets.length;++j) {
                targets.push(newTargets[j]);
            }
        }


        // Chain to write plugin.

        return this.context.chain("write",this.settings.write);
    }

    async compileBundle(bundleSettings) {
        // Figure out the path where the bundle(s) will be written. This is
        // slightly non-intuiative since rollup doesn't give us the full path in
        // the generated chunk info. So we'll pull it from the options
        // ourselves.
        let outputDir;
        if (bundleSettings.output.dir) {
            outputDir = bundleSettings.output.dir;
        }
        else if (bundleSettings.output.file) {
            outputDir = path.dirname(bundleSettings.output.file);
        }
        else {
            throw new PluginError(
                "failed to determine output path for '%s': 'file' or 'dir' is required",
                bundleSettings.context
            );
        }

        this.loader.begin();
        const results = await this.buildBundle(bundleSettings);
        const parentTargets = this.loader.end();

        return results.map((chunk) => {
            const target = this.context.resolveTargets(
                path.join(outputDir,chunk.fileName),
                parentTargets
            );
            target.stream.end(chunk.code);

            return target;
        });
    }

    async buildBundle(bundleSettings) {
        const loaderPlugin = this.loader.plugin();
        const inputPlugins = [];
        inputPlugins.push(loaderPlugin); // last

        const inputOptions = Object.assign({},bundleSettings.input);
        inputOptions.plugins = inputPlugins;

        const bundle = await rollup.rollup(inputOptions);

        const outputOptions = Object.assign({},bundleSettings.output);

        const results = await bundle.generate(outputOptions);
        return results.output;
    }
}

module.exports = {
    Kernel
};
