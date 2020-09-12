/**
 * kernel.js
 */

const rollup = require("rollup");

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
        this.loader.begin();
        const results = await this.buildBundle(bundleSettings);
        const parentTargets = this.loader.end();

        return results.map((chunk) => {
            const target = this.context.resolveTargets(chunk.fileName,parentTargets);
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
