#!/usr/bin/env node

'use strict';

const child_process = require('child_process');

const _ = require('lodash');

// regexes exported to make testing easier (they're overwritten in the tests)
module.exports.isWindowsRegex = /^win/;
module.exports.isMacRegex = /^darwin/;

exports.isWindows = () => { return module.exports.isWindowsRegex.test(process.platform); };
exports.isMac = () => { return module.exports.isMacRegex.test(process.platform); };

module.exports.installCommands = {
    // https://github.com/Automattic/node-canvas#installation
    brew: { command: 'brew install pkg-config cairo libpng jpeg giflib', sudo: false },
    'apt-get': { command: 'apt-get install libcairo2-dev libjpeg8-dev libpango1.0-dev libgif-dev build-essential g++', sudo: true },
    yum: { command: 'yum install cairo cairo-devel cairomm-devel libjpeg-turbo-devel pango pango-devel pangomm pangomm-devel giflib-devel', sudo: true },
    pkgin: { command: 'pkgin install cairo pkg-config xproto renderproto kbproto xextproto', sudo: false }
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

let detectPackageManager = () => {
    var installedPackageManagers = _.map(_.keys(module.exports.installCommands), installCommand => {
        try {
            let installer = child_process.execSync(`which ${installCommand}`).toString('utf-8').trim();
            console.log(`${installer} detected`);
            return installCommand;
        } catch (e) {}
    });

    return _.first(_.compact(installedPackageManagers));
};

exports.downloadDeps = () => {

    if (exports.isWindows()) {
        throw new Error(windowsUninstallableWarning);
    }

    let installerName = detectPackageManager();
    let installer = module.exports.installCommands[installerName];
    if (installer === undefined) {
        if (exports.isMac()) {
            throw new Error(brewNotAvailableWarning);
        }

        throw new Error(noInstallerAvailableMessage);
    }

    let isSudo = process.getuid() === 0;
    if (installer.sudo && !isSudo) {
        throw new Error(needsSudoError(installerName, installer));
    }

    return child_process.execSync(`${installer.command}`).toString('utf-8');

};

if (require.main === module) {
    console.log(exports.downloadDeps());
}
