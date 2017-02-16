'use strict';

let path = require('path');

const _ = require('lodash');

const descriptions = require('./descriptions');

let setConfigDefaults = config => {
    if (config.snappit === undefined) {
        config.snappit = {};
    }

    config.snappit = _.default(config.snappit, {
        screenshotsDirectory: './screenshots',
        threshold: 3
    });

    if (config.snappit.cicd === undefined) {
        config.snappit.cicd = {};
    }

    config.snappit.cicd = _.defaults(config.snappit.cicd, {
        githubTokenEnvironmentVariable: 'ghToken',
        targetBranch: undefined, // will default to project pull request's target branch
        privateRepo: false,
        ignoreSSLWarnings: false,
        githubEnterprise: false
    });

    if (config.snappit.cicd.serviceAccount === undefined) {
        config.snappit.cicd.serviceAccount = {};
    }

    config.snappit.cicd.serviceAccount = _.defaults(config.snappit.cicd.serviceAccount, {
        userEmail: '', // this can be blank, but should be set anyway
        teamId: undefined
    });

    if (config.snappit.cicd.statuses === undefined) {
        config.snappit.cicd.statuses = {};
    }

    config.snappit.cicd.statuses = _.defaults(config.snappit.cicd.statuses, {
        enabled: true,
        context: 'continuous-integration/snappit-visreg',
        description: 'Visual regression detected -- diff available'
    });

    if (config.snappit.cicd.messages === undefined) {
        config.snappit.cicd.messages = {};
    }

    config.snappit.cicd.messages = _.defaults(config.snappit.cicd.messages, {
        branchName: function (vars) {
            return `SHA-${vars.sha1}`;
        },

        commitMessage: function (vars) {
            return `chore(screenshots): For ${vars.repoSlug}@${vars.sha1}`;
        },

        pullRequestBody: function (vars) {
            let offendingSha = `See ${vars.repoSlug}@${vars.sha1}`;
            let buildLogFooter = `\n\nAlso, the [build log](${vars.buildUrl}) is available.`;
            if (config.snappit.cicd.statuses.enabled) {
                return `${descriptions.pullRequestBodyWithStatuses}\n\n${offendingSha}${buildLogFooter}`;
            }

            if (vars.pullRequestNumber) {
                // Not using statuses...fallback to legacy behavior of creating a mention
                return `See ${vars.repoSlug}#${vars.pullRequestNumber}.${buildLogFooter}`
            }

            return `See ${offendingSha}. Pull request number unknown.${buildLogFooter}`;
        },

        pullRequestTitle: function (vars) {
            if (vars.pullRequestNumber && !config.snappit.cicd.statuses.enabled) {
                return `Screenshots for ${vars.repoSlug}#${vars.pullRequestNumber}`
            }

            return `Screenshots for ${vars.repoSlug}@${vars.sha1}`;
        }
    });

    return config;
};

exports.fromProtractorConf = protractorConfPath => {
    let config = require(path.join(process.cwd(), protractorConfPath)).config;
    return setConfigDefaults(config);
};
