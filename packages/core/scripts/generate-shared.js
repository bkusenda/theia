/********************************************************************************
 * Copyright (C) 2021 Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

const path = require('path');
const { promises: fsp } = require('fs');
const { EOL } = require('os');
const { exportStar, exportEqual, sharedModules } = require('../shared');

const {
    dependencies,
    devDependencies,
    peerDependencies,
} = require('../package.json');

const shared = path.resolve(__dirname, '../shared');

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

async function main() {
    await mkdirp(shared);
    await Promise.all([
        generateExportTheiaElectron(),
        Promise.all(exportStar.map(entry => generateExportStar(entry.module, entry.alias))),
        Promise.all(exportEqual.map(entry => generateExportEqual(entry.module, entry.namespace))),
        generateReadme(sharedModules),
    ]);
}

async function generateReadme(reExports) {
    const input = path.resolve(__dirname, '../README.in.md');
    const output = path.resolve(__dirname, '../README.md');
    const readme = await fsp.readFile(input, { encoding: 'utf8' });
    await fsp.writeFile(output, readme.replace('{{RE-EXPORTS}}', reExports.map(
        module => ` - [\`${module}@${getPackageRange(module)}\`](${getNpmUrl(module)})`
    ).join(getEOL(readme))));
}

async function generateExportTheiaElectron() {
    const base = path.resolve(shared, 'electron');
    await Promise.all([
        writeFileIfMissing(`${base}.js`, `\
module.exports = require('@theia/electron');
`),
        writeFileIfMissing(`${base}.d.ts`, `\
import Electron = require('@theia/electron');
export = Electron;
`),
    ]);
}

async function generateExportStar(module, alias) {
    const base = await prepareSharedModule(alias);
    await Promise.all([
        writeFileIfMissing(`${base}.js`, `\
module.exports = require('${module}');
`),
        writeFileIfMissing(`${base}.d.ts`, `\
export * from '${module}';
`),
    ]);
}

async function generateExportEqual(module, namespace) {
    const base = await prepareSharedModule(module);
    await Promise.all([
        writeFileIfMissing(`${base}.js`, `\
module.exports = require('${module}');
`),
        writeFileIfMissing(`${base}.d.ts`, `\
import ${namespace} = require('${module}');
export = ${namespace};
`),
    ]);
}

/**
 * @param {string} module
 * @returns {string} target filename without extension (base)
 */
async function prepareSharedModule(module) {
    const base = path.resolve(shared, module);
    // Handle case like '@a/b/c/d.js' => mkdirp('@a/b/c')
    await mkdirp(path.dirname(base));
    return base;
}

async function mkdirp(directory) {
    await fsp.mkdir(directory, { recursive: true });
}

async function writeFileIfMissing(file, content) {
    if (await fsp.access(file).then(() => false, error => true)) {
        await writeFile(file, content);
    }
}

async function writeFile(file, content) {
    if (process.platform === 'win32' && getEOL(content) !== '\r\n') {
        // JS strings always use `\n` even on Windows, but when
        // writing to a file we want to use the system's EOL.
        content = content.replace(/\n/g, '\r\n');
    }
    await fsp.writeFile(file, content);
}

/**
 * Detects the EOL from the content of a string.
 * Will only look at the first line.
 * @param {string} string
 * @returns {string}
 */
function getEOL(string) {
    const split = string.split('\n', 2);
    if (split.length === 1) {
        // There's no newlines, use the system's default
        return EOL
    }
    return split[0].endsWith('\r')
        ? '\r\n'
        : '\n';
}

/**
 * @param {string} package
 * @returns {string}
 */
function getNpmUrl(package) {
    return `https://www.npmjs.com/package/${getPackageName(package)}`;
}

/**
 * @param {string} package
 * @returns {string}
 */
function getPackageRange(package) {
    const packageName = getPackageName(package);
    if (packageName === 'electron') {
        // In this case we are doing something weird, @theia/core does not depend on electron,
        // but rather we depend on an optional peer dependency @theia/electron which itself depends
        // on electron. For practical purposes, we re-export electron through @theia/electron own re-exports.
        // The exports look like this: electron -> @theia/electron (optional) -> @theia/core/shared/electron
        return require('@theia/electron/package.json').dependencies.electron;
    }
    return dependencies[packageName] || devDependencies[packageName] || peerDependencies[packageName];
}

/**
 * Only keep the first two parts of the package name
 * e.g. @a/b/c => @a/b
 * @param {string} module
 * @returns {string}
 */
function getPackageName(module) {
    const slice = module.startsWith('@') ? 2 : 1;
    return module.split('/')
        .slice(0, slice)
        .join('/');
}
