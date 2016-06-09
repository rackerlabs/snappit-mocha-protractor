'use strict';

const _ = require('lodash');

exports.showHelpTextAndQuit = (helpText, actions) => {
    if (helpText === undefined) {
        let helpText = `
Usage: snappit-ci configFile [${_.keys(actions).join('|')}]

These actions are meant to be run in order, during different steps in your end to end tests.

Example:

\`npm bin\`/snappit-ci protractor.conf.js clone
\`npm bin\`/protractor
\`npm bin\`/snappit-ci protractor.conf.js commit
\`npm bin\`/snappit-ci protractor.conf.js push
\`npm bin\`/snappit-ci protractor.conf.js pr
`;
    }

    console.log(helpText);
    if (actions) {
        console.log('Actions:');
        _.each(actions, (details, a) => { console.log(a + ':', details.description) });
    }
    process.exit(0);
};

exports.cloneDescription = `
Sets up and clones the screenshots repository into the main project repository.
This includes creating the screenshots repo first, if it does not exist.
It will then create a fork of this screenshots repository, if that does not exist.
Finally, it clones the screenshots repository (as a submodule) into the directory set in 'config.snappit.cicd.screenshotsDirectory'.
Run this command before you have run your visual regression test using protractor.
`;

exports.commitDescription = `
Commit all changed screenshots to the submodule on the branch name specified in 'config.snappit.cicd.messages.branchName'.
Will use the commit message format specified in the config entry for 'config.snappit.cicd.messages.commitMessage'.
Run this command after you have run your visual regression test using protractor.
`;

exports.pushDescription = `
Push up the changes introduced in the "commit" step, on the branch specified in 'config.snappit.cicd.messages.branchName'.
The changes are pushed to the fork of the screenshots repository.
`;

exports.prDescription = `
Create a pull request against the target branch of the screenshots repository, specified in 'config.snappit.cicd.targetBranch'.
The pull request originates from the fork that the service account created in the "clone" step.
The pull request title is configurable from the 'config.snappit.cicd.messages.pullRequestTitle' entry.
The pull request body is configurable from the 'config.snappit.cicd.messages.pullRequestBody' entry.
`;

exports.noPullRequestErrorMessage = function (vars) {
    return `
No pull request currently exists for ${vars.repoSlug}@${vars.sha1}. You will need to open
a pull request for that change set, and re-run this test suite in order to properly handle
visual regression checks.

For more information, see https://github.com/rackerlabs/snappit-mocha-protractor/wiki/0:-snappit-ci#running-visual-regression-tests-without-opening-a-pr-first
`;
};

exports.unknownCIEnvironmentError = `
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
