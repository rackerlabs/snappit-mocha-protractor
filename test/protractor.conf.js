exports.config = {
    framework: 'mocha',

    seleniumAddress: 'http://localhost:4444/wd/hub',
    baseUrl: 'https://angularjs.org',

    specs: [
        './spec.js'
    ],

    snappit: {
        screenshotsDirectory: './screenshots',
        threshold: 5,
        defaultResolutions: [[768, 1024], [1024, 768], // tablet
                             [320, 568], [568, 320]],  // phone
        cicd: {
            serviceAccount: {
                userName: 'comeatmebro',
                userEmail: 'comeatmebro@users.noreply.github.com'
            },
            githubTokenEnvironmentVariable: 'ghToken',
            screenshotsRepo: 'github.com/rackerlabs/encore-ui-screenshots',
            projectRepo: 'github.com/rackerlabs/encore-ui',
            targetBranch: 'master',
            commitMessage: function (vars) {
                return `chore(screenshots): Visual diff against ${vars.sha1}`;
            }
        }
    },

    onPrepare: function () {
        var chai = require('chai').use(require('chai-as-promised'));
        chai.config.truncateThreshold = 0;
        expect = chai.expect;
        browser.driver.manage().window().setSize(1366, 768); // laptop
        screenshot = require('../index');
        screenshot.configure({
            threshold: 5,
            defaultResolutions: [[768, 1024], [1024, 768], // tablet
                                 [320, 568], [568, 320]]  // phone
        });
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
