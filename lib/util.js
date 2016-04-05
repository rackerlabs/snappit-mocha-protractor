'use strict';

let _ = require('lodash');

exports.fileSystemFriendly = fileName => {
    return fileName.replace(/([!.,+?<>:*|"])/g, '').replace(/\s+/g, '-');
};

exports.buildFullNameFromParents = (testInformation, acc) => {
    if (acc === undefined) {
        acc = [];
    }
    if (testInformation.parent) {
        acc.push(testInformation.parent.title);
        return exports.buildFullNameFromParents(testInformation.parent, acc);
    } else {
        acc.pop();
        return acc.reverse().join(' ');
    }
};

// catch odd cases around `before`, `after`, etc.
exports.handleMochaHooks = testContext => {
    let fullTitle;
    let file;
    let testInformation = testContext.test || testContext.currentTest;
    if (testContext.test.type === 'hook') {
        fullTitle = `${exports.buildFullNameFromParents(testInformation)}-${testInformation.title}`;
        file = testInformation.parent.file;
    } else {
        fullTitle = testInformation.fullTitle();
        file = testInformation.file;
    }
    return {
        fullTitle: fullTitle,
        file: file
    };
};

// [[111, 222], [222, 333], [111, 222]] -> [[111, 222], [222, 333]]
// This exists in case you pass in a resolution that is already in module.exports.defaultResolutions
exports.uniqueResolutions = (resolutions, defaultResolutions) => {
    debugger;
    let allResolutions = defaultResolutions.length ? [...resolutions, ...defaultResolutions] : resolutions;

    return _.uniq(allResolutions, resolution => {
        return resolution.join(' ');
    });
};
