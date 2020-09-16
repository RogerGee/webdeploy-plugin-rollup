/**
 * kernel.js
 *
 * rollup (webdeploy plugin)
 */

const fs = require("fs");
const path = require("path");
const { format } = require("util");

const { PluginError } = require("./error");
const { PluginSettings } = require("./settings");
const { Loader, LoaderAbortException } = require("./loader");

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
        const entryPoints = [];
        for (let i = 0;i < this.settings.bundles.length;++i) {
            const nextResults = await this.compileBundle(this.settings.bundles[i]);
            for (let j = 0;j < nextResults.length;++j) {
                const next = nextResults[j];
                targets.push(next.target);
                entryPoints.push(next.entryTarget.getSourceTargetPath());
            }
        }

        this.context.logger.popIndent();

        // Remove unused targets from the context. Since these targets were
        // selected by the configuration, we must purge them from the dependency
        // tree.
        this.context.removeTargets(this.loader.calcExtraneous(),true);

        const output = await this.executeBuilder(targets);
        await this.processOutput(output,entryPoints);
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

        this.loader.begin(bundleSettings);
        const results = await this.loader.build();
        const { entryTarget, parentTargets, extra } = this.loader.end();

        let output = extra.map((target) => ({ target, entryTarget }));

        output = output.concat(results.map((chunk) => {
            const nmodules = Object.keys(chunk.modules).length;
            this.context.logger.log(
                format("_%s_ with %d modules",chunk.fileName,nmodules)
            );

            const target = this.context.resolveTargets(
                path.join(outputDir,chunk.fileName),
                parentTargets
            );
            target.stream.end(chunk.code);

            return { target, entryTarget };
        }));

        return output;
    }

    async executeBuilder(targets) {
        if (this.settings.build.length == 0) {
            return targets.map((target) => target.getSourceTargetPath());
        }

        const output = [];

        this.context.logger.log("Building bundles:");
        this.context.logger.pushIndent();

        targets.forEach((target) => {
            output.push(target.getSourceTargetPath());
            this.context.buildTarget(target,this.settings.build);
        });

        await this.context.executeBuilder();
        this.context.logger.popIndent();

        // Resolve connections from old target names in case any names changed
        // during the build.

        for (let i = 0;i < output.length;++i) {
            const resolv = this.context.graph.resolveConnection(output[i]);
            if (resolv != output[i]) {
                output.splice(i,1,resolv);
            }
        }

        return output;
    }

    async processOutput(output,entryPoints) {
        // Look up output from a previous run in cache. If a previous output
        // file was built using one of the entry points of a current output file
        // and the names are different, then we delete the old file.

        const prevOutput = await this.context.readCacheProperty(OUTPUT_CACHE_KEY) || [];

        const keep = [];
        const deleteList = [];

        for (let i = 0; i < prevOutput.length;++i) {
            const file = prevOutput[i];
            const nodes = this.context.prevGraph.lookupReverse(file);

            if (!nodes) {
                continue;
            }

            let j = 0;
            while (j < nodes.length) {
                const index = entryPoints.indexOf(nodes[j]);
                if (index >= 0) {
                    if (output.indexOf(file) < 0) {
                        deleteList.push(file);
                    }

                    break;
                }

                j += 1;
            }

            if (j >= nodes.length) {
                keep.push(file);
            }
        }

        // Delete old output files that are no longer needed.

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

        const augmented = output.concat(keep);

        await this.context.writeCacheProperty(OUTPUT_CACHE_KEY,augmented);
    }

    async finalize() {
        return this.context.chain("write",this.settings.write);
    }
}

module.exports = {
    Kernel
};
