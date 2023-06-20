const esbuild = require("esbuild");
const esbuildSvelte = require("esbuild-svelte");
const sveltePreprocess = require("svelte-preprocess")
const { aliasPath } = require("esbuild-plugin-alias-path")
const path = require("path");

const args = process.argv.slice(2);

const isWatch = args.indexOf('--watch') >= 0;

async function build() {
    esbuild.build({
        entryPoints: {
            portsview: path.join(__dirname, '../gitpod-shared/portsview/src/main.ts'),
            codicon: path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'),
        },
        mainFields: ["svelte", "browser", "module", "main"],
        bundle: true,
        outdir: path.join(__dirname, './public'),
        loader: {
            '.ttf': 'dataurl',
        },
		minify: true,
		sourcemap: isWatch,
		platform: 'browser',
		target: ['es2020'],
        plugins: [
            aliasPath({
                alias: { 'package.nls.json': path.join(__dirname, 'package.nls.json') },
            }),
            esbuildSvelte({
                preprocess: sveltePreprocess(),
            }),
        ],
        logLevel: "info",
    })
}

build().catch((e) => {
    console.error(e)
    process.exit(1)
});

if (isWatch) {
    const srcDir = path.join(__dirname, '../gitpod-shared/portsview')
    const watcher = require('@parcel/watcher');
    watcher.subscribe(srcDir, () => {
        return build();
    });
}