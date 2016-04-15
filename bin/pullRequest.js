#!/usr/bin/env node

'use strict';

var https = require('https');

var _ = require('lodash');

exports.findPullRequestNumber = (orgName, branchName) => {
    var options = {
        hostname: 'api.github.com',
        path: `/repos/rackerlabs/snappit-mocha-protractor/pulls?head=${orgName}:${branchName}`,
        method: 'GET',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            // 'Authorization': 'token ' + process.env.ghToken
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, function (res) {
            var response = [];
            res.on('data', d => {
                response.push(d.toString('utf-8'));
            });

            res.on('end', () => {
                let pullRequests = JSON.parse(response.join(''));
                if (pullRequests.length) {
                    return resolve(pullRequests[0].number);
                }

                return reject('No pull request has been created against this branch yet');
            });
        });

        req.end();

    });

};

let supportedCIEnvironments = {
    travis: { name: 'travis', url: 'https://travis-ci.org' },
    codeship: { name: 'codeship', url: 'https://codeship.io' },
    jenkins: { name: 'jenkins-ghprb', url: 'https://wiki.jenkins-ci.org/display/JENKINS/GitHub+pull+request+builder+plugin' }
};

let unknownCIEnvironmentError = `
Your project is running in an unkown CI environment. You'll need to configure your
commit messages, title and body without relying on any convenience variables provided
in this application. This includes the current build's sha1 reference, pull request number,
or github pull requeest link. You can still get this information by specifying your own commit
messages, title and body by using 'process.env.YOUR_COMMIT_SHA', and other techniques inside
of the 'snappit' entry of your protractor configuration file.

Please report this to

https://github.com/rackerlabs/snappit-mocha-protractor/issues

and specify your CI setup to have it added it to the list of supported environments:

${ _.map(supportedCIEnvironments, (details, name) => { name + ': ' + details.url }) }
`;

let currentCIEnvironment = () => {
    if (process.env.TRAVIS) {
        return supportedCIEnvironments.travis.name;
    }

    if (process.env.CI_NAME === 'codeship') {
        return supportedCIEnvironments.codeship.name;
    }

    if (process.env.sha1) {
        return supportedCIEnvironments.jenkins.name;
    }

    throw new Error(unknownCIEnvironmentError);

};

let sha1 = ciEnv => {
    return {
        travis: process.env.TRAVIS_COMMIT_RANGE.slice(43, 50),
        codeship: process.env.CI_COMMIT_ID.slice(0, 7),
        'jenkins-ghprb': process.env.sha1.slice(0, 7)
    }
};
