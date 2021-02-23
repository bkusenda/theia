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
const { dependencies, theiaReExports } = require('../package.json');

const shared = path.resolve(__dirname, '../shared');

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

async function main() {
    /** @type {[string, string][]} */
    const exportStar = theiaReExports['export *'].map(entry => {
        const [package, alias = entry] = entry.split(':', 2);
        return [package, alias];
    });
    /** @type {[string, string][]} */
    const exportEqual = theiaReExports['export ='].map(entry => {
        const [package, namespace = entry] = entry.split(' as ', 2);
        return [package, namespace];
    });
    await mkdirp(shared);
    await Promise.all([
        generateExportTheiaElectron(),
        Promise.all(exportStar.map(([package, alias]) => generateExportStar(package, alias))),
        Promise.all(exportEqual.map(([package, namespace]) => generateExportEqual(package, namespace))),
        generateReadme([
            ...exportStar.map(([package, alias]) => package),
            ...exportEqual.map(([package, namespace]) => package),
        ].sort()),
    ]);
}

async function generateReadme(reExports) {
    const input = path.resolve(__dirname, '../README.in.md');
    const output = path.resolve(__dirname, '../README.md');
    const readme = await fsp.readFile(input, { encoding: 'utf8' });
    await fsp.writeFile(output, readme.replace('{{RE-EXPORTS}}', reExports.map(
        package => ` - [\`${package}@${getPackageRange(package)}\`](${getNpmUrl(package)})`
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

async function generateExportStar(package, alias) {
    const base = await prepareSharedPackage(alias);
    await Promise.all([
        writeFileIfMissing(`${base}.js`, `\
module.exports = require('${package}');
`),
        writeFileIfMissing(`${base}.d.ts`, `\
export * from '${package}';
`),
    ]);
}

async function generateExportEqual(package, namespace) {
    const base = await prepareSharedPackage(package);
    await Promise.all([
        writeFileIfMissing(`${base}.js`, `\
module.exports = require('${package}');
`),
        writeFileIfMissing(`${base}.d.ts`, `\
import ${namespace} = require('${package}');
export = ${namespace};
`),
    ]);
}

/**
 * @param {string} package
 * @returns {string} target filename without extension (base)
 */
async function prepareSharedPackage(package) {
    const base = path.resolve(shared, package);
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
    return dependencies[getPackageName(package)];
}

/**
 * Only keep the first two parts of the package name
 * e.g. @a/b/c => @a/b
 * @param {string} package
 * @returns {string}
 */
function getPackageName(package) {
    return package.startsWith('@')
        ? package.split('/').slice(0, 2).join('/')
        : package;
}
