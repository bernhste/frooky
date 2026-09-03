import { spawn, spawnSync } from 'child_process';
import chokidar from 'chokidar';
import fs from 'fs';
import * as yaml from 'js-yaml';
import minimist from 'minimist';
import path, { join } from 'path';
import { fileURLToPath } from 'url';

const VALID_PLATFORMS = ['android', 'ios'];
const VALID_TARGETS = ['frooky', 'frida'];

function parseArgs(argv) {
    const args = minimist(argv, {
        boolean: ['watch', 'compress', 'verbose', 'keep-build-dir'],
        string: ['target', 'type-check'],
        alias: {
            t: 'target',
            w: 'watch',
            c: 'compress',
            v: 'verbose',
            h: 'help',
        },
        default: {
            t: 'frooky',
            w: false,
            c: false,
            'keep-build-dir': false,
            'type-check': 'full',
        },
    });

    const rootDir = path.dirname(fileURLToPath(import.meta.url));
    const platform = args._[0];
    const target = args.target;
    const distDir = path.join(rootDir, 'dist');
    const buildDir = path.join(rootDir, 'src', 'build');

    return {
        rootDir,
        platform,
        target,
        typeCheck: args['type-check'],
        keepBuildDir: args['keep-build-dir'],
        watch: args.watch,
        compress: args.compress,
        help: args.help,
        verbose: args.verbose,
        hooksFilePaths: args._.slice(1),
        sourceDir: path.join(rootDir, 'src', platform),
        distDir,
        buildDir,
        agentPath: path.join(distDir, `agent-${platform}.js`),
        versionPath: path.join(distDir, 'version.json'),
    };
}

function showHelp() {
    console.log(`
    Usage: node build.js <platform> [hook-files...] [options]

    Arguments:
    <platform>                Platform to target (android, ios)
    [hook-files...]           Paths to hook YAML (or JSON) files to process (frida target only)

    Options:
    -t, --target <name>       Target environment (frooky, frida) [default: frooky]
    --type-check <name>       Sets TypeScript type checking (full, none) [default: full]
    -w, --watch               Re-Compiles agent.js every time code or hooks change [default: false]
    -c, --compress            Compress agent.js [default: false]
    -v, --verbose             Verbose output [default: false]
    --keep-build-dir          Keeps the build directory after compiling the agent [default: false]
    -h, --help                Show this help message
    `);
    process.exit(0);
}

function validateConfig(config) {
    if (!VALID_PLATFORMS.includes(config.platform)) {
        console.error(`Platform must be one of: ${VALID_PLATFORMS.join(', ')}`);
        process.exit(1);
    }

    if (!VALID_TARGETS.includes(config.target)) {
        console.error(`Target must be one of: ${VALID_TARGETS.join(', ')}`);
        process.exit(1);
    }

    if (config.target === 'frida') {
        if (config.hooksFilePaths.length === 0) {
            console.error('No hook files provided. Provide one or more hook files.');
            process.exit(1);
        }
        config.hooksFilePaths.forEach((file) => {
            if (!fs.existsSync(file)) {
                console.error(`Hook file not found: ${file}`);
                process.exit(1);
            }
            const ext = path.extname(file).toLowerCase();
            if (ext !== '.json' && ext !== '.yaml' && ext !== '.yml') {
                console.error(`Invalid file type: ${file}. Only .yaml/.yml and .json files are allowed.`);
                process.exit(1);
            }
        });
    }
}

function saveCompiledFridaVersion(config) {
    try {
        const packagePaths = {
            frida: join(config.rootDir, 'node_modules', 'frida', 'package.json'),
            'frida-java-bridge': join(config.rootDir, 'node_modules', 'frida-java-bridge', 'package.json'),
            'frida-swift-bridge': join(config.rootDir, 'node_modules', 'frida-swift-bridge', 'package.json'),
            'frida-objc-bridge': join(config.rootDir, 'node_modules', 'frida-objc-bridge', 'package.json'),
        };

        const versionInfo = Object.fromEntries(
            Object.entries(packagePaths).map(([name, pkgPath]) => [
                name,
                JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version,
            ])
        );
        versionInfo.buildtime = new Date().toISOString();

        fs.writeFileSync(config.versionPath, JSON.stringify(versionInfo, null, 2));

        if (config.verbose) {
            console.log(`Frida version written to ${config.versionPath}`);
        }
        return versionInfo;
    } catch (error) {
        console.error('Error writing Frida versions:', error.message);
        return null;
    }
}

function cleanupBuildDir(config) {
    fs.rmSync(config.buildDir, { recursive: true, force: true });
}

// TODO: Patch when fixing https://github.com/cpholguera/frooky/issues/29
// Merges multiple hook configuration files into one and injects them into the target index file.
function generateHooksFile(config) {
    const frookyConfigs = config.hooksFilePaths.map((file) => {
        try {
            const content = fs.readFileSync(file, 'utf8');
            const ext = path.extname(file).toLowerCase();
            return (ext === '.yaml' || ext === '.yml') ? yaml.load(content) : JSON.parse(content);
        } catch (error) {
            console.error(`Error reading ${file}:`, error.message);
            process.exit(1);
        }
    });

    const targetFile = path.join(config.buildDir, `index.${config.target}.ts`);
    const replacement = `frookyConfigs = ${JSON.stringify(frookyConfigs)} as InputFrookyConfig[];`;
    const blockRegex = /(\/\/%%% REPLACE START\n)[\s\S]*?(\/\/%%% REPLACE STOP)/;

    try {
        let content = fs.readFileSync(targetFile, 'utf8');

        if (!blockRegex.test(content)) {
            console.error('Replace block markers not found in index.ts');
            process.exit(1);
        }

        content = content.replace(blockRegex, `$1${replacement}\n$2`);
        fs.writeFileSync(targetFile, content, 'utf8');

        if (config.verbose) {
            console.log(`Hook compiling successful. Updated: ${targetFile}`);
        }
    } catch (error) {
        console.error('Error updating index.ts:', error.message);
        process.exit(1);
    }
}

function setupBuildDir(config) {
    if (!fs.existsSync(config.distDir)) {
        fs.mkdirSync(config.distDir);
    }

    if (!fs.existsSync(config.buildDir)) {
        fs.mkdirSync(config.buildDir);
    }

    fs.cpSync(config.sourceDir, config.buildDir, { recursive: true });

    // Remove the index file we're NOT using
    const unusedTarget = config.target === 'frida' ? 'frooky' : 'frida';
    const unusedIndexPath = path.join(config.buildDir, `index.${unusedTarget}.ts`);
    if (fs.existsSync(unusedIndexPath)) {
        fs.unlinkSync(unusedIndexPath);
    }

    if (config.target === 'frida') {
        generateHooksFile(config);
    }
}

function runCompileAgent(config) {
    spawnSync('frida-compile', [
        path.join(config.buildDir, `index.${config.target}.ts`),
        '-o', config.agentPath,
        '-T', config.typeCheck,
        ...(config.compress ? ['-c'] : []),
    ], { stdio: 'inherit' });

    if (config.verbose) {
        console.log(`Agent compiling successful. Location: ${config.agentPath}`);
    }
}

function runWatch(config) {
    return new Promise((resolve, reject) => {
        const fridaProcess = spawn('frida-compile', [
            path.join(config.buildDir, `index.${config.target}.ts`),
            '-o', config.agentPath,
            '-w',
            '-T', config.typeCheck,
            ...(config.compress ? ['-c'] : []),
        ], { stdio: 'inherit' });

        const watcherHooks = chokidar.watch(config.hooksFilePaths, {
            persistent: true,
            ignoreInitial: true,
        });
        watcherHooks.on('change', () => {
            if (config.verbose) console.log('Hook files changed, regenerating hooks.');
            generateHooksFile(config);
        });

        const watcherSource = chokidar.watch(config.sourceDir, {
            persistent: true,
            ignoreInitial: true,
        });
        watcherSource.on('change', () => {
            if (config.verbose) console.log('Source files changed, rebuilding.');
            cleanupBuildDir(config);
            setupBuildDir(config);
        });

        const stopWatching = () => {
            if (config.verbose) console.log('Stop watching for file changes.');
            fridaProcess.kill();
            watcherHooks.close();
            watcherSource.close();
        };

        process.on('SIGINT', () => {
            stopWatching();
            resolve();
        });

        fridaProcess.on('error', (err) => {
            stopWatching();
            reject(err);
        });
    });
}

async function main() {
    const config = parseArgs(process.argv.slice(2));

    if (config.help) {
        showHelp();
    }
    validateConfig(config);

    try {
        setupBuildDir(config);
        saveCompiledFridaVersion(config);

        if (config.watch) {
            await runWatch(config);
        } else {
            runCompileAgent(config);
        }
    } catch (e) {
        console.error(`Error: ${e}`);
    } finally {
        if (!config.keepBuildDir) {
            cleanupBuildDir(config);
        }
    }
}

main();
