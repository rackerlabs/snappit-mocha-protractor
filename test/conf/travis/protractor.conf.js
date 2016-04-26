exports.config = {
    framework: 'mocha',

    seleniumAddress: 'http://localhost:4444/wd/hub',
    baseUrl: 'https://angularjs.org',

    specs: [
        '../.././spec.js'
    ],

    snappit: {
        screenshotsDirectory: './screenshots',
        threshold: 5,
        disable: false,
        logWarnings: true,
        defaultResolutions: [[768, 1024], [1024, 768], // tablet
                             [320, 568], [568, 320]],  // phone
        cicd: {
            serviceAccount: {
                userName: 'comeatmebro',
                userEmail: 'comeatmebro@users.noreply.github.com',
                teamId: 442108
            },
            screenshotsRepo: 'https://github.com/rackerlabs/snappit-mocha-protractor-screenshots-travis',
            projectRepo: 'https://github.com/rackerlabs/snappit-mocha-protractor'
        }
    },

    onPrepare: function () {
        var chai = require('chai').use(require('chai-as-promised'));
        chai.config.truncateThreshold = 0;
        expect = chai.expect;
        browser.driver.manage().window().setSize(1366, 768); // laptop
        screenshot = require('../../../index');
    },

    capabilities: {
        browserName: 'firefox'
    },

    mochaOpts: {
        enableTimeouts: false,
        reporter: 'spec',
        slow: 3000,
        ui: 'bdd'
    }
};
