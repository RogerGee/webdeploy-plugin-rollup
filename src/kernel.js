/**
 * kernel.js
 */

const fs = require("fs");
const path = require("path");
const rollup = require("rollup");
const { format } = require("util");

const { PluginError } = require("./error");
const { PluginSettings } = require("./settings");
const { Loader } = require("./loader");

const OUTPUT_CACHE_KEY = "rollup.output";

class Kernel {
    constructor(context,settings) {
        this.context = context;
        if (settings.__audited) {
            this.settings = settings.__audited;
        }
        else {
            this.settings = new PluginSettings(settings);
        }
        this.loader = new Loader(this.settings.loader,context);
    }

    async exec() {
        await this.loader.addTargets(this.context);
        if (this.loader.count() == 0) {
            return this.finalize();
        }

        this.context.logger.log("Generating bundles:");
        this.context.logger.pushIndent();

        // Compile bundles
        const targets = [];
        for (let i = 0;i < this.settings.bundles.length;++i) {
            const newTargets = await this.compileBundle(this.settings.bundles[i]);
            for (let j = 0;j < newTargets.length;++j) {
                targets.push(newTargets[j]);
            }
        }

        this.context.logger.popIndent();

        // Remove unused targets from the context. Since these targets were
        // selected by the configuration, we must purge them from the dependency
        // tree.
        this.context.removeTargets(this.loader.calcExtraneous(),true);

        await this.executeBuilder(targets);
        await this.processOutput(targets);
        await this.finalize();
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
            const nmodules = Object.keys(chunk.modules).length;
            this.context.logger.log(
                format("_%s_ with %d modules",chunk.fileName,nmodules)
            );

            const target = this.context.resolveTargets(
                path.join(outputDir,chunk.fileName),
                parentTargets
            );
            target.stream.end(chunk.code);

            return target;
        });
    }

    async buildBundle(bundleSettings) {
        const inputOptions = Object.assign({},bundleSettings.input);
        inputOptions.plugins = this.loader.getInputPlugins(inputOptions.plugins);

        const bundle = await rollup.rollup(inputOptions);

        const outputOptions = Object.assign({},bundleSettings.output);
        outputOptions.plugins = this.loader.getOutputPlugins(outputOptions.plugins);

        const results = await bundle.generate(outputOptions);

        return results.output;
    }

    async executeBuilder(targets) {
        if (this.settings.build.length == 0) {
            return;
        }

        this.context.logger.log("Building bundles:");
        this.context.logger.pushIndent();

        targets.forEach((target) => {
            this.context.buildTarget(target,this.settings.build);
        });

        const result = await this.context.executeBuilder();
        this.context.logger.popIndent();

        return result;
    }

    async processOutput(targets) {
        const output = targets.map((target) => target.getSourceTargetPath());
        const fileset = new Set();

        for (let i = 0;i < output.length;++i) {
            const resolv = this.context.graph.resolveConnection(output[i]);
            if (resolv != output[i]) {
                output.splice(i,1,resolv);
            }

            fileset.add(output[i]);
        }

        // Look up output from a previous run in cache. Use the previous file
        // list to remove output files that are no longer a part of the
        // deployment.

        const prevOutput = await this.context.readCacheProperty(OUTPUT_CACHE_KEY) || [];
        const deleteList = prevOutput.filter((x) => !fileset.has(x));

        for (let i = 0;i < deleteList.length;++i) {
            const filepath = this.context.makeDeployPath(deleteList[i]);
            const err = await new Promise((resolve) => {
                fs.unlink(filepath,resolve);
            });

            this.context.logger.log("Unlinked _" + filepath + "_");

            if (err) {
                if (err.code != "ENOENT") {
                    throw err;
                }
            }
        }

        // Save output files in deployment cache.

        await this.context.writeCacheProperty(OUTPUT_CACHE_KEY,output);
    }

    async finalize() {
        return this.context.chain("write",this.settings.write);
    }
}

module.exports = {
    Kernel
};
