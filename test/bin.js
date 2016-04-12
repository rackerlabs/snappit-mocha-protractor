'use strict';

const _ = require('lodash');

let depsInstaller = require('../bin/systemDepsInstaller');

let restoreRegexes = (regexes) => {
    _.each(regexes, (regex, property) => {
        depsInstaller[property] = regex;
    });
};

let windowsUninstallableWarning = `
Windows is not supported at this time. Please raise an issue at https://github.com/rackerlabs/snappit-mocha-protractor/issues
In the mean time, use the instructions located at https://github.com/Automattic/node-canvas/wiki/Installation---Windows to use this software.
`;

let brewNotAvailableWarning = `
Brew was not detected! Download and install "brew" before running this command.
See http://brew.sh/ for more information.
`;

let noInstallerAvailableMessage = `
You do not have one of the following supported installers available: ${_.keys(module.exports.installCommands).join(', ')}
Please refer to https://github.com/Automattic/node-canvas#installation for more information on setting up dependencies
`;

let needsSudoError = (installerName, installer) => { `
Using ${installerName} to install image manipulation dependencies requires root.
Either re-run with sudo, or install yourself with:

sudo ${installer.command}
`; };

describe('systemDepsInstaller', function () {
    var oldRegexes;

    describe('windows', function () {
        before(function () {
            oldRegexes = { isWindowsRegex: depsInstaller.isWindowsRegex, isMacRegex: depsInstaller.isMacRegex };
            depsInstaller.isWindowsRegex = /.*/;
            depsInstaller.isMacRegex = /foobar/;
        });

        it('should report that it is a windows install', function () {
            expect(depsInstaller.isWindows()).to.be.true;
            expect(depsInstaller.isMac()).to.be.false;
        });

        it('should report that this tool\'s deps need a manual install', function () {
            expect(depsInstaller.downloadDeps).to.throw(Error);
            expect(depsInstaller.downloadDeps).to.throw(windowsUninstallableWarning);
        });

        after(function () {
            restoreRegexes(oldRegexes);
        });
    });

    describe('mac', function () {
        let brew;

        before(function () {
            oldRegexes = { isWindowsRegex: depsInstaller.isWindowsRegex, isMacRegex: depsInstaller.isMacRegex };
            depsInstaller.isMacRegex = /.*/;
            depsInstaller.isWindowsRegex = /foobar/;

            brew = _.cloneDeep(depsInstaller.installCommands.brew);
            depsInstaller.installCommands.notBrew = brew;
            delete depsInstaller.installCommands.brew;
        });

        it('should report that it is a mac install', function () {
            expect(depsInstaller.isMac()).to.be.true;
            expect(depsInstaller.isWindows()).to.be.false;
        });

        it('should report a warning if brew is not available', function () {
            expect(depsInstaller.downloadDeps).to.throw(Error);
            expect(depsInstaller.downloadDeps).to.throw(brewNotAvailableWarning);
        });

        after(function () {
            depsInstaller.installCommands.brew = brew;
            delete depsInstaller.installCommands.notBrew;
            restoreRegexes(oldRegexes);
        });
    });
});
