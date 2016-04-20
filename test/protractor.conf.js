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
            githubTokenEnvironmentVariable: 'ghToken',
            screenshotsRepo: 'https://github.com/rackerlabs/snappit-mocha-protractor-screenshots',
            projectRepo: 'https://github.com/rackerlabs/snappit-mocha-protractor',
            targetBranch: 'master',
            messages: {
                branchName: function (vars) {
                    return `SHA-${vars.sha1}`;
                },
                commitMessage: function (vars) {
                    return `chore(screenshots): Visual diff against ${vars.sha1}`;
                },
                pullRequestBody: function (vars) {
                    return `See ${vars.repoSlug}#${vars.pullRequestNumber}`;
                },
                pullRequestTitle: function (vars) {
                    return `Screenshots for ${vars.repoSlug}#${vars.pullRequestNumber}`;
                }
            }
        }
    },

    onPrepare: function () {
        var chai = require('chai').use(require('chai-as-promised'));
        chai.config.truncateThreshold = 0;
        expect = chai.expect;
        browser.driver.manage().window().setSize(1366, 768); // laptop
        screenshot = require('../index');
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
