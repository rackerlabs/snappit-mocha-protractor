var path = require('path');

var _ = require('lodash');
var chalk = require('chalk');
var fs = require('fs-extra');
var lwip = require('lwip');
var resemble = require('node-resemble');
var zfill = require('zfill');

module.exports.logWarnings = true;
module.exports.threshold = 4; // percent
module.exports.defaultResolutions = [];
module.exports.disable = false;

var noScreenshot = function (element, reason, fileName) {
    if (module.exports.logWarnings) {
        console.log('Error: element', element.locator().toString(), reason, 'No screenshot taken.');
    }
};

var fileSystemFriendly = function (fileName) {
    return fileName.replace(/([!.,+?<>:*|"])/g, '').replace(/\s+/g, '-');
};

var buildFullNameFromParents = function (testInformation, acc) {
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
var handleMochaHooks = function (testContext) {
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

var getScreenshotNameFromContext = function (testContext) {
    return browser.getCapabilities().then(function (capabilities) {
        return browser.driver.manage().window().getSize().then(function (resolution) {
            var resolutionString = [zfill(resolution.width, 4), zfill(resolution.height, 4)].join('x');
            var browserName = capabilities.caps_.browserName;
            var screenshotDir = path.join('screenshots', browserName);
            var test = handleMochaHooks(testContext);
            var fullyQualifiedPath = test.file.split('/');
            var commonPath = _.takeWhile(path.resolve(__dirname).split('/'), function (directoryPart, index) {
                return directoryPart === fullyQualifiedPath[index];
            }).join('/');
            var relativeFilePath = fullyQualifiedPath.join('/').replace(commonPath, '').replace(/\.js$/, '');
            var rawName = path.join(screenshotDir, relativeFilePath, test.fullTitle, resolutionString);
            return fileSystemFriendly(rawName);
        });
    });
};

var writeImage = function (image, screenshotName, deferred) {
    var flow = browser.controlFlow();
    var writeFileFn = function () {
        fs.mkdirs(path.dirname(screenshotName));
        image.writeFile(screenshotName, function (err) {
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
var saveImage = function (image, screenshotName, deferred) {
    var flow = browser.controlFlow();
    if (fs.existsSync(screenshotName)) {
        var toBufferFn = function () {
            image.toBuffer('png', { compression: 'none' }, function (err, imageBuffer) {
                if (err) {
                    console.log('Error creating comparison image buffer', err);
                    deferred.reject();
                }
                var comparisonFn = function () {
                    var comparison = resemble(imageBuffer).compareTo(screenshotName);
                    comparison.onComplete(function (data) {
                        if (parseFloat(data.misMatchPercentage) > module.exports.threshold) {
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
        return writeImage(image, screenshotName, deferred);
    }
};

var cropAndSaveImage = function (image, elem, imageName, deferred) {
    return elem.isPresent().then(function (present) {
        if (present) {
            var info = [elem.isDisplayed(), elem.getSize(), elem.getLocation()];
            return protractor.promise.all(info).then(function (info) {
                var displayed = info[0];
                var size = info[1];
                var location = info[2];
                image.crop(
                    location.x, // left
                    location.y, // top
                    location.x + size.width, // right
                    location.y + size.height, // bottom
                    function (err, image) {
                        if (err) {
                            console.log('Error', err);
                            return deferred.reject();
                        }
                        if (!displayed) {
                            // cropped to zero means deleted entirely, with warning
                            noScreenshot(elem, 'not displayed.', imageName);
                            return deferred.reject();
                        }
                        return saveImage(image, imageName, deferred);
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
var uniqueResolutions = function (resolutions, ignoreDefaultResolutions) {
    if (resolutions === undefined) {
        resolutions = [];
    }

    var allResolutions = resolutions;
    if (ignoreDefaultResolutions === false) {
        allResolutions = resolutions.concat(module.exports.defaultResolutions);
    }

    return _.unique(allResolutions, function (resolution) {
        return resolution.join(' ');
    });
};

var snapOne = function (testContext, elem) {
    var flow = browser.controlFlow();
    var snapFn = function () {
        return getScreenshotNameFromContext(testContext).then(function (screenshotName) {
            return browser.takeScreenshot().then(function (screenshotData) {
                var deferred = protractor.promise.defer();
                lwip.open(new Buffer(screenshotData, 'base64'), 'png', function (err, image) {
                    if (err) {
                        console.log('Error opening screenshot:', err);
                        return deferred.reject();
                    }
                    if (elem === undefined) {
                        // without an `elem` to crop to, rename the file to be the full screenshot
                        var fullScreenName = screenshotName + '-full-screen.png';
                        return saveImage(image, fullScreenName, deferred);
                    } else {
                        var croppedName = [screenshotName, '-', elem.locator().toString() + '.png'].join('');
                        return cropAndSaveImage(image, elem, croppedName, deferred);
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
exports.snap = function (testContext, elem, resolutions, options) {
    if (module.exports.disable) {
        return;
    }

    if (options === undefined) {
        options = {};
    }

    options = _.defaults(options, {
        ignoreDefaultResolutions: false
    });

    var flow = browser.controlFlow();
    var allResolutions = uniqueResolutions(resolutions, options.ignoreDefaultResolutions);
    if (allResolutions.length) {
        return browser.driver.manage().window().getSize().then(function (originalResolution) {
            var originalWidth = originalResolution.width;
            var originalHeight = originalResolution.height;
            _.forEach(allResolutions, function (resolution) {
                var takeEachScreenshotFn = function () {
                    var width = resolution[0];
                    var height = resolution[1];
                    browser.driver.manage().window().setSize(width, height);
                    snapOne(testContext, elem);
                };
                return flow.execute(takeEachScreenshotFn);
            });
            browser.driver.manage().window().setSize(originalWidth, originalHeight);
            snapOne(testContext, elem);
        });
    } else {
        snapOne(testContext, elem);
    }
};

exports.configure = function (options) {
    _.forEach(options, function (value, key) {
        module.exports[key] = value;
    });
};
