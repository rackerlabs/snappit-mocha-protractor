var path = require('path');

var _ = require('lodash');
var chalk = require('chalk');
var fs = require('fs-extra');
var lwip = require('lwip');
var resemble = require('node-resemble');
var zfill = _.partialRight(_.padStart, '0');

module.exports.logWarnings = true;
module.exports.threshold = 4; // percent
module.exports.defaultResolutions = [];
module.exports.disable = false;

var noScreenshot = (element, reason, fileName) => {
    if (module.exports.logWarnings) {
        console.log('Error: element', element.locator().toString(), reason, 'No screenshot taken.');
    }
};

var fileSystemFriendly = fileName => {
    return fileName.replace(/([!.,+?<>:*|"])/g, '').replace(/\s+/g, '-');
};

var buildFullNameFromParents = (testInformation, acc) => {
    if (acc === undefined) {
        acc = [];
    }
    if (testInformation.parent) {
        acc.push(testInformation.parent.title);
        return buildFullNameFromParents(testInformation.parent, acc);
    } else {
        acc.pop();
        return acc.reverse().join(' ');
    }
};

// catch odd cases around `before`, `after`, etc.
var handleMochaHooks = testContext => {
    var fullTitle;
    var file;
    var testInformation = testContext.test || testContext.currentTest;
    if (testContext.test.type === 'hook') {
        fullTitle = [buildFullNameFromParents(testInformation), '-', testInformation.title].join('');
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

var getScreenshotNameFromContext = testContext => {
    return browser.getCapabilities().then(capabilities => {
        return browser.driver.manage().window().getSize().then(resolution => {
            var resolutionString = [zfill(resolution.width, 4), zfill(resolution.height, 4)].join('x');
            var browserName = capabilities.caps_.browserName;
            var screenshotDir = path.join('screenshots', browserName);
            var test = handleMochaHooks(testContext);
            var fullyQualifiedPath = test.file.split('/');
            var commonPath = _.takeWhile(path.resolve(__dirname).split('/'), (directoryPart, index) => {
                return directoryPart === fullyQualifiedPath[index];
            }).join('/');
            var relativeFilePath = fullyQualifiedPath.join('/').replace(commonPath, '');
            var cleanPathName = relativeFilePath.replace(/\.js$/, '').replace(/\./g, '-');
            var rawName = path.join(screenshotDir, cleanPathName, test.fullTitle, resolutionString);
            return fileSystemFriendly(rawName);
        });
    });
};

var writeImage = (image, screenshotName, deferred) => {
    var flow = browser.controlFlow();
    var writeFileFn = () => {
        fs.mkdirsSync(path.dirname(screenshotName));
        image.writeFile(screenshotName, err => {
            if (err) {
                console.log('Error saving screenshot:', err);
                return deferred.reject();
            }
            return deferred.fulfill();
        });
    };
    flow.execute(writeFileFn);
};

// compares the image before saving it, using `threshold` setting as a gate.
var saveImage = (image, screenshotName, deferred, options) => {
    var flow = browser.controlFlow();
    if (fs.existsSync(screenshotName)) {
        var toBufferFn = () => {
            image.toBuffer('png', { compression: 'none' }, (err, imageBuffer) => {
                if (err) {
                    console.log('Error creating comparison image buffer', err);
                    deferred.reject();
                }
                var comparisonFn = () => {
                    var comparison = resemble(imageBuffer).compareTo(screenshotName);
                    comparison.onComplete(data => {
                        if (parseFloat(data.misMatchPercentage) > options.threshold) {
                            if (module.exports.logWarnings) {
                                var percentage = chalk.yellow.bold(data.misMatchPercentage + '%');
                                var shortName = chalk.red(path.basename(screenshotName));
                                console.log('%s difference in screenshot %s', percentage, shortName);
                            }
                            return writeImage(image, screenshotName, deferred);
                        }
                        return deferred.fulfill();
                    });
                };
                flow.execute(comparisonFn);
            });
        };
        flow.execute(toBufferFn);
    } else {
        if (module.exports.logWarnings) {
            var newMessage = chalk.green.bold('New screenshot added:');
            var shortName = chalk.red(path.basename(screenshotName));
            console.log('%s %s', newMessage, shortName);
        }
        return writeImage(image, screenshotName, deferred);
    }
};

var cropAndSaveImage = (image, elem, imageName, deferred, options) => {
    return elem.isPresent().then(present => {
        if (present) {
            var info = [elem.isDisplayed(), elem.getSize(), elem.getLocation()];
            return protractor.promise.all(info).then(info => {
                var displayed = info[0];
                var size = info[1];
                var location = info[2];
                image.crop(
                    location.x, // left
                    location.y, // top
                    location.x + size.width, // right
                    location.y + size.height, // bottom
                    (err, image) => {
                        if (err) {
                            console.log('Error', err);
                            return deferred.reject();
                        }
                        if (!displayed) {
                            // cropped to zero means deleted entirely, with warning
                            noScreenshot(elem, 'not displayed.', imageName);
                            return deferred.reject();
                        }
                        return saveImage(image, imageName, deferred, options);
                    }
                );
            });
        }  else {
            noScreenshot(elem, 'not present.', imageName);
            return deferred.reject();
        }
    });
};

// [[111, 222], [222, 333], [111, 222]] -> [[111, 222], [222, 333]]
// This exists in case you pass in a resolution that is already in module.exports.defaultResolutions
var uniqueResolutions = (resolutions, ignoreDefaultResolutions) => {
    if (resolutions === undefined) {
        resolutions = [];
    }

    var allResolutions = resolutions;
    if (ignoreDefaultResolutions === false) {
        allResolutions = resolutions.concat(module.exports.defaultResolutions);
    }

    return _.uniq(allResolutions, resolution => {
        return resolution.join(' ');
    });
};

var snapOne = (testContext, elem, options) => {
    var flow = browser.controlFlow();
    var snapFn = () => {
        return getScreenshotNameFromContext(testContext).then(screenshotName => {
            return browser.takeScreenshot().then(screenshotData => {
                var deferred = protractor.promise.defer();
                lwip.open(new Buffer(screenshotData, 'base64'), 'png', (err, image) => {
                    if (err) {
                        console.log('Error opening screenshot:', err);
                        return deferred.reject();
                    }
                    if (elem === undefined) {
                        // without an `elem` to crop to, rename the file to be the full screenshot
                        var fullScreenName = screenshotName + '-full-screen.png';
                        return saveImage(image, fullScreenName, deferred, options);
                    } else {
                        var croppedName = [screenshotName, '-', elem.locator().toString() + '.png'].join('');
                        return cropAndSaveImage(image, elem, croppedName, deferred, options);
                    }
                });
                return deferred.promise;
            });
        });
    };
    return flow.execute(snapFn);
};

/**
   Calling this function with no `elem` will take a screenshot of the entire browser window.
   @param {Object} testContext - The `this` object from the current mocha test.
   @param {WebElement} [elem=] - Crop screenshot to contain just `elem`. If undefined, snap entire browser screen.
   @param {Array<Array<Number>>} resolutions - List of two-part arrays containing browser resolutions to snap.
   @param {Object} config - Options to be used for just this call.
   @param {Boolean} config.ignoreDefaultResolutions - Ignore using default resolutions for just one call.
   @returns {undefined}
*/
exports.snap = (testContext, elem, options) => {
    if (module.exports.disable) {
        return;
    }

    if (options === undefined) {
        options = {};
    }

    options = _.defaults(options, {
        resolutions: [],
        ignoreDefaultResolutions: false,
        threshold: module.exports.threshold
    });

    var flow = browser.controlFlow();
    var allResolutions = uniqueResolutions(options.resolutions, options.ignoreDefaultResolutions);
    if (allResolutions.length) {
        return browser.driver.manage().window().getSize().then(originalResolution => {
            var originalWidth = originalResolution.width;
            var originalHeight = originalResolution.height;
            _.forEach(allResolutions, resolution => {
                var takeEachScreenshotFn = () => {
                    var width = resolution[0];
                    var height = resolution[1];
                    browser.driver.manage().window().setSize(width, height);
                    snapOne(testContext, elem, options);
                };
                return flow.execute(takeEachScreenshotFn);
            });
            browser.driver.manage().window().setSize(originalWidth, originalHeight);
            snapOne(testContext, elem, options);
        });
    } else {
        snapOne(testContext, elem, options);
    }
};

exports.configure = options => {
    _.forEach(options, (value, key) => {
        module.exports[key] = value;
    });
};
