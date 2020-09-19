/**
 * kernel.js
 *
 * rollup (webdeploy plugin)
 */

const fs = require("fs");
const path = require("path");
const utils = require("./utils");
const { format } = require("util");
const { PluginError } = require("./error");
const { PluginSettings } = require("./settings");
const { Loader, LoaderAbortException } = require("./loader");

class Kernel {
    static resolveGroups(groups) {
        groups.forEach((group) => {
            for (let i = 0;i < group.length;++i) {
                if (typeof group[i] === "object") {
                    group[i] = group[i].file;
                }
            }
        });
    }

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
        let groups = [];
        let targets = [];
        for (let i = 0;i < this.settings.bundles.length;++i) {
            const group = [];
            const result = await this.compileBundle(this.settings.bundles[i]);
            result.refs.forEach((ref) => group.push(ref));
            result.targets.forEach((target) => {
                const entry = { target, file: target.getSourceTargetPath() };
                targets.push(entry);
                group.push(entry);
            });
            groups.push(group);
        }

        this.context.logger.popIndent();

        // Remove unused targets from the context. Since these targets were
        // selected by the configuration, we must purge them from the dependency
        // tree.
        this.context.removeTargets(this.loader.calcExtraneous(),true);

        await this.executeBuilder(targets);
        await this.finalize(groups);
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
        const { entryTarget, parentTargets, extra, refs } = this.loader.end();

        let targets = extra.slice();

        targets = targets.concat(results.map((chunk) => {
            this.context.logger.log(
                format(
                    "_%s_ with %d modules",
                    chunk.fileName,
                    Object.keys(chunk.modules).length
                )
            );

            const target = this.context.resolveTargets(
                path.join(outputDir,chunk.fileName),
                parentTargets
            );
            target.stream.end(chunk.code);

            return target;
        }));

        return { entryTarget, targets, refs };
    }

    async executeBuilder(targets) {
        if (this.settings.build.length == 0) {
            return;
        }

        this.context.logger.log("Building bundles:");
        this.context.logger.pushIndent();

        input.forEach(({ target, file }) => {
            this.context.buildTarget(target,this.settings.build);
        });

        await this.context.executeBuilder();
        this.context.logger.popIndent();

        // Resolve connections from old target names in case any names changed
        // during the build. This updates the name in the target ref entry.

        for (let i = 0;i < targets.length;++i) {
            const resolv = this.context.graph.resolveConnection(targets[i].file);
            if (resolv != targets[i].file) {
                targets[i].file = resolv;
            }
        }
    }

    async finalize(groups) {
        if (this.settings.manifest) {
            const manifestSettings = this.settings.manifest;

            Kernel.resolveGroups(groups);
            manifestSettings.refs = groups;
            manifestSettings.write = this.settings.write;

            return this.context.chain("manifest",manifestSettings);
        }

        return this.context.chain("write",this.settings.write);
    }
}

module.exports = {
    Kernel
};
