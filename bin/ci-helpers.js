#!/usr/bin/env node

'use strict';

let execSync = require('child_process').execSync;
let https = require('https');
let path = require('path');
let url = require('url');

var _ = require('lodash');

let args = process.argv.slice(2);
let action = args[1];

let showHelpTextAndQuit = (helpText, actions) => {
    console.log(helpText);
    _.each(actions, (details, a) => { console.log(a + ':', details.description) });
    process.exit(0);
};

if (args[0] === undefined) {
    showHelpTextAndQuit('Your first argument must be the path to your protractor.conf.js file.', {});
};

let config = require(path.join(process.cwd(), args[0])).config;

let projectRepo = url.parse(config.snappit.cicd.projectRepo);
let screenshotsRepo = url.parse(config.snappit.cicd.screenshotsRepo);
let token = process.env[config.snappit.cicd.githubTokenEnvironmentVariable];
let currentBranch = execSync('git branch --no-color | grep "^*\s" | cut -c3-').toString('utf-8');

let cloneDescription = `
Sets up and clones the screenshots repository into the main project repository.
This includes creating the screenshots repo first, if it does not exist.
It will then create a fork of this screenshots repository, if that does not exist.
Finally, it clones the screenshots repository (as a submodule) into the directory set in 'config.snappit.cicd.screenshotsDirectory'.
Run this command before you have run your visual regression test using protractor.
`;

let commitDescription = `
Commit all changed screenshots to the submodule on the branch name specified in 'config.snappit.cicd.messages.branchName'.
Will use the commit message format specified in the config entry for 'config.snappit.cicd.messages.commitMessage'.
Run this command after you have run your visual regression test using protractor.
`;

let pushDescription = `
Push up the changes introduced in the "commit" step, on the branch specified in 'config.snappit.cicd.messages.branchName'.
The changes are pushed to the fork of the screenshots repository.
`;

let prDescription = `
Create a pull request against the target branch of the screenshots repository, specified in 'config.snappit.cicd.targetBranch'.
The pull request originates from the fork that the service account created in the "clone" step.
The pull request title is configurable from the 'config.snappit.cicd.messages.pullRequestTitle' entry.
The pull request body is configurable from the 'config.snappit.cicd.messages.pullRequestBody' entry.
`;

let actions = {
    clone: {
        description: cloneDescription,
        get fn() { return exports.createForkAndClone; }
    },

    commit: {
        description: commitDescription,
        get fn() { return exports.commitScreenshots; }
    },

    push: {
        description: pushDescription,
        get fn() { return exports.pushScreenshots; }
    },

    pr: {
        description: prDescription,
        get fn() { return exports.makePullRequest; }
    }
};

let helpText = `
Usage: snappit-ci configFile [${_.keys(actions).join('|')}]

These actions are meant to be run in order, during different steps in your end to end tests.

Example:

\`npm bin\`/snappit-ci protractor.conf.js clone
\`npm bin\`/protractor
\`npm bin\`/snappit-ci protractor.conf.js commit
\`npm bin\`/snappit-ci protractor.conf.js push
\`npm bin\`/snappit-ci protractor.conf.js pr

Actions:
`;
if (action === undefined || !_.includes(_.keys(actions), action)) {
    showHelpTextAndQuit(helpText, actions);
}

/**
 * Codeship doesn't natively support getting you the branch number of a pull request
 * because they build as soon as a commit is pushed, not when a PR is opened. So,
 * this searches for any pull requests that match the current branch. If no pull request
 * is open, then a warning text is returned instead.
 */
let findPullRequestNumber = (branchName) => {
    var options = {
        hostname: `api.${projectRepo.hostname}`,
        path: `/repos${projectRepo.path}/pulls?head=${orgName}:${branchName}`,
        method: 'GET',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
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

/**
 * Supported CI Environments. All this means is that there's some "convenience" vars available
 * to users to construct custom commit messages, pull request title/body contents, etc. They
 * are here because the default behavior is to reference the pull request that snappit is taking
 * screenshots of via a github mention: https://github.com/blog/957-introducing-issue-mentions.
 * The values under each key are under a getter function to prevent javascript from evaluating the contents
 * of those values in environments where it doesn't make sense (such as in local testing).
 *
 * NOTE:
 * Since codeship's pullRequestNumber is fetched via an api call, all `pullRequestNumber`
 * values are returned as promises to ensure a more consistent user experience.
 */
let supportedCIEnvironments = {
    travis: {
        get name() { return 'travis'; },
        get url() { return 'https://travis-ci.org'; },
        get sha1() { return process.env.TRAVIS_COMMIT_RANGE.slice(43, 50); },
        get pullRequestNumber() { return Promise.resolve(process.env.TRAVIS_PULL_REQUEST); }
    },

    codeship: {
        get name() { return 'codeship'; },
        get url() { return 'https://codeship.io'; },
        get sha1() { return process.env.CI_COMMIT_ID.slice(0, 7); },
        get pullRequestNumber() { return findPullRequestNumber(currentBranch); },
    },

    jenkins: {
        get name() { return 'jenkins-ghprb'; },
        get url() { return 'https://wiki.jenkins-ci.org/display/JENKINS/GitHub+pull+request+builder+plugin'; },
        get sha1() { return process.env.sha1.slice(0, 7); },
        get pullRequestNumber() { return Promise.resolve(process.env.ghprbPullId); }
    },

    undefined: {
        get name() { return 'unknown-ci-provider'; },
        get url() { return 'https://github.com/rackerlabs/snappit-mocha-protractor/issues/new'; },
        get sha1() { return 'sha1-unavailable'; },
        get pullRequestNumber() { return Promise.resolve('pull-request-number-unavailable'); }
    }
};

let unknownCIEnvironmentError = `
Your project is running in an unkown CI environment. You'll need to configure your
commit messages, title and body without relying on any convenience variables provided
in this application. This includes the current build's sha1 reference, pull request number,
or github pull requeest link. You can still get this information by specifying your own commit
messages, title and body by using 'process.env.YOUR_COMMIT_SHA', and other techniques inside
of the 'snappit' entry of your protractor configuration file. If you don't do this, you'll have
some default messages appear in for the commit message, pull request body, etc.

Please report this to

https://github.com/rackerlabs/snappit-mocha-protractor/issues/new

and specify your CI setup to have it added it to the list of supported environments.

Supported CI environments:
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

    console.log(unknownCIEnvironmentError);
    _.each(supportedCIEnvironments, (details, name) => {
        // don't print the undefined ci env details
        if (name !== 'undefined') {
            console.log(name + ': ' + details.url);
        }
    });
    console.log();
};

let currentEnvVars = supportedCIEnvironments[currentCIEnvironment()];
// all environments have these vars that are always the same
let vars = Object.defineProperties(currentEnvVars, {
    repoSlug: {
        get: () => projectRepo.path.slice(1) // drop leading "/" character
    },

    branch: {
        get: () => currentBranch
    }
});

let repositoryExists = (repoUrl) => {
    let url = `https://api.${repoUrl.hostname}/repos${repoUrl.path}`;
    let repositoryInfo = JSON.parse(execSync(`curl ${url} 2>/dev/null`).toString('utf-8'));
    return repositoryInfo.message !== 'Not Found';
};

let createRepository = (repoUrl) => {
    let org = repoUrl.path.match(/\/.*\//)[0];
    var data = {
        name: _.last(repoUrl.path.split('/')),
        auto_init: true
    };

    if (config.snappit.cicd.serviceAccount.teamId !== undefined) {
        data.team_id = config.snappit.cicd.serviceAccount.teamId;
    }

    var options = {
        hostname: `api.${repoUrl.hostname}`,
        path: `/orgs${org}repos`,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            var data = [];
            if (res.statusCode !== 201) {
                res.on('data', d => { data.push(d.toString('utf-8'))});
                res.on('end', () => {
                    throw new Error(`(HTTP ${res.statusCode}) Something went wrong while creating the repository ${repoUrl.href}:\n${data.join('')}`);
                });
            }
            resolve(`Created a new repository at ${repoUrl.href}`);
        });

        req.write(JSON.stringify(data));

        req.end();
    });

};

/**
 * Will fork under the service account's profile, not an org that you can specify.
 * Perhaps someday that will be a nice feature.
 */
let forkRepository = (repoUrl) => {
    // let user = config.snappit.cicd.serviceAccount.userName;
    // let repoName = _.last(repoUrl.path.split('/'));

    var options = {
        hostname: `api.${repoUrl.hostname}`,
        path: `/repos${repoUrl.path}/forks`,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            var data = [];
            if (res.statusCode !== 202) {
                res.on('data', d => { data.push(d.toString('utf-8'))});
                res.on('end', () => {
                    throw new Error(`(HTTP ${res.statusCode}) Something went wrong while forking the repository ${repoUrl.href}:\n${data.join('')}`);
                });
            }
            resolve(`Forked the repository ${repoUrl.href}`);
        });

        req.end();
    });
};

let cloneScreenshotsRepo = () => {
    let cloneUrl = `https://${token}@${screenshotsRepo.host}${screenshotsRepo.path}.git`;
    // don't log any of this information out to the console!
    execSync(`git submodule add -f ${cloneUrl} screenshots > /dev/null`);
};

exports.createForkAndClone = () => {
    if (!repositoryExists(projectRepo)) {
        throw new Error(`Main project repo ${projectRepo.href} does not exist!`);
    }

    let repoAction = Promise.resolve(`Repository ${screenshotsRepo.href} already exists.`);
    if (!repositoryExists(screenshotsRepo)) {
        console.log(`Screenshots repository ${screenshotsRepo.href} not found. Creating...`);
        repoAction = createRepository(screenshotsRepo);
    }

    // will either create a repo (if it doesn't exist), or return a message stating that it does exist
    return repoAction.then(message => {
        console.log(message);
        let user = config.snappit.cicd.serviceAccount.userName;
        let repoName = _.last(screenshotsRepo.path.split('/'));
        let forkedRepo = url.parse(`https://${screenshotsRepo.hostname}/${user}/${repoName}`);
        return forkRepository(screenshotsRepo).then((message) => {
            console.log(message);
            do {
                setTimeout(() => {
                    console.log(`Waiting on forked repository ${forkedRepo.href} to appear...`)
                }, 1000);
            } while (!repositoryExists(forkedRepo))
            cloneScreenshotsRepo();
        });
    });
};

let cmd = command => execSync(`${command}`, { stdio: [0, 1, 2] });
exports.commitScreenshots = () => {
    let cmds = [
        `cd ${config.snappit.screenshotsDirectory}`,
        `git checkout -b ${config.snappit.cicd.messages.branchName(vars)}`,
        `git config user.name "${config.snappit.cicd.serviceAccount.userName}"`,
        `git config user.email "${config.snappit.cicd.serviceAccount.userEmail}"`,
        `git add -A`,
        `git status -sb`,
        `git commit -m "${config.snappit.cicd.messages.commitMessage(vars)}"`
    ];
    cmd(cmds.join('; '));
};

exports.pushScreenshots = () => {
    // pushes to the fork created by the service account, not the main screenshots repo
    let user = config.snappit.cicd.serviceAccount.userName;
    let repoName = _.last(screenshotsRepo.path.split('/'));
    let pushUrl = `https://${token}@${screenshotsRepo.hostname}/${user}/${repoName}.git`;
    // don't log any of this information out to the console!
    let sensitiveCommand = [
        `cd ${config.snappit.screenshotsDirectory}`,
        `git push ${pushUrl} ${config.snappit.cicd.messages.branchName(vars)} > /dev/null 2>&1`
    ].join('; ');

    execSync(sensitiveCommand);
};

exports.makePullRequest = () => {
    var data = {
        title: config.snappit.cicd.meessages.pullRequestTitle(vars),
        body: config.snappit.cicd.meessages.pullRequestBody(vars),
        base: config.snappit.cicd.targetBranch,
        head: `${config.snappit.cicd.serviceAccount.userName}:${config.snappit.cicd.meessages.branchName(vars)}`
    };

    var options = {
        hostname: `api.${projectRepo.hostname}`,
        path: `/repos${projectRepo.path}/pulls`,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            var data = [];
            if (res.statusCode !== 201) {
                res.on('data', d => { data.push(d.toString('utf-8'))});
                res.on('end', () => {
                    throw new Error(`(HTTP ${res.statusCode}) Something went wrong with the pull request:\n${data.join('')}`);
                });
            }
            resolve();
        });

        req.write(JSON.stringify(data));

        req.end();
    });

};

if (require.main === module) {
    actions[action].fn();
};
