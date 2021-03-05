// @ts-check
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

const fs = require('fs');
const path = require('path');

const {
    theiaCoreSharedPrefix,
    isSharedModule,
    getTheiaCoreSharedModule,
} = require('@theia/core/shared');

/** @type {{[ruleId: string]: import('eslint').Rule.RuleModule}} */
exports.rules = {
    "shared-dependencies": {
        meta: {
            type: "problem",
            fixable: 'code',
        },
        create(context) {
            const filename = context.getFilename();
            const packageJson = findPackageJson(filename);
            if (packageJson && dependsOnTheiaCore(packageJson)) {
                // Only show an error regarding the package.json file if this is the first
                // time we detect the error, else it will error for every file of the package:
                if (firstTime(packageJson.__filename)) {
                    const sharedModules = getSharedModuleDependencies(packageJson);
                    if (sharedModules.length > 0) {
                        context.report({
                            loc: { line: 0, column: 0 },
                            message: `"${packageJson.__filename}" depends on some @theia/core shared dependencies: [${sharedModules}]`,
                        });
                    }
                }
                /**
                 * @param {import('estree').Literal} node
                 * @param {string} module
                 */
                function checkModuleImport(node, module) {
                    if (isSharedModule(module)) {
                        context.report({
                            node,
                            message: `"${module}" is a @theia/core shared dependency, please use "${theiaCoreSharedPrefix}${module}" instead.`,
                            fix(fixer) {
                                if (node.range) {
                                    const [start, end] = node.range;
                                    // Make sure to insert text between the first quote of the string and the rest:
                                    return fixer.insertTextBeforeRange([start + 1, end], theiaCoreSharedPrefix);
                                }
                            }
                        });
                    } else {
                        const shared = getTheiaCoreSharedModule(module);
                        if (shared && !isSharedModule(shared)) {
                            context.report({
                                node,
                                message: `"${shared}" is not part of @theia/core shared dependencies.`
                            });
                        }
                    }
                }
                return {
                    ImportDeclaration(node) {
                        checkModuleImport(node.source, /** @type {string} */(node.source.value));
                    },
                    TSExternalModuleReference(node) {
                        checkModuleImport(node.expression, node.expression.value);
                    },
                };
            }
            return {};
        },
    },
};

/** @type {Set<string>} */
const firstTimeCache = new Set();
/**
 * @param {string} key
 * @returns {boolean} true if first time seeing `key` else false.
 */
function firstTime(key) {
    if (firstTimeCache.has(key)) {
        return false;
    } else {
        firstTimeCache.add(key);
        return true;
    }
}

/**
 * @typedef FoundPackageJson
 * @property {string} __filename
 * @property {{[package: string]: string}} [dependencies]
 */

/**
 * Keep a shortcut to a given package.json file based on previous crawls.
 * @type {Map<string, FoundPackageJson>}
 */
const findPackageJsonCache = new Map();
/**
 * @param {string} from
 * @returns {FoundPackageJson | undefined}
 */
function findPackageJson(from) {
    let current = path.parse(path.resolve(from));
    // Keep track of all paths tried before eventually finding a package.json file
    const tried = [current.base];
    while (!isRoot(current)) {
        const cached = findPackageJsonCache.get(current.base);
        if (cached) {
            return cached;
        }
        const packageJsonPath = path.resolve(current.base, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, { encoding: 'utf8' }));
            for (const base of tried) {
                findPackageJsonCache.set(base, packageJson);
            }
            packageJson['__filename'] = packageJsonPath;
            return packageJson;
        }
        current = path.parse(path.dirname(current.base));
        tried.push(current.base);
    }
}

/**
 * @param {path.ParsedPath} parsed
 */
function isRoot(parsed) {
    return parsed.name === '' && parsed.ext === '' && parsed.base === parsed.root;
}

/**
 * @param {object} packageJson
 * @returns {boolean}
 */
function dependsOnTheiaCore(packageJson) {
    return typeof packageJson.dependencies === 'object' && '@theia/core' in packageJson.dependencies;
}

/**
 * @param {object} packageJson
 * @return {string[]}
 */
function getSharedModuleDependencies(packageJson) {
    return typeof packageJson.dependencies === 'object'
        ? Object.keys(packageJson.dependencies).filter(dependency => isSharedModule(dependency))
        : [];
}
