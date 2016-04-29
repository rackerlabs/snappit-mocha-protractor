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
        defaultResolutions: [[768, 1024], [1024, 768]], // tablet
        cicd: {
            githubEnvironmentVariableToken: 'ghEnterpriseToken',
            githubEnterprise: true,
            ignoreSSLWarnings: true,
            serviceAccount: {
                userName: 'rt-inova-encoresvc',
                teamId: 1567
            },
            screenshotsRepo: 'https://github.rackspace.com/EncoreUI/snappit-mocha-protractor-screenshots-jenkins-enterprise',
            projectRepo: 'https://rackspace.com/rackerlabs/snappit-mocha-protractor'
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
