#!/usr/bin/env node

'use strict';

let execSync = require('child_process').execSync;
let https = require('https');
let path = require('path');
let url = require('url');

let _ = require('lodash');

let args = process.argv.slice(2);
let action = args[1];

function cmd(command) {
    execSync(`${command}`, { stdio: [0, 1, 2] })
};

function showHelpTextAndQuit(helpText, actions) {
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
let org = projectRepo.path.match(/\/.*\//)[0].replace(/\//g, '');
let userName = config.snappit.cicd.serviceAccount.userName;
let token = process.env[config.snappit.cicd.githubTokenEnvironmentVariable];

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

/**
 * Actions that are supported by the ci helpers. If you want to add new functions, this is the place to do it.
 * All action references throughout the help text, etc., are generated via this object. Define all actions here.
 */
let actions = {
    clone: {
        description: cloneDescription,
        fn: createForkAndClone
    },

    commit: {
        description: commitDescription,
        fn: commitScreenshots
    },

    push: {
        description: pushDescription,
        fn: pushCommit
    },

    pr: {
        description: prDescription,
        fn: makePullRequest
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
 * Supported CI Environments. All this means is that there's some "convenience" vars available
 * to users to construct custom commit messages, pull request title/body contents, etc. They
 * are here because the default behavior is to reference the pull request that snappit is taking
 * screenshots of via a github mention: https://github.com/blog/957-introducing-issue-mentions.
 * The values under each key are under a getter function to prevent javascript from evaluating the contents
 * of those values in environments where it doesn't make sense (such as in local testing).
 */
let supportedCIEnvironments = {
    travis: {
        get name() { return 'travis'; },
        get url() { return 'https://travis-ci.org'; },
        get sha1() { return process.env.TRAVIS_COMMIT_RANGE.slice(43, 50); },
        get pullRequestNumber() { return process.env.TRAVIS_PULL_REQUEST; },
        get branch() {
            // https://graysonkoonce.com/getting-the-current-branch-name-during-a-pull-request-in-travis-ci/
            if (process.env.TRAVIS_PULL_REQUEST === 'false') {
                return process.env.TRAVIS_BRANCH;
            }
            return findBranchName(this.pullRequestNumber);
        }
    },

    codeship: {
        get name() { return 'codeship'; },
        get url() { return 'https://codeship.io'; },
        get sha1() { return process.env.CI_COMMIT_ID.slice(0, 7); },
        // codeship builds when new commits are pushed, not when pull requests are opened
        get pullRequestNumber() { return findPullRequestNumber(this.branch); },
        get branch() { return process.env.CI_BRANCH; }
    },

    jenkins: {
        get name() { return 'jenkins-ghprb'; },
        get url() { return 'https://wiki.jenkins-ci.org/display/JENKINS/GitHub+pull+request+builder+plugin'; },
        get sha1() { return process.env.sha1.slice(0, 7); },
        get pullRequestNumber() { return process.env.ghprbPullId; },
        get branch() { return process.env.ghprbSourceBranch; }
    },

    undefined: {
        get name() { return 'unknown-ci-provider'; },
        get url() { return 'https://github.com/rackerlabs/snappit-mocha-protractor/issues/new'; },
        get sha1() { return 'sha1-unavailable'; },
        get pullRequestNumber() { return 'pull-request-number-unavailable'; },
        get branch() { return 'branch-unavailable'; }
    }
};

let unknownCIEnvironmentError = `
Your project is running in an unkown CI environment. You'll need to configure your
commit messages, title and body without relying on any convenience variables provided
in this application. This includes the current build's sha1 reference, pull request number,
or github pull request link. You can still get this information by specifying your own commit
messages, title and body by using 'process.env.YOUR_COMMIT_SHA', and other techniques inside
of the 'snappit' entry of your protractor configuration file. If you don't do this, you'll have
some default messages appear in for the commit message, pull request body, etc.

Please report this to

https://github.com/rackerlabs/snappit-mocha-protractor/issues/new

and specify your CI setup to have it added it to the list of supported environments.
`;

function getCurrentCIEnvironment() {
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
    console.log('Supported CI environments:');
    _.each(supportedCIEnvironments, (details, name) => {
        // don't print the undefined ci env details
        if (name !== 'undefined') {
            console.log(name + ': ' + details.url);
        }
    });
    console.log();
};

let currentEnvVars = supportedCIEnvironments[getCurrentCIEnvironment()];

// all environments have these vars that are always the same
let vars = Object.defineProperties(currentEnvVars, {
    repoSlug: {
        get: () => projectRepo.path.slice(1) // drop leading "/" character
    }
});

function repositoryExists(repoUrl) {
    let url = `https://api.${repoUrl.hostname}/repos${repoUrl.path}`;
    let repositoryInfo = JSON.parse(execSync(`curl ${url} 2>/dev/null`).toString('utf-8'));
    return repositoryInfo.message !== 'Not Found';
};

/**
 * Travis doesn't natively support getting you the branch name from a build
 * because they use the same environment variable for both "push" and "pr" builds. So,
 * this searches for any branch names that match the current pull request number.
 * If no branch is found, then a warning text is returned instead.
 */
function findBranchName(pullRequestNumber) {
    let url = `https://api.${projectRepo.hostname}/repos${projectRepo.path}/pulls/${pullRequestNumber}`;
    let pullRequest = JSON.parse(execSync(`curl -H "Authorization: token ${token}" ${url} 2>/dev/null`).toString('utf-8'));
    if (pullRequest.message === undefined) {
        return pullRequest.head.ref;
    }
};

/**
 * Codeship doesn't natively support getting you the pull request number from a build
 * because they build as soon as a commit is pushed, not when a PR is opened. So,
 * this searches for any pull requests that match the current branch. If no pull request
 * is open, then a warning text is returned instead.
 */
function findPullRequestNumber(branchName) {
    let url = `https://api.${projectRepo.hostname}/repos${projectRepo.path}/pulls?head=${org}:${branchName}`;
    let pullRequests = JSON.parse(execSync(`curl -H "Authorization: token ${token}" ${url} 2>/dev/null`).toString('utf-8'));
    if (pullRequests.length) {
        return pullRequests[0].number;
    }
};

/**
 * This step also includes making a "dud" commit on the master branch.
 * For brand new repositories, an initial commit is not enough! You must have some kind of
 * change on the master branch in order for the github API to see changes between a fork's branch and master.
 */
let createRepository = (repoUrl) => {
    let data = {
        name: _.last(repoUrl.path.split('/')),
        auto_init: true
    };

    if (config.snappit.cicd.serviceAccount.teamId !== undefined) {
        data.team_id = config.snappit.cicd.serviceAccount.teamId;
    }

    let options = {
        hostname: `api.${repoUrl.hostname}`,
        path: `/orgs/${org}/repos`,
        method: 'POST',
        headers: {
            'User-Agent': 'snappit',
            'Content-Type': 'application/json',
            'Authorization': 'token ' + token
        }
    };

    return new Promise((resolve, reject) => {
        let req = https.request(options, res => {
            if (res.statusCode !== 201) {
                var data = [];
                res.on('data', d => { data.push(d.toString('utf-8'))});
                res.on('end', () => {
                    throw new Error(`(HTTP ${res.statusCode}) Something went wrong while creating the repository ${repoUrl.href}:\n${data.join('')}`);
                });
            }

            res.on('end', () => {
                if (!repositoryExists(repoUrl)) {
                    do {
                        setTimeout(() => {
                            console.log(`Waiting on newly created repository ${repoUrl.href} to appear...`)
                        }, 1000);
                    } while (!repositoryExists(repoUrl))
                }
                resolve(`Created a new repository at ${repoUrl.href}`);
            });
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
    let options = {
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
    execSync(`git submodule add -f ${cloneUrl} ${config.snappit.screenshotsDirectory} > /dev/null`);
    console.log(`Cloned a submodule for screenshots in directory "${config.snappit.screenshotsDirectory}"`);
};

function createForkAndClone() {
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
        let repoName = _.last(screenshotsRepo.path.split('/'));
        let forkedRepo = url.parse(`https://${screenshotsRepo.hostname}/${userName}/${repoName}`);
        if (!repositoryExists(forkedRepo)) {
            return forkRepository(screenshotsRepo).then((message) => {
                console.log(message);
                do {
                    setTimeout(() => {
                        console.log(`Waiting on forked repository ${forkedRepo.href} to appear...`)
                    }, 1000);
                } while (!repositoryExists(forkedRepo))
            });
        } else {
            console.log(`Forked screenshots repository ${forkedRepo.href} already exists.`);
        }

        cloneScreenshotsRepo();
    });
};

function commitScreenshots() {
    let cmds = [
        `pwd`,
        `cd ${config.snappit.screenshotsDirectory}`,
        `pwd`,
        `git checkout -b ${config.snappit.cicd.messages.branchName(vars)}`,
        `git config user.name "${userName}"`,
        `git config user.email "${config.snappit.cicd.serviceAccount.userEmail}"`,
        `git add -A`,
        `git status -sb`,
        `git commit -m "${config.snappit.cicd.messages.commitMessage(vars)}"`
    ];
    cmd(cmds.join('; '));
};

function pushCommit() {
    // pushes to the fork created by the service account by default, not the main screenshots repo
    let repoName = _.last(screenshotsRepo.path.split('/'));
    let pushUrl = `https://${token}@${screenshotsRepo.hostname}/${userName}/${repoName}.git`;
    // don't log any of this information out to the console!
    let sensitiveCommand = [
        `cd ${config.snappit.screenshotsDirectory}`,
        `git push ${pushUrl} ${config.snappit.cicd.messages.branchName(vars)} > /dev/null 2>&1`
    ].join('; ');

    execSync(sensitiveCommand);
};

function makePullRequest() {
    let data = {
        title: config.snappit.cicd.messages.pullRequestTitle(vars),
        body: config.snappit.cicd.messages.pullRequestBody(vars),
        head: `${userName}:${config.snappit.cicd.messages.branchName(vars)}`,
        base: config.snappit.cicd.targetBranch
    };

    let options = {
        hostname: `api.${screenshotsRepo.hostname}`,
        path: `/repos${screenshotsRepo.path}/pulls`,
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
