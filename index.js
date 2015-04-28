var path = require('path');

var _ = require('lodash');
var fs = require('fs-extra');
var lwip = require('lwip');

module.exports.logWarnings = true;

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
        var browserName = capabilities.caps_.browserName;
        var screenshotDir = path.join('screenshots', browserName);
        var test = handleMochaHooks(testContext);
        var fullyQualifiedPath = test.file.split('/');
        var commonPath = _.takeWhile(path.resolve(__dirname).split('/'), function (directoryPart, index) {
            return directoryPart === fullyQualifiedPath[index];
        }).join('/');
        var relativeFilePath = fullyQualifiedPath.join('/').replace(commonPath, '').replace(/\.js$/, '');
        var rawName = path.join(screenshotDir, relativeFilePath, test.fullTitle);
        return fileSystemFriendly(rawName);
    });
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
                        fs.mkdirs(path.dirname(imageName));
                        image.writeFile(imageName, function (err) {
                            if (err) {
                                console.log('Error saving cropped screenshot:', err);
                                return deferred.reject();
                            }
                            return deferred.fulfill();
                        });
                    }
                );
            });
        }  else {
            noScreenshot(elem, 'not present.', imageName);
            return deferred.reject();
        }
    });
};

/**
   Calling this function with no `elem` will take a screenshot of the entire browser window.
   @param {String} screenshotName - Name of the screenshot to save.
   @param {WebElement} [elem=] - Crop screenshot to contain just `elem`. If undefined, snap entire browser screen.
   @returns {undefined}
*/
exports.snap = function (testContext, elem) {
    var flow = browser.controlFlow();
    var snapFn = function () {
        return getScreenshotNameFromContext(testContext).then(function (screenshotName) {
            return browser.takeScreenshot().then(function (screenshotData) {
                var handleScreenshot = function () {
                    var deferred = protractor.promise.defer();
                    lwip.open(new Buffer(screenshotData, 'base64'), 'png', function (err, image) {
                        if (err) {
                            console.log('Error opening screenshot:', err);
                            return deferred.reject();
                        }
                        if (elem === undefined) {
                            // without an `elem` to crop to, rename the file to be the full screenshot
                            var fullScreenName = screenshotName + '-full-screen.png';
                            fs.mkdirs(path.dirname(fullScreenName));
                            image.writeFile(fullScreenName, function (err) {
                                if (err) {
                                    console.log('Error saving screenshot:', err);
                                    return deferred.reject();
                                }
                                return deferred.fulfill();
                            });
                        } else {
                            var croppedName = [screenshotName, '-', elem.locator().toString() + '.png'].join('');
                            cropAndSaveImage(image, elem, croppedName, deferred);
                        }
                    });
                    return deferred.promise;
                };
                return flow.execute(handleScreenshot);
            });
        });
    };
    return flow.execute(snapFn);
};
