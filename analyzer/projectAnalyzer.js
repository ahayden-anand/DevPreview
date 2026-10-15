const fs = require('fs');
const path = require('path');

const VITE_CONFIG_FILES = [
    'vite.config.js',
    'vite.config.ts',
    'vite.config.mjs',
    'vite.config.cjs'
];

const LOCK_FILES = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'bun.lock', manager: 'bun' },
    { file: 'package-lock.json', manager: 'npm' }
];

const CSS_CONFIG_FILES = [
    'tailwind.config.js',
    'tailwind.config.ts',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
    'postcss.config.js',
    'postcss.config.ts',
    'postcss.config.cjs',
    'postcss.config.mjs'
];

function findPackageJson(startDirectory) {
    let currentDirectory = path.resolve(startDirectory);

    while (true) {
        const packageJsonPath = path.join(currentDirectory, 'package.json');

        if (fs.existsSync(packageJsonPath)) {
            return packageJsonPath;
        }

        const parentDirectory = path.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            return undefined;
        }

        currentDirectory = parentDirectory;
    }
}

function getDependencyVersion(packageJson, dependencyName) {
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};

    return dependencies[dependencyName] || devDependencies[dependencyName];
}

function detectPackageManager(projectRoot) {
    for (const item of LOCK_FILES) {
        const lockPath = path.join(projectRoot, item.file);
        if (fs.existsSync(lockPath)) {
            return {
                packageManager: item.manager,
                lockFile: item.file,
                lockFilePath: lockPath
            };
        }
    }
    return {
        packageManager: 'npm',
        lockFile: null,
        lockFilePath: null
    };
}

function detectCssConfigs(projectRoot) {
    const detected = [];
    for (const fileName of CSS_CONFIG_FILES) {
        const filePath = path.join(projectRoot, fileName);
        if (fs.existsSync(filePath)) {
            detected.push(fileName);
        }
    }
    return detected;
}

function analyzeProject(componentPath) {
    if (!componentPath) {
        throw new Error('No component path provided.');
    }

    const absoluteComponentPath = path.resolve(componentPath);
    const startDir = fs.existsSync(absoluteComponentPath) && fs.statSync(absoluteComponentPath).isDirectory()
        ? absoluteComponentPath
        : path.dirname(absoluteComponentPath);

    const packageJsonPath = findPackageJson(startDir);

    if (!packageJsonPath) {
        throw new Error('Could not find package.json in the component directory or any parent directory.');
    }

    let packageJson;
    try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch (error) {
        throw new Error(`Could not read package.json: ${error.message}`);
    }

    const projectRoot = path.dirname(packageJsonPath);
    const reactVersion = getDependencyVersion(packageJson, 'react');
    const reactDomVersion = getDependencyVersion(packageJson, 'react-dom');
    const viteVersion = getDependencyVersion(packageJson, 'vite');
    const viteConfigPath = VITE_CONFIG_FILES
        .map((fileName) => path.join(projectRoot, fileName))
        .find((filePath) => fs.existsSync(filePath));

    const tsConfigPath = path.join(projectRoot, 'tsconfig.json');
    const hasTsConfig = fs.existsSync(tsConfigPath);
    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    const nodeModulesExists = fs.existsSync(nodeModulesPath);
    const pmInfo = detectPackageManager(projectRoot);
    const cssConfigs = detectCssConfigs(projectRoot);

    const usesReact = Boolean(reactVersion || reactDomVersion);
    const usesVite = Boolean(viteVersion || viteConfigPath);

    let isSupported = true;
    let supportError = null;

    if (!usesReact) {
        isSupported = false;
        supportError = "DevPreview requires React. Neither 'react' nor 'react-dom' was detected in package.json.";
    } else if (!usesVite) {
        isSupported = false;
        supportError = "DevPreview currently requires Vite as the project bundler. 'vite' was not detected in package.json or project config.";
    } else if (!nodeModulesExists) {
        isSupported = false;
        supportError = "DevPreview detected that 'node_modules' is missing. Please run your package manager install command (e.g. 'npm install') first.";
    }

    return {
        projectRoot,
        componentPath: absoluteComponentPath,
        componentRelativePath: path.relative(projectRoot, absoluteComponentPath),
        packageJsonPath,
        reactVersion,
        reactDomVersion,
        viteVersion,
        usesReact,
        usesVite,
        viteConfigPath,
        nodeModulesExists,
        nodeModulesPath,
        hasTsConfig,
        tsConfigPath: hasTsConfig ? tsConfigPath : null,
        packageManager: pmInfo.packageManager,
        lockFile: pmInfo.lockFile,
        cssConfigs,
        isSupported,
        supportError
    };
}

module.exports = {
    analyzeProject,
    findPackageJson,
    detectPackageManager,
    detectCssConfigs
};
